#![no_std]
//! Proof of Stay: guests prove a past stay with a Semaphore v4 proof, verified on-chain over BN254.
//! One circuit, the nullifier scope selects the use: anonymous review or returning-guest discount.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, crypto::bn254::Bn254Fr, panic_with_error,
    token, xdr::ToXdr, Address, Symbol, Bytes, BytesN, Env, String, Vec, U256,
};

pub mod tier;
pub mod tree;
pub mod verifier;

use tier::TierPolicy;
use tree::LeanImt;
use verifier::{Proof, VerificationKey};

/// Semaphore artifacts are per depth and depth is not a public input, so one depth is pinned.
pub const TREE_DEPTH: u32 = 10;
pub const MAX_LEAVES: u32 = 1 << TREE_DEPTH;
pub const ROOT_HISTORY: u32 = 30;
const BPS: i128 = 10_000;
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND: u32 = 500_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    MerchantNotFound = 1,
    TreeFull = 2,
    BadLeaf = 3,
    DuplicateLeaf = 4,
    UnknownRoot = 5,
    NullifierUsed = 6,
    NonCanonical = 7,
    InvalidProof = 8,
    BadRating = 9,
    ReviewNotFound = 10,
    BadParams = 11,
    NotInPolicy = 12,
    GroupNotFound = 13,
    DuplicateClaim = 14,
    RepNotConfigured = 15,
    RepMalformed = 16,
    RepIssuer = 17,
    RepExpired = 18,
    RepNoTier = 19,
    RepHolder = 20,
    RepNonce = 21,
    RepReplay = 22,
    BadSeason = 23,
}

