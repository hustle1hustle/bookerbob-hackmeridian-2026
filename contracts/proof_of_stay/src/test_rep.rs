extern crate std;

use crate::rep::{self, RepIssuer};
use crate::{Error, ProofOfStay, ProofOfStayClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Bytes, BytesN, Env, String as SString, Symbol, U256,
};

const FX: &str = include_str!("../fixtures/rep.json");

struct R<'a> {
    env: Env,
    client: ProofOfStayClient<'a>,
    fx: serde_json::Value,
    group: u32,
}

fn hex65(env: &Env, h: &str) -> BytesN<65> {
    BytesN::from_array(env, &hex::decode(h).unwrap().try_into().unwrap())
}

fn dec(env: &Env, s: &str) -> U256 {
    let mut out = [0u8; 32];
    for ch in s.bytes() {
        let mut carry = (ch - b'0') as u32;
        for b in out.iter_mut().rev() {
            let v = (*b as u32) * 10 + carry;
            *b = (v & 0xff) as u8;
            carry = v >> 8;
        }
    }
    U256::from_be_bytes(env, &Bytes::from_array(env, &out))
}

fn issuer(env: &Env, key: &str) -> RepIssuer {
    RepIssuer {
        key: hex65(env, key),
        iss: Bytes::from_slice(env, b"https://rep-attest.fly.dev"),
        aud: Bytes::from_slice(env, b"bookerbob"),
        max_age: 7 * 86400,
        hosts: vec![env, Bytes::from_slice(env, b"airbnb.com"), Bytes::from_slice(env, b"booking.com")],
    }
}

fn rsetup<'a>() -> R<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let fx: serde_json::Value = serde_json::from_str(FX).unwrap();
    env.ledger().set_timestamp(fx["now"].as_u64().unwrap());
    let g = include_str!("../../../circuits/golden/depth10/soroban.json");
    let _ = g; // the VK is irrelevant here; reuse the main test's loader
    env.cost_estimate().budget().reset_unlimited();
    let (vk, _, _) = crate::test::load_vk(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(ProofOfStay, (Address::generate(&env), Address::generate(&env), sac.address(), vk));
    let client = ProofOfStayClient::new(&env, &id);
    client.create_group(&Symbol::new(&env, "chain"), &Address::generate(&env), &SString::from_str(&env, "network"));
    let group = client.create_group(&Symbol::new(&env, "attested"), &Address::generate(&env), &SString::from_str(&env, "REP verified traveler"));
    client.set_rep_issuer(&group, &issuer(&env, fx["issuer_key"].as_str().unwrap()));
    R { env, client, fx, group }
}

fn case<'a>(r: &R<'a>, name: &str) -> (U256, Bytes, Bytes) {
    let c = &r.fx[name];
    let cm = c["commitment"].as_str().unwrap_or(r.fx["commitment"].as_str().unwrap());
    (
        dec(&r.env, cm),
        Bytes::from_slice(&r.env, c["verdict"].as_str().unwrap().as_bytes()),
        Bytes::from_slice(&r.env, c["kb"].as_str().unwrap().as_bytes()),
    )
}

fn expect_err(r: &R, name: &str, want: Option<Error>) {
    let (cm, v, kb) = case(r, name);
    let res = r.client.try_add_member_with_rep(&r.group, &cm, &v, &kb);
    match want {
        Some(e) => assert_eq!(res.err().unwrap().ok().unwrap(), e.into(), "{name}"),
        // a failed P-256 check is a host Crypto error, not a contract error
        None => match res {
            Err(Ok(e)) => assert!(!e.is_type(soroban_sdk::xdr::ScErrorType::Contract), "{name}: {e:?}"),
            other => assert!(other.is_err(), "{name}: {other:?}"),
        },
    }
    assert_eq!(r.client.get_group(&r.group).tree.size, 0, "{name} added a member");
}

#[test]
fn real_shape_verdict_joins_and_costs() {
    let r = rsetup();
    let (cm, v, kb) = case(&r, "good");
    r.env.cost_estimate().budget().reset_default();
    let root = r.client.add_member_with_rep(&r.group, &cm, &v, &kb);
    let b = r.env.cost_estimate().budget();
    std::println!("add_member_with_rep cpu={} mem={}", b.cpu_instruction_cost(), b.memory_bytes_cost());
    r.env.cost_estimate().budget().reset_unlimited();
    let g = r.client.get_group(&r.group);
    assert_eq!(g.tree.size, 1);
    assert_eq!(g.tree.root(&r.env), root);
    assert_eq!(r.client.get_group_leaves(&r.group).get_unchecked(0), cm);
}

#[test]
fn low_s_signatures_also_pass() {
    let r = rsetup();
    let (cm, v, kb) = case(&r, "good_low_s");
    r.client.add_member_with_rep(&r.group, &cm, &v, &kb);
    assert_eq!(r.client.get_group(&r.group).tree.size, 1);
}

#[test]
fn forged_issuer_signature_fails() {
    expect_err(&rsetup(), "forged_issuer", None);
}

