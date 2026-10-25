// Stellar wallet tier join: wallet signature (SEP-53), tier threshold, one join per wallet and per identity.
// Run: node --test server/src/stellar-tier.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Keypair } from "@stellar/stellar-sdk"
import { createStellarTier, sep53Hash, GROUP_NAME } from "./stellar-tier.ts"
import { Identity } from "@semaphore-protocol/identity"
import { signRebind } from "./rebind.ts"

function harness(opts: { tiers?: Record<string, number>; stateDir?: string | null; slowAdd?: boolean } = {}) {
  const added: bigint[] = []
  const members = new Set<bigint>()
  const t = createStellarTier({
    minTier: 3,
    salt: "test-salt",
    stateDir: opts.stateDir ?? null,
    tierOf: async (a) => opts.tiers?.[a] ?? 4,
    addMember: async (c) => {
      if (opts.slowAdd) await new Promise((r) => setTimeout(r, 50))
      added.push(c)
      members.add(c)
      return "ab".repeat(32)
    },
    groupId: async () => 2,
    replaceMember: async (o, n) => {
      if (!members.has(o)) throw new Error("NotMember")
      members.delete(o)
      members.add(n)
      return "cd".repeat(32)
    },
  })
  const server = createServer((req, res) => t.handle(req, res, new URL(req.url!, "http://x").pathname))
  const base = new Promise<string>((ok) => server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(server.address() as any).port}/api/stellar-tier`)))
  const get = async (p: string) => { const r = await fetch(`${await base}${p}`); return { status: r.status, body: (await r.json()) as any } }
  const post = async (p: string, b: unknown) => { const r = await fetch(`${await base}${p}`, { method: "POST", body: JSON.stringify(b) }); return { status: r.status, body: (await r.json()) as any } }
  const join_ = async (kp: Keypair, commitment: string, signer: Keypair = kp, old?: Identity) => {
    const c = await get(`/challenge?address=${kp.publicKey()}&commitment=${commitment}`)
    assert.equal(c.status, 200)
    const signature = Buffer.from(signer.sign(sep53Hash(c.body.message))).toString("base64")
    const rebind = old ? signRebind(old, 2, commitment, c.body.nonce) : undefined
    return post("/join", { address: kp.publicKey(), commitment, nonce: c.body.nonce, signature, ...(rebind ? { rebind } : {}) })
  }
  return { added, members, get, post, join: join_, close: () => server.close() }
}

test("a wallet at or above the tier joins once; the explainer is served", async () => {
  const h = harness()
  const info = await h.get("/info")
  assert.equal(info.body.group, GROUP_NAME)
  assert.match(info.body.explainer, /places see the tier, never the wallet/)
  const kp = Keypair.random()
  const r = await h.join(kp, "1111")
  assert.equal(r.status, 200)
  assert.equal(r.body.tier, 4)
  assert.deepEqual(h.added, [1111n])
  assert.equal((await h.join(kp, "2222")).status, 409) // same wallet, another identity
  assert.equal((await h.join(Keypair.random(), "1111")).status, 409) // same identity, another wallet
  h.close()
})

test("the signature must come from the wallet itself", async () => {
  const h = harness()
  const kp = Keypair.random()
  assert.equal((await h.join(kp, "3333", Keypair.random())).status, 401)
  assert.deepEqual(h.added, [])
  h.close()
})

test("a challenge is single use and bound to its wallet and identity", async () => {
  const h = harness()
  const kp = Keypair.random()
  const c = await h.get(`/challenge?address=${kp.publicKey()}&commitment=4444`)
  const sig = Buffer.from(kp.sign(sep53Hash(c.body.message))).toString("base64")
  assert.equal((await h.post("/join", { address: kp.publicKey(), commitment: "5555", nonce: c.body.nonce, signature: sig })).status, 400)
  assert.equal((await h.post("/join", { address: kp.publicKey(), commitment: "4444", nonce: c.body.nonce, signature: sig })).status, 410)
  h.close()
})

test("below the threshold: refused and not burned", async () => {
  const kp = Keypair.random()
  const tiers = { [kp.publicKey()]: 2 }
  const h = harness({ tiers })
  const r = await h.join(kp, "6666")
  assert.equal(r.status, 403)
  assert.equal(r.body.tier, 2)
  tiers[kp.publicKey()] = 3
  assert.equal((await h.join(kp, "6666")).status, 200)
  h.close()
})

test("two concurrent joins for one wallet: only one lands", async () => {
  const h = harness({ slowAdd: true })
  const kp = Keypair.random()
  const rs = await Promise.all([h.join(kp, "7001"), h.join(kp, "7002")])
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409])
  assert.equal(h.added.length, 1)
  h.close()
})

test("joins survive a restart as salted hashes only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tier-"))
  const kp = Keypair.random()
  const h1 = harness({ stateDir: dir })
  assert.equal((await h1.join(kp, "8888")).status, 200)
  h1.close()
  const stored = readFileSync(join(dir, "stellar-tier-joined.txt"), "utf8")
  assert.ok(!stored.includes(kp.publicKey()) && !stored.includes("8888"))
  const h2 = harness({ stateDir: dir })
  assert.equal((await h2.join(kp, "9999")).status, 409)
  h2.close()
})

test("contract accounts, bad commitments and rate limits", async () => {
  const h = harness()
  assert.equal((await h.get(`/challenge?address=CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY&commitment=1`)).status, 400)
  assert.equal((await h.get(`/challenge?address=${Keypair.random().publicKey()}&commitment=0`)).status, 400)
  let last = 0
  for (let i = 0; i < 22; i++) last = (await h.get(`/challenge?address=${Keypair.random().publicKey()}&commitment=${i + 1}`)).status
  assert.equal(last, 429)
  h.close()
})

test("start over MOVES the wallet's membership with the old identity's signature", async () => {
  const h = harness()
  const kp = Keypair.random()
  const a = new Identity(), b = new Identity(), c = new Identity(), x = new Identity()
  assert.equal((await h.join(kp, a.commitment.toString())).status, 200)
  assert.equal((await h.join(kp, b.commitment.toString())).status, 409) // no rebind: refused
  assert.equal((await h.join(kp, b.commitment.toString(), kp, x)).status, 409) // signed by a stranger identity
  const r = await h.join(kp, b.commitment.toString(), kp, a)
  assert.equal(r.status, 200)
  assert.equal(r.body.moved, true)
  assert.deepEqual([...h.members], [b.commitment])
  assert.equal((await h.join(kp, c.commitment.toString(), kp, a)).status, 409) // a no longer holds it
  assert.equal((await h.join(kp, c.commitment.toString(), kp, b)).status, 200)
  assert.deepEqual([...h.members], [c.commitment])
  h.close()
})
