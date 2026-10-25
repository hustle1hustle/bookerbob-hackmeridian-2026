// REP handoff tests: a fixture issuer (its own ES256 key and a signed status list on loopback) stands in for
// rep-attest.fly.dev; the holder signs a key-binding JWT the way REP Bob does. Run: node --test server/src/rep.test.ts
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { deflateRawSync } from "node:zlib"
import { createRep, REP_ISSUER, AUD } from "./rep.ts"

const b64u = (x: Buffer | string) => Buffer.from(x).toString("base64url")
const issuerKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
const holderKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
const pub = (k: typeof issuerKey) => k.publicKey.export({ format: "jwk" }) as { crv: string; x: string; y: string }
const JWK = { ...pub(issuerKey), kty: "EC", kid: "rep-attest-1" }
const jws = (header: object, payload: object, key = issuerKey.privateKey) => {
  const si = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`
  return `${si}.${b64u(sign("sha256", Buffer.from(si), { key, dsaEncoding: "ieee-p1363" }))}`
}
const thumb = (j: { crv: string; x: string; y: string }) => createHash("sha256").update(JSON.stringify({ crv: j.crv, kty: "EC", x: j.x, y: j.y })).digest("base64url")

// signed status list on loopback (verify-rep allows http only there); bit 7 = revoked
let statusUrl = ""
let statusServer: Server
const ready = new Promise<void>((ok) => {
  statusServer = createServer((_, res) => {
    const bits = Buffer.alloc(16)
    bits[0] = 1 << 7
    res.end(jws({ alg: "ES256", kid: "rep-attest-1", typ: "statuslist+jwt" }, { sub: statusUrl, status_list: { bits: 1, lst: b64u(deflateRawSync(bits)) } }))
  }).listen(0, "127.0.0.1", () => {
    statusUrl = `http://127.0.0.1:${(statusServer.address() as any).port}/status/1`
    ok()
  })
})

const NOW = 1_792_900_000
function verdict(over: Record<string, unknown> = {}) {
  return jws({ alg: "ES256", typ: "rep-attestation+jws", kid: "rep-attest-1" }, {
    iss: REP_ISSUER, vct: "travel-context", rep_profile: 1, iat: NOW - 60, exp: NOW + 3600,
    cnf: { jkt: thumb(pub(holderKey)) }, status: { status_list: { uri: statusUrl, idx: 3 } },
    server_name: "www.airbnb.com", evidence_time: NOW - 86_400, lodging_spend_tier: "T2", ...over,
  })
}
const kb = (v: string, nonce: string, aud = AUD) =>
  jws({ alg: "ES256", typ: "kb+jwt", jwk: { ...pub(holderKey), kty: "EC" } }, { aud, nonce, iat: NOW, at_hash: createHash("sha256").update(v).digest("base64url") }, holderKey.privateKey)

function harness() {
  const added: bigint[] = []
  let t = NOW * 1000
  const rep = createRep({ jwks: { keys: [JWK] }, now: () => t, addMember: async (c) => (added.push(c), "ab".repeat(32)) })
  // exactly like index.ts: the handler gets the pathname, the query stays on req.url
  const server = createServer((req, res) => rep.handle(req, res, new URL(req.url!, "http://x").pathname))
  const base = new Promise<string>((ok) => server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(server.address() as any).port}/api/rep`)))
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(`${await base}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return { status: r.status, body: (await r.json()) as any }
  }
  const open = async (commitment = "12345") => {
    const s = await call("/session", { commitment })
    const p = await call("/pending")
    assert.equal(p.body.sid, s.body.sid)
    assert.equal(p.body.aud, AUD)
    return p.body as { sid: string; nonce: string }
  }
  return { rep, call, open, added, advance: (ms: number) => (t += ms), close: () => server.close() }
}

test("a valid verdict adds the commitment to the group and keeps only 'passed'", async () => {
  await ready
  const h = harness()
  const { sid, nonce } = await h.open("12345")
  const v = verdict()
  const r = await h.call("/present", { sid, attestations: [{ jws: v, kbJwt: kb(v, nonce) }], vps: ["never read"], presentations: ["never read"] })
  assert.equal(r.status, 200)
  assert.deepEqual(h.added, [12345n])
  const res = await h.call(`/result?sid=${sid}`)
  assert.equal(res.body.status, "passed")
  assert.deepEqual(Object.keys(res.body).sort(), ["status", "txHash"])
  h.close()
})

