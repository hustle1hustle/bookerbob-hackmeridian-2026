extern crate std;

use crate::tier::{self, TierPolicy};
use crate::{Error, ProofOfStay, ProofOfStayClient};
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use sha2::{Digest, Sha256};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env, String as SString, Symbol, U256,
};
use std::vec::Vec as StdVec;

// Cross-implementation vector from the tier issuer (rep-attest-tier), throwaway test key. Its audience predates
// the contract binding, so it checks the byte layout and the signature, not admission.
const UCP_KEY: &str = "04640511a16881c6010f7b226a7dc86bb7813fb899f554bff1c8a05454575787bff88a6524702719e152612eb94af95748c969c239565a08c7567932b87643f278";
const UCP_CRED: &str = "524550544945523101fd7e957d201f506666bd60c5a3d4586f28a25f93b60e560ea3f62ee21ad6bf7501000000000000000000000000000000000000000000000000ab54a98ceb1f0ad2000000006add7ba0000000006add7df800112233445566778899aabbccddeeff";
const UCP_SIG: &str = "062d5a764d586d1b07cbb7f1073c90f1312767cbea110870077199aa7415575f6b74577685ba1d6e816983d2764e8b5053b4d9e1b91f2b31804f4b59d4e81d3a";

const NOW: u64 = 1_792_900_000;
const N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51,
];

struct T<'a> {
    env: Env,
    client: ProofOfStayClient<'a>,
    group: u32,
    issuer: SigningKey,
    jti: core::cell::Cell<u8>,
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32].into()).unwrap()
}

fn sec1(env: &Env, k: &SigningKey) -> BytesN<65> {
    BytesN::from_array(env, &k.verifying_key().to_encoded_point(false).as_bytes().try_into().unwrap())
}

fn hexn<const L: usize>(env: &Env, h: &str) -> BytesN<L> {
    BytesN::from_array(env, &hex::decode(h).unwrap().try_into().unwrap())
}

fn cm(env: &Env, last: u8) -> U256 {
    let mut b = [0u8; 32];
    b[1] = 0x12;
    b[31] = last;
    U256::from_be_bytes(env, &Bytes::from_array(env, &b))
}

#[derive(Clone)]
struct Cred {
    magic: [u8; 8],
    kid: u8,
    audience: [u8; 32],
    tier: u8,
    commitment: [u8; 32],
    iat: u64,
    exp: u64,
    jti: [u8; 16],
}

impl Cred {
    fn bytes(&self) -> [u8; 106] {
        let mut b = StdVec::with_capacity(106);
        b.extend_from_slice(&self.magic);
        b.push(self.kid);
        b.extend_from_slice(&self.audience);
        b.push(self.tier);
        b.extend_from_slice(&self.commitment);
        b.extend_from_slice(&self.iat.to_be_bytes());
        b.extend_from_slice(&self.exp.to_be_bytes());
        b.extend_from_slice(&self.jti);
        b.try_into().unwrap()
    }
}

/// Raw r||s over sha256(cred), as the issuer signs it. p256 emits low-S.
fn sign(k: &SigningKey, cred: &[u8; 106]) -> [u8; 64] {
    let d = Sha256::digest(cred);
    let s: Signature = k.sign_prehash(&d).unwrap();
    s.to_bytes().into()
}

fn high_s(mut sig: [u8; 64]) -> [u8; 64] {
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let d = N[i] as i16 - sig[32 + i] as i16 - borrow;
        borrow = (d < 0) as i16;
        sig[32 + i] = (d + 256 * borrow) as u8;
    }
    sig
}

fn tsetup<'a>() -> T<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_timestamp(NOW);
    let (vk, _, _) = crate::test::load_vk(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(ProofOfStay, (Address::generate(&env), Address::generate(&env), sac.address(), vk));
    let client = ProofOfStayClient::new(&env, &id);
    client.create_group(&Symbol::new(&env, "chain"), &Address::generate(&env), &SString::from_str(&env, "network"));
    let group = client.create_group(&Symbol::new(&env, "attested"), &Address::generate(&env), &SString::from_str(&env, "REP verified traveler"));
    client.set_tier_policy(&group, &TierPolicy { min_tier: 1 });
    let issuer = key(7);
    client.set_tier_issuer(&group, &1, &Some(sec1(&env, &issuer)));
    T { env, client, group, issuer, jti: core::cell::Cell::new(0) }
}

