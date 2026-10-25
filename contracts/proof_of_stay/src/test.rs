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

pub(crate) fn load_vk(env: &Env) -> (verifier::VerificationKey, verifier::Proof, Vec<Bn254Fr>) {
    load(env)
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
use soroban_sdk::{testutils::Address as _, token, Address, String as SString, Symbol};

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
    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let id = env.register(ProofOfStay, (admin, arbiter, sac.address(), vk));
    let client = ProofOfStayClient::new(&env, &id);
    let usdc = token::Client::new(&env, &sac.address());
    let hotel_admin = Address::generate(&env);
    let fx: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
    // 100 USDC (7 decimals), 20% off for returning guests
    let hid = client.register_merchant(&hotel_admin, &Symbol::new(&env, "hotel"), &SString::from_str(&env, "Casa Alfama"), &1_000_000_000, &2000);
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
fn review_at_other_merchant_fails() {
    let c = setup();
    let other = c.client.register_merchant(&c.hotel_admin, &Symbol::new(&c.env, "cafe"), &SString::from_str(&c.env, "Other"), &10, &0);
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

#[test]
fn leaves_view_matches_checkouts() {
    let c = setup();
    let leaves = c.client.get_leaves(&0);
    let fx = c.fx["commitments"].as_array().unwrap();
    assert_eq!(leaves.len() as usize, fx.len());
    for (i, cm) in fx.iter().enumerate() {
        let v = u256_dec(&c.env, cm.as_str().unwrap());
        assert_eq!(leaves.get_unchecked(i as u32), v);
        assert_eq!(c.client.leaf_index(&0, &v), Some(i as u32));
    }
    assert_eq!(c.client.leaf_index(&0, &U256::from_u32(&c.env, 7)), None);
    assert_eq!(tree::lean_imt_root(&c.env, &leaves), c.client.get_root(&0));
}

// ---- v2: merchant-quoted amounts, redeem, upgrade ----

use soroban_sdk::testutils::{AuthorizedFunction, MockAuth, MockAuthInvoke};
use soroban_sdk::IntoVal;

fn discount_args(c: &Ctx) -> (Address, u32, verifier::Proof, U256, U256) {
    let d = &c.fx["discount"];
    (
        Address::from_str(&c.env, c.fx["guest"].as_str().unwrap()),
        c.fx["season"].as_u64().unwrap() as u32,
        proof_from(&c.env, &d["proof"]),
        u256_dec(&c.env, d["root"].as_str().unwrap()),
        u256_dec(&c.env, d["nullifier"].as_str().unwrap()),
    )
}

fn fund(c: &Ctx, who: &Address) {
    soroban_sdk::token::StellarAssetClient::new(&c.env, &c.usdc.address).mint(who, &5_000_000_000);
}

#[test]
fn discount_amount_charges_signed_amount_and_requires_admin() {
    let c = setup();
    let (guest, season, proof, root, nf) = discount_args(&c);
    fund(&c, &guest);
    let order = BytesN::from_array(&c.env, &[7u8; 32]);
    // 250 USDC cart, 20% off
    let paid = c.client.book_with_discount_amount(&0, &guest, &season, &2_500_000_000, &order, &proof, &root, &nf);
    // env.auths() reflects the last invocation only, so read it before any other call
    let auths = c.env.auths();
    assert_eq!(paid, 2_000_000_000);
    assert_eq!(c.usdc.balance(&c.hotel_admin), 2_000_000_000);
    // the merchant admin authorized exactly these arguments, amount and order_ref included
    let admin_auth = auths.iter().find(|(a, _)| *a == c.hotel_admin).expect("admin auth missing");
    match &admin_auth.1.function {
        AuthorizedFunction::Contract((_, name, args)) => {
            assert_eq!(*name, Symbol::new(&c.env, "book_with_discount_amount"));
            let amount: i128 = args.get(3).unwrap().into_val(&c.env);
            assert_eq!(amount, 2_500_000_000);
        }
        _ => panic!("unexpected auth"),
    }
    // same nullifier cannot be used again on the fixed-price path either
    let err = c.client.try_book_with_discount(&0, &guest, &season, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::NullifierUsed.into());
}

#[test]
fn amount_without_admin_signature_is_refused() {
    let c = setup();
    let (guest, _, _, _, _) = discount_args(&c);
    fund(&c, &guest);
    let order = BytesN::from_array(&c.env, &[9u8; 32]);
    // only the guest signs (including the token transfer it would make); the merchant admin does not
    let args = (0u32, guest.clone(), 1i128, order.clone()).into_val(&c.env);
    c.env.mock_auths(&[MockAuth {
        address: &guest,
        invoke: &MockAuthInvoke { contract: &c.client.address, fn_name: "book_amount", args, sub_invokes: &[] },
    }]);
    let r = c.client.try_book_amount(&0, &guest, &1, &order);
    assert!(r.is_err(), "book_amount passed without the merchant admin's signature");
    assert_eq!(c.usdc.balance(&c.hotel_admin), 0);
}

#[test]
fn book_amount_full_price() {
    let c = setup();
    let guest = Address::generate(&c.env);
    fund(&c, &guest);
    let order = BytesN::from_array(&c.env, &[1u8; 32]);
    assert_eq!(c.client.book_amount(&0, &guest, &408_000_000, &order), 408_000_000);
    let err = c.client.try_book_amount(&0, &guest, &0, &order);
    assert_eq!(err.err().unwrap().unwrap(), Error::BadParams.into());
}

#[test]
fn redeem_spends_nullifier_without_transfer_once() {
    let c = setup();
    let (guest, season, proof, root, nf) = discount_args(&c);
    let order = BytesN::from_array(&c.env, &[3u8; 32]);
    c.client.redeem(&0, &guest, &season, &order, &proof, &root, &nf);
    let auths = c.env.auths();
    assert_eq!(c.usdc.balance(&c.hotel_admin), 0);
    assert!(auths.iter().any(|(a, _)| *a == c.hotel_admin), "redeem must require the merchant admin");
    let err = c.client.try_redeem(&0, &guest, &season, &order, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::NullifierUsed.into());
    // and the USDC path is closed for that season too
    fund(&c, &guest);
    let err = c.client.try_book_with_discount(&0, &guest, &season, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::NullifierUsed.into());
}

#[test]
fn redeem_for_another_guest_fails() {
    let c = setup();
    let (_, season, proof, root, nf) = discount_args(&c);
    let other = Address::generate(&c.env);
    let order = BytesN::from_array(&c.env, &[4u8; 32]);
    let err = c.client.try_redeem(&0, &other, &season, &order, &proof, &root, &nf);
    assert_eq!(err.err().unwrap().unwrap(), Error::InvalidProof.into());
}

const WASM: &[u8] = include_bytes!("../target/wasm32v1-none/release/proof_of_stay.wasm");

#[test]
fn upgrade_by_admin_keeps_state() {
    let c = setup();
    let hash = c.env.deployer().upload_contract_wasm(WASM);
    let root_before = c.client.get_root(&0);
    let admin = c.client.admin();
    c.client.upgrade(&hash);
    assert!(c.env.auths().iter().any(|(a, _)| *a == admin));
    assert_eq!(c.client.get_root(&0), root_before);
}

#[test]
fn upgrade_by_non_admin_is_refused() {
    let c = setup();
    let hash = c.env.deployer().upload_contract_wasm(WASM);
    let stranger = Address::generate(&c.env);
    let args = (hash.clone(),).into_val(&c.env);
    c.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke { contract: &c.client.address, fn_name: "upgrade", args, sub_invokes: &[] },
    }]);
    assert!(c.client.try_upgrade(&hash).is_err());
}

