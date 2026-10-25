extern crate std;

use crate::tier::{self, TierPolicy};
use crate::{Error, ProofOfStay, ProofOfStayClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env, String as SString, Symbol, U256,
};

const FX: &str = include_str!("../fixtures/tier.json");

// Cross-implementation vector from the tier issuer (rep-attest-tier), throwaway test key.
const UCP_KEY: &str = "04640511a16881c6010f7b226a7dc86bb7813fb899f554bff1c8a05454575787bff88a6524702719e152612eb94af95748c969c239565a08c7567932b87643f278";
const UCP_CRED: &str = "524550544945523101fd7e957d201f506666bd60c5a3d4586f28a25f93b60e560ea3f62ee21ad6bf7501000000000000000000000000000000000000000000000000ab54a98ceb1f0ad2000000006add7ba0000000006add7df800112233445566778899aabbccddeeff";
const UCP_SIG: &str = "062d5a764d586d1b07cbb7f1073c90f1312767cbea110870077199aa7415575f6b74577685ba1d6e816983d2764e8b5053b4d9e1b91f2b31804f4b59d4e81d3a";

struct T<'a> {
    env: Env,
    client: ProofOfStayClient<'a>,
    fx: serde_json::Value,
    group: u32,
}

fn hexn<const N: usize>(env: &Env, h: &str) -> BytesN<N> {
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

fn tsetup<'a>() -> T<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let fx: serde_json::Value = serde_json::from_str(FX).unwrap();
    env.ledger().set_timestamp(fx["now"].as_u64().unwrap());
    let (vk, _, _) = crate::test::load_vk(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(ProofOfStay, (Address::generate(&env), Address::generate(&env), sac.address(), vk));
    let client = ProofOfStayClient::new(&env, &id);
    client.create_group(&Symbol::new(&env, "chain"), &Address::generate(&env), &SString::from_str(&env, "network"));
    let group = client.create_group(&Symbol::new(&env, "attested"), &Address::generate(&env), &SString::from_str(&env, "REP verified traveler"));
    client.set_tier_policy(&group, &TierPolicy { group_hash: hexn(&env, fx["group_hash"].as_str().unwrap()), min_tier: 1 });
    client.set_tier_issuer(&group, &1, &Some(hexn(&env, fx["issuer_key"].as_str().unwrap())));
    T { env, client, fx, group }
}

fn args(t: &T, name: &str) -> (BytesN<106>, BytesN<64>) {
    (hexn(&t.env, t.fx[name]["cred"].as_str().unwrap()), hexn(&t.env, t.fx[name]["sig"].as_str().unwrap()))
}

fn cm(t: &T) -> U256 {
    dec(&t.env, t.fx["commitment"].as_str().unwrap())
}

fn expect(t: &T, name: &str, want: Option<Error>) {
    let (c, s) = args(t, name);
    let res = t.client.try_add_member_with_tier(&t.group, &cm(t), &c, &s);
    match want {
        Some(e) => assert_eq!(res.err().unwrap().ok().unwrap(), e.into(), "{name}"),
        // a failed P-256 check is a host Crypto error, not a contract error
        None => match res {
            Err(Ok(e)) => assert!(!e.is_type(soroban_sdk::xdr::ScErrorType::Contract), "{name}: {e:?}"),
            other => assert!(other.is_err(), "{name}: {other:?}"),
        },
    }
    assert_eq!(t.client.get_group(&t.group).tree.size, 0, "{name} added a member");
}

#[test]
fn credential_joins_and_costs() {
    let t = tsetup();
    let (c, s) = args(&t, "good");
    t.env.cost_estimate().budget().reset_default();
    let root = t.client.add_member_with_tier(&t.group, &cm(&t), &c, &s);
    let b = t.env.cost_estimate().budget();
    std::println!("add_member_with_tier cpu={} mem={}", b.cpu_instruction_cost(), b.memory_bytes_cost());
    t.env.cost_estimate().budget().reset_unlimited();
    let g = t.client.get_group(&t.group);
    assert_eq!((g.tree.size, g.tree.root(&t.env)), (1, root));
    assert_eq!(t.client.get_group_leaves(&t.group).get_unchecked(0), cm(&t));
    let jti: [u8; 16] = c.to_array()[90..106].try_into().unwrap();
    assert!(t.client.is_tier_used(&BytesN::from_array(&t.env, &jti)));
}

#[test]
fn high_s_signature_passes() {
    let t = tsetup();
    let (c, s) = args(&t, "good_high_s");
    t.client.add_member_with_tier(&t.group, &cm(&t), &c, &s);
}

#[test]
fn issuer_vector_from_rep_attest_tier_verifies() {
    let t = tsetup();
    t.env.ledger().set_timestamp(1_792_900_000);
    t.client.set_tier_issuer(&t.group, &1, &Some(hexn(&t.env, UCP_KEY)));
    let r = t.client.add_member_with_tier(&t.group, &dec(&t.env, "12345678901234567890"), &hexn(&t.env, UCP_CRED), &hexn(&t.env, UCP_SIG));
    assert_eq!(t.client.get_group(&t.group).tree.root(&t.env), r);
}

#[test]
fn forged_signature_fails() {
    expect(&tsetup(), "forged", None);
}

#[test]
fn credential_for_another_commitment_fails() {
    expect(&tsetup(), "other_commitment", Some(Error::RepNonce));
}

#[test]
fn wrong_group_magic_or_kid_fails() {
    let t = tsetup();
    expect(&t, "other_group", Some(Error::RepIssuer));
    expect(&t, "bad_magic", Some(Error::RepMalformed));
    expect(&t, "unknown_kid", Some(Error::RepIssuer));
}

#[test]
fn tier_below_policy_fails() {
    let t = tsetup();
    expect(&t, "tier_zero", Some(Error::RepNoTier));
    t.client.set_tier_policy(&t.group, &TierPolicy { group_hash: hexn(&t.env, t.fx["group_hash"].as_str().unwrap()), min_tier: 3 });
    expect(&t, "tier_two", Some(Error::RepNoTier));
}

#[test]
fn expired_early_or_long_lived_fails() {
    let t = tsetup();
    expect(&t, "expired", Some(Error::RepExpired));
    expect(&t, "not_yet", Some(Error::RepExpired));
    expect(&t, "too_long", Some(Error::RepExpired));
    // a good credential after its exp
    t.env.ledger().set_timestamp(t.fx["now"].as_u64().unwrap() + 590);
    expect(&t, "good", Some(Error::RepExpired));
}

#[test]
fn replay_fails_even_with_flipped_s() {
    let t = tsetup();
    let (c, s) = args(&t, "good");
    t.client.add_member_with_tier(&t.group, &cm(&t), &c, &s);
    let again = t.client.try_add_member_with_tier(&t.group, &cm(&t), &c, &s);
    assert_eq!(again.err().unwrap().ok().unwrap(), Error::RepReplay.into());
    let (c2, s2) = args(&t, "same_cred_high_s");
    let flipped = t.client.try_add_member_with_tier(&t.group, &cm(&t), &c2, &s2);
    assert_eq!(flipped.err().unwrap().ok().unwrap(), Error::RepReplay.into());
    assert_eq!(t.client.get_group(&t.group).tree.size, 1);
}

#[test]
fn rotation_and_removal() {
    let t = tsetup();
    // the forged credential is signed by the other key: pin it as kid 1 and it passes, the old key stops
    t.client.set_tier_issuer(&t.group, &1, &Some(hexn(&t.env, t.fx["other_key"].as_str().unwrap())));
    expect(&t, "good", None);
    let (c, s) = args(&t, "forged");
    t.client.add_member_with_tier(&t.group, &cm(&t), &c, &s);
    t.client.set_tier_issuer(&t.group, &1, &None);
    assert!(t.client.get_tier_issuer(&t.group, &1).is_none());
    let (c, s) = args(&t, "good_high_s");
    assert_eq!(t.client.try_add_member_with_tier(&t.group, &cm(&t), &c, &s).err().unwrap().ok().unwrap(), Error::RepIssuer.into());
}

#[test]
fn needs_an_attested_group_with_a_policy() {
    let t = tsetup();
    let (c, s) = args(&t, "good");
    assert_eq!(t.client.try_add_member_with_tier(&0, &cm(&t), &c, &s).err().unwrap().ok().unwrap(), Error::RepNotConfigured.into());
    let p = TierPolicy { group_hash: hexn(&t.env, t.fx["group_hash"].as_str().unwrap()), min_tier: 1 };
    assert!(t.client.try_set_tier_policy(&0, &p).is_err());
    assert!(t.client.try_set_tier_issuer(&0, &1, &None).is_err());
}

#[test]
fn low_s_helper() {
    let mut s = [0u8; 64];
    s[32..].copy_from_slice(&hex::decode("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550").unwrap());
    let low = tier::low_s(s);
    assert_eq!(low[63], 1);
    assert!(low[32..63].iter().all(|&b| b == 0));
    assert_eq!(tier::low_s(low), low);
}