impl<'a> T<'a> {
    fn cred(&self, commitment: &U256) -> Cred {
        let mut c = [0u8; 32];
        commitment.to_be_bytes().copy_into_slice(&mut c);
        self.jti.set(self.jti.get() + 1);
        Cred {
            magic: *b"REPTIER1",
            kid: 1,
            audience: self.client.tier_audience(&self.group).to_array(),
            tier: 1,
            commitment: c,
            iat: NOW - 10,
            exp: NOW + 590,
            jti: [self.jti.get(); 16],
        }
    }
    fn submit(&self, commitment: &U256, cred: &Cred, sig: [u8; 64]) -> Result<U256, Option<Error>> {
        let r = self.client.try_add_member_with_tier(&self.group, commitment, &BytesN::from_array(&self.env, &cred.bytes()), &BytesN::from_array(&self.env, &sig));
        match r {
            Ok(Ok(root)) => Ok(root),
            // contract errors come back as Some, a failed P-256 check (host Crypto error) as None
            Err(Ok(e)) => Err(if e.is_type(soroban_sdk::xdr::ScErrorType::Contract) {
                Some(Error::try_from(e.get_code()).ok().unwrap())
            } else {
                None
            }),
            other => panic!("{other:?}"),
        }
    }
    fn size(&self) -> u32 {
        self.client.get_group(&self.group).tree.size
    }
}

impl TryFrom<u32> for Error {
    type Error = ();
    fn try_from(c: u32) -> Result<Self, ()> {
        Ok(match c {
            11 => Error::BadParams,
            15 => Error::RepNotConfigured,
            16 => Error::RepMalformed,
            17 => Error::RepIssuer,
            18 => Error::RepExpired,
            19 => Error::RepNoTier,
            21 => Error::RepNonce,
            22 => Error::RepReplay,
            24 => Error::NotMember,
            25 => Error::BadPath,
            4 => Error::DuplicateLeaf,
            _ => return Err(()),
        })
    }
}

#[test]
fn credential_joins_and_costs() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let cred = t.cred(&c);
    let sig = sign(&t.issuer, &cred.bytes());
    t.env.cost_estimate().budget().reset_default();
    let root = t.submit(&c, &cred, sig).unwrap();
    let b = t.env.cost_estimate().budget();
    std::println!("add_member_with_tier cpu={} mem={}", b.cpu_instruction_cost(), b.memory_bytes_cost());
    t.env.cost_estimate().budget().reset_unlimited();
    assert_eq!((t.size(), t.client.get_group(&t.group).tree.root(&t.env)), (1, root));
    assert!(t.client.is_tier_used(&BytesN::from_array(&t.env, &cred.jti)));
}

#[test]
fn audience_is_contract_and_group() {
    let t = tsetup();
    let id = t.client.address.to_string();
    let mut buf = [0u8; 56];
    id.copy_into_slice(&mut buf);
    let want = Sha256::digest(std::format!("{}:{}", std::str::from_utf8(&buf).unwrap(), t.group).as_bytes());
    assert!(buf.starts_with(b"C"));
    assert_eq!(t.client.tier_audience(&t.group).to_array(), <[u8; 32]>::from(want));
    assert_ne!(t.client.tier_audience(&t.group), t.client.tier_audience(&0));
}

#[test]
fn high_s_signature_passes() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let cred = t.cred(&c);
    t.submit(&c, &cred, high_s(sign(&t.issuer, &cred.bytes()))).unwrap();
}

#[test]
fn issuer_vector_signature_verifies() {
    let env = Env::default();
    let cred: BytesN<106> = hexn(&env, UCP_CRED);
    tier::verify(&env, &hexn(&env, UCP_KEY), &cred, &hexn(&env, UCP_SIG));
    let a = cred.to_array();
    assert_eq!(&a[0..8], b"REPTIER1");
    assert_eq!((a[8], a[41]), (1, 1));
}

#[test]
fn forged_signature_fails() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let cred = t.cred(&c);
    assert_eq!(t.submit(&c, &cred, sign(&key(9), &cred.bytes())), Err(None));
    assert_eq!(t.size(), 0);
}

#[test]
fn credential_for_another_commitment_fails() {
    let t = tsetup();
    let cred = t.cred(&cm(&t.env, 1));
    assert_eq!(t.submit(&cm(&t.env, 2), &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepNonce)));
}

