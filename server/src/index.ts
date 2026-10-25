// BookerBob backend for the Proof of Stay demo. Serves the static app and a small JSON API:
//   GET  /api/config                       contract id, network, demo desk merchants
//   GET  /api/reviews/:merchant            on-chain reviews joined with texts and tx hashes
//   POST /api/review                       relayer submits post_review (author unlinkable from sender)
//   POST /api/checkout                     demo desk checks a stay in for a demo merchant
//   POST /api/faucet                       mints test USDC to an address
//   GET  /api/disputes  POST /api/disputes  dispute packages for the arbiter
//   POST /api/attest                       demo arbiter: checks the disclosure, then attest_review
//   POST /api/loyalty/attest               verify_onchain_zk: relayer posts claim digest (testnet tx)
//   GET  /api/passport/lookup?address=     Stellar Passport score (PASSPORT_API_KEY optional)
//   POST /api/context/attest               context provider hook (stub)
//   POST /api/payer/open|activate|feebump   fresh payer per booking, sponsored and fee-bumped by BookerBob
//   GET  /api/catalog  POST /api/quote  POST /api/cosign   demo catalog, server-computed totals, admin co-sign
//   POST /api/disputes/open                merchant disputes a review (awaits the guest's disclosure)
//   GET  /api/state                        home first paint: merchants, reviews (with texts), policies, leaves, groups
//   GET  /api/search?q=                    Ask Bob: federated search over source adapters, ranked by proven reviews
import { contractId, deployment } from "../../packages/sdk/src/deployment.ts"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createHash, timingSafeEqual } from "node:crypto"
import { rpc } from "@stellar/stellar-sdk"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { Ops, keysFromEnv } from "./core.ts"
import { Store } from "./store.ts"
import { TESTNET, views } from "../../packages/sdk/src/contract.ts"
import { contentHash } from "../../packages/sdk/src/derive.ts"
import { checkDisclosure } from "../../packages/sdk/src/disclosure.ts"
import { federatedSearch } from "./search/index.ts"
import { placesAdapter } from "./search/places.ts"
import { ucpAdapter } from "./search/ucp.ts"
import { opsApi, opsClient, record as opsRecord, scrub as opsScrub, RELEASE } from "./ops.ts" // importing installs the error hooks
import { jmprAdapter } from "./search/jmpr.ts"
import { PayerService } from "./payer.ts"
import { findJoinTx } from "./joins.ts"
import { serveArtifact, warmArtifacts } from "./artifacts.ts"
import { loadCatalog, Quotes } from "./catalog.ts"
import type { Merchant, Review } from "../../packages/sdk/src/types.ts"

const CONTRACT = contractId()
const net = { ...TESTNET, rpcUrl: process.env.STELLAR_RPC_URL ?? TESTNET.rpcUrl, contractId: CONTRACT }
const ROOT = resolve(import.meta.dirname, "..")
const STATIC = process.env.STATIC_DIR ?? join(ROOT, "../app/dist")
// The Claude Design site (site/public) is served at /; the earlier app shell stays at /classic/.
const SITE = process.env.SITE_DIR ?? join(ROOT, "../site/public")
const store = new Store(CONTRACT, join(ROOT, "data"), process.env.DATA_DIR ?? join(ROOT, ".data"))
const ops = new Ops(net, keysFromEnv())
const FAUCET_AMOUNT = 1000n * 10_000_000n