test("forged signature is refused", async () => {
  await ready
  const h = harness()
  const { sid, nonce } = await h.open()
  const [hd, , sg] = verdict().split(".")
  const forged = `${hd}.${b64u(JSON.stringify({ iss: REP_ISSUER, rep_profile: 1, lodging_spend_tier: "T5", server_name: "www.airbnb.com", cnf: { jkt: thumb(pub(holderKey)) }, exp: NOW + 3600 }))}.${sg}`
  const r = await h.call("/present", { sid, attestations: [{ jws: forged, kbJwt: kb(forged, nonce) }] })
  assert.equal(r.status, 400)
  assert.equal(h.added.length, 0)
  assert.match((await h.call(`/result?sid=${sid}`)).body.reason, /SIGNATURE_INVALID/)
  h.close()
})

test("expired session is refused", async () => {
  await ready
  const h = harness()
  const { sid, nonce } = await h.open()
  h.advance(2 * 60_000 + 1)
  const v = verdict()
  const r = await h.call("/present", { sid, attestations: [{ jws: v, kbJwt: kb(v, nonce) }] })
  assert.equal(r.status, 410)
  assert.equal(h.added.length, 0)
  assert.equal((await h.call("/pending")).body.sid, undefined)
  h.close()
})

test("a reused nonce is refused", async () => {
  await ready
  const h = harness()
  const { sid, nonce } = await h.open()
  const v = verdict()
  assert.equal((await h.call("/present", { sid, attestations: [{ jws: v, kbJwt: kb(v, nonce) }] })).status, 200)
  const again = await h.call("/present", { sid, attestations: [{ jws: v, kbJwt: kb(v, nonce) }] })
  assert.equal(again.status, 409)
  // the same proof against a new session's nonce does not bind either
  const s2 = await h.open("777")
  const r = await h.call("/present", { sid: s2.sid, attestations: [{ jws: v, kbJwt: kb(v, nonce) }] })
  assert.equal(r.status, 400)
  assert.deepEqual(h.added, [12345n])
  h.close()
})

test("wrong audience is refused", async () => {
  await ready
  const h = harness()
  const { sid, nonce } = await h.open()
  const v = verdict()
  const r = await h.call("/present", { sid, attestations: [{ jws: v, kbJwt: kb(v, nonce, "hermes") }] })
  assert.equal(r.status, 400)
  assert.match((await h.call(`/result?sid=${sid}`)).body.reason, /HOLDER_BINDING_FAILED/)
  assert.equal(h.added.length, 0)
  h.close()
})

test("revoked verdict, missing tier and non-lodging source are refused", async () => {
  await ready
  for (const over of [{ status: { status_list: { uri: "", idx: 7 } } }, { lodging_spend_tier: undefined }, { server_name: "api.steampowered.com" }]) {
    const h = harness()
    const { sid, nonce } = await h.open()
    const o: any = { ...over }
    if (o.status) o.status.status_list.uri = statusUrl
    const v = verdict(o)
    assert.equal((await h.call("/present", { sid, attestations: [{ jws: v, kbJwt: kb(v, nonce) }] })).status, 400)
    assert.equal(h.added.length, 0)
    h.close()
  }
})

test("/receive and /issue are 404 and never read", async () => {
  await ready
  const h = harness()
  assert.equal((await h.call("/receive", { presentations: ["x"] })).status, 404)
  assert.equal((await h.call("/issue", { anything: 1 })).status, 404)
  h.close()
})

after(() => statusServer.close())

test("REP_ONCHAIN path hands the exact verdict and holder proof to the contract, not the attester key", async () => {
  await ready
  const added: bigint[] = [], onchain: [bigint, string, string][] = []
  const rep = createRep({
    jwks: { keys: [JWK] }, now: () => NOW * 1000,
    addMember: async (c) => (added.push(c), "attester"),
    addMemberWithRep: async (c, j, k) => (onchain.push([c, j, k]), "onchain"),
  })
  const s = await rep.present({ sid: "x" })
  assert.equal(s.code, 404)
  // open a session directly through the handler state
  const sid = "s1", nonce = `pos:777:${"ab".repeat(16)}`
  rep.sessions.set(sid, { sid, commitment: "777", nonce, exp: NOW * 1000 + 60_000, status: "pending" })
  const v = verdict()
  const k = kb(v, nonce)
  const r = await rep.present({ sid, attestations: [{ jws: v, kbJwt: k }] })
  assert.equal(r.code, 200)
  assert.deepEqual(added, [])
  assert.deepEqual(onchain, [[777n, v, k]])
  assert.equal(rep.sessions.get(sid)!.txHash, "onchain")
})
