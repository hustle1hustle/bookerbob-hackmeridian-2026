#![no_std]
//! Proof of Stay: guests prove a past stay with a Semaphore v4 proof, verified on-chain over BN254.
//! One circuit, the nullifier scope selects the use: anonymous review or returning-guest discount.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, crypto::bn254::Bn254Fr, panic_with_error,
    token, xdr::ToXdr, Address, Bytes, BytesN, Env, String, Vec, U256,
};

pub mod tree;
pub mod verifier;

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
    HotelNotFound = 1,
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
}

#[derive(Clone)]
#[contracttype]
pub struct Hotel {
    pub admin: Address,
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
    pub hotel: u32,
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
    Vk,
    Arbiter,
    Usdc,
    HotelCount,
    ReviewCount,
    Hotel(u32),
    Leaf(u32, U256),
    Nullifier(U256, U256),
    Review(u32),
    HotelReviews(u32),
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

fn tagged(env: &Env, tag: &str, hotel: u32) -> Bytes {
    let mut b = Bytes::from_slice(env, tag.as_bytes());
    b.extend_from_array(&hotel.to_be_bytes());
    b
}

/// Raw (pre-hash) scope for reviews: keccak256("pos/review" || be32(hotel)).
pub fn review_scope(env: &Env, hotel: u32) -> U256 {
    keccak_u256(env, &tagged(env, "pos/review", hotel))
}

/// Raw scope for discounts: keccak256("pos/discount" || be32(hotel) || be32(season)).
pub fn discount_scope(env: &Env, hotel: u32, season: u32) -> U256 {
    let mut b = tagged(env, "pos/discount", hotel);
    b.extend_from_array(&season.to_be_bytes());
    keccak_u256(env, &b)
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

fn load_hotel(env: &Env, id: u32) -> Hotel {
    env.storage()
        .persistent()
        .get(&Key::Hotel(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::HotelNotFound))
}

fn save_hotel(env: &Env, id: u32, h: &Hotel) {
    let k = Key::Hotel(id);
    env.storage().persistent().set(&k, h);
    bump_persistent(env, &k);
}

/// Checks root membership, nullifier freshness and the Groth16 proof, then burns the nullifier.
fn spend(env: &Env, hotel: &Hotel, root: &U256, nullifier: &U256, message: &U256, scope: &U256, proof: &Proof) {
    // Root 0 would accept proofs with an out-of-range merkleProofLength; only known roots count.
    if *root == U256::from_u32(env, 0) || !hotel.roots.contains(root) {
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
    pub fn __constructor(env: Env, arbiter: Address, usdc: Address, vk: VerificationKey) {
        if vk.ic.len() != 5 {
            panic_with_error!(&env, Error::BadParams);
        }
        let s = env.storage().instance();
        s.set(&Key::Vk, &vk);
        s.set(&Key::Arbiter, &arbiter);
        s.set(&Key::Usdc, &usdc);
        s.set(&Key::HotelCount, &0u32);
        s.set(&Key::ReviewCount, &0u32);
        bump_instance(&env);
    }

    pub fn register_hotel(env: Env, admin: Address, name: String, price: i128, discount_bps: u32) -> u32 {
        admin.require_auth();
        if price <= 0 || discount_bps > 10_000 {
            panic_with_error!(&env, Error::BadParams);
        }
        let id: u32 = env.storage().instance().get(&Key::HotelCount).unwrap();
        let h = Hotel {
            admin,
            name,
            price,
            discount_bps,
            tree: LeanImt::new(&env),
            roots: Vec::new(&env),
            rating_sum: 0,
            rating_count: 0,
            verified_count: 0,
        };
        save_hotel(&env, id, &h);
        env.storage().instance().set(&Key::HotelCount, &(id + 1));
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("hotel"), id), h.price);
        id
    }

    /// Hotel admin inserts the stay-identity commitment at checkout. Returns the new root.
    pub fn checkout(env: Env, hotel: u32, id_commitment: U256) -> U256 {
        let mut h = load_hotel(&env, hotel);
        h.admin.require_auth();
        if id_commitment == U256::from_u32(&env, 0) {
            panic_with_error!(&env, Error::BadLeaf);
        }
        require_canonical(&env, &id_commitment);
        if h.tree.size >= MAX_LEAVES {
            panic_with_error!(&env, Error::TreeFull);
        }
        let lk = Key::Leaf(hotel, id_commitment.clone());
        if env.storage().persistent().has(&lk) {
            panic_with_error!(&env, Error::DuplicateLeaf);
        }
        let index = h.tree.size;
        let root = h.tree.insert(&env, id_commitment.clone());
        if h.roots.len() >= ROOT_HISTORY {
            h.roots.pop_front();
        }
        h.roots.push_back(root.clone());
        save_hotel(&env, hotel, &h);
        env.storage().persistent().set(&lk, &index);
        bump_persistent(&env, &lk);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("checkout"), hotel), (id_commitment, index, root.clone()));
        root
    }

    /// Full-price booking: USDC from guest to hotel admin.
    pub fn book(env: Env, hotel: u32, guest: Address) -> i128 {
        guest.require_auth();
        let h = load_hotel(&env, hotel);
        let usdc: Address = env.storage().instance().get(&Key::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&guest, &h.admin, &h.price);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("book"), hotel), (guest, h.price));
        h.price
    }

    /// Returning-guest booking: proves a past stay at this hotel, once per season per stay.
    /// The proof message binds the paying guest, so a proof cannot be front-run by another payer.
    pub fn book_with_discount(env: Env, hotel: u32, guest: Address, season: u32, proof: Proof, root: U256, nullifier: U256) -> i128 {
        guest.require_auth();
        let h = load_hotel(&env, hotel);
        let scope = discount_scope(&env, hotel, season);
        let message = discount_message(&env, &guest);
        spend(&env, &h, &root, &nullifier, &message, &scope, &proof);
        let amount = h.price * (BPS - h.discount_bps as i128) / BPS;
        let usdc: Address = env.storage().instance().get(&Key::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&guest, &h.admin, &amount);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("discount"), hotel), (guest, amount, season));
        amount
    }

    /// Anonymous review. Any account (relayer or fresh key) may submit, no auth.
    pub fn post_review(
        env: Env,
        hotel: u32,
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
        let mut h = load_hotel(&env, hotel);
        let scope = review_scope(&env, hotel);
        let message = review_message(&env, rating, &content_hash, &disclosure_commit);
        spend(&env, &h, &root, &nullifier, &message, &scope, &proof);

        let id: u32 = env.storage().instance().get(&Key::ReviewCount).unwrap();
        let r = Review { hotel, rating, content_hash, disclosure_commit, nullifier, verified: false, ledger: env.ledger().sequence() };
        let rk = Key::Review(id);
        env.storage().persistent().set(&rk, &r);
        bump_persistent(&env, &rk);
        let hk = Key::HotelReviews(hotel);
        let mut ids: Vec<u32> = env.storage().persistent().get(&hk).unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage().persistent().set(&hk, &ids);
        bump_persistent(&env, &hk);
        env.storage().instance().set(&Key::ReviewCount, &(id + 1));

        h.rating_sum += rating;
        h.rating_count += 1;
        save_hotel(&env, hotel, &h);
        bump_instance(&env);
        env.events().publish((soroban_sdk::symbol_short!("review"), hotel), (id, rating));
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
        let mut h = load_hotel(&env, r.hotel);
        h.verified_count += 1;
        save_hotel(&env, r.hotel, &h);
        env.events().publish((soroban_sdk::symbol_short!("attest"), r.hotel), review_id);
    }

    pub fn hotel_count(env: Env) -> u32 {
        env.storage().instance().get(&Key::HotelCount).unwrap()
    }

    pub fn get_hotel(env: Env, hotel: u32) -> Hotel {
        load_hotel(&env, hotel)
    }

    pub fn get_root(env: Env, hotel: u32) -> U256 {
        load_hotel(&env, hotel).tree.root(&env)
    }

    pub fn get_rating(env: Env, hotel: u32) -> Rating {
        let h = load_hotel(&env, hotel);
        Rating { sum: h.rating_sum, count: h.rating_count, verified_count: h.verified_count }
    }

    pub fn get_review(env: Env, review_id: u32) -> Review {
        env.storage()
            .persistent()
            .get(&Key::Review(review_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::ReviewNotFound))
    }

    pub fn get_reviews(env: Env, hotel: u32) -> Vec<Review> {
        let ids: Vec<u32> = env.storage().persistent().get(&Key::HotelReviews(hotel)).unwrap_or(Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            out.push_back(env.storage().persistent().get(&Key::Review(id)).unwrap());
        }
        out
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