// Chain snapshot (merchants, reviews, policies, leaves, groups), pre-warmed at boot and refreshed in the background,
// so search, /api/config and the home's first paint (/api/state) never wait on dozens of RPC reads.
type Snap = { at: number; merchants: Merchant[]; reviews: Review[]; policies: Record<number, unknown>; leaves: Record<number, string[]>; groups: unknown[]; groupLeaves: Record<number, string[]> }
let snap: Snap | null = null
let snapP: Promise<Snap> | null = null
let configStatic: { usdc: string; arbiter: string } | null = null
async function buildSnapshot(): Promise<Snap> {
  const read = await ops.read()
  const n = await views.merchantCount(read)
  const ids = Array.from({ length: n }, (_, i) => i)
  const [merchants, groups] = await Promise.all([Promise.all(ids.map((i) => views.merchant(read, i))), views.groups(read).catch(() => [])])
  const [reviews, policies, leaves, groupLeaves] = await Promise.all([
    Promise.all(merchants.map((m) => views.reviews(read, m.id))).then((x) => x.flat() as Review[]),
    Promise.all(ids.map((i) => views.policy(read, i).catch(() => null))).then((x) => Object.fromEntries(x.map((p, i) => [i, p]))),
    Promise.all(ids.map((i) => views.leaves(read, i))).then((x) => Object.fromEntries(x.map((l, i) => [i, l.map(String)]))),
    Promise.all((groups as any[]).map((g) => views.groupLeaves(read, g.id))).then((x) => Object.fromEntries(x.map((l, i) => [(groups as any[])[i].id, l.map(String)]))),
  ])
  // a leaf this server just added may not be visible to RPC reads yet: keep it for a minute so a pass never vanishes
  const now = Date.now()
  for (const r of recentLeaves.filter((x) => now - x.at < 60_000)) {
    const l = (leaves as Record<number, string[]>)[r.merchant]
    if (l && !l.includes(r.commitment)) l.push(r.commitment)
  }
  return { at: now, merchants, reviews, policies, leaves, groups, groupLeaves }
}
const recentLeaves: { merchant: number; commitment: string; at: number }[] = []
/** A checkout landed: show its leaf at once and refresh the snapshot behind it. */
function noteLeaf(merchant: number, commitment: string) {
  recentLeaves.push({ merchant, commitment, at: Date.now() })
  while (recentLeaves.length > 200) recentLeaves.shift()
  const l = snap?.leaves[merchant]
  if (l && !l.includes(commitment)) l.push(commitment)
  snapP = null
  refreshSnapshot()
}
async function snapshot(): Promise<Snap> {
  if (snap && Date.now() - snap.at < 15_000) return snap
  if (snap) {
    // serve the last snapshot now, refresh behind it
    snapP ??= buildSnapshot().then((x) => ((snap = x), (snapP = null), x)).catch(() => ((snapP = null), snap!))
    return snap
  }
  snapP ??= buildSnapshot().then((x) => ((snap = x), (snapP = null), x)).catch((e) => ((snapP = null), Promise.reject(e)))
  return snapP
}
const refreshSnapshot = () => {
  snapP ??= buildSnapshot().then((x) => ((snap = x), (snapP = null), x)).catch(() => ((snapP = null), snap as Snap))
}
const payers = new PayerService(ops)
const catalog = loadCatalog(join(ROOT, "data"))
const quotes = new Quotes(net.networkPassphrase)
const UCP_MERCHANTS = new Set((process.env.UCP_MERCHANTS ?? "5").split(",").filter(Boolean).map(Number))
const adapters = [
  placesAdapter(async () => (await snapshot()).merchants, UCP_MERCHANTS),
  ucpAdapter(process.env.UCP_BRIDGE_URL ?? "https://bookerbob-ucp-bridge.fly.dev"),
  jmprAdapter(process.env.JMPR_ENABLED !== "0"), // static snapshot, zero JMPR calls
]

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" })
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
}
const body = async (req: IncomingMessage): Promise<any> => {
  let s = ""
  for await (const c of req) {
    s += c
    if (s.length > 64_000) throw new Error("body too large")
  }
  return s ? JSON.parse(s) : {}
}
const isInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0
const isDec = (v: unknown) => typeof v === "string" && /^\d{1,78}$/.test(v)
const isHex = (v: unknown, n: number) => typeof v === "string" && new RegExp(`^(0x)?[0-9a-f]{${n}}$`, "i").test(v)
const fail = (res: ServerResponse, r: { error: string; message?: string }) => json(res, 400, { error: r.error, message: r.message })

