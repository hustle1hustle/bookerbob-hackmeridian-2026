//! On-chain check of a REP verdict, so an attested group can be joined without a trusted attester server.
//!
//! Input is exactly what the REP Bob phone presents: the verdict (a compact JWS, `typ rep-attestation+jws`,
//! ES256 by the REP issuer) and a holder proof (a compact KB-JWT, `typ kb+jwt`, ES256 by the device key,
//! carrying that key as `jwk` in its header). Both signatures are P-256 over sha256("header.payload"),
//! checked with the host's secp256r1 verify. The contract decodes the base64url segments itself, so it
//! checks the exact bytes that were signed.
//!
//! Checked: issuer key (pinned per group by the contract admin), typ, alg, iss, rep_profile, nbf, exp,
//! max age since iat, a non-empty lodging tier, the source host, the device key hashing to `cnf.jkt`
//! (RFC 7638), aud, a nonce `pos:<commitment>:<rand>`, at_hash over this exact verdict, a fresh KB iat.
//! Not checkable on-chain: the issuer's revocation status list. `exp` and `max_age` bound the window.

use soroban_sdk::{contracttype, panic_with_error, Bytes, BytesN, Env, Vec, U256};

use crate::Error;

/// Upper bounds for the presented strings; a real verdict is ~1 KB, a KB-JWT ~0.5 KB.
pub const MAX_JWS: usize = 3072;
pub const MAX_KB: usize = 1024;
/// How far a KB-JWT iat may sit from the ledger clock, seconds (the REP verifier kit uses 300).
pub const KB_MAX_SKEW: u64 = 300;
pub const REP_PROFILE: u64 = 1;
const TIER_FIELD: &[u8] = b"lodging_spend_tier";

/// Per-group REP issuer settings, set by the contract admin. Rotation of the REP key = a new `key` here.
#[derive(Clone)]
#[contracttype]
pub struct RepIssuer {
    /// SEC-1 uncompressed P-256 key, 0x04 || x || y, from the issuer's JWKS.
    pub key: BytesN<65>,
    /// Expected `iss`, e.g. https://rep-attest.fly.dev
    pub iss: Bytes,
    /// Expected KB-JWT `aud`, e.g. bookerbob
    pub aud: Bytes,
    /// Oldest verdict accepted, seconds since its `iat` (revocation cannot be read on-chain).
    pub max_age: u64,
    /// Accepted sources: a `server_name` equal to one of these or a subdomain of it.
    pub hosts: Vec<Bytes>,
}

/// What a passing check yields: the replay key (sha256 of the verdict's signing input).
pub struct Checked {
    pub verdict_id: BytesN<32>,
}

fn fail(env: &Env, e: Error) -> ! {
    panic_with_error!(env, e)
}