// ---- context groups ----

use crate::{Claim, GroupRef, Policy, PolicyItem};

const GFX: &str = include_str!("../../../circuits/golden/depth10/fixtures-groups.json");

struct GCtx<'a> {
    c: Ctx<'a>,
    gx: serde_json::Value,
    guest: Address,
    attester: Address,
}

/// Merchant 0 joins chain group 0 before checkouts, attested group 1 holds stay 2 only.
fn gsetup<'a>() -> GCtx<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let (vk, _, _) = load(&env);
    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(ProofOfStay, (admin, arbiter, sac.address(), vk));
    let client = ProofOfStayClient::new(&env, &id);
    let usdc = token::Client::new(&env, &sac.address());
    let hotel_admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let gx: serde_json::Value = serde_json::from_str(GFX).unwrap();
    client.register_merchant(&hotel_admin, &Symbol::new(&env, "hotel"), &SString::from_str(&env, "Casa"), &1_000_000_000, &2000);
    let chain = client.create_group(&Symbol::new(&env, "chain"), &hotel_admin, &SString::from_str(&env, "Lisbon stays network"));
    let att = client.create_group(&Symbol::new(&env, "attested"), &attester, &SString::from_str(&env, "verified traveler"));
    assert_eq!((chain, att), (0, 1));
    client.join_chain(&0, &0);
    for cm in gx["commitments"].as_array().unwrap() {
        client.checkout(&0, &u256_dec(&env, cm.as_str().unwrap()));
    }
    client.add_member(&1, &u256_dec(&env, gx["attested"][0].as_str().unwrap()));
    let guest = Address::from_str(&env, gx["guest"].as_str().unwrap());
    soroban_sdk::token::StellarAssetClient::new(&env, &sac.address()).mint(&guest, &5_000_000_000);
    let fx: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
    GCtx { c: Ctx { env, client, usdc, hotel_admin, fx }, gx, guest, attester }
}

