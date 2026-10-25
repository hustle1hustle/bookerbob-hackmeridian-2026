extern crate std;

use crate::{tree, verifier};
use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    Bytes, BytesN, Env, Vec, U256,
};
use std::string::String;

const GOLDEN: &str = include_str!("../../../circuits/golden/depth10/soroban.json");
const META: &str = include_str!("../../../circuits/golden/depth10/meta.json");

fn bytes<const N: usize>(env: &Env, h: &str) -> BytesN<N> {
    let v = hex::decode(h).unwrap();
    BytesN::from_array(env, &v.try_into().unwrap())
}

fn u256_dec(env: &Env, s: &str) -> U256 {
    let n = num_be32(s);
    U256::from_be_bytes(env, &Bytes::from_array(env, &n))
}

// Decimal string to 32-byte big-endian, enough for test fixtures.
fn num_be32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for ch in s.bytes() {
        let mut carry = (ch - b'0') as u32;
        for b in out.iter_mut().rev() {
            let v = (*b as u32) * 10 + carry;
            *b = (v & 0xff) as u8;
            carry = v >> 8;
        }
    }
    out
}

fn load(env: &Env) -> (verifier::VerificationKey, verifier::Proof, Vec<Bn254Fr>) {
    let j: serde_json::Value = serde_json::from_str(GOLDEN).unwrap();
    let g1 = |h: &serde_json::Value| Bn254G1Affine::from_bytes(bytes::<64>(env, h.as_str().unwrap()));
    let g2 = |h: &serde_json::Value| Bn254G2Affine::from_bytes(bytes::<128>(env, h.as_str().unwrap()));
    let mut ic = Vec::new(env);
    for p in j["vk"]["ic"].as_array().unwrap() {
        ic.push_back(g1(p));
    }
    let vk = verifier::VerificationKey {
        alpha: g1(&j["vk"]["alpha"]),
        beta: g2(&j["vk"]["beta"]),
        gamma: g2(&j["vk"]["gamma"]),
        delta: g2(&j["vk"]["delta"]),
        ic,
    };
    let proof = verifier::Proof { a: g1(&j["proof"]["a"]), b: g2(&j["proof"]["b"]), c: g1(&j["proof"]["c"]) };
    let mut pubs = Vec::new(env);
    for s in j["public"].as_array().unwrap() {
        pubs.push_back(Bn254Fr::from_bytes(bytes::<32>(env, s.as_str().unwrap())));
    }
    (vk, proof, pubs)
}

#[test]
fn golden_proof_verifies() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (vk, proof, pubs) = load(&env);
    assert!(verifier::verify(&env, &vk, &proof, &pubs));
    std::println!("verify cost: cpu={} mem={}", env.cost_estimate().budget().cpu_instruction_cost(), env.cost_estimate().budget().memory_bytes_cost());
}

#[test]
fn tampered_public_input_fails() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (vk, proof, pubs) = load(&env);
    for i in 0..pubs.len() {
        let mut bad = pubs.clone();
        let v = bad.get_unchecked(i).to_u256().add(&U256::from_u32(&env, 1));
        bad.set(i, Bn254Fr::from_u256(v));
        assert!(!verifier::verify(&env, &vk, &proof, &bad), "tampered signal {i} passed");
    }
}

#[test]
fn wrong_signal_count_fails() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (vk, proof, mut pubs) = load(&env);
    pubs.pop_back();
    assert!(!verifier::verify(&env, &vk, &proof, &pubs));
}

#[test]
fn lean_imt_root_matches_js() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let m: serde_json::Value = serde_json::from_str(META).unwrap();
    let mut leaves = Vec::new(&env);
    for c in m["commitments"].as_array().unwrap() {
        leaves.push_back(u256_dec(&env, c.as_str().unwrap()));
    }
    let root = tree::lean_imt_root(&env, &leaves);
    let expected: String = m["root"].as_str().unwrap().into();
    assert_eq!(root, u256_dec(&env, &expected));
}