#[test]
fn credential_for_another_group_or_contract_fails() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    // signed for group 0 of this contract, submitted to the attested group: a front-run cannot move it
    let mut cred = t.cred(&c);
    cred.audience = t.client.tier_audience(&0).to_array();
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepIssuer)));
    // the issuer-name audience used before the binding
    cred.audience = Sha256::digest(b"rep-verified-traveler").into();
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepIssuer)));
    // signed for the same group id of another deployment
    let (vk, _, _) = crate::test::load_vk(&t.env);
    let sac = t.env.register_stellar_asset_contract_v2(Address::generate(&t.env));
    let id2 = t.env.register(ProofOfStay, (Address::generate(&t.env), Address::generate(&t.env), sac.address(), vk));
    let c2 = ProofOfStayClient::new(&t.env, &id2);
    assert_ne!(id2, t.client.address);
    let mut cred = t.cred(&c);
    cred.audience = c2.tier_audience(&t.group).to_array();
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepIssuer)));
    assert_eq!(t.size(), 0);
}

#[test]
fn bad_magic_or_unknown_kid_fails() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let mut cred = t.cred(&c);
    cred.magic = *b"REPTIER2";
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepMalformed)));
    let mut cred = t.cred(&c);
    cred.kid = 7;
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepIssuer)));
}

#[test]
fn tier_below_policy_fails() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let mut cred = t.cred(&c);
    cred.tier = 0;
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepNoTier)));
    t.client.set_tier_policy(&t.group, &TierPolicy { min_tier: 3 });
    let mut cred = t.cred(&c);
    cred.tier = 2;
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepNoTier)));
    let mut cred = t.cred(&c);
    cred.tier = 3;
    t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())).unwrap();
}

#[test]
fn expired_early_or_long_lived_fails() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let cases: [(u64, u64); 3] = [(NOW - 700, NOW - 100), (NOW + 120, NOW + 700), (NOW - 10, NOW + 7200)];
    for (iat, exp) in cases {
        let mut cred = t.cred(&c);
        (cred.iat, cred.exp) = (iat, exp);
        assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepExpired)), "{iat} {exp}");
    }
    // a good credential at its exp
    let cred = t.cred(&c);
    t.env.ledger().set_timestamp(cred.exp);
    assert_eq!(t.submit(&c, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepExpired)));
    assert_eq!(t.size(), 0);
}

#[test]
fn replay_fails_even_with_flipped_s() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let cred = t.cred(&c);
    let sig = sign(&t.issuer, &cred.bytes());
    t.submit(&c, &cred, sig).unwrap();
    assert_eq!(t.submit(&c, &cred, sig), Err(Some(Error::RepReplay)));
    assert_eq!(t.submit(&c, &cred, high_s(sig)), Err(Some(Error::RepReplay)));
    assert_eq!(t.size(), 1);
}

#[test]
fn rotation_and_removal() {
    let t = tsetup();
    let new = key(8);
    t.client.set_tier_issuer(&t.group, &2, &Some(sec1(&t.env, &new)));
    let (c1, c2) = (cm(&t.env, 1), cm(&t.env, 2));
    let mut cred = t.cred(&c1);
    cred.kid = 2;
    t.submit(&c1, &cred, sign(&new, &cred.bytes())).unwrap();
    // kid 2 signed by the old key fails
    let mut cred = t.cred(&c2);
    cred.kid = 2;
    assert_eq!(t.submit(&c2, &cred, sign(&t.issuer, &cred.bytes())), Err(None));
    t.client.set_tier_issuer(&t.group, &1, &None);
    assert!(t.client.get_tier_issuer(&t.group, &1).is_none());
    let cred = t.cred(&c2);
    assert_eq!(t.submit(&c2, &cred, sign(&t.issuer, &cred.bytes())), Err(Some(Error::RepIssuer)));
}

#[test]
fn needs_an_attested_group_with_a_policy() {
    let t = tsetup();
    let c = cm(&t.env, 1);
    let cred = t.cred(&c);
    let r = t.client.try_add_member_with_tier(&0, &c, &BytesN::from_array(&t.env, &cred.bytes()), &BytesN::from_array(&t.env, &sign(&t.issuer, &cred.bytes())));
    assert_eq!(r.err().unwrap().ok().unwrap(), Error::RepNotConfigured.into());
    assert!(t.client.try_set_tier_policy(&0, &TierPolicy { min_tier: 1 }).is_err());
    assert!(t.client.try_set_tier_policy(&t.group, &TierPolicy { min_tier: 0 }).is_err());
    assert!(t.client.try_set_tier_issuer(&0, &1, &None).is_err());
}

