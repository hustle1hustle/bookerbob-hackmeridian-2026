// Fixtures for the on-chain tier credential check (src/tier.rs tests), signed with throwaway local keys.
// Run: node contracts/proof_of_stay/fixtures/gen-tier.mjs > contracts/proof_of_stay/fixtures/tier.json
import { createHash, generateKeyPairSync, sign } from "node:crypto"

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const sha = (x) => createHash("sha256").update(x).digest()
const key = () => generateKeyPairSync("ec", { namedCurve: "P-256" })
const sec1 = (k) => { const j = k.publicKey.export({ format: "jwk" }); return "04" + Buffer.from(j.x, "base64url").toString("hex") + Buffer.from(j.y, "base64url").toString("hex") }
const be = (n, len) => Buffer.from(BigInt(n).toString(16).padStart(len * 2, "0"), "hex")
const NOW = Number(process.env.TIER_FIXTURE_NOW ?? 1_792_900_000)
const GROUP = "rep-verified-traveler"
const COMMITMENT = "12345678901234567890123456789012345678901234567890123456789012345678901234567"
const issuer = key(), other = key()
let jtiN = 0
function cred({ magic = "REPTIER1", kid = 1, group = GROUP, tier = 1, commitment = COMMITMENT, iat = NOW - 10, exp = NOW + 590, jti } = {}) {
  return Buffer.concat([Buffer.from(magic), Buffer.from([kid]), sha(group), Buffer.from([tier]), be(commitment, 32), be(iat, 8), be(exp, 8), jti ?? be(++jtiN, 16)])
}
const isHigh = (s) => BigInt("0x" + s.subarray(32).toString("hex")) > N / 2n
function sig(c, k = issuer, want) {
  for (;;) {
    const s = sign("sha256", c, { key: k.privateKey, dsaEncoding: "ieee-p1363" })
    if (!want || (want === "high") === isHigh(s)) return s
  }
}
const pair = (c, k, want) => ({ cred: c.toString("hex"), sig: sig(c, k, want).toString("hex") })
const good = cred()
const lowSig = sig(good, issuer, "low")
const flipped = Buffer.concat([lowSig.subarray(0, 32), be(N - BigInt("0x" + lowSig.subarray(32).toString("hex")), 32)])
const out = {
  now: NOW, commitment: COMMITMENT, group_hash: sha(GROUP).toString("hex"), issuer_key: sec1(issuer), other_key: sec1(other),
  good: { cred: good.toString("hex"), sig: lowSig.toString("hex") },
  // the same credential with S flipped to n - S: still valid, still one member (replay is keyed on jti)
  same_cred_high_s: { cred: good.toString("hex"), sig: flipped.toString("hex") },
  good_high_s: pair(cred(), issuer, "high"),
  forged: pair(cred(), other),
  other_commitment: pair(cred({ commitment: COMMITMENT.replace(/7$/, "8") }), issuer),
  other_group: pair(cred({ group: "someone-else" }), issuer),
  bad_magic: pair(cred({ magic: "REPTIER2" }), issuer),
  unknown_kid: pair(cred({ kid: 7 }), issuer),
  tier_zero: pair(cred({ tier: 0 }), issuer),
  tier_two: pair(cred({ tier: 2 }), issuer),
  expired: pair(cred({ iat: NOW - 700, exp: NOW - 100 }), issuer),
  not_yet: pair(cred({ iat: NOW + 120, exp: NOW + 700 }), issuer),
  too_long: pair(cred({ iat: NOW - 10, exp: NOW + 7200 }), issuer),
}
console.log(JSON.stringify(out, null, 1))