pub fn check(env: &Env, cfg: &RepIssuer, commitment: &U256, verdict: &Bytes, kb: &Bytes) -> Checked {
    let now = env.ledger().timestamp();

    // ---- the verdict ----
    let vlen = verdict.len() as usize;
    if vlen == 0 || vlen > MAX_JWS {
        fail(env, Error::RepMalformed);
    }
    let mut vbuf = [0u8; MAX_JWS];
    verdict.copy_into_slice(&mut vbuf[..vlen]);
    let v = &vbuf[..vlen];
    let (vh, vp, vs) = split3(v).unwrap_or_else(|| fail(env, Error::RepMalformed));

    let mut hdr = [0u8; 512];
    let hdr = b64u_decode(vh, &mut hdr).unwrap_or_else(|| fail(env, Error::RepMalformed));
    if str_field(hdr, b"typ") != Some(b"rep-attestation+jws") || str_field(hdr, b"alg") != Some(b"ES256") {
        fail(env, Error::RepMalformed);
    }
    let mut sig = [0u8; 64];
    if b64u_decode(vs, &mut sig).map(|s| s.len()) != Some(64) {
        fail(env, Error::RepMalformed);
    }
    let signing_input = &v[..vh.len() + 1 + vp.len()];
    let digest = env.crypto().sha256(&Bytes::from_slice(env, signing_input));
    // Panics (host Crypto error) unless REP's pinned key signed exactly these bytes.
    env.crypto().secp256r1_verify(&cfg.key, &digest, &BytesN::from_array(env, &low_s(sig)));
    let verdict_id: BytesN<32> = digest.into();

    let mut pay = [0u8; MAX_JWS];
    let p = b64u_decode(vp, &mut pay).unwrap_or_else(|| fail(env, Error::RepMalformed));
    if !object_ok(p) {
        fail(env, Error::RepMalformed);
    }
    if !eq_bytes(str_field(p, b"iss"), &cfg.iss) {
        fail(env, Error::RepIssuer);
    }
    if num_field(p, b"rep_profile") != Some(REP_PROFILE) {
        fail(env, Error::RepIssuer);
    }
    let exp = num_field(p, b"exp").unwrap_or_else(|| fail(env, Error::RepExpired));
    let iat = num_field(p, b"iat").unwrap_or_else(|| fail(env, Error::RepExpired));
    if now >= exp || iat.saturating_add(cfg.max_age) < now {
        fail(env, Error::RepExpired);
    }
    if let Some(nbf) = field(p, b"nbf") {
        if parse_u64(nbf).map_or(true, |n| now < n) {
            fail(env, Error::RepExpired);
        }
    }
    match str_field(p, TIER_FIELD) {
        Some(t) if !t.is_empty() => {}
        _ => fail(env, Error::RepNoTier),
    }
    let host = str_field(p, b"server_name").unwrap_or_else(|| fail(env, Error::RepNoTier));
    if !cfg.hosts.iter().any(|h| host_matches(host, &h)) {
        fail(env, Error::RepNoTier);
    }
    let jkt = field(p, b"cnf").and_then(|c| str_field(c, b"jkt")).unwrap_or_else(|| fail(env, Error::RepHolder));

    // ---- the holder proof ----
    let klen = kb.len() as usize;
    if klen == 0 || klen > MAX_KB {
        fail(env, Error::RepMalformed);
    }
    let mut kbuf = [0u8; MAX_KB];
    kb.copy_into_slice(&mut kbuf[..klen]);
    let k = &kbuf[..klen];
    let (kh, kp, ks) = split3(k).unwrap_or_else(|| fail(env, Error::RepMalformed));
    let mut khb = [0u8; 512];
    let kh_json = b64u_decode(kh, &mut khb).unwrap_or_else(|| fail(env, Error::RepMalformed));
    if str_field(kh_json, b"typ") != Some(b"kb+jwt") || str_field(kh_json, b"alg") != Some(b"ES256") {
        fail(env, Error::RepHolder);
    }
    let jwk = field(kh_json, b"jwk").unwrap_or_else(|| fail(env, Error::RepHolder));
    let (jx, jy) = match (str_field(jwk, b"kty"), str_field(jwk, b"crv"), str_field(jwk, b"x"), str_field(jwk, b"y")) {
        (Some(b"EC"), Some(b"P-256"), Some(x), Some(y)) => (x, y),
        _ => fail(env, Error::RepHolder),
    };
    // RFC 7638: sha256 of {"crv","kty","x","y"} in that order, no spaces; must equal the verdict's cnf.jkt.
    let mut tp = Bytes::from_slice(env, b"{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"");
    tp.extend_from_slice(jx);
    tp.extend_from_slice(b"\",\"y\":\"");
    tp.extend_from_slice(jy);
    tp.extend_from_slice(b"\"}");
    let mut enc = [0u8; 43];
    b64u_encode(&env.crypto().sha256(&tp).to_array(), &mut enc);
    if jkt != &enc[..] {
        fail(env, Error::RepHolder);
    }
    let mut key = [0u8; 65];
    key[0] = 0x04;
    let mut xy = [0u8; 33];
    match b64u_decode(jx, &mut xy) {
        Some(x) if x.len() == 32 => key[1..33].copy_from_slice(x),
        _ => fail(env, Error::RepHolder),
    }
    match b64u_decode(jy, &mut xy) {
        Some(y) if y.len() == 32 => key[33..].copy_from_slice(y),
        _ => fail(env, Error::RepHolder),
    }
    let mut ksig = [0u8; 64];
    if b64u_decode(ks, &mut ksig).map(|s| s.len()) != Some(64) {
        fail(env, Error::RepHolder);
    }
    let kdigest = env.crypto().sha256(&Bytes::from_slice(env, &k[..kh.len() + 1 + kp.len()]));
    // Panics (host Crypto error) unless the device key named by cnf.jkt signed this proof.
    env.crypto().secp256r1_verify(&BytesN::from_array(env, &key), &kdigest, &BytesN::from_array(env, &low_s(ksig)));

    let mut kpb = [0u8; 768];
    let kpj = b64u_decode(kp, &mut kpb).unwrap_or_else(|| fail(env, Error::RepMalformed));
    if !object_ok(kpj) {
        fail(env, Error::RepMalformed);
    }
    if !eq_bytes(str_field(kpj, b"aud"), &cfg.aud) {
        fail(env, Error::RepHolder);
    }
    // at_hash binds the proof to this exact verdict string.
    b64u_encode(&env.crypto().sha256(verdict).to_array(), &mut enc);
    if str_field(kpj, b"at_hash") != Some(&enc[..]) {
        fail(env, Error::RepHolder);
    }
    let kiat = num_field(kpj, b"iat").unwrap_or_else(|| fail(env, Error::RepHolder));
    if kiat.abs_diff(now) > KB_MAX_SKEW {
        fail(env, Error::RepHolder);
    }
    // nonce = "pos:<commitment decimal>:<rand>": the proof can only ever add this commitment.
    let nonce = str_field(kpj, b"nonce").unwrap_or_else(|| fail(env, Error::RepNonce));
    let mut dec = [0u8; 78];
    let d = decimal(commitment, &mut dec);
    let pre = 4 + d.len() + 1;
    if nonce.len() <= pre || &nonce[..4] != b"pos:" || &nonce[4..4 + d.len()] != d || nonce[pre - 1] != b':' {
        fail(env, Error::RepNonce);
    }

    Checked { verdict_id }
}

// ---- small no_std helpers over byte slices ----

/// header.payload.signature, each non-empty.
fn split3(s: &[u8]) -> Option<(&[u8], &[u8], &[u8])> {
    let a = s.iter().position(|&c| c == b'.')?;
    let b = a + 1 + s[a + 1..].iter().position(|&c| c == b'.')?;
    let (h, p, g) = (&s[..a], &s[a + 1..b], &s[b + 1..]);
    if h.is_empty() || p.is_empty() || g.is_empty() || g.contains(&b'.') {
        return None;
    }
    Some((h, p, g))
}

fn b64u_val(c: u8) -> Option<u32> {
    Some(match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'-' => 62,
        b'_' => 63,
        _ => return None,
    } as u32)
}

