// Copied unmodified from the REP verifier kit (r3pb0b/commerce src/verify-rep.mjs), which is meant to be copied.
// Verify a REP attestation. Copy this file into your project; it has no
// dependencies beyond Node's built-in crypto.
//
// What you get: a signed statement from REP that a specific person's verified
// context meets a band, checked against REP's published key. What you do NOT
// get, by design: the underlying values, or the transcript they came from.
//
//   import { verifyRepAttestation } from './verify-rep.mjs';
//   const r = await verifyRepAttestation(jws, { audience: 'your-verifier-id' });
//   if (r.valid) { /* r.verdict.lodging_spend_tier === 'T3' */ }
//   if (r.personhood?.src === 'world') { /* a real human, as of r.personhood.as_of */ }
//
// Every failure returns a stable code in r.reasons. Branch on the codes, never
// on message text.

import { createPublicKey, verify as verifyRaw, createHash } from 'node:crypto';

const DEFAULT_ISSUER = 'https://r3p.xyz';

/// The rule set this verifier implements. A verdict carries the profile it was
/// written under, and a verifier refuses a profile it does not know rather than
/// reading it under the wrong rules. Bump only when the MEANING of a field
/// changes, never for an addition a old verifier can safely ignore.
export const REP_PROFILE = 1;

/// Fields that are envelope machinery rather than statements about the person.
/// `personhood` is a statement about the person, so it stays in the verdict (where an
/// envelope's readable copy has it too) and also comes back on its own (step 7).
const META = new Set(['iss', 'vct', 'iat', 'nbf', 'exp', 'status', 'cnf',
                      'attestation_hash', 'notary_key_id', 'server_name',
                      'evidence_time', 'assurance_tier', 'disclosure',
                      'rep_profile', 'derivation_id']);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/// The personhood levels this kit hands back. A level it does not know reads as no claim.
const KNOWN_LEVELS = new Set(['orb']);

const b64uJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/**
 * @param {string} jws  the compact attestation
 * @param {object} opts
 *   issuer          expected issuer, default https://r3p.xyz
 *   jwks            pre-fetched JWKS (skip the network); otherwise fetched from issuer
 *   audience        if set, require the holder's KB-JWT to name you (pass kbJwt too)
 *   kbJwt           the holder's key-binding JWT, if you demanded one
 *   nonce           the challenge you issued, checked against the KB-JWT
 *   maxEvidenceAge  seconds; reject if the underlying proof is older
 *   checkRevocation default true; fetches the status list
 *   now             unix seconds, for testing
 */