#[test]
fn rotated_issuer_key_is_an_admin_update() {
    let r = rsetup();
    // pin the other key: the old verdict stops passing, the forged one (signed by it) passes
    r.client.set_rep_issuer(&r.group, &issuer(&r.env, r.fx["other_key"].as_str().unwrap()));
    expect_err(&r, "good", None);
    let (cm, v, kb) = case(&r, "forged_issuer");
    r.client.add_member_with_rep(&r.group, &cm, &v, &kb);
}

#[test]
fn wrong_device_key_fails() {
    let r = rsetup();
    expect_err(&r, "wrong_device_thumb", Some(Error::RepHolder));
    expect_err(&r, "wrong_device_sig", None);
    expect_err(&r, "at_hash_other_verdict", Some(Error::RepHolder));
    expect_err(&r, "wrong_aud", Some(Error::RepHolder));
}

#[test]
fn nonce_commitment_mismatch_fails() {
    let r = rsetup();
    expect_err(&r, "nonce_other_commitment", Some(Error::RepNonce));
}

#[test]
fn expired_fails() {
    let r = rsetup();
    let now = r.fx["now"].as_u64().unwrap();
    // past exp (issued now-3600 with a 30 day ttl); max_age widened so exp is the reason
    let mut cfg = issuer(&r.env, r.fx["issuer_key"].as_str().unwrap());
    cfg.max_age = 60 * 86400;
    r.client.set_rep_issuer(&r.group, &cfg);
    r.env.ledger().set_timestamp(now - 3600 + 30 * 86400);
    expect_err(&r, "good", Some(Error::RepExpired));
    // older than max_age (7 days), still inside exp
    r.client.set_rep_issuer(&r.group, &issuer(&r.env, r.fx["issuer_key"].as_str().unwrap()));
    r.env.ledger().set_timestamp(now + 8 * 86400);
    expect_err(&r, "good", Some(Error::RepExpired));
    // a holder proof older than 5 minutes
    r.env.ledger().set_timestamp(now + 301);
    expect_err(&r, "good", Some(Error::RepHolder));
    // before nbf
    r.env.ledger().set_timestamp(now - 3601);
    expect_err(&r, "good", Some(Error::RepExpired));
}

#[test]
fn no_tier_or_not_lodging_fails() {
    let r = rsetup();
    expect_err(&r, "no_tier", Some(Error::RepNoTier));
    expect_err(&r, "not_lodging", Some(Error::RepNoTier));
}

#[test]
fn wrong_iss_fails() {
    expect_err(&rsetup(), "wrong_iss", Some(Error::RepIssuer));
}

#[test]
fn replay_fails() {
    let r = rsetup();
    let (cm, v, kb) = case(&r, "good");
    r.client.add_member_with_rep(&r.group, &cm, &v, &kb);
    // the same presentation again
    expect_replay(&r, &cm, &v, &kb);
    // the same verdict with a fresh holder proof for another commitment: one verdict, one member
    let (cm2, v2, kb2) = case(&r, "replay_second_commitment");
    expect_replay(&r, &cm2, &v2, &kb2);
    // the same verdict with S flipped to n - S (still a valid signature): the replay key ignores S
    let (cm3, v3, kb3) = case(&r, "replay_s_flipped");
    expect_replay(&r, &cm3, &v3, &kb3);
    assert_eq!(r.client.get_group(&r.group).tree.size, 1);
}

#[test]
fn s_flipped_verdict_alone_passes() {
    // control for replay_fails: the flipped copy is otherwise a valid presentation
    let r = rsetup();
    let (cm, v, kb) = case(&r, "replay_s_flipped");
    r.client.add_member_with_rep(&r.group, &cm, &v, &kb);
}

fn expect_replay(r: &R, cm: &U256, v: &Bytes, kb: &Bytes) {
    let res = r.client.try_add_member_with_rep(&r.group, cm, v, kb);
    assert_eq!(res.err().unwrap().ok().unwrap(), Error::RepReplay.into());
}

#[test]
fn needs_an_attested_group_with_an_issuer() {
    let r = rsetup();
    let (cm, v, kb) = case(&r, "good");
    assert_eq!(r.client.try_add_member_with_rep(&0, &cm, &v, &kb).err().unwrap().ok().unwrap(), Error::RepNotConfigured.into());
    assert!(r.client.try_set_rep_issuer(&0, &issuer(&r.env, r.fx["issuer_key"].as_str().unwrap())).is_err());
}

#[test]
fn helpers() {
    let mut out = [0u8; 64];
    assert_eq!(rep::b64u_decode(b"aGk", &mut out), Some(&b"hi"[..]));
    assert_eq!(rep::b64u_decode(b"aGl", &mut out), None); // non-zero trailing bits
    assert_eq!(rep::b64u_decode(b"aGk=", &mut out), None); // padding
    assert_eq!(rep::b64u_decode(b"a", &mut out), None);
    let mut s = [0u8; 64];
    // s = n - 1 (high), low form is 1
    s[32..].copy_from_slice(&hex::decode("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550").unwrap());
    let low = rep::low_s(s);
    assert_eq!(low[63], 1);
    assert!(low[32..63].iter().all(|&b| b == 0));
    assert_eq!(rep::low_s(low), low);
}