/// Unpadded base64url, canonical only (no padding, zero trailing bits).
pub fn b64u_decode<'a>(s: &[u8], out: &'a mut [u8]) -> Option<&'a [u8]> {
    if s.len() % 4 == 1 {
        return None;
    }
    let n = s.len() / 4 * 3 + match s.len() % 4 { 2 => 1, 3 => 2, _ => 0 };
    if n > out.len() {
        return None;
    }
    let mut o = 0;
    for chunk in s.chunks(4) {
        let mut acc: u32 = 0;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= b64u_val(c)? << (18 - 6 * i);
        }
        let bytes = [(acc >> 16) as u8, (acc >> 8) as u8, acc as u8];
        let take = chunk.len() - 1;
        // the bits past the last whole byte must be zero, or two strings would decode to one value
        if take < 3 && (acc & (0xFF_FFFF >> (8 * take))) != 0 {
            return None;
        }
        out[o..o + take].copy_from_slice(&bytes[..take]);
        o += take;
    }
    Some(&out[..o])
}

const B64U: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// base64url of 32 bytes = 43 chars.
pub fn b64u_encode(d: &[u8; 32], out: &mut [u8; 43]) {
    let mut o = 0;
    for chunk in d.chunks(3) {
        let mut acc: u32 = 0;
        for (i, &b) in chunk.iter().enumerate() {
            acc |= (b as u32) << (16 - 8 * i);
        }
        for i in 0..chunk.len() + 1 {
            out[o] = B64U[((acc >> (18 - 6 * i)) & 63) as usize];
            o += 1;
        }
    }
}

// P-256 group order n and n/2, big-endian.
const P256_N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51,
];
const P256_HALF_N: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xde, 0x73, 0x7d, 0x56, 0xd3, 0x8b, 0xcf, 0x42, 0x79, 0xdc, 0xe5, 0x61, 0x7e, 0x31, 0x92, 0xa8,
];

/// The host only takes low-S; JOSE signers (node, CryptoKit) emit either. (r, n - s) verifies iff (r, s) does.
/// The replay key is the signing-input hash, so this malleability cannot mint a second membership.
pub fn low_s(mut sig: [u8; 64]) -> [u8; 64] {
    if sig[32..] > P256_HALF_N[..] {
        let mut borrow = 0i16;
        for i in (0..32).rev() {
            let d = P256_N[i] as i16 - sig[32 + i] as i16 - borrow;
            borrow = (d < 0) as i16;
            sig[32 + i] = (d + 256 * borrow) as u8;
        }
    }
    sig
}

/// Decimal digits of a U256, no leading zeros.
fn decimal<'a>(v: &U256, out: &'a mut [u8; 78]) -> &'a [u8] {
    let mut n = [0u8; 32];
    v.to_be_bytes().copy_into_slice(&mut n);
    let mut i = out.len();
    loop {
        let mut rem: u16 = 0;
        let mut zero = true;
        for b in n.iter_mut() {
            let cur = (rem << 8) | *b as u16;
            *b = (cur / 10) as u8;
            rem = cur % 10;
            zero &= *b == 0;
        }
        i -= 1;
        out[i] = b'0' + rem as u8;
        if zero {
            break;
        }
    }
    &out[i..]
}

