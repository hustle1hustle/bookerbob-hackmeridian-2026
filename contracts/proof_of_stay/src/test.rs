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
