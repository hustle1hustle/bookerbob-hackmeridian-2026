//! Poseidon hashing compatible with circomlib (via stellar/rs-soroban-poseidon) and the
//! LeanIMT used by Semaphore v4: a lone left node is promoted unchanged, no zero hashes.

use soroban_poseidon::poseidon_hash;
use soroban_sdk::{contracttype, crypto::bn254::Bn254Fr, vec, Env, Vec, U256};

pub fn hash2(env: &Env, a: &U256, b: &U256) -> U256 {
    poseidon_hash::<3, Bn254Fr>(env, &vec![env, a.clone(), b.clone()])
}

/// Incremental LeanIMT state, same insert rule as zk-kit's LeanIMT.sol.
#[derive(Clone)]
#[contracttype]
pub struct LeanImt {
    pub size: u32,
    pub depth: u32,
    pub side_nodes: Vec<U256>,
}

impl LeanImt {
    pub fn new(env: &Env) -> Self {
        LeanImt { size: 0, depth: 0, side_nodes: Vec::new(env) }
    }

    pub fn root(&self, env: &Env) -> U256 {
        self.side_nodes.get(self.depth).unwrap_or(U256::from_u32(env, 0))
    }

    /// Inserts `leaf` and returns the new root.
    pub fn insert(&mut self, env: &Env, leaf: U256) -> U256 {
        let index = self.size;
        let mut depth = self.depth;
        if (1u64 << depth) < (index as u64) + 1 {
            depth += 1;
        }
        self.depth = depth;
        while self.side_nodes.len() <= depth {
            self.side_nodes.push_back(U256::from_u32(env, 0));
        }
        let mut node = leaf;
        for level in 0..depth {
            if (index >> level) & 1 == 1 {
                node = hash2(env, &self.side_nodes.get_unchecked(level), &node);
            } else {
                self.side_nodes.set(level, node.clone());
            }
        }
        self.size = index + 1;
        self.side_nodes.set(depth, node.clone());
        node
    }
}

/// Root of a LeanIMT over `leaves`, recomputed from scratch. Reference for tests.
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