#[derive(Clone)]
#[contracttype]
pub struct Merchant {
    pub admin: Address,
    pub kind: Symbol,
    pub name: String,
    pub price: i128,
    pub discount_bps: u32,
    pub tree: LeanImt,
    pub roots: Vec<U256>,
    pub rating_sum: u32,
    pub rating_count: u32,
    pub verified_count: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct Review {
    pub id: u32,
    pub merchant: u32,
    pub rating: u32,
    pub content_hash: BytesN<32>,
    pub disclosure_commit: BytesN<32>,
    pub nullifier: U256,
    pub verified: bool,
    pub ledger: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct Rating {
    pub sum: u32,
    pub count: u32,
    pub verified_count: u32,
}

#[contracttype]
enum Key {
    Admin,
    Vk,
    Arbiter,
    Usdc,
    MerchantCount,
    ReviewCount,
    Merchant(u32),
    Leaf(u32, U256),
    Nullifier(U256, U256),
    Review(u32),
    MerchantReviews(u32),
    Leaves(u32),
    GroupCount,
    Group(u32),
    GroupLeaf(u32, U256),
    GroupLeaves(u32),
    Policy(u32),
    MerchantChain(u32),
    TierKey(u32, u32),
    TierPolicy(u32),
    TierUsed(BytesN<16>),
    Season,
}

/// A context group: a tree of commitments that a merchant's discount policy can reward.
/// kind: `chain` (filled at checkout by member merchants) or `attested` (filled by an attester).
#[derive(Clone)]
#[contracttype]
pub struct Group {
    pub admin: Address,
    pub kind: Symbol,
    pub name: String,
    pub tree: LeanImt,
    pub roots: Vec<U256>,
}

#[derive(Clone)]
#[contracttype]
pub struct GroupInfo {
    pub id: u32,
    pub kind: Symbol,
    pub name: String,
    pub operator: Address,
    pub size: u32,
}

/// Which tree a claim proves membership in: a merchant's own customer tree or a context group.
#[derive(Clone, PartialEq, Eq)]
#[contracttype]
pub enum GroupRef {
    Merchant(u32),
    Group(u32),
}

#[derive(Clone)]
#[contracttype]
pub struct PolicyItem {
    pub group: GroupRef,
    pub bps: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct Policy {
    pub items: Vec<PolicyItem>,
    pub max_bps: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct Claim {
    pub group: GroupRef,
    pub proof: Proof,
    pub root: U256,
    pub nullifier: U256,
}

#[contract]
pub struct ProofOfStay;

// BN254 scalar field modulus r, big-endian.
pub const FR_MODULUS_PUB: [u8; 32] = FR_MODULUS;
const FR_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

fn fr_modulus(env: &Env) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &FR_MODULUS))
}

fn require_canonical(env: &Env, v: &U256) {
    if *v >= fr_modulus(env) {
        panic_with_error!(env, Error::NonCanonical);
    }
}

fn keccak_u256(env: &Env, data: &Bytes) -> U256 {
    let h: BytesN<32> = env.crypto().keccak256(data).into();
    U256::from_be_bytes(env, &Bytes::from(h))
}

/// Semaphore's hash(): keccak256 of the 32-byte big-endian value, shifted right by 8.
pub fn semaphore_hash(env: &Env, v: &U256) -> U256 {
    keccak_u256(env, &v.to_be_bytes()).shr(8)
}

fn tagged(env: &Env, tag: &str, merchant: u32) -> Bytes {
    let mut b = Bytes::from_slice(env, tag.as_bytes());
    b.extend_from_array(&merchant.to_be_bytes());
    b
}

/// Raw (pre-hash) scope for reviews: keccak256("pos/review" || be32(merchant)).
pub fn review_scope(env: &Env, merchant: u32) -> U256 {
    keccak_u256(env, &tagged(env, "pos/review", merchant))
}

/// Raw scope for discounts: keccak256("pos/discount" || be32(merchant) || be32(season)).
pub fn discount_scope(env: &Env, merchant: u32, season: u32) -> U256 {
    let mut b = tagged(env, "pos/discount", merchant);
    b.extend_from_array(&season.to_be_bytes());
    keccak_u256(env, &b)
}

/// Raw scope for a context claim: keccak256("pos/ctx" || be32(merchant) || tag || be32(id) || be32(season)),
/// tag 0 = a merchant tree, 1 = a context group. A merchant's own tree uses `discount_scope` instead,
/// so a context booking and a plain discount booking share one nullifier per stay per season.
pub fn ctx_scope(env: &Env, merchant: u32, group: &GroupRef, season: u32) -> U256 {
    let mut b = tagged(env, "pos/ctx", merchant);
    let (tag, id) = match group {
        GroupRef::Merchant(m) => (0u8, *m),
        GroupRef::Group(g) => (1u8, *g),
    };
    b.push_back(tag);
    b.extend_from_array(&id.to_be_bytes());
    b.extend_from_array(&season.to_be_bytes());
    keccak_u256(env, &b)
}

/// Seasons are fixed windows of ledger time: season 1 starts at `epoch`, each lasts `len` seconds.
/// The contract computes the season; a caller-chosen value would give a fresh nullifier per call.
#[derive(Clone)]
#[contracttype]
pub struct SeasonCfg {
    pub epoch: u64,
    pub len: u64,
}

/// 2026-10-01T00:00:00Z, 91 days: season 1 runs to 2026-12-31, the value every client used so far.
pub const SEASON_EPOCH: u64 = 1_790_812_800;
pub const SEASON_LEN: u64 = 91 * 86_400;

fn season_cfg(env: &Env) -> SeasonCfg {
    env.storage().instance().get(&Key::Season).unwrap_or(SeasonCfg { epoch: SEASON_EPOCH, len: SEASON_LEN })
}

/// 1 + whole seasons since the epoch (season 1 before it, so a fresh test ledger at time 0 is in season 1).
pub fn season_at(cfg: &SeasonCfg, now: u64) -> u32 {
    (1 + now.saturating_sub(cfg.epoch) / cfg.len) as u32
}

fn require_season(env: &Env, season: u32) {
    if season != season_at(&season_cfg(env), env.ledger().timestamp()) {
        panic_with_error!(env, Error::BadSeason);
    }
}

/// A chain claim at a member merchant shares that merchant's own discount scope, so one stay is one discount
/// per merchant per season whether it is claimed as a returning guest or as a network member.
fn claim_scope(env: &Env, merchant: u32, group: &GroupRef, season: u32) -> U256 {
    match group {
        GroupRef::Merchant(m) if *m == merchant => discount_scope(env, merchant, season),
        GroupRef::Group(g) if env.storage().persistent().get::<_, u32>(&Key::MerchantChain(merchant)) == Some(*g) => {
            discount_scope(env, merchant, season)
        }
        _ => ctx_scope(env, merchant, group, season),
    }
}

fn load_group(env: &Env, id: u32) -> Group {
    env.storage()
        .persistent()
        .get(&Key::Group(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::GroupNotFound))
}

/// Chain enrollment at checkout never blocks the checkout itself: a full chain group or a leaf already in it
/// is skipped with an event.
fn enroll_in_chain(env: &Env, gid: u32, commitment: &U256) {
    let full = load_group(env, gid).tree.size >= MAX_LEAVES;
    if full || env.storage().persistent().has(&Key::GroupLeaf(gid, commitment.clone())) {
        env.events().publish((soroban_sdk::symbol_short!("chainskip"), gid), (commitment.clone(), full));
        return;
    }
    insert_group_leaf(env, gid, commitment);
}

fn insert_group_leaf(env: &Env, gid: u32, commitment: &U256) {
    let mut g = load_group(env, gid);
    if g.tree.size >= MAX_LEAVES {
        panic_with_error!(env, Error::TreeFull);
    }
    let lk = Key::GroupLeaf(gid, commitment.clone());
    if env.storage().persistent().has(&lk) {
        panic_with_error!(env, Error::DuplicateLeaf);
    }
    let index = g.tree.size;
    let root = g.tree.insert(env, commitment.clone());
    if g.roots.len() >= ROOT_HISTORY {
        g.roots.pop_front();
    }
    g.roots.push_back(root.clone());
    let gk = Key::Group(gid);
    env.storage().persistent().set(&gk, &g);
    bump_persistent(env, &gk);
    env.storage().persistent().set(&lk, &index);
    bump_persistent(env, &lk);
    let lsk = Key::GroupLeaves(gid);
    let mut leaves: Vec<U256> = env.storage().persistent().get(&lsk).unwrap_or(Vec::new(env));
    leaves.push_back(commitment.clone());
    env.storage().persistent().set(&lsk, &leaves);
    bump_persistent(env, &lsk);
    env.events().publish((soroban_sdk::symbol_short!("member"), gid), (commitment.clone(), index, root));
}

/// Raw message for reviews: keccak256(be32(rating) || content_hash || disclosure_commit).
pub fn review_message(env: &Env, rating: u32, content_hash: &BytesN<32>, disclosure_commit: &BytesN<32>) -> U256 {
    let mut b = Bytes::from_array(env, &rating.to_be_bytes());
    b.append(&Bytes::from(content_hash.clone()));
    b.append(&Bytes::from(disclosure_commit.clone()));
    keccak_u256(env, &b)
}

/// Raw message for discounts binds the paying guest: keccak256("pos/guest" || xdr(ScVal(guest))).
pub fn discount_message(env: &Env, guest: &Address) -> U256 {
    let mut b = Bytes::from_slice(env, b"pos/guest");
    b.append(&guest.clone().to_xdr(env));
    keccak_u256(env, &b)
}

fn bump_persistent(env: &Env, key: &Key) {
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND);
}