fn claim(g: &GCtx, name: &str, group: GroupRef) -> Claim {
    let j = &g.gx["claims"][name];
    Claim { group, proof: proof_from(&g.c.env, &j["proof"]), root: u256_dec(&g.c.env, j["root"].as_str().unwrap()), nullifier: u256_dec(&g.c.env, j["nullifier"].as_str().unwrap()) }
}

fn policy(g: &GCtx, items: &[(GroupRef, u32)], max_bps: u32) {
    let mut v = Vec::new(&g.c.env);
    for (gr, bps) in items {
        v.push_back(PolicyItem { group: gr.clone(), bps: *bps });
    }
    g.c.client.set_policy(&0, &Policy { items: v, max_bps });
}

fn std_policy(g: &GCtx) {
    policy(g, &[(GroupRef::Merchant(0), 1000), (GroupRef::Group(0), 500), (GroupRef::Group(1), 500)], 1500);
}

fn claims(g: &GCtx, cs: &[Claim]) -> Vec<Claim> {
    let mut v = Vec::new(&g.c.env);
    for c in cs {
        v.push_back(c.clone());
    }
    v
}

#[test]
fn chain_group_mirrors_checkouts_and_roots_match_js() {
    let g = gsetup();
    let groups = g.c.client.list_groups();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups.get_unchecked(0).size, 3);
    assert_eq!(groups.get_unchecked(1).size, 1);
    assert_eq!(g.c.client.get_group(&0).tree.root(&g.c.env), u256_dec(&g.c.env, g.gx["roots"]["chain"].as_str().unwrap()));
    assert_eq!(g.c.client.get_group(&1).tree.root(&g.c.env), u256_dec(&g.c.env, g.gx["roots"]["attested"].as_str().unwrap()));
}

#[test]
fn stacked_claims_are_capped() {
    let g = gsetup();
    std_policy(&g);
    let cs = claims(&g, &[claim(&g, "self", GroupRef::Merchant(0)), claim(&g, "chain", GroupRef::Group(0)), claim(&g, "attested", GroupRef::Group(1))]);
    // 10% + 5% + 5% = 20%, capped at 15%
    let paid = g.c.client.book_with_context(&0, &g.guest, &1, &None, &cs);
    assert_eq!(paid, 850_000_000);
    std::println!("book_with_context x3 cpu={}", g.c.env.cost_estimate().budget().cpu_instruction_cost());
}

#[test]
fn stacked_claims_below_cap_add_up() {
    let g = gsetup();
    std_policy(&g);
    let cs = claims(&g, &[claim(&g, "chain", GroupRef::Group(0)), claim(&g, "attested", GroupRef::Group(1))]);
    assert_eq!(g.c.client.book_with_context(&0, &g.guest, &1, &None, &cs), 900_000_000);
}

