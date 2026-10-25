//! Poseidon hashing compatible with circomlib (via stellar/rs-soroban-poseidon) and the
//! LeanIMT root rule used by Semaphore v4: a lone left node is promoted unchanged, no zero hashes.

use soroban_poseidon::poseidon_hash;
use soroban_sdk::{crypto::bn254::Bn254Fr, vec, Env, Vec, U256};

pub fn hash2(env: &Env, a: &U256, b: &U256) -> U256 {
    poseidon_hash::<3, Bn254Fr>(env, &vec![env, a.clone(), b.clone()])
}

/// Root of a LeanIMT over `leaves`, recomputed from scratch.
pub fn lean_imt_root(env: &Env, leaves: &Vec<U256>) -> U256 {
    let mut level = leaves.clone();
    while level.len() > 1 {
        let mut next = Vec::new(env);
        let mut i = 0;
        while i < level.len() {
            if i + 1 < level.len() {
                next.push_back(hash2(env, &level.get_unchecked(i), &level.get_unchecked(i + 1)));
            } else {
                next.push_back(level.get_unchecked(i));
            }
            i += 2;
        }
        level = next;
    }
    level.get(0).unwrap_or(U256::from_u32(env, 0))
}
