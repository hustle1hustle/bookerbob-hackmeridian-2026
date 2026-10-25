// Testnet demo activity: real purchases with test USDC and real proven reviews on FICTIONAL places only,
// spread over time so the feed shows reviews arriving. Every review is labelled "testnet demo activity".
// Goes through the public BookerBob API (demo desk checkout, relayer) so texts land in the deployed store.
// Usage: API=https://... ROUNDS=20 MIN_GAP=120 MAX_GAP=360 node scripts/live-fill.ts
import { execFileSync } from "node:child_process"
import { readFileSync, appendFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Keypair } from "@stellar/stellar-sdk"
import { getClient, write, views, TESTNET } from "../packages/sdk/src/contract.ts"
import { signerOf, Ops } from "../server/src/core.ts"
import * as d from "../packages/sdk/src/derive.ts"
import { loadArtifacts, proveMembership } from "../packages/sdk/src/prove.ts"

const API = process.env.API ?? "https://stellarbob2026.fly.dev"
const ROUNDS = Number(process.env.ROUNDS ?? 12)
const MIN_GAP = Number(process.env.MIN_GAP ?? 120), MAX_GAP = Number(process.env.MAX_GAP ?? 360)
const EXCLUDE = new Set((process.env.EXCLUDE ?? "5").split(",").map(Number)) // real stores never get scripted reviews
const BUYERS = ["buyer1", "buyer2", "buyer3", "buyer4"]
const key = (a: string) => Keypair.fromSecret(execFileSync("stellar", ["keys", "secret", a], { encoding: "utf8" }).trim())
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000))
const post = (path: string, body: unknown) =>
  fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) }).then((r) => r.json())

let master = readFileSync(".env", "utf8").match(/^LIVEFILL_MASTER=(.+)$/m)?.[1]
if (!master) {
  master = randomBytes(32).toString("hex")
  appendFileSync(".env", `\nLIVEFILL_MASTER=${master}\n`)
}

const texts: Record<string, Record<number, string[]>> = {
  hotel: {
    5: ["woke up to the river light, would book again tomorrow", "the staff made a late arrival feel easy", "spotless room and a breakfast worth getting up for", "quiet, central, and the bed was perfect"],
    4: ["good stay, a little street noise after midnight", "great location, the shower took a minute to warm up", "friendly desk, small but well kept room", "comfortable and fair for the price"],
    3: ["fine for a night, the room was smaller than the photos", "decent, but the wifi kept dropping", "ok stay, breakfast was basic"],
  },
  cafe: {
    5: ["the best flat white I had this week", "warm pastries and no rush to leave", "they remembered my order on day two"],
    4: ["solid espresso, a bit crowded at 10", "good coffee, tiny tables", "nice spot to read for an hour"],
    3: ["coffee ok, service slow at lunch", "fine, nothing special"],
  },
  restaurant: {
    5: ["the grilled fish was perfect, simple and fresh", "warm service and a wine list that does not show off", "best dinner of the trip"],
    4: ["very good food, we waited a bit for a table", "generous portions, loud room", "the daily special was the right call"],
    3: ["good food, the service forgot us twice", "ok, a little overpriced for the area"],
  },
  shop: { 5: ["great quality, it survived the first wash perfectly"], 4: ["nice print, sizes run a little small"], 3: ["fine, slow checkout"] },
}
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

const cfg = await fetch(`${API}/api/config`).then((r) => r.json())
const net = { ...TESTNET, contractId: cfg.contractId }
const read = await getClient(net)
const ops = new Ops(net, { relayer: key("relayer"), arbiter: key("arbiter"), usdcIssuer: key("usdc-issuer"), merchantAdmins: new Map() })
const artifacts = await loadArtifacts()

// fund buyers once: account, trustline, test USDC
for (const b of BUYERS) {
  try {
    execFileSync("stellar", ["keys", "address", b], { stdio: "ignore" })
  } catch {
    execFileSync("stellar", ["keys", "generate", b, "--network", "testnet", "--fund"], { stdio: "ignore" })
  }
  const kp = key(b)
  await ops.trustUsdc(kp).catch(() => null)
  await ops.mintUsdc(kp.publicKey(), 500n * 10_000_000n).catch((e) => log("mint failed", b, String(e).slice(0, 80)))
}

for (let round = 0; round < ROUNDS; round++) {
  try {
    const n = await views.merchantCount(read)
    const candidates = []
    for (let i = 0; i < n; i++) {
      if (EXCLUDE.has(i) || !cfg.demoMerchants.includes(i)) continue
      candidates.push(await views.merchant(read, i))
    }
    const m = pick(candidates)
    const buyer = key(pick(BUYERS))
    const stayKey = `${master}:${m.id}:${Date.now()}`
    const id = d.stayIdentity(stayKey, m.id, 0)
    const bc = await getClient(net, signerOf(buyer, net.networkPassphrase))
    const bk = await write(bc, "book", { merchant: m.id, guest: buyer.publicKey() })
    log(`purchase at ${m.name}`, bk.ok ? bk.txHash : bk.error)
    if (!bk.ok) throw new Error("booking failed")
    // the backend adds a stay only for a real booking at that place
    const co = await post("/api/checkout", { merchant: m.id, commitment: id.commitment.toString(), bookingTx: bk.txHash })
    if (co.error) throw new Error(`checkout ${co.error}`)
    const avg = m.ratingCount ? m.ratingSum / m.ratingCount : 4
    const rating = Math.max(3, Math.min(5, Math.round(avg + (Math.random() - 0.5) * 1.6))) as 3 | 4 | 5
    const text = pick((texts[m.kind] ?? texts.hotel)[rating])
    const commit = d.disclosureCommit(d.stayDisclosureKey(stayKey, m.id, 0))
    const leaves = await views.leaves(read, m.id)
    const mp = await proveMembership(id, leaves, d.reviewMessage(rating, d.contentHash(text), commit), d.reviewScope(m.id), artifacts)
    const rv = await post("/api/review", { merchant: m.id, rating, text, disclosureCommit: commit, proof: mp.proof, root: mp.root, nullifier: mp.nullifier, label: "demo-activity" })
    log(`review ${rating}* at ${m.name}`, rv.error ?? rv.txHash)
  } catch (e) {
    log("round failed", String((e as any)?.message ?? e).slice(0, 160))
  }
  if (round < ROUNDS - 1) await sleep(MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP))
}
process.exit(0)