#[test]
fn claim_outside_policy_is_refused() {
    let g = gsetup();
    policy(&g, &[(GroupRef::Merchant(0), 1000), (GroupRef::Group(0), 500)], 1500);
    let cs = claims(&g, &[claim(&g, "attested", GroupRef::Group(1))]);
    let err = g.c.client.try_book_with_context(&0, &g.guest, &1, &None, &cs);
    assert_eq!(err.err().unwrap().unwrap(), Error::NotInPolicy.into());
}

#[test]
fn group_nullifier_reuse_is_refused() {
    let g = gsetup();
    std_policy(&g);
    let cs = claims(&g, &[claim(&g, "chain", GroupRef::Group(0))]);
    g.c.client.book_with_context(&0, &g.guest, &1, &None, &cs);
    let err = g.c.client.try_book_with_context(&0, &g.guest, &1, &None, &cs);
    assert_eq!(err.err().unwrap().unwrap(), Error::NullifierUsed.into());
}

#[test]
fn self_claim_shares_the_plain_discount_nullifier() {
    let g = gsetup();
    std_policy(&g);
    let s = claim(&g, "self", GroupRef::Merchant(0));
    g.c.client.book_with_discount(&0, &g.guest, &1, &s.proof, &s.root, &s.nullifier);
    let err = g.c.client.try_book_with_context(&0, &g.guest, &1, &None, &claims(&g, &[s]));
    assert_eq!(err.err().unwrap().unwrap(), Error::NullifierUsed.into());
}

#[test]
fn wrong_root_for_group_is_refused() {
    let g = gsetup();
    std_policy(&g);
    let mut c = claim(&g, "chain", GroupRef::Group(0));
    c.root = u256_dec(&g.c.env, g.gx["roots"]["attested"].as_str().unwrap());
    let err = g.c.client.try_book_with_context(&0, &g.guest, &1, &None, &claims(&g, &[c]));
    assert_eq!(err.err().unwrap().unwrap(), Error::UnknownRoot.into());
}

#[test]
fn duplicate_group_claim_is_refused() {
    let g = gsetup();
    std_policy(&g);
    let c = claim(&g, "chain", GroupRef::Group(0));
    let err = g.c.client.try_book_with_context(&0, &g.guest, &1, &None, &claims(&g, &[c.clone(), c]));
    assert_eq!(err.err().unwrap().unwrap(), Error::DuplicateClaim.into());
}

#[test]
fn claim_proof_for_another_group_fails() {
    let g = gsetup();
    std_policy(&g);
    // attested proof presented as a chain claim with the attested root: root check passes only if
    // the root were in the chain history; give it the chain root instead so the proof itself fails
    let mut c = claim(&g, "attested", GroupRef::Group(0));
    c.root = u256_dec(&g.c.env, g.gx["roots"]["chain"].as_str().unwrap());
    let err = g.c.client.try_book_with_context(&0, &g.guest, &1, &None, &claims(&g, &[c]));
    assert_eq!(err.err().unwrap().unwrap(), Error::InvalidProof.into());
}

#[test]
fn add_member_by_non_attester_is_refused() {
    let g = gsetup();
    let stranger = Address::generate(&g.c.env);
    let cm = U256::from_u32(&g.c.env, 12345);
    let args = (1u32, cm.clone()).into_val(&g.c.env);
    g.c.env.mock_auths(&[MockAuth { address: &stranger, invoke: &MockAuthInvoke { contract: &g.c.client.address, fn_name: "add_member", args, sub_invokes: &[] } }]);
    assert!(g.c.client.try_add_member(&1, &cm).is_err());
    let _ = &g.attester;
}

#[test]
fn create_group_needs_contract_admin() {
    let g = gsetup();
    let stranger = Address::generate(&g.c.env);
    let args = (Symbol::new(&g.c.env, "attested"), stranger.clone(), SString::from_str(&g.c.env, "x")).into_val(&g.c.env);
    g.c.env.mock_auths(&[MockAuth { address: &stranger, invoke: &MockAuthInvoke { contract: &g.c.client.address, fn_name: "create_group", args, sub_invokes: &[] } }]);
    assert!(g.c.client.try_create_group(&Symbol::new(&g.c.env, "attested"), &stranger, &SString::from_str(&g.c.env, "x")).is_err());
}