export async function verifyRepAttestation(jws, opts = {}) {
  const {
    issuer = DEFAULT_ISSUER, jwks = null, audience = null, kbJwt = null, nonce = null,
    maxEvidenceAge = null, checkRevocation = true, now = Math.floor(Date.now() / 1000),
    kbMaxAge = 300,
  } = opts;

  const reasons = [];
  let header, payload;
  try {
    const [h, p] = jws.split('.');
    header = b64uJson(h); payload = b64uJson(p);
  } catch { return { valid: false, reasons: ['MALFORMED'], verdict: null }; }

  // 0. WHAT KIND OF DOCUMENT IS THIS.
  //
  // Everything below asks whether the signature is good. Nothing asked what was
  // signed, and REP signs more than one kind of document with the same key: the
  // status list token at /status/1 is public, fetched by this very file, and it
  // used to come back from here as `{ valid: true, reasons: [] }` with a
  // `verdict` of `{ sub, ttl, status_list }`. A partner whose gate reads `valid`
  // let it through.
  //
  // attest.mjs has had this check since the holder-binding pass; the copy a
  // partner actually runs did not, which is the real lesson: three verifiers for
  // one document means the weakest one is the one in the field.
  if (header.typ !== 'rep-attestation+jws') reasons.push('WRONG_TYPE');

  // The profile is what makes every later tightening possible. This kit is
  // distributed by copy-paste, so a fix cannot be pushed: a partner running an
  // old copy must REFUSE a document written to rules it does not know, rather
  // than interpret it under the old ones. There is no version 2 yet, and the
  // point is that there can be.
  if (payload.rep_profile !== REP_PROFILE) reasons.push('UNKNOWN_PROFILE');

  // 1. whose key are we about to trust
  let keys = jwks?.keys;
  if (!keys) {
    try {
      const res = await fetch(`${issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
      keys = (await res.json()).keys;
    } catch { return { valid: false, reasons: ['ISSUER_UNKNOWN'], verdict: null, payload }; }
  }
  if (!Array.isArray(keys)) return { valid: false, reasons: ['ISSUER_UNKNOWN'], verdict: null, payload };
  // No `|| keys[0]` fallback. A kid that names no published key is an unknown
  // key, and quietly verifying against a different one turns key rotation into a
  // silent acceptance of documents signed by a retired key.
  const key = header.kid ? keys.find(k => k.kid === header.kid) : (keys.length === 1 ? keys[0] : null);
  if (!key) reasons.push('ISSUER_UNKNOWN');
  if (payload.iss !== issuer) reasons.push('ISSUER_UNKNOWN');

  // 2. is the statement authentic and unmodified
  if (key && !verifySig(jws, key)) reasons.push('SIGNATURE_INVALID');

  // STOP HERE if we do not know whose statement this is. Everything below reads
  // fields out of the payload, and step 4 makes an outbound request to a URL taken
  // from it. Continuing past a failed signature means an attacker chooses where we
  // connect by handing us a document we already know is forged.
  if (reasons.length) return { valid: false, reasons, verdict: null, payload };

  // 3. is it currently valid
  if (payload.nbf && now < payload.nbf) reasons.push('NOT_YET_VALID');
  if (payload.exp && now >= payload.exp) reasons.push('EXPIRED');

  // 4. has it been revoked since it was issued
  if (checkRevocation && payload.status?.status_list) {
    const st = await fetchStatus(payload.status.status_list, keys);
    if (st === 'revoked') reasons.push('REVOKED');
    else if (st === 'unavailable') reasons.push('STATUS_UNAVAILABLE');  // your policy: fail open or closed
  }

  // 5. is the party in front of you the one it was issued to
  //
  // This block used to be decorative and it is worth saying why, because the shape
  // of the mistake is easy to repeat. It read the holder key from `payload.cnf.jwk`
  // and gated every real check on that value being present. The issuer only ever
  // writes `cnf.jkt`, a THUMBPRINT, so the key was always null, both the signature
  // check and the thumbprint comparison silently did nothing, and the only
  // surviving comparisons read `aud` and `nonce` out of an unverified blob. A
  // key-binding JWT whose signature was the literal characters AAAA passed.
  //
  // The shape below is DPoP's (RFC 9449): a thumbprint in the envelope is correct
  // and sufficient, PROVIDED the proof carries its own public key and we check that
  // the key hashes to the thumbprint. Nothing is conditional: if a binding was
  // asked for and cannot be checked, that is a failure, not a skip.
  if (audience || nonce || kbJwt) {
    const fail = () => { if (!reasons.includes('HOLDER_BINDING_FAILED')) reasons.push('HOLDER_BINDING_FAILED'); };

    if (!kbJwt) fail();
    else if (!payload.cnf?.jkt) fail();   // envelope names no holder: nothing to bind to
    else {
      let kbHeader = null, kb = null;
      try {
        kbHeader = b64uJson(kbJwt.split('.')[0]);
        kb = b64uJson(kbJwt.split('.')[1]);
      } catch { /* stays null, fails below */ }

      const presentedJwk = kbHeader?.jwk || null;
      if (!kb || !presentedJwk) fail();
      else {
        // the presented key must BE the key the verdict was issued to
        if (jwkThumbprint(presentedJwk) !== payload.cnf.jkt) fail();
        // and it must actually have signed this proof
        if (!verifySig(kbJwt, presentedJwk)) fail();
        // presented to us, for this challenge
        if (audience && kb.aud !== audience) fail();
        if (nonce && kb.nonce !== nonce) fail();
        // and for THIS verdict: without it, one key-binding proof is reusable across
        // every verdict the same holder owns
        if (kb.at_hash !== sha256b64u(jws)) fail();
        // and recently: a captured proof otherwise replays for as long as the verdict lives
        if (!Number.isFinite(kb.iat) || Math.abs(now - kb.iat) > kbMaxAge) fail();
      }
    }
  }

  // 6. is the underlying fact recent enough for your decision
  // Fails CLOSED. The old shape was `maxEvidenceAge && payload.evidence_time &&
  // ...`, so a verdict whose evidence_time is null skipped the check entirely and
  // read as fresh — and null is a shape the issuer emits whenever the notary did
  // not report a session time. A caller who asked for a freshness bound and got
  // silence must be told, not reassured.
  if (maxEvidenceAge && typeof payload.evidence_time !== 'number')
    reasons.push('EVIDENCE_TIME_UNKNOWN');
  if (maxEvidenceAge && payload.evidence_time && (now - payload.evidence_time) > maxEvidenceAge)
    reasons.push('EVIDENCE_STALE');

  // 7. a real human, as of when, if the verdict says so. Optional: REP adds it only when the
  // holder brought a fresh World check bound to this very proof, and it names no one:
  // { level: 'orb', as_of: <unix seconds>, src: 'world' }. REP checked that World check and signs
  // the claim with its own key, like every band. src 'world-sandbox' is a test setup's, which
  // nothing that prices or admits should take. A claim that is not even shaped like one is a
  // verdict this kit cannot read. A level it does not know yet is a claim it does not hand back
  // (`personhood: null` below), in a verdict that stays valid, so a new level needs no new profile.
  const ph = payload.personhood;
  if (ph !== undefined && !(isObject(ph) && typeof ph.level === 'string' && Number.isFinite(ph.as_of) && typeof ph.src === 'string'))
    reasons.push('MALFORMED_PERSONHOOD');

  // A failed document still PARSES, so its claims are readable. Handing them back
  // anyway is how a caller writes `if (r.verdict.tier === 'T3')` and never notices
  // it forgot to check `valid`. Nothing readable comes out of a document that did
  // not check out.
  const ok = reasons.length === 0;
  const verdict = ok
    ? Object.fromEntries(Object.entries(payload).filter(([k]) => !META.has(k)))
    : null;
  return {
    valid: ok,
    reasons,
    verdict,                       // the bands, e.g. { lodging_spend_tier: 'T3' }, plus personhood when present; null if invalid
    evidence: {
      platform: payload.server_name,
      notary_key_id: payload.notary_key_id,
      proved_at: payload.evidence_time,
      hash: payload.attestation_hash,
    },
    assurance: payload.assurance_tier,
    disclosure: payload.disclosure,   // 'bands' or 'detail'
    // { level: 'orb', as_of, src } when the verdict says so in a level this kit knows, else null
    personhood: ok && isObject(payload.personhood) && KNOWN_LEVELS.has(payload.personhood.level) ? payload.personhood : null,
    valid_until: payload.exp,
    payload,
  };
}

function verifySig(compact, jwk) {
  try {
    const [h, p, s] = compact.split('.');
    const key = createPublicKey({ key: { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
    return verifyRaw('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' },
                     Buffer.from(s, 'base64url'));
  } catch { return false; }
}

/// base64url(sha256(x)). Used to bind a key-binding proof to one specific verdict.
function sha256b64u(x) {
  return createHash('sha256').update(x).digest('base64url');
}

function jwkThumbprint(jwk) {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: 'EC', x: jwk.x, y: jwk.y });
  return createHash('sha256').update(canonical).digest('base64url');
}

/// Fetch the status list and read this credential's bit.
/// A list is only meaningful if its `sub` is the URI the credential named, so a
/// different list cannot be substituted for it.
async function fetchStatus({ uri, idx }, keys = null) {
  try {
    // https only, and time-bounded. This runs on a URI that came out of a document
    // we are still deciding whether to believe, so an untimed fetch to an arbitrary
    // scheme is the caller's problem, not the issuer's.
    //
    // Loopback over http is the one carve-out, because local development and the
    // test harness have no certificate and an attacker gains nothing by pointing us
    // at our own machine. Any other http URI is refused rather than followed.
    const u = (() => { try { return new URL(uri); } catch { return null; } })();
    const loopback = u && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1');
    if (!u || (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback))) return 'unavailable';
    const res = await fetch(uri, {
      headers: { accept: 'application/statuslist+jwt' },
      signal: AbortSignal.timeout(10_000),
    });
    const token = (await res.text()).trim();
    const payload = b64uJson(token.split('.')[1]);
    // The token is SIGNED for exactly this purpose. Reading the bit without
    // checking the signature makes revocation a claim by whoever answered the
    // request, which on a compromised or substituted endpoint is the attacker.
    if (keys?.length) {
      const kh = b64uJson(token.split('.')[0]);
      const k = keys.find(x => !kh.kid || x.kid === kh.kid) || keys[0];
      if (!k || !verifySig(token, k)) return 'unavailable';
    }
    if (payload.sub !== uri) return 'unavailable';
    const { inflateRawSync } = await import('node:zlib');
    const bits = inflateRawSync(Buffer.from(payload.status_list.lst, 'base64url'));
    return (bits[idx >> 3] ?? 0) & (1 << (idx & 7)) ? 'revoked' : 'valid';
  } catch { return 'unavailable'; }
}

// ---------------------------------------------------------------------------
// CLI. The point of this kit is that a partner engineer gets a green check on
// day one; making them write the wiring first defeats that.
//
//   node verify-rep.mjs <jws> [issuer-url | path/to/jwks.json]
//
// Exit code is the answer: 0 valid, 1 not. So it drops into a smoke test or a
// CI step without anyone parsing prose.
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const [jws, where] = process.argv.slice(2);
  if (!jws) {
    console.error('usage: node verify-rep.mjs <jws> [issuer-url | path/to/jwks.json]');
    process.exit(2);
  }
  const opts = {};
  if (where) {
    if (/^https?:/.test(where)) opts.issuer = where.replace(/\/$/, '');
    else {
      const { readFileSync: rf } = await import('node:fs');
      opts.jwks = JSON.parse(rf(where, 'utf8'));
      opts.checkRevocation = false; // an offline JWKS means no network for the list either
    }
  }
  const r = await verifyRepAttestation(jws, opts);
  console.log(r.valid ? 'VALID' : 'INVALID');
  // Only print the bands when the verdict is valid. An invalid attestation still
  // PARSES, so its claims are readable, and printing them next to the word
  // INVALID is how someone skims the output and quietly believes an unverified
  // number. If it did not check out, it has no verdict to report.
  if (r.valid) {
    const bands = Object.entries(r.verdict || {}).filter(([k]) => k !== 'personhood').map(([k, v]) => `${k}=${v}`).join('  ');
    if (bands) console.log('  verdict: ' + bands);
    if (r.payload?.server_name) console.log('  source : ' + r.payload.server_name);
    if (r.personhood) console.log(`  human  : ${r.personhood.level}, as of ${new Date(r.personhood.as_of * 1000).toISOString()} (${r.personhood.src})`);
  }
  if (r.reasons?.length) console.log('  reasons: ' + r.reasons.join(', '));
  process.exit(r.valid ? 0 : 1);
}
