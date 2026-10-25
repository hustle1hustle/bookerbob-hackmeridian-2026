// Seeds the deployed contract through the real cycle: register places, check stays in, prove and post reviews
// via the relayer, one full-price + one discounted booking, arbiter attestations and one open dispute.
// Keys are read in-process from the local stellar-cli keystore and never printed. SEED_MASTER lives in .env.
import { contractId } from "../packages/sdk/src/deployment.ts"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Keypair } from "@stellar/stellar-sdk"
import { Ops } from "../server/src/core.ts"
import { writeSeed, type ReviewMeta, type Dispute } from "../server/src/store.ts"
import { TESTNET, views } from "../packages/sdk/src/contract.ts"
import * as d from "../packages/sdk/src/derive.ts"
import { loadArtifacts, proveMembership } from "../packages/sdk/src/prove.ts"
import { buildDisclosure } from "../packages/sdk/src/disclosure.ts"

const CONTRACT = contractId()
const net = { ...TESTNET, contractId: CONTRACT }
const key = (alias: string) => Keypair.fromSecret(execFileSync("stellar", ["keys", "secret", alias], { encoding: "utf8" }).trim())

let master = process.env.SEED_MASTER ?? (existsSync(".env") ? readFileSync(".env", "utf8").match(/^SEED_MASTER=(.+)$/m)?.[1] : undefined)
if (!master) {
  master = randomBytes(32).toString("hex")
  appendFileSync(".env", `\nSEED_MASTER=${master}\n`)
}

const U = 10_000_000n
const places = [
  { kind: "hotel", name: "Casa Azulejo Nove", admin: "hotel1", price: 110n * U, bps: 1500, stays: 10 },
  { kind: "hotel", name: "Pátio do Vento", admin: "hotel2", price: 95n * U, bps: 2000, stays: 8 },
  { kind: "hotel", name: "Ribeira Slow House", admin: "hotel3", price: 140n * U, bps: 1000, stays: 7 },
  { kind: "cafe", name: "Café Lento", admin: "cafe1", price: 4n * U, bps: 2500, stays: 6 },
  { kind: "shop", name: "Linho & Sal", admin: "shop1", price: 38n * U, bps: 1000, stays: 2 },
]
// [place, stay index, rating, text, attested]
const reviews: [number, number, 1 | 2 | 3 | 4 | 5, string, boolean][] = [
  [0, 0, 5, "quiet room on the courtyard, breakfast was simple and honest", true],
  [0, 1, 4, "great location, the tram is loud before 8", false],
  [0, 2, 5, "staff remembered how I take my coffee by day two", true],
  [0, 3, 3, "clean, but the wifi dropped every evening", false],
  [0, 4, 4, "tiles everywhere, exactly what the photos promised", false],
  [0, 5, 4, "good value for Alfama, small bathroom", false],
  [0, 6, 5, "they kept my bag for a whole day after checkout, no fuss", false],
  [1, 0, 4, "rooftop at sunset is the reason to stay", true],
  [1, 1, 2, "street noise until 2am on Friday", false],
  [1, 2, 4, "friendly, flexible checkout", false],
  [1, 3, 5, "the gull wake-up call is real and somehow charming", false],
  [1, 4, 3, "fine for two nights, beds are firm", false],
  [1, 5, 4, "walkable to everything, ask for a room at the back", false],
  [2, 0, 5, "slow is the right word, in the best way", true],
  [2, 1, 4, "river view room is worth the extra", true],
  [2, 2, 4, "breakfast until noon, perfect after a late dinner", false],
  [2, 3, 3, "stairs only, heavy bags were a workout", false],
  [2, 4, 5, "best sleep I had in Lisbon", false],
  [2, 5, 4, "the owner's map of the neighbourhood beats any app", false],
  [3, 0, 5, "the pastel de nata comes out warm at 9", false],
  [3, 1, 4, "good flat white, tiny tables", true],
  [3, 2, 4, "quiet enough to work for an hour", false],
]
const DISPUTE = { place: 1, stay: 1 } // open dispute on "street noise" review
const DISCOUNT = { place: 0, season: 1 }

const stayMaster = (p: number, i: number) => `${master}:${p}:${i}`
const ident = (p: number, i: number) => d.stayIdentity(stayMaster(p, i), p, 0)
const dkOf = (p: number, i: number) => d.stayDisclosureKey(stayMaster(p, i), p, 0)

const ops = new Ops(net, { relayer: key("relayer"), arbiter: key("arbiter"), usdcIssuer: key("usdc-issuer"), merchantAdmins: new Map() })
const read = await ops.read()
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const must = <T>(label: string, r: { ok: true; txHash: string; value: T } | { ok: false; error: string; message: string }) => {
  if (!r.ok) throw new Error(`${label}: ${r.error} ${r.message}`)
  return r
}

// RESUME=<log of an earlier run>: places, checkouts, reviews and attestations are already on chain; rebuild their
// metadata from that log and continue with the bookings.
const resumeLog = process.env.RESUME ? readFileSync(process.env.RESUME, "utf8") : null
if (!resumeLog && (await views.merchantCount(read)) !== 0 && !process.env.FORCE) throw new Error("contract already has merchants; set FORCE=1 to seed anyway")