// ---- full contract cycle ----

use crate::{Error, ProofOfStay, ProofOfStayClient};
use soroban_sdk::{testutils::Address as _, token, Address, String as SString};

const FIXTURES: &str = include_str!("../../../circuits/golden/depth10/fixtures.json");

struct Ctx<'a> {
    env: Env,
    client: ProofOfStayClient<'a>,
    usdc: token::Client<'a>,
    hotel_admin: Address,
    fx: serde_json::Value,
}

fn proof_from(env: &Env, j: &serde_json::Value) -> verifier::Proof {
    let g1 = |h: &serde_json::Value| Bn254G1Affine::from_bytes(bytes::<64>(env, h.as_str().unwrap()));
    let g2 = |h: &serde_json::Value| Bn254G2Affine::from_bytes(bytes::<128>(env, h.as_str().unwrap()));
    verifier::Proof { a: g1(&j["a"]), b: g2(&j["b"]), c: g1(&j["c"]) }
}

fn setup<'a>() -> Ctx<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let (vk, _, _) = load(&env);
    let arbiter = Address::generate(&env);
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let id = env.register(ProofOfStay, (arbiter, sac.address(), vk));
    let client = ProofOfStayClient::new(&env, &id);
    let usdc = token::Client::new(&env, &sac.address());
    let hotel_admin = Address::generate(&env);
    let fx: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
    // 100 USDC (7 decimals), 20% off for returning guests
    let hid = client.register_hotel(&hotel_admin, &SString::from_str(&env, "Casa Alfama"), &1_000_000_000, &2000);
    assert_eq!(hid, 0);
    for c in fx["commitments"].as_array().unwrap() {
        client.checkout(&0, &u256_dec(&env, c.as_str().unwrap()));
    }
    Ctx { env, client, usdc, hotel_admin, fx }
}

fn review_args(c: &Ctx) -> (u32, BytesN<32>, BytesN<32>, verifier::Proof, U256, U256) {
    let r = &c.fx["review"];
    (
        r["rating"].as_u64().unwrap() as u32,
        bytes::<32>(&c.env, r["contentHash"].as_str().unwrap()),
        bytes::<32>(&c.env, r["disclosureCommit"].as_str().unwrap()),
        proof_from(&c.env, &r["proof"]),
        u256_dec(&c.env, r["root"].as_str().unwrap()),
        u256_dec(&c.env, r["nullifier"].as_str().unwrap()),
    )
}

#[test]
fn incremental_tree_matches_recompute() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let mut t = tree::LeanImt::new(&env);
    let mut leaves = Vec::new(&env);
    for i in 1..=13u32 {
        let leaf = U256::from_u32(&env, i * 7919);
        leaves.push_back(leaf.clone());
        let root = t.insert(&env, leaf);
        assert_eq!(root, tree::lean_imt_root(&env, &leaves), "size {i}");
    }
}

#[test]
fn checkout_root_matches_js() {
    let c = setup();
    assert_eq!(c.client.get_root(&0), u256_dec(&c.env, c.fx["root"].as_str().unwrap()));
}

#[test]
fn review_cycle() {
    let c = setup();
    let (rating, content, commit, proof, root, nf) = review_args(&c);
    let id = c.client.post_review(&0, &rating, &content, &commit, &proof, &root, &nf);
    assert_eq!(id, 0);
    let r = c.client.get_rating(&0);
    assert_eq!((r.sum, r.count, r.verified_count), (5, 1, 0));
    std::println!("post_review cpu={}", c.env.cost_estimate().budget().cpu_instruction_cost());

    // same stay cannot review twice
    let err = c.client.try_post_review(&0, &rating, &content, &commit, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::NullifierUsed.into());

    c.client.attest_review(&0);
    assert!(c.client.get_review(&0).verified);
    assert_eq!(c.client.get_rating(&0).verified_count, 1);
}