fn load_merchant(env: &Env, id: u32) -> Merchant {
    env.storage()
        .persistent()
        .get(&Key::Merchant(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MerchantNotFound))
}

fn save_merchant(env: &Env, id: u32, h: &Merchant) {
    let k = Key::Merchant(id);
    env.storage().persistent().set(&k, h);
    bump_persistent(env, &k);
}

/// Checks root membership, nullifier freshness and the Groth16 proof, then burns the nullifier.
fn spend(env: &Env, roots: &Vec<U256>, root: &U256, nullifier: &U256, message: &U256, scope: &U256, proof: &Proof) {
    // Root 0 would accept proofs with an out-of-range merkleProofLength; only known roots count.
    if *root == U256::from_u32(env, 0) || !roots.contains(root) {
        panic_with_error!(env, Error::UnknownRoot);
    }
    require_canonical(env, nullifier);
    let scope_h = semaphore_hash(env, scope);
    let nk = Key::Nullifier(scope_h.clone(), nullifier.clone());
    if env.storage().persistent().has(&nk) {
        panic_with_error!(env, Error::NullifierUsed);
    }
    let vk: VerificationKey = env.storage().instance().get(&Key::Vk).unwrap();
    let mut pubs: Vec<Bn254Fr> = Vec::new(env);
    pubs.push_back(Bn254Fr::from_u256(root.clone()));
    pubs.push_back(Bn254Fr::from_u256(nullifier.clone()));
    pubs.push_back(Bn254Fr::from_u256(semaphore_hash(env, message)));
    pubs.push_back(Bn254Fr::from_u256(scope_h));
    if !verifier::verify(env, &vk, proof, &pubs) {
        panic_with_error!(env, Error::InvalidProof);
    }
    env.storage().persistent().set(&nk, &true);
    bump_persistent(env, &nk);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

#[contractimpl]
impl ProofOfStay {
    pub fn __constructor(env: Env, admin: Address, arbiter: Address, usdc: Address, vk: VerificationKey) {
        if vk.ic.len() != 5 {
            panic_with_error!(&env, Error::BadParams);
        }
        let s = env.storage().instance();
        s.set(&Key::Admin, &admin);
        s.set(&Key::Vk, &vk);
        s.set(&Key::Arbiter, &arbiter);
        s.set(&Key::Usdc, &usdc);
        s.set(&Key::MerchantCount, &0u32);
        s.set(&Key::ReviewCount, &0u32);
        bump_instance(&env);
    }

    pub fn register_merchant(env: Env, admin: Address, kind: Symbol, name: String, price: i128, discount_bps: u32) -> u32 {
        admin.require_auth();
        if price <= 0 || discount_bps > 10_000 {
            panic_with_error!(&env, Error::BadParams);
        }
        let id: u32 = env.storage().instance().get(&Key::MerchantCount).unwrap();
        let h = Merchant {
            admin,
            kind,
            name,
            price,
            discount_bps,
            tree: LeanImt::new(&env),
            roots: Vec::new(&env),
            rating_sum: 0,
            rating_count: 0,
            verified_count: 0,
        };
        save_merchant(&env, id, &h);
        env.storage().instance().set(&Key::MerchantCount, &(id + 1));
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("merchant"), id), h.price);
        id
    }

    /// Merchant admin inserts the stay-identity commitment at checkout. Returns the new root.
    pub fn checkout(env: Env, merchant: u32, id_commitment: U256) -> U256 {
        let mut h = load_merchant(&env, merchant);
        h.admin.require_auth();
        if id_commitment == U256::from_u32(&env, 0) {
            panic_with_error!(&env, Error::BadLeaf);
        }
        require_canonical(&env, &id_commitment);
        if h.tree.size >= MAX_LEAVES {
            panic_with_error!(&env, Error::TreeFull);
        }
        let lk = Key::Leaf(merchant, id_commitment.clone());
        if env.storage().persistent().has(&lk) {
            panic_with_error!(&env, Error::DuplicateLeaf);
        }
        let index = h.tree.size;
        let root = h.tree.insert(&env, id_commitment.clone());
        if h.roots.len() >= ROOT_HISTORY {
            h.roots.pop_front();
        }
        h.roots.push_back(root.clone());
        save_merchant(&env, merchant, &h);
        env.storage().persistent().set(&lk, &index);
        bump_persistent(&env, &lk);
        // Full leaf list (<= 1024 x 32 bytes) so clients can build Merkle paths without an indexer.
        let lsk = Key::Leaves(merchant);
        let mut leaves: Vec<U256> = env.storage().persistent().get(&lsk).unwrap_or(Vec::new(&env));
        leaves.push_back(id_commitment.clone());
        env.storage().persistent().set(&lsk, &leaves);
        bump_persistent(&env, &lsk);
        // A merchant in a chain also enrolls the stay in the chain group ("guest anywhere in the network").
        if let Some(gid) = env.storage().persistent().get::<_, u32>(&Key::MerchantChain(merchant)) {
            enroll_in_chain(&env, gid, &id_commitment);
        }
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("checkout"), merchant), (id_commitment, index, root.clone()));
        root
    }

    /// Full-price booking: USDC from guest to merchant admin.
    pub fn book(env: Env, merchant: u32, guest: Address) -> i128 {
        guest.require_auth();
        let h = load_merchant(&env, merchant);
        let usdc: Address = env.storage().instance().get(&Key::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&guest, &h.admin, &h.price);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("book"), merchant), (guest, h.price));
        h.price
    }

    /// Returning-guest booking: proves a past stay at this merchant, once per season per stay.
    /// The proof message binds the paying guest, so a proof cannot be front-run by another payer.
    pub fn book_with_discount(env: Env, merchant: u32, guest: Address, season: u32, proof: Proof, root: U256, nullifier: U256) -> i128 {
        guest.require_auth();
        require_season(&env, season);
        let h = load_merchant(&env, merchant);
        let scope = discount_scope(&env, merchant, season);
        let message = discount_message(&env, &guest);
        spend(&env, &h.roots, &root, &nullifier, &message, &scope, &proof);
        let amount = h.price * (BPS - h.discount_bps as i128) / BPS;
        let usdc: Address = env.storage().instance().get(&Key::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&guest, &h.admin, &amount);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("discount"), merchant), (guest, amount, season));
        amount
    }

    /// Full-price order with a merchant-quoted amount (any cart). The merchant admin co-signs
    /// `amount` and `order_ref` (hash of the store order), so the charged amount is the signed one.
    pub fn book_amount(env: Env, merchant: u32, guest: Address, amount: i128, order_ref: BytesN<32>) -> i128 {
        guest.require_auth();
        let h = load_merchant(&env, merchant);
        h.admin.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::BadParams);
        }
        let usdc: Address = env.storage().instance().get(&Key::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&guest, &h.admin, &amount);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("book"), merchant), (guest, amount, order_ref));
        amount
    }

    /// Returning-customer order with a merchant-quoted amount. Same proof and nullifier as
    /// `book_with_discount` (one discount per past stay per season, whatever the rail), the contract
    /// applies `discount_bps` to the admin-signed `amount`.
    pub fn book_with_discount_amount(
        env: Env,
        merchant: u32,
        guest: Address,
        season: u32,
        amount: i128,
        order_ref: BytesN<32>,
        proof: Proof,
        root: U256,
        nullifier: U256,
    ) -> i128 {
        guest.require_auth();
        require_season(&env, season);
        let h = load_merchant(&env, merchant);
        h.admin.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::BadParams);
        }
        let scope = discount_scope(&env, merchant, season);
        let message = discount_message(&env, &guest);
        spend(&env, &h.roots, &root, &nullifier, &message, &scope, &proof);
        let paid = amount * (BPS - h.discount_bps as i128) / BPS;
        let usdc: Address = env.storage().instance().get(&Key::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&guest, &h.admin, &paid);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("discount"), merchant), (guest, paid, season, order_ref));
        paid
    }

    /// Spends the discount nullifier without moving USDC (the order is paid on another rail, e.g. a card).
    /// Only the merchant admin (its checkout bridge) may call it. The proof still binds the guest address.
    pub fn redeem(env: Env, merchant: u32, guest: Address, season: u32, order_ref: BytesN<32>, proof: Proof, root: U256, nullifier: U256) {
        require_season(&env, season);
        let h = load_merchant(&env, merchant);
        h.admin.require_auth();
        let scope = discount_scope(&env, merchant, season);
        let message = discount_message(&env, &guest);
        spend(&env, &h.roots, &root, &nullifier, &message, &scope, &proof);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("redeem"), merchant), (guest, season, order_ref));
    }

    // ---- context groups ----

    /// Contract admin creates a context group and names its operator: for `attested` the attester
    /// (a context provider such as REP verified travelers or a wallet-history module), for `chain` the chain admin.
    /// Each provider owns its own groups; only that operator can add members.
    pub fn create_group(env: Env, kind: Symbol, operator: Address, name: String) -> u32 {
        let cadmin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        cadmin.require_auth();
        let admin = operator;
        if kind != Symbol::new(&env, "chain") && kind != Symbol::new(&env, "attested") {
            panic_with_error!(&env, Error::BadParams);
        }
        let id: u32 = env.storage().instance().get(&Key::GroupCount).unwrap_or(0);
        let g = Group { admin, kind, name, tree: LeanImt::new(&env), roots: Vec::new(&env) };
        let k = Key::Group(id);
        env.storage().persistent().set(&k, &g);
        bump_persistent(&env, &k);
        env.storage().instance().set(&Key::GroupCount, &(id + 1));
        bump_instance(&env);
        id
    }

    /// Group admin adds a member: the attester for `attested` groups, or a backfill by the chain admin.
    pub fn add_member(env: Env, group: u32, id_commitment: U256) -> U256 {
        let g = load_group(&env, group);
        g.admin.require_auth();
        if id_commitment == U256::from_u32(&env, 0) {
            panic_with_error!(&env, Error::BadLeaf);
        }
        require_canonical(&env, &id_commitment);
        insert_group_leaf(&env, group, &id_commitment);
        bump_instance(&env);
        load_group(&env, group).tree.root(&env)
    }

    /// Contract admin pins a tier issuer key for an attested group under `kid` (the credential's byte 8).
    /// Rotation: pin the new kid, then remove the old one with `None`.
    pub fn set_tier_issuer(env: Env, group: u32, kid: u32, pubkey: Option<BytesN<65>>) {
        let cadmin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        cadmin.require_auth();
        if load_group(&env, group).kind != Symbol::new(&env, "attested") || kid > 255 {
            panic_with_error!(&env, Error::BadParams);
        }
        let k = Key::TierKey(group, kid);
        match pubkey {
            Some(pk) => {
                env.storage().persistent().set(&k, &pk);
                bump_persistent(&env, &k);
            }
            None => env.storage().persistent().remove(&k),
        }
    }

    /// Contract admin sets the lowest tier an attested group admits. Credentials must name this contract and group.
    pub fn set_tier_policy(env: Env, group: u32, policy: TierPolicy) {
        let cadmin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        cadmin.require_auth();
        if load_group(&env, group).kind != Symbol::new(&env, "attested") || policy.min_tier == 0 || policy.min_tier > 255 {
            panic_with_error!(&env, Error::BadParams);
        }
        let k = Key::TierPolicy(group);
        env.storage().persistent().set(&k, &policy);
        bump_persistent(&env, &k);
    }

    pub fn get_tier_issuer(env: Env, group: u32, kid: u32) -> Option<BytesN<65>> {
        env.storage().persistent().get(&Key::TierKey(group, kid))
    }

    /// What a tier credential for `group` must carry in bytes [9..41): sha256("<contract strkey>:<group>").
    pub fn tier_audience(env: Env, group: u32) -> BytesN<32> {
        BytesN::from_array(&env, &tier::audience(&env, group))
    }

    pub fn get_tier_policy(env: Env, group: u32) -> Option<TierPolicy> {
        env.storage().persistent().get(&Key::TierPolicy(group))
    }

    /// Anyone may submit: joins an attested group on a tier credential (see `tier.rs`) signed by a pinned issuer
    /// key, for exactly this commitment. Each credential (jti) adds one member. The ledger sees the credential
    /// only: no REP verdict, device key, spend or source. The operator's `add_member` stays as the fallback.
    pub fn add_member_with_tier(env: Env, group: u32, id_commitment: U256, cred: BytesN<106>, sig: BytesN<64>) -> U256 {
        let policy: TierPolicy = env
            .storage()
            .persistent()
            .get(&Key::TierPolicy(group))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RepNotConfigured));
        if id_commitment == U256::from_u32(&env, 0) {
            panic_with_error!(&env, Error::BadLeaf);
        }
        require_canonical(&env, &id_commitment);
        let c = tier::check(&env, group, &policy, &id_commitment, &cred);
        let key: BytesN<65> = env
            .storage()
            .persistent()
            .get(&Key::TierKey(group, c.kid))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RepIssuer));
        let uk = Key::TierUsed(c.jti.clone());
        if env.storage().persistent().has(&uk) {
            panic_with_error!(&env, Error::RepReplay);
        }
        tier::verify(&env, &key, &cred, &sig);
        env.storage().persistent().set(&uk, &true);
        bump_persistent(&env, &uk);
        insert_group_leaf(&env, group, &id_commitment);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("tier"), group), c.jti);
        load_group(&env, group).tree.root(&env)
    }

    pub fn is_tier_used(env: Env, jti: BytesN<16>) -> bool {
        env.storage().persistent().has(&Key::TierUsed(jti))
    }

    /// A merchant joins a chain group; its future checkouts are enrolled there too. Both admins sign.
    pub fn join_chain(env: Env, group: u32, merchant: u32) {
        let g = load_group(&env, group);
        if g.kind != Symbol::new(&env, "chain") {
            panic_with_error!(&env, Error::BadParams);
        }
        g.admin.require_auth();
        load_merchant(&env, merchant).admin.require_auth();
        let k = Key::MerchantChain(merchant);
        env.storage().persistent().set(&k, &group);
        bump_persistent(&env, &k);
    }

    /// The season the contract accepts right now (see `SeasonCfg`).
    pub fn current_season(env: Env) -> u32 {
        season_at(&season_cfg(&env), env.ledger().timestamp())
    }

    pub fn season_config(env: Env) -> SeasonCfg {
        season_cfg(&env)
    }

    /// Contract admin moves the season clock. Nullifiers already spent stay spent under their old season.
    pub fn set_season(env: Env, cfg: SeasonCfg) {
        let cadmin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        cadmin.require_auth();
        if cfg.len == 0 {
            panic_with_error!(&env, Error::BadParams);
        }
        env.storage().instance().set(&Key::Season, &cfg);
        bump_instance(&env);
    }

    /// Merchant admin sets which groups earn what discount, capped at `max_bps`.
    pub fn set_policy(env: Env, merchant: u32, policy: Policy) {
        load_merchant(&env, merchant).admin.require_auth();
        if policy.max_bps > 10_000 {
            panic_with_error!(&env, Error::BadParams);
        }
        for it in policy.items.iter() {
            if it.bps > 10_000 {
                panic_with_error!(&env, Error::BadParams);
            }
            if let GroupRef::Group(g) = it.group {
                load_group(&env, g);
            }
        }
        let k = Key::Policy(merchant);
        env.storage().persistent().set(&k, &policy);
        bump_persistent(&env, &k);
    }

    /// Booking with stacked context claims: each claim proves membership in one policy group, the
    /// discounts add up to `max_bps`, one USDC transfer. `amount` = None charges the list price;
    /// Some(amount) is a merchant-quoted amount the merchant admin co-signs.
    pub fn book_with_context(env: Env, merchant: u32, guest: Address, season: u32, amount: Option<i128>, claims: Vec<Claim>) -> i128 {
        guest.require_auth();
        require_season(&env, season);
        let h = load_merchant(&env, merchant);
        let base = match amount {
            Some(a) => {
                h.admin.require_auth();
                if a <= 0 {
                    panic_with_error!(&env, Error::BadParams);
                }
                a
            }
            None => h.price,
        };
        let policy: Policy = env
            .storage()
            .persistent()
            .get(&Key::Policy(merchant))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInPolicy));
        if claims.is_empty() {
            panic_with_error!(&env, Error::BadParams);
        }
        let message = discount_message(&env, &guest);
        let mut total: u32 = 0;
        for i in 0..claims.len() {
            let c = claims.get_unchecked(i);
            for j in 0..i {
                if claims.get_unchecked(j).group == c.group {
                    panic_with_error!(&env, Error::DuplicateClaim);
                }
            }
            let bps = policy
                .items
                .iter()
                .find(|it| it.group == c.group)
                .map(|it| it.bps)
                .unwrap_or_else(|| panic_with_error!(&env, Error::NotInPolicy));
            let roots = match c.group {
                GroupRef::Merchant(m) => (if m == merchant { h.clone() } else { load_merchant(&env, m) }).roots,
                GroupRef::Group(g) => load_group(&env, g).roots,
            };
            let scope = claim_scope(&env, merchant, &c.group, season);
            spend(&env, &roots, &c.root, &c.nullifier, &message, &scope, &c.proof);
            total += bps;
        }
        let bps = if total > policy.max_bps { policy.max_bps } else { total };
        let paid = base * (BPS - bps as i128) / BPS;
        let usdc: Address = env.storage().instance().get(&Key::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&guest, &h.admin, &paid);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("context"), merchant), (guest, paid, bps, season));
        paid
    }

    pub fn list_groups(env: Env) -> Vec<GroupInfo> {
        let n: u32 = env.storage().instance().get(&Key::GroupCount).unwrap_or(0);
        let mut out = Vec::new(&env);
        for id in 0..n {
            let g = load_group(&env, id);
            out.push_back(GroupInfo { id, kind: g.kind, name: g.name, operator: g.admin, size: g.tree.size });
        }
        out
    }

    pub fn group_count(env: Env) -> u32 {
        env.storage().instance().get(&Key::GroupCount).unwrap_or(0)
    }

    pub fn get_group(env: Env, group: u32) -> Group {
        load_group(&env, group)
    }

    pub fn get_group_leaves(env: Env, group: u32) -> Vec<U256> {
        env.storage().persistent().get(&Key::GroupLeaves(group)).unwrap_or(Vec::new(&env))
    }

    pub fn get_policy(env: Env, merchant: u32) -> Option<Policy> {
        env.storage().persistent().get(&Key::Policy(merchant))
    }

    pub fn merchant_chain(env: Env, merchant: u32) -> Option<u32> {
        env.storage().persistent().get(&Key::MerchantChain(merchant))
    }

    /// Contract admin replaces the code; storage and the contract ID stay. On testnet the admin is our deployer key;
    /// a production deployment hands this to a multisig or a timelock.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&Key::Admin).unwrap()
    }

    /// Anonymous review. Any account (relayer or fresh key) may submit, no auth.
    pub fn post_review(
        env: Env,
        merchant: u32,
        rating: u32,
        content_hash: BytesN<32>,
        disclosure_commit: BytesN<32>,
        proof: Proof,
        root: U256,
        nullifier: U256,
    ) -> u32 {
        if !(1..=5).contains(&rating) {
            panic_with_error!(&env, Error::BadRating);
        }
        let mut h = load_merchant(&env, merchant);
        let scope = review_scope(&env, merchant);
        let message = review_message(&env, rating, &content_hash, &disclosure_commit);
        spend(&env, &h.roots, &root, &nullifier, &message, &scope, &proof);

        let id: u32 = env.storage().instance().get(&Key::ReviewCount).unwrap();
        let r = Review { id, merchant, rating, content_hash, disclosure_commit, nullifier, verified: false, ledger: env.ledger().sequence() };
        let rk = Key::Review(id);
        env.storage().persistent().set(&rk, &r);
        bump_persistent(&env, &rk);
        let hk = Key::MerchantReviews(merchant);
        let mut ids: Vec<u32> = env.storage().persistent().get(&hk).unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage().persistent().set(&hk, &ids);
        bump_persistent(&env, &hk);
        env.storage().instance().set(&Key::ReviewCount, &(id + 1));

        h.rating_sum += rating;
        h.rating_count += 1;
        save_merchant(&env, merchant, &h);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("review"), merchant), (id, rating));
        id
    }

    /// Arbiter marks a review as a verified stay after checking the off-chain disclosure.
    pub fn attest_review(env: Env, review_id: u32) {
        let arbiter: Address = env.storage().instance().get(&Key::Arbiter).unwrap();
        arbiter.require_auth();
        let rk = Key::Review(review_id);
        let mut r: Review = env
            .storage()
            .persistent()
            .get(&rk)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ReviewNotFound));
        if r.verified {
            return;
        }
        r.verified = true;
        env.storage().persistent().set(&rk, &r);
        bump_persistent(&env, &rk);
        let mut h = load_merchant(&env, r.merchant);
        h.verified_count += 1;
        save_merchant(&env, r.merchant, &h);
        env.events().publish((soroban_sdk::symbol_short!("attest"), r.merchant), review_id);
    }

    /// Stateless Groth16 check against the stored Semaphore VK: `[root, nullifier, hash(message), hash(scope)]`.
    /// Used for the golden-proof gate and the cost benchmark. Rejects non-canonical signals.
    pub fn verify(env: Env, proof: Proof, pub_signals: Vec<U256>) -> bool {
        let mut pubs: Vec<Bn254Fr> = Vec::new(&env);
        for v in pub_signals.iter() {
            require_canonical(&env, &v);
            pubs.push_back(Bn254Fr::from_u256(v));
        }
        let vk: VerificationKey = env.storage().instance().get(&Key::Vk).unwrap();
        verifier::verify(&env, &vk, &proof, &pubs)
    }

    pub fn merchant_count(env: Env) -> u32 {
        env.storage().instance().get(&Key::MerchantCount).unwrap()
    }

    pub fn get_merchant(env: Env, merchant: u32) -> Merchant {
        load_merchant(&env, merchant)
    }

    pub fn get_root(env: Env, merchant: u32) -> U256 {
        load_merchant(&env, merchant).tree.root(&env)
    }

    pub fn get_rating(env: Env, merchant: u32) -> Rating {
        let h = load_merchant(&env, merchant);
        Rating { sum: h.rating_sum, count: h.rating_count, verified_count: h.verified_count }
    }

    pub fn get_review(env: Env, review_id: u32) -> Review {
        env.storage()
            .persistent()
            .get(&Key::Review(review_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::ReviewNotFound))
    }

    pub fn get_reviews(env: Env, merchant: u32) -> Vec<Review> {
        let ids: Vec<u32> = env.storage().persistent().get(&Key::MerchantReviews(merchant)).unwrap_or(Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            out.push_back(env.storage().persistent().get(&Key::Review(id)).unwrap());
        }
        out
    }

    pub fn get_leaves(env: Env, merchant: u32) -> Vec<U256> {
        env.storage().persistent().get(&Key::Leaves(merchant)).unwrap_or(Vec::new(&env))
    }

    pub fn leaf_index(env: Env, merchant: u32, id_commitment: U256) -> Option<u32> {
        env.storage().persistent().get(&Key::Leaf(merchant, id_commitment))
    }

    pub fn is_spent(env: Env, scope_hash: U256, nullifier: U256) -> bool {
        env.storage().persistent().has(&Key::Nullifier(scope_hash, nullifier))
    }

    pub fn arbiter(env: Env) -> Address {
        env.storage().instance().get(&Key::Arbiter).unwrap()
    }

    pub fn usdc(env: Env) -> Address {
        env.storage().instance().get(&Key::Usdc).unwrap()
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_tier;
