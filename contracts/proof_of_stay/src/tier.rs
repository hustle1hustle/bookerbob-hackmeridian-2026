//! On-chain check of a REP tier credential, so an attested group can be joined without a trusted operator key
//! and without putting the REP verdict on the ledger.
//!
//! The tier issuer (rep-attest-tier) checks the full REP verdict and the phone's holder proof off chain, spends
//! that verdict once, and signs a compact credential for one commitment. No device key, spend or source reaches
//! the ledger; the tier byte is 1 ("qualified at the policy minimum") unless the issuer is set to write bands.
//!
//! cred, 106 bytes, big-endian:
//!   [0..8)    magic "REPTIER1"
//!   [8]       kid, pinned per group by the contract admin to a SEC-1 P-256 key
//!   [9..41)   group hash, sha256 of the group's name at the issuer (e.g. "rep-verified-traveler")
//!   [41]      tier, 1..
//!   [42..74)  id_commitment
//!   [74..82)  iat, unix seconds
//!   [82..90)  exp, unix seconds
//!   [90..106) jti, spent on use
//! sig: ECDSA P-256 over sha256(cred), raw r||s.

use soroban_sdk::{contracttype, panic_with_error, Bytes, BytesN, Env, U256};

use crate::Error;

pub const CRED_LEN: usize = 106;
pub const MAGIC: &[u8; 8] = b"REPTIER1";
/// Ledger clock may trail the issuer's by this much.
pub const MAX_SKEW: u64 = 60;
/// Longest credential life accepted, whatever the issuer wrote.
pub const MAX_LIFE: u64 = 3600;

/// Per-group policy, set by the contract admin.
#[derive(Clone)]
#[contracttype]
pub struct TierPolicy {
    /// Expected bytes [9..41) of the credential.
    pub group_hash: BytesN<32>,
    /// Lowest tier admitted (1 = any qualified holder).
    pub min_tier: u32,
}

pub struct Checked {
    pub kid: u32,
    pub jti: BytesN<16>,
}

fn fail(env: &Env, e: Error) -> ! {
    panic_with_error!(env, e)
}

fn be_u64(b: &[u8]) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(b);
    u64::from_be_bytes(a)
}

/// Format and policy checks that need no key. Returns the kid; the caller looks up the key and verifies.
pub fn check(env: &Env, policy: &TierPolicy, commitment: &U256, cred: &BytesN<CRED_LEN>) -> Checked {
    let c = cred.to_array();
    if &c[0..8] != MAGIC {
        fail(env, Error::RepMalformed);
    }
    if c[9..41] != policy.group_hash.to_array() {
        fail(env, Error::RepIssuer);
    }
    if c[41] == 0 || (c[41] as u32) < policy.min_tier {
        fail(env, Error::RepNoTier);
    }
    let mut cm = [0u8; 32];
    commitment.to_be_bytes().copy_into_slice(&mut cm);
    if c[42..74] != cm {
        fail(env, Error::RepNonce);
    }
    let (iat, exp, now) = (be_u64(&c[74..82]), be_u64(&c[82..90]), env.ledger().timestamp());
    if exp <= iat || exp - iat > MAX_LIFE || now >= exp || now.saturating_add(MAX_SKEW) < iat {
        fail(env, Error::RepExpired);
    }
    let mut jti = [0u8; 16];
    jti.copy_from_slice(&c[90..106]);
    Checked { kid: c[8] as u32, jti: BytesN::from_array(env, &jti) }
}

/// Panics (host Crypto error) unless `key` signed exactly this credential.
pub fn verify(env: &Env, key: &BytesN<65>, cred: &BytesN<CRED_LEN>, sig: &BytesN<64>) {
    let digest = env.crypto().sha256(&Bytes::from(cred.clone()));
    env.crypto().secp256r1_verify(key, &digest, &BytesN::from_array(env, &low_s(sig.to_array())));
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

/// The host only takes low-S. (r, n - s) verifies iff (r, s) does; replay is keyed on jti, not the signature.
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