#[test]
fn low_s_helper() {
    let mut s = [0u8; 64];
    s[32..].copy_from_slice(&hex::decode("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550").unwrap());
    let low = tier::low_s(s);
    assert_eq!(low[63], 1);
    assert!(low[32..63].iter().all(|&b| b == 0));
    assert_eq!(tier::low_s(low), low);
}

// ---- move credential (replace_member_with_tier) ----

fn move_cred(t: &T, old: &U256, new: &U256, magic: &[u8; 8]) -> [u8; 137] {
    let (mut o, mut n) = ([0u8; 32], [0u8; 32]);
    old.to_be_bytes().copy_into_slice(&mut o);
    new.to_be_bytes().copy_into_slice(&mut n);
    t.jti.set(t.jti.get() + 1);
    let mut b = StdVec::with_capacity(137);
    b.extend_from_slice(magic);
    b.push(1);
    b.extend_from_slice(&t.client.tier_audience(&t.group).to_array());
    b.extend_from_slice(&o);
    b.extend_from_slice(&n);
    b.extend_from_slice(&(NOW - 10).to_be_bytes());
    b.extend_from_slice(&(NOW + 590).to_be_bytes());
    b.extend_from_slice(&[0xA0 | t.jti.get(); 16]);
    b.try_into().unwrap()
}

fn sign_any(k: &SigningKey, m: &[u8]) -> [u8; 64] {
    let s: Signature = k.sign_prehash(&Sha256::digest(m)).unwrap();
    s.to_bytes().into()
}

fn try_move(t: &T, old: &U256, new: &U256, m: &[u8; 137], sig: [u8; 64]) -> Result<U256, Option<Error>> {
    let leaves = t.client.get_group_leaves(&t.group);
    let idx = (0..leaves.len()).find(|&i| leaves.get_unchecked(i) == *old).unwrap_or(0);
    let sibs = crate::tree::siblings_of(&t.env, &leaves, idx);
    match t.client.try_replace_member_with_tier(&t.group, old, new, &sibs, &BytesN::from_array(&t.env, m), &BytesN::from_array(&t.env, &sig)) {
        Ok(Ok(r)) => Ok(r),
        Err(Ok(e)) => Err(if e.is_type(soroban_sdk::xdr::ScErrorType::Contract) { Some(Error::try_from(e.get_code()).unwrap_or(Error::BadParams)) } else { None }),
        other => panic!("{other:?}"),
    }
}

#[test]
fn tier_move_credential_moves_one_membership() {
    let t = tsetup();
    let (old, new, other) = (cm(&t.env, 1), cm(&t.env, 2), cm(&t.env, 3));
    let cred = t.cred(&old);
    t.submit(&old, &cred, sign(&t.issuer, &cred.bytes())).unwrap();
    let m = move_cred(&t, &old, &new, b"REPMOVE1");
    // a credential for (old, new) cannot move to another commitment, or evict a leaf it does not name
    assert_eq!(try_move(&t, &old, &other, &m, sign_any(&t.issuer, &m)), Err(Some(Error::RepNonce)));
    // forged
    assert_eq!(try_move(&t, &old, &new, &m, sign_any(&key(9), &m)), Err(None));
    // wrong magic (a join credential is never a move credential)
    let bad = move_cred(&t, &old, &new, b"REPTIER1");
    assert_eq!(try_move(&t, &old, &new, &bad, sign_any(&t.issuer, &bad)), Err(Some(Error::RepMalformed)));
    let sig = sign_any(&t.issuer, &m);
    let root = try_move(&t, &old, &new, &m, sig).unwrap();
    let leaves = t.client.get_group_leaves(&t.group);
    assert_eq!((leaves.len(), leaves.get_unchecked(0), t.client.get_group(&t.group).tree.root(&t.env)), (1, new.clone(), root));
    // replay
    assert_eq!(try_move(&t, &old, &new, &m, sig), Err(Some(Error::RepReplay)));
    // old is gone, so a fresh credential for it cannot move it again
    let m2 = move_cred(&t, &old, &other, b"REPMOVE1");
    assert_eq!(try_move(&t, &old, &other, &m2, sign_any(&t.issuer, &m2)), Err(Some(Error::NotMember)));
}
