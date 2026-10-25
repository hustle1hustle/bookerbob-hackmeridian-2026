//! Groth16 verifier over BN254 (CAP-0074 host functions).
//! Mirrors stellar/soroban-examples groth16_verifier (BLS12-381), ported to `crypto::bn254`.

use soroban_sdk::{
    contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, Env, Vec,
};

#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: Bn254G1Affine,
    pub beta: Bn254G2Affine,
    pub gamma: Bn254G2Affine,
    pub delta: Bn254G2Affine,
    pub ic: Vec<Bn254G1Affine>,
}

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

/// Returns false on a malformed key (wrong IC length) or a failing pairing check.
pub fn verify(env: &Env, vk: &VerificationKey, proof: &Proof, pub_signals: &Vec<Bn254Fr>) -> bool {
    if pub_signals.len() + 1 != vk.ic.len() {
        return false;
    }
    let bn = env.crypto().bn254();

    // vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
    let mut vk_x = vk.ic.get_unchecked(0);
    for i in 0..pub_signals.len() {
        let prod = bn.g1_mul(&vk.ic.get_unchecked(i + 1), &pub_signals.get_unchecked(i));
        vk_x = bn.g1_add(&vk_x, &prod);
    }

    // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    let neg_a = -proof.a.clone();
    let vp1 = vec![env, neg_a, vk.alpha.clone(), vk_x, proof.c.clone()];
    let vp2 = vec![env, proof.b.clone(), vk.beta.clone(), vk.gamma.clone(), vk.delta.clone()];
    bn.pairing_check(vp1, vp2)
}