fn eq_bytes(a: Option<&[u8]>, b: &Bytes) -> bool {
    match a {
        Some(a) if a.len() == b.len() as usize => a.iter().zip(b.iter()).all(|(x, y)| *x == y),
        _ => false,
    }
}

/// `host` == h or ends with "." + h.
fn host_matches(host: &[u8], h: &Bytes) -> bool {
    let n = h.len() as usize;
    if host.len() < n || !eq_bytes(Some(&host[host.len() - n..]), h) {
        return false;
    }
    host.len() == n || host[host.len() - n - 1] == b'.'
}

// ---- a minimal JSON reader: top-level members of one object ----
// Enough for JOSE headers and payloads. A key seen twice is refused, so no two readers disagree.

fn ws(j: &[u8], mut i: usize) -> usize {
    while i < j.len() && matches!(j[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

/// j[i] == '"'; returns the index after the closing quote.
fn skip_str(j: &[u8], mut i: usize) -> Option<usize> {
    i += 1;
    while i < j.len() {
        match j[i] {
            b'\\' => i += 2,
            b'"' => return Some(i + 1),
            _ => i += 1,
        }
    }
    None
}

fn skip_value(j: &[u8], i: usize) -> Option<usize> {
    match *j.get(i)? {
        b'"' => skip_str(j, i),
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut k = i;
            while k < j.len() {
                match j[k] {
                    b'"' => {
                        k = skip_str(j, k)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(k + 1);
                        }
                    }
                    _ => {}
                }
                k += 1;
            }
            None
        }
        _ => {
            let mut k = i;
            while k < j.len() && !matches!(j[k], b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r') {
                k += 1;
            }
            if k == i { None } else { Some(k) }
        }
    }
}

/// Walks the object; calls `f(key, value)` per member. None if it is not one well-formed object.
fn members<'a>(j: &'a [u8], mut f: impl FnMut(&'a [u8], &'a [u8])) -> Option<()> {
    let mut i = ws(j, 0);
    if j.get(i) != Some(&b'{') {
        return None;
    }
    i = ws(j, i + 1);
    if j.get(i) == Some(&b'}') {
        return (ws(j, i + 1) == j.len()).then_some(());
    }
    loop {
        if j.get(i) != Some(&b'"') {
            return None;
        }
        let ke = skip_str(j, i)?;
        let key = &j[i + 1..ke - 1];
        i = ws(j, ke);
        if j.get(i) != Some(&b':') {
            return None;
        }
        i = ws(j, i + 1);
        let ve = skip_value(j, i)?;
        f(key, &j[i..ve]);
        i = ws(j, ve);
        match j.get(i) {
            Some(b',') => i = ws(j, i + 1),
            Some(b'}') => return (ws(j, i + 1) == j.len()).then_some(()),
            _ => return None,
        }
    }
}

/// A well-formed object with no duplicate keys.
fn object_ok(j: &[u8]) -> bool {
    let mut dup = false;
    let ok = members(j, |k, _| {
        let mut seen = 0;
        let _ = members(j, |k2, _| seen += (k2 == k) as u32);
        dup |= seen > 1;
    });
    ok.is_some() && !dup
}

/// The raw value of a top-level key; None if absent, repeated, or the object is malformed.
fn field<'a>(j: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut found: Option<&'a [u8]> = None;
    let mut count = 0;
    members(j, |k, v| {
        if k == key {
            count += 1;
            found = Some(v);
        }
    })?;
    if count == 1 { found } else { None }
}

/// A string value without escapes (every field read here is plain ASCII).
fn str_field<'a>(j: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let v = field(j, key)?;
    if v.len() < 2 || v[0] != b'"' || v[v.len() - 1] != b'"' {
        return None;
    }
    let s = &v[1..v.len() - 1];
    if s.contains(&b'\\') { None } else { Some(s) }
}

fn parse_u64(v: &[u8]) -> Option<u64> {
    if v.is_empty() || v.len() > 19 {
        return None;
    }
    let mut n: u64 = 0;
    for &c in v {
        if !c.is_ascii_digit() {
            return None;
        }
        n = n * 10 + (c - b'0') as u64;
    }
    Some(n)
}

fn num_field(j: &[u8], key: &[u8]) -> Option<u64> {
    parse_u64(field(j, key)?)
}