// naive per-IP rate limit for writes: one booking is ~8 POSTs and judges on venue Wi-Fi share one NAT IP
const hits = new Map<string, number[]>()
const limited = (req: IncomingMessage) => {
  const ip = String(req.headers["fly-client-ip"] ?? req.socket.remoteAddress)
  const now = Date.now()
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  h.push(now)
  hits.set(ip, h)
  return h.length > 120
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".wasm": "application/wasm", ".zkey": "application/octet-stream", ".woff2": "font/woff2", ".ico": "image/x-icon" }

const OPERATOR_COOKIE = "bb_demo"
function isOperatorReq(req: IncomingMessage): boolean {
  const want = process.env.REP_DEMO_TOKEN
  if (!want) return false
  const cookie = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${OPERATOR_COOKIE}=`))?.slice(OPERATOR_COOKIE.length + 1)
  const got = String(req.headers["x-bb-demo"] ?? (cookie ? decodeURIComponent(cookie) : ""))
  const h = (x: string) => createHash("sha256").update(x).digest()
  return got.length > 0 && timingSafeEqual(h(got), h(want))
}
const BOOKING_FNS = new Set(["book", "book_with_discount", "book_with_context", "book_amount", "book_with_discount_amount"])
/** A successful, recent (30 min) booking call to our contract for this merchant. */
async function verifyBookingTx(hash: string, merchant: number): Promise<boolean> {
  try {
    const r: any = await new rpc.Server(net.rpcUrl).getTransaction(hash)
    if (r.status !== "SUCCESS") return false
    if (Date.now() / 1000 - Number(r.createdAt) > 1800) return false
    const env = JSON.parse(JSON.stringify(r.envelopeXdr, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
    const find = (o: any): any => (o && typeof o === "object" ? (o.invoke_contract ?? Object.values(o).map(find).find(Boolean)) : undefined)
    const call = find(env)
    return !!call && call.contract_address === CONTRACT && BOOKING_FNS.has(call.function_name) && Number(call.args?.[0]?.u32) === merchant
  } catch {
    return false
  }
}

async function checkStored(d: { pkg?: import("@bookerbob/pos-sdk").DisclosurePackage }) {
  if (!d.pkg) return { commitmentMatches: false, signatureValid: false, leafInTree: false }
  const read = await ops.read()
  const review = await views.review(read, d.pkg.reviewId)
  const leaf = await views.leafIndex(read, d.pkg.merchant, BigInt(d.pkg.commitment))
  return checkDisclosure(d.pkg, review.disclosureCommit, review.merchant === d.pkg.merchant ? leaf : null)
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path.startsWith("/api/ops/")) return opsApi(req, res, path)
  if (path.startsWith("/api/stellar-tier/")) return (await import("./stellar-tier.ts")).stellarTierApi(req, res, path)
  if (path.startsWith("/api/rep/")) return (await import("./rep.ts")).repApi(req, res, path)
  const read = await ops.read()
  let m: RegExpMatchArray | null
  if (req.method === "GET" && path === "/api/config") {
    // merchants come from the 15 s snapshot (parallel reads), so first paint is not gated on N sequential reads
    const sn = await snapshot()
    const demo = sn.merchants.filter((x) => ops.keys.merchantAdmins.has(x.admin)).map((x) => x.id)
    configStatic ??= { usdc: await views.usdc(read), arbiter: await views.arbiter(read) }
    return json(res, 200, { contractId: CONTRACT, rpcUrl: net.rpcUrl, networkPassphrase: net.networkPassphrase, demoMerchants: demo, usdc: configStatic.usdc, usdcIssuer: ops.keys.usdcIssuer?.publicKey(), arbiter: configStatic.arbiter, loyaltyAttest: process.env.LOYALTY_ATTEST === "1" })
  }
  if (req.method === "GET" && (m = path.match(/^\/api\/reviews\/(\d+)$/))) {
    const rs = await views.reviews(read, Number(m[1]))
    return json(res, 200, rs.map((r) => {
      const meta = store.review(r.id)
      const text = meta && contentHash(meta.text).slice(2) === r.contentHash ? meta.text : null
      return { ...r, text, txHash: meta?.txHash ?? null, time: meta?.time ?? null, demoActivity: meta?.demoActivity ?? false }
    }))
  }
  // The disclosure package stays server-side (the arbiter's side); the public queue gets status only.
  // checkout tx for a pass: GET /api/checkout-tx?merchant=&commitment= (only checkouts done through the demo desk)
  if (req.method === "GET" && path === "/api/checkout-tx") {
    const q = new URL(req.url ?? "", "http://x").searchParams
    const mer = Number(q.get("merchant")), cm = String(q.get("commitment") ?? "")
    if (!Number.isInteger(mer) || !/^\d{1,78}$/.test(cm)) return fail(res, { error: "BadParams" })
    const saved = store.checkoutTx(mer, cm)
    if (saved) return json(res, 200, { txHash: saved })
    const hit = await findJoinTx(net.rpcUrl, CONTRACT, "checkout", mer, cm, deployment.deployLedger ?? 1).catch(() => null)
    return json(res, 200, { txHash: hit?.txHash ?? null })
  }
  // add_member tx for a group pass (REP verified traveler, chain backfills): GET /api/member-tx?group=&commitment=
  if (req.method === "GET" && path === "/api/member-tx") {
    const q = new URL(req.url ?? "", "http://x").searchParams
    const gid = Number(q.get("group")), cm = String(q.get("commitment") ?? "")
    if (!Number.isInteger(gid) || !/^\d{1,78}$/.test(cm)) return fail(res, { error: "BadParams" })
    const hit = await findJoinTx(net.rpcUrl, CONTRACT, "member", gid, cm, deployment.deployLedger ?? 1).catch(() => null)
    return json(res, 200, { txHash: hit?.txHash ?? null })
  }
  // Everything the home needs for first paint, from the warm snapshot; review texts joined in.
  if (req.method === "GET" && path === "/api/state") {
    const sn = await snapshot()
    const reviews = sn.reviews.map((r) => {
      const meta = store.review(r.id)
      const text = meta && contentHash(meta.text).slice(2) === r.contentHash ? meta.text : null
      return { ...r, text, txHash: meta?.txHash ?? null, time: meta?.time ?? null, demoActivity: meta?.demoActivity ?? false }
    })
    const catalogById: Record<number, unknown> = {}
    for (const m of sn.merchants) if (catalog[m.name]) catalogById[m.id] = catalog[m.name]
    const demo = sn.merchants.filter((x) => ops.keys.merchantAdmins.has(x.admin)).map((x) => x.id)
    res.setHeader("cache-control", "no-cache")
    return json(res, 200, { at: sn.at, contractId: CONTRACT, demoMerchants: demo, merchants: sn.merchants, reviews, policies: sn.policies, leaves: sn.leaves, groups: sn.groups, groupLeaves: sn.groupLeaves, catalog: catalogById })
  }
  if (req.method === "GET" && path === "/api/catalog") {
    const sn = await snapshot()
    const out: Record<number, unknown> = {}
    for (const m of sn.merchants) if (catalog[m.name]) out[m.id] = catalog[m.name]
    return json(res, 200, out)
  }
  if (req.method === "GET" && path === "/api/ledger") {
    const r = await fetch(net.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }) }).then((x) => x.json())
    return json(res, 200, { sequence: r.result?.sequence ?? null, at: Date.now() })
  }
  if (req.method === "GET" && path === "/api/search") {
    const q = String(new URL(req.url ?? "", "http://x").searchParams.get("q") ?? "").slice(0, 200)
    const sn = await snapshot()
    return json(res, 200, await federatedSearch(q, adapters, sn.merchants, sn.reviews))
  }
  if (req.method === "GET" && path === "/api/disputes") return json(res, 200, store.disputes().map(({ pkg, ...d }) => ({ ...d, disclosed: !!pkg })))
  if (req.method === "GET" && (m = path.match(/^\/api\/disputes\/(\d+)\/check$/))) {
    const id = Number(m[1])
    const d = store.disputes().find((x) => x.id === id)
    if (!d) return json(res, 404, { error: "ReviewNotFound" })
    return json(res, 200, { check: await checkStored(d) })
  }
  // Stellar Passport lookup: PASSPORT_API_KEY stays on the server (keyless works without it).
  if (req.method === "GET" && path === "/api/passport/lookup") {
    const address = String(new URL(req.url ?? "", "http://x").searchParams.get("address") ?? "")
    if (!/^[GC][A-Z2-7]{55}$/.test(address)) return fail(res, { error: "BadParams", message: "address required" })
    const { fetchPassport } = await import("../../packages/verify_onchain_zk/src/index.ts")
    return json(
      res,
      200,
      await fetchPassport(address, {
        passportApiKey: process.env.PASSPORT_API_KEY || undefined,
        passportBaseUrl: process.env.PASSPORT_BASE_URL || undefined,
      }),
    )
  }
  if (req.method !== "POST") return json(res, 404, { error: "NotFound" })
  if (limited(req)) return json(res, 429, { error: "RateLimited", message: "busy, retry in a few seconds" })
  const b = await body(req)

  // Context provider hook (docs/context-providers.md): a provider verifies its own evidence, then add_member.
  if (path === "/api/context/attest") {
    return json(res, 501, { error: "NotImplemented", message: "context provider attestation is not wired yet; see docs/context-providers.md" })
  }
  // Cart totals: computed here from the catalog, then the demo desk co-signs exactly that amount (never a client amount).
  if (path === "/api/quote") {
    if (!isInt(b.merchant)) return fail(res, { error: "BadParams" })
    const sn = await snapshot()
    const m = sn.merchants.find((x) => x.id === b.merchant)
    const entry = m && catalog[m.name]
    if (!m || !entry || !ops.keys.merchantAdmins.has(m.admin)) return fail(res, { error: "NotDemoMerchant" })
    try {
      const q = quotes.create(m.id, entry, b.items)
      return json(res, 200, { quoteId: q.quoteId, total: q.total.toString(), orderRef: q.orderRef })
    } catch {
      return fail(res, { error: "BadParams" })
    }
  }
  if (path === "/api/cosign") {
    if (typeof b.quoteId !== "string" || typeof b.preimage !== "string") return fail(res, { error: "BadParams" })
    const sn = await snapshot()
    try {
      const signature = quotes.cosign(b.quoteId, b.preimage, CONTRACT, (mid) => {
        const m = sn.merchants.find((x) => x.id === mid)
        return m ? ops.keys.merchantAdmins.get(m.admin) : undefined
      })
      return json(res, 200, { signature })
    } catch (e) {
      return fail(res, { error: String((e as any)?.message ?? "BadParams") })
    }
  }
  if (path === "/api/disputes/open") {
    if (!isInt(b.reviewId)) return fail(res, { error: "BadParams" })
    const read2 = await ops.read()
    const r = await views.review(read2, b.reviewId).catch(() => null)
    if (!r) return fail(res, { error: "ReviewNotFound" })
    const { pkg: _p, ...d } = store.openAwaiting(b.reviewId, r.merchant)
    return json(res, 200, d)
  }
  // Fresh payer per booking: sponsored account + trustline, funding, fee-bumped booking (server/src/payer.ts)
  if (path === "/api/payer/open") {
    if (typeof b.publicKey !== "string" || !/^G[A-Z2-7]{55}$/.test(b.publicKey)) return fail(res, { error: "BadParams" })
    return json(res, 200, { xdr: await payers.open(b.publicKey) })
  }
  if (path === "/api/payer/activate") {
    if (typeof b.xdr !== "string" || !isDec(b.amount)) return fail(res, { error: "BadParams" })
    try {
      return json(res, 200, await payers.activate(b.xdr, BigInt(b.amount)))
    } catch (e) {
      return fail(res, { error: "BadParams", message: String((e as any)?.message ?? e).slice(0, 200) })
    }
  }
  if (path === "/api/payer/feebump") {
    if (typeof b.xdr !== "string") return fail(res, { error: "BadParams" })
    try {
      return json(res, 200, await payers.feeBump(b.xdr))
    } catch (e) {
      const msg = String((e as any)?.message ?? e)
      const code = msg.match(/Error\(Contract, #(\d+)\)/)
      return fail(res, { error: code ? `Contract${code[1]}` : "BadParams", message: msg.slice(0, 200) })
    }
  }
  if (path === "/api/review") {
    const ok = isInt(b.merchant) && isInt(b.rating) && typeof b.text === "string" && b.text.length <= 1000 && isHex(b.disclosureCommit, 64) && isDec(b.root) && isDec(b.nullifier) && b.proof && isHex(b.proof.a, 128) && isHex(b.proof.b, 256) && isHex(b.proof.c, 128)
    if (!ok) return fail(res, { error: "BadParams" })
    const r = await ops.postReview({ merchant: b.merchant, rating: b.rating, text: b.text, disclosureCommit: b.disclosureCommit.replace(/^0x/, ""), proof: b.proof, root: BigInt(b.root), nullifier: BigInt(b.nullifier) })
    // a second review from the same stay is a normal outcome, not a server error
    if (!r.ok && r.error === "NullifierUsed") return json(res, 409, { error: "NullifierUsed", message: "this stay already has a review" })
    if (!r.ok) return fail(res, r)
    const id = Number(r.value)
    store.putReview(id, { text: b.text, txHash: r.txHash, time: Date.now(), ...(b.label === "demo-activity" ? { demoActivity: true } : {}) })
    refreshSnapshot()
    return json(res, 200, { txHash: r.txHash, reviewId: id })
  }
  if (path === "/api/checkout") {
    if (!isInt(b.merchant) || !isDec(b.commitment)) return fail(res, { error: "BadParams" })
    // a stay joins a place's tree only for a real booking at that place (one checkout per booking tx), or for the
    // demo operator (scripts, the hotel desk demo); never for anyone who asks
    if (!isOperatorReq(req)) {
      const ok = typeof b.bookingTx === "string" && /^[0-9a-f]{64}$/.test(b.bookingTx) && (await verifyBookingTx(b.bookingTx, b.merchant))
      if (!ok) return json(res, 403, { error: "NotDemoMerchant", message: "a stay is added after a booking at this place" })
      if (store.bookingUsed(b.bookingTx)) return json(res, 409, { error: "DuplicateLeaf", message: "this booking already added a stay" })
      store.useBooking(b.bookingTx)
    }
    const r = await ops.checkout(b.merchant, BigInt(b.commitment))
    if (!r.ok) return fail(res, r)
    store.putCheckout(b.merchant, String(b.commitment), r.txHash)
    noteLeaf(b.merchant, String(b.commitment))
    return json(res, 200, { txHash: r.txHash, root: String(r.value) })
  }
  if (path === "/api/faucet") {
    if (typeof b.address !== "string" || !/^[GC][A-Z2-7]{55}$/.test(b.address)) return fail(res, { error: "BadParams" })
    try {
      return json(res, 200, { txHash: await ops.mintUsdc(b.address, FAUCET_AMOUNT) })
    } catch (e) {
      return fail(res, { error: b.address.startsWith("G") ? "NoTrustline" : "Unknown", message: String(e).slice(0, 200) })
    }
  }
  // Public wallet+tier attest is OFF by default (LOYALTY_ATTEST=1 enables it): it links a wallet to its tier in public,
  // and it raced the fresh-payer sponsor. The wallet tier still works privately through group 2.
  if (path === "/api/loyalty/attest" && process.env.LOYALTY_ATTEST !== "1") return json(res, 404, { error: "Disabled", message: "public loyalty attest is off" })
  if (path === "/api/loyalty/attest") {
    const ok =
      typeof b.address === "string" &&
      /^[GC][A-Z2-7]{55}$/.test(b.address) &&
      typeof b.digest === "string" &&
      /^(0x)?[0-9a-f]{64}$/i.test(b.digest) &&
      isInt(b.rating) &&
      b.rating <= 100 &&
      isInt(b.tier) &&
      b.tier >= 1 &&
      b.tier <= 5
    if (!ok) return fail(res, { error: "BadParams" })
    try {
      const txHash = await ops.attestLoyalty(b.address, b.digest)
      return json(res, 200, { txHash, digest: String(b.digest).replace(/^0x/, "").toLowerCase() })
    } catch (e) {
      return fail(res, { error: "AttestFailed", message: String((e as Error)?.message ?? e).slice(0, 200) })
    }
  }
  if (path === "/api/disputes") {
    const p = b.pkg
    if (!p || !isInt(p.reviewId) || !isInt(p.merchant) || !isDec(p.commitment) || !isDec(p.dk)) return fail(res, { error: "BadParams" })
    const { pkg: _, ...open } = store.openDispute(p)
    return json(res, 200, open)
  }
  if (path === "/api/attest") {
    if (!isInt(b.reviewId)) return fail(res, { error: "BadParams" })
    const d = store.disputes().find((x) => x.id === b.reviewId)
    if (!d) return fail(res, { error: "ReviewNotFound", message: "no disclosure for this review" })
    const check = await checkStored(d)
    if (!check.commitmentMatches || !check.signatureValid || !check.leafInTree) return json(res, 400, { error: "DisclosureRejected", check })
    const r = await ops.attest(b.reviewId)
    if (!r.ok) return fail(res, r)
    store.closeDispute(b.reviewId, r.txHash)
    return json(res, 200, { txHash: r.txHash, check })
  }
  return json(res, 404, { error: "NotFound" })
}

function serveFile(res: ServerResponse, root: string, rel: string) {
  let f = join(root, rel === "/" || rel === "" ? "index.html" : rel)
  if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) f = join(root, "index.html")
  if (!existsSync(f)) return json(res, 404, { error: "app not built" })
  const ext = extname(f)
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600" })
  res.end(readFileSync(f))
}

function serveStatic(res: ServerResponse, path: string) {
  if (path === "/classic" || path.startsWith("/classic/")) return serveFile(res, STATIC, path.slice("/classic".length) || "/")
  if (path === "/how" || path === "/how/") return serveFile(res, SITE, "/how.html") // "how it works" page
  if (existsSync(join(SITE, "index.html"))) return serveFile(res, SITE, path)
  return serveFile(res, STATIC, path)
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" })
      return res.end()
    }
    if (path.startsWith("/api/")) return await api(req, res, path)
    if (path === "/" && req.url?.includes("demo=")) return (await import("./rep.ts")).repApi(req, res, "/api/rep/demo")
    if (path === "/ops.js") return opsClient(res)
    if (path.startsWith("/artifacts/") && (await serveArtifact(req, res, path, process.env.DATA_DIR ?? join(ROOT, ".data")))) return
    serveStatic(res, path)
  } catch (e) {
    // diagnosable 5xx: error name, message and the top 5 stack frames, scrubbed (no body, no addresses or commitments)
    const err = e as any
    const frames = String(err?.stack ?? "").split("\n").slice(1, 6).map((l) => l.trim()).join("\n")
    opsRecord({ source: "server", kind: `500 ${err?.name ?? "Error"}`, message: opsScrub(err?.message ?? e), stack: opsScrub(frames, 2000), path: opsScrub(path, 200), release: RELEASE })
    json(res, 500, { error: "Unknown", message: String(err?.message ?? e).slice(0, 200) })
  }
}).listen(Number(process.env.PORT ?? 8080), () => {
  warmArtifacts(process.env.DATA_DIR ?? join(ROOT, ".data")).catch((e) => console.error("artifacts warm failed", String(e)))
  refreshSnapshot()
  setInterval(refreshSnapshot, 15_000).unref()
  console.log(`pos server on :${process.env.PORT ?? 8080}, contract ${CONTRACT}`)
})