// 1. places, sequential so ids are 0..4
if (!resumeLog) for (const [i, p] of places.entries()) {
  const r = must(`register ${p.name}`, await ops.registerMerchant(key(p.admin), p.kind, p.name, p.price, p.bps))
  log("place", i, p.name, r.txHash)
}

// 2. checkouts, one admin per place in parallel; the discount guest also stays at place 0
const guest = key("guest1")
const guestStay = d.stayIdentity(`${master}:guest1`, DISCOUNT.place, 0)
if (!resumeLog) await Promise.all(
  places.map(async (p, pi) => {
    const admin = key(p.admin)
    const c = await (await import("../packages/sdk/src/contract.ts")).getClient(net, (await import("../server/src/core.ts")).signerOf(admin, net.networkPassphrase))
    const { write } = await import("../packages/sdk/src/contract.ts")
    const commits = Array.from({ length: p.stays }, (_, i) => ident(pi, i).commitment)
    if (pi === DISCOUNT.place) commits.push(guestStay.commitment)
    for (const cm of commits) {
      const r = must(`checkout ${pi}`, await write(c, "checkout", { merchant: pi, id_commitment: cm }))
      log("checkout", pi, r.txHash)
    }
  }),
)

// 3. reviews through the relayer, proofs against the on-chain leaves
const artifacts = await loadArtifacts()
const meta: Record<string, ReviewMeta> = {}
const disputes: Dispute[] = []
const idOf = new Map<string, number>()
if (resumeLog) {
  const lines = resumeLog.split("\n")
  for (const [k, [p, i, , text]] of reviews.entries()) {
    const m = lines.map((l) => l.match(/^\S+ review (\d+) (\d+) (\d) ([0-9a-f]{64})$/)).filter(Boolean)[k]!
    idOf.set(`${p}:${i}`, Number(m[1]))
    meta[m[1]] = { text, txHash: m[4], time: Date.now() }
  }
  for (const [p, i, , , attested] of reviews) {
    const isDispute = p === DISPUTE.place && i === DISPUTE.stay
    if (!attested && !isDispute) continue
    const id = idOf.get(`${p}:${i}`)!
    const pkg = buildDisclosure(ident(p, i), dkOf(p, i), id, p, i)
    const a = resumeLog.match(new RegExp(`attest ${id} ([0-9a-f]{64})`))
    disputes.push(a ? { id, pkg, openedAt: Date.now(), attestTx: a[1] } : { id, pkg, openedAt: Date.now() })
  }
}
if (!resumeLog) for (const [p, i, rating, text, _] of reviews) {
  const leaves = await views.leaves(read, p)
  const commit = d.disclosureCommit(dkOf(p, i))
  const msg = d.reviewMessage(rating, d.contentHash(text), commit)
  const mp = await proveMembership(ident(p, i), leaves, msg, d.reviewScope(p), artifacts)
  const r = must(`review ${p}/${i}`, await ops.postReview({ merchant: p, rating, text, disclosureCommit: commit, proof: mp.proof, root: mp.root, nullifier: mp.nullifier }))
  const id = Number(r.value)
  idOf.set(`${p}:${i}`, id)
  meta[id] = { text, txHash: r.txHash, time: Date.now() }
  log("review", id, p, rating, r.txHash)
}

// 4. disclosures: attested ones are checked and attested by the arbiter; one stays open
if (!resumeLog) for (const [p, i, , , attested] of reviews) {
  const isDispute = p === DISPUTE.place && i === DISPUTE.stay
  if (!attested && !isDispute) continue
  const id = idOf.get(`${p}:${i}`)!
  const pkg = buildDisclosure(ident(p, i), dkOf(p, i), id, p, i)
  if (attested) {
    const r = must(`attest ${id}`, await ops.attest(id))
    disputes.push({ id, pkg, openedAt: Date.now(), attestTx: r.txHash })
    log("attest", id, r.txHash)
  } else {
    disputes.push({ id, pkg, openedAt: Date.now() })
    log("dispute open", id)
  }
}

// 5. bookings: first visit at full price, return visit with the proven-stay discount
// merchants receive USDC, so their admin accounts need the trustline too
for (const p of places) log("trust", p.admin, await ops.trustUsdc(key(p.admin)).catch((e) => `skip (${String(e).slice(0, 60)})`))
if (!resumeLog) log("trust", await ops.trustUsdc(guest).catch((e) => `skip (${String(e).slice(0, 60)})`))
if (!resumeLog) log("mint", await ops.mintUsdc(guest.publicKey(), 1000n * U))
const full = must("book", await ops.book(guest, DISCOUNT.place))
log("book full", full.txHash)
const leaves0 = await views.leaves(read, DISCOUNT.place)
const dmp = await proveMembership(guestStay, leaves0, d.discountMessage(guest.publicKey()), d.discountScope(DISCOUNT.place, DISCOUNT.season), artifacts)
const disc = must("discount", await ops.bookWithDiscount(guest, DISCOUNT.place, DISCOUNT.season, dmp.proof, dmp.root, dmp.nullifier))
log("book discount", disc.txHash, "paid", disc.value)

writeSeed(CONTRACT, "server/data", { reviews: meta, disputes })
console.log(JSON.stringify({ contract: CONTRACT, reviews: Object.keys(meta).length, bookFull: full.txHash, bookDiscount: disc.txHash }, null, 2))
process.exit(0)