#[test]
fn review_with_changed_rating_fails() {
    let c = setup();
    let (_, content, commit, proof, root, nf) = review_args(&c);
    let err = c.client.try_post_review(&0, &1, &content, &commit, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::InvalidProof.into());
}

#[test]
fn review_at_other_hotel_fails() {
    let c = setup();
    let other = c.client.register_hotel(&c.hotel_admin, &SString::from_str(&c.env, "Other"), &10, &0);
    for cm in c.fx["commitments"].as_array().unwrap() {
        c.client.checkout(&other, &u256_dec(&c.env, cm.as_str().unwrap()));
    }
    // same leaves, same root, but the contract-derived scope differs
    let (rating, content, commit, proof, root, nf) = review_args(&c);
    let err = c.client.try_post_review(&other, &rating, &content, &commit, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::InvalidProof.into());
}

#[test]
fn unknown_or_zero_root_fails() {
    let c = setup();
    let (rating, content, commit, proof, _, nf) = review_args(&c);
    for root in [U256::from_u32(&c.env, 0), U256::from_u32(&c.env, 42)] {
        let err = c.client.try_post_review(&0, &rating, &content, &commit, &proof, &root, &nf);
        assert_eq!(err.err().unwrap().unwrap(), Error::UnknownRoot.into());
    }
}

#[test]
fn non_canonical_nullifier_fails() {
    let c = setup();
    let (rating, content, commit, proof, root, nf) = review_args(&c);
    let r = U256::from_be_bytes(&c.env, &Bytes::from_array(&c.env, &crate::FR_MODULUS_PUB));
    let err = c.client.try_post_review(&0, &rating, &content, &commit, &proof, &root, &nf.add(&r));
    assert_eq!(err.err().unwrap().unwrap(), Error::NonCanonical.into());
}

#[test]
fn duplicate_checkout_fails() {
    let c = setup();
    let cm = u256_dec(&c.env, c.fx["commitments"][0].as_str().unwrap());
    let err = c.client.try_checkout(&0, &cm);
    assert_eq!(err.err().unwrap().unwrap(), Error::DuplicateLeaf.into());
}

#[test]
fn discount_cycle() {
    let c = setup();
    let guest = Address::from_str(&c.env, c.fx["guest"].as_str().unwrap());
    let sac = soroban_sdk::token::StellarAssetClient::new(&c.env, &c.usdc.address);
    sac.mint(&guest, &5_000_000_000);

    // first booking at full price
    assert_eq!(c.client.book(&0, &guest), 1_000_000_000);

    let d = &c.fx["discount"];
    let season = c.fx["season"].as_u64().unwrap() as u32;
    let proof = proof_from(&c.env, &d["proof"]);
    let root = u256_dec(&c.env, d["root"].as_str().unwrap());
    let nf = u256_dec(&c.env, d["nullifier"].as_str().unwrap());

    // a different payer cannot use the guest's proof
    let thief = Address::generate(&c.env);
    let err = c.client.try_book_with_discount(&0, &thief, &season, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::InvalidProof.into());

    let paid = c.client.book_with_discount(&0, &guest, &season, &proof, &root, &nf);
    assert_eq!(paid, 800_000_000);
    assert_eq!(c.usdc.balance(&guest), 5_000_000_000 - 1_000_000_000 - 800_000_000);
    assert_eq!(c.usdc.balance(&c.hotel_admin), 1_800_000_000);

    // once per season per stay
    let err = c.client.try_book_with_discount(&0, &guest, &season, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::NullifierUsed.into());
}

#[test]
fn contract_verify_entry() {
    let c = setup();
    let (_, proof, pubs) = load(&c.env);
    let mut raw = Vec::new(&c.env);
    for p in pubs.iter() {
        raw.push_back(p.to_u256());
    }
    assert!(c.client.verify(&proof, &raw));
    let mut bad = raw.clone();
    bad.set(3, bad.get_unchecked(3).add(&U256::from_u32(&c.env, 1)));
    assert!(!c.client.verify(&proof, &bad));
}
