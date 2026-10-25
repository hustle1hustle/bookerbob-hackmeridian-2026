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

impl LeanImt {
    /// Replaces the leaf at `index` (whose current value is `old`) with `new`, given the Merkle siblings of that
    /// leaf (LeanIMT order: one per level that has a sibling, bottom up, as Semaphore's generateMerkleProof gives
    /// them). Checks the old path hashes to the current root, recomputes the path, and keeps the side nodes the
    /// insert rule relies on. At most 2 x depth hashes. Returns the new root, or None if the path is wrong.
    pub fn update(&mut self, env: &Env, index: u32, old: &U256, new: &U256, siblings: &Vec<U256>) -> Option<U256> {
        if index >= self.size {
            return None;
        }
        let last = self.size - 1;
        let (mut node, mut prev) = (new.clone(), old.clone());
        let mut i = 0u32;
        let mut side = self.side_nodes.clone();
        for level in 0..self.depth {
            let pos = index >> level;
            let j = last >> level;
            let pick = if j & 1 == 1 { j - 1 } else { j };
            if pos == pick {
                side.set(level, node.clone());
            }
            if pos & 1 == 1 || pos != j {
                let sib = siblings.get(i)?;
                i += 1;
                if pos & 1 == 1 {
                    node = hash2(env, &sib, &node);
                    prev = hash2(env, &sib, &prev);
                } else {
                    node = hash2(env, &node, &sib);
                    prev = hash2(env, &prev, &sib);
                }
            }
        }
        if i != siblings.len() || prev != self.root(env) {
            return None;
        }
        side.set(self.depth, node.clone());
        self.side_nodes = side;
        Some(node)
    }

    /// The incremental state after inserting `leaves` in order, built level by level (at most n - 1 hashes).
    /// Used when a leaf changes in place: the side node at each level is the last left node the insert rule
    /// would have kept, i.e. node(level, k >> level) or its left sibling, where k is the last index.
    pub fn from_leaves(env: &Env, leaves: &Vec<U256>) -> Self {
        let mut t = LeanImt::new(env);
        let n = leaves.len();
        if n == 0 {
            return t;
        }
        let mut depth = 0u32;
        while (1u64 << depth) < n as u64 {
            depth += 1;
        }
        let k = n - 1;
        let mut level = leaves.clone();
        for l in 0..=depth {
            let j = k >> l;
            let pick = if (j & 1) == 1 { j - 1 } else { j };
            t.side_nodes.push_back(level.get_unchecked(if l == depth { 0 } else { pick }));
            if l == depth {
                break;
            }
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
        t.size = n;
        t.depth = depth;
        t
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

/// Merkle siblings of leaf `index`, in the order `LeanImt::update` takes them. Reference for tests (clients use
/// Semaphore's `generateMerkleProof`).
#[cfg(test)]
pub fn siblings_of(env: &Env, leaves: &Vec<U256>, index: u32) -> Vec<U256> {
    let mut out = Vec::new(env);
    let mut level = leaves.clone();
    let mut pos = index;
    while level.len() > 1 {
        let sib = pos ^ 1;
        if sib < level.len() {
            out.push_back(level.get_unchecked(sib));
        }
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
        pos >>= 1;
    }
    out
}
