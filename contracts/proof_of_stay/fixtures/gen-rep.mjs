// Fixtures for the on-chain REP check (src/rep.rs tests). Same shape as a live rep-attest.fly.dev verdict and
// a REP Bob KB-JWT, signed with throwaway local keys. No PII: tier and band only, the hashes are synthetic.
// Run: node contracts/proof_of_stay/fixtures/gen-rep.mjs > contracts/proof_of_stay/fixtures/rep.json
import { createHash, generateKeyPairSync, sign } from "node:crypto"

const b64u = (x) => Buffer.from(x).toString("base64url")
const sha = (x) => createHash("sha256").update(x).digest()
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const key = () => generateKeyPairSync("ec", { namedCurve: "P-256" })
const jwk = (k) => { const j = k.publicKey.export({ format: "jwk" }); return { crv: j.crv, kty: "EC", x: j.x, y: j.y } }
const sec1 = (k) => { const j = jwk(k); return "04" + Buffer.from(j.x, "base64url").toString("hex") + Buffer.from(j.y, "base64url").toString("hex") }
const thumb = (j) => b64u(sha(JSON.stringify({ crv: j.crv, kty: "EC", x: j.x, y: j.y })))
const isHigh = (sig) => BigInt("0x" + sig.subarray(32).toString("hex")) > N / 2n
// want: "high" | "low" | undefined, so both S forms are covered
function jws(header, payload, k, want) {
  const si = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`
  for (;;) {
    const sig = sign("sha256", Buffer.from(si), { key: k.privateKey, dsaEncoding: "ieee-p1363" })
    if (!want || (want === "high") === isHigh(sig)) return `${si}.${b64u(sig)}`
  }
}

const NOW = Number(process.env.REP_FIXTURE_NOW ?? 1_792_900_000)
const issuer = key(), device = key(), other = key()
const COMMITMENT = "12345678901234567890123456789012345678901234567890123456789012345678901234567"
const verdictPayload = (over = {}) => ({
  iss: "https://rep-attest.fly.dev", rep_profile: 1, derivation_id: "rep-derive-v1",
  vct: "https://r3p.xyz/vct/travel", iat: NOW - 3600, nbf: NOW - 3600, exp: NOW - 3600 + 30 * 86400,
  assurance_tier: "co-signed", disclosure: "bands", lodging_spend_tier: "T2",
  attestation_hash: b64u(sha("synthetic")), notary_key_id: "rep-notary-v1", server_name: "www.airbnb.com",
  evidence_time: NOW - 7200, status: { status_list: { uri: "https://rep-attest.fly.dev/status/1", idx: 42 } },
  cnf: { jkt: thumb(jwk(device)) }, ...over,
})
const VH = { alg: "ES256", typ: "rep-attestation+jws", kid: "rep-attest-1" }
const verdict = (over, k = issuer, want) => jws(VH, verdictPayload(over), k, want)
const kb = (v, { nonce = `pos:${COMMITMENT}:${"ab".repeat(16)}`, aud = "bookerbob", iat = NOW, signer = device, carried = device, want } = {}) =>
  jws({ alg: "ES256", jwk: { ...jwk(carried) }, typ: "kb+jwt" }, { at_hash: b64u(sha(v)), aud, iat, nonce }, signer, want)

const good = verdict({}, issuer, "high")
const goodLow = verdict({}, issuer, "low")
const noTier = verdict({ lodging_spend_tier: undefined })
const notLodging = verdict({ server_name: "www.amazon.com" })
const wrongIss = verdict({ iss: "https://evil.example" })
const forged = verdict({}, other)
const second = `pos:${COMMITMENT.replace(/7$/, "8")}:${"cd".repeat(16)}`
// the same verdict with S replaced by n - S: still a valid ES256 signature, a different compact string
const flip = (c) => {
  const [h, p, g] = c.split("."), sig = Buffer.from(g, "base64url")
  const s2 = (N - BigInt("0x" + sig.subarray(32).toString("hex"))).toString(16).padStart(64, "0")
  return `${h}.${p}.${b64u(Buffer.concat([sig.subarray(0, 32), Buffer.from(s2, "hex")]))}`
}
const flipped = flip(good)
const out = {
  now: NOW, commitment: COMMITMENT, issuer_key: sec1(issuer), other_key: sec1(other),
  good: { verdict: good, kb: kb(good, { want: "high" }) },
  good_low_s: { verdict: goodLow, kb: kb(goodLow, { want: "low" }) },
  forged_issuer: { verdict: forged, kb: kb(forged) },
  wrong_device_thumb: { verdict: good, kb: kb(good, { signer: other, carried: other }) },
  wrong_device_sig: { verdict: good, kb: kb(good, { signer: other, carried: device }) },
  nonce_other_commitment: { verdict: good, kb: kb(good, { nonce: second }) },
  wrong_aud: { verdict: good, kb: kb(good, { aud: "someone-else" }) },
  no_tier: { verdict: noTier, kb: kb(noTier) },
  not_lodging: { verdict: notLodging, kb: kb(notLodging) },
  wrong_iss: { verdict: wrongIss, kb: kb(wrongIss) },
  at_hash_other_verdict: { verdict: good, kb: kb(goodLow) },
  replay_s_flipped: { verdict: flipped, kb: kb(flipped, { nonce: second }), commitment: COMMITMENT.replace(/7$/, "8") },
  replay_second_commitment: { verdict: good, kb: kb(good, { nonce: second }), commitment: COMMITMENT.replace(/7$/, "8") },
}
console.log(JSON.stringify(out, null, 1))
