// BookerBob backend for the Proof of Stay demo. Serves the static app and a small JSON API:
//   GET  /api/config                       contract id, network, demo desk merchants
//   GET  /api/reviews/:merchant            on-chain reviews joined with texts and tx hashes
//   POST /api/review                       relayer submits post_review (author unlinkable from sender)
//   POST /api/checkout                     demo desk checks a stay in for a demo merchant
//   POST /api/faucet                       mints test USDC to an address
//   GET  /api/disputes  POST /api/disputes  dispute packages for the arbiter
//   POST /api/attest                       demo arbiter: checks the disclosure, then attest_review
//   POST /api/context/attest               context provider hook (stub)
//   POST /api/payer/open|activate|feebump   fresh payer per booking, sponsored and fee-bumped by BookerBob
//   GET  /api/search?q=                    Ask Bob: federated search over source adapters, ranked by proven reviews
import { contractId } from "../../packages/sdk/src/deployment.ts"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
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
import { jmprAdapter } from "./search/jmpr.ts"
import { PayerService } from "./payer.ts"
import type { Merchant, Review } from "../../packages/sdk/src/types.ts"

const CONTRACT = contractId()
const net = { ...TESTNET, rpcUrl: process.env.STELLAR_RPC_URL ?? TESTNET.rpcUrl, contractId: CONTRACT }
const ROOT = resolve(import.meta.dirname, "..")
const STATIC = process.env.STATIC_DIR ?? join(ROOT, "../app/dist")
const store = new Store(CONTRACT, join(ROOT, "data"), process.env.DATA_DIR ?? join(ROOT, ".data"))
const ops = new Ops(net, keysFromEnv())
const FAUCET_AMOUNT = 1000n * 10_000_000n

// Chain snapshot for search (merchants + all reviews), refreshed at most every 15 s.
let snap: { at: number; merchants: Merchant[]; reviews: Review[] } | null = null
async function snapshot() {
  if (snap && Date.now() - snap.at < 15_000) return snap
  const read = await ops.read()
  const n = await views.merchantCount(read)
  const merchants = await Promise.all(Array.from({ length: n }, (_, i) => views.merchant(read, i)))
  const reviews = (await Promise.all(merchants.map((m) => views.reviews(read, m.id)))).flat() as Review[]
  snap = { at: Date.now(), merchants, reviews }
  return snap
}
const payers = new PayerService(ops)
const UCP_MERCHANTS = new Set((process.env.UCP_MERCHANTS ?? "5").split(",").filter(Boolean).map(Number))
const adapters = [
  placesAdapter(async () => (await snapshot()).merchants, UCP_MERCHANTS),
  ucpAdapter(process.env.UCP_BRIDGE_URL ?? "https://bookerbob-ucp-bridge.fly.dev"),
  jmprAdapter(process.env.JMPR_ENABLED === "1"),
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

// naive per-IP rate limit for writes
const hits = new Map<string, number[]>()
const limited = (req: IncomingMessage) => {
  const ip = String(req.headers["fly-client-ip"] ?? req.socket.remoteAddress)
  const now = Date.now()
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  h.push(now)
  hits.set(ip, h)
  return h.length > 30
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".wasm": "application/wasm", ".zkey": "application/octet-stream", ".woff2": "font/woff2", ".ico": "image/x-icon" }

async function checkStored(d: { pkg: import("@bookerbob/pos-sdk").DisclosurePackage }) {
  const read = await ops.read()
  const review = await views.review(read, d.pkg.reviewId)
  const leaf = await views.leafIndex(read, d.pkg.merchant, BigInt(d.pkg.commitment))
  return checkDisclosure(d.pkg, review.disclosureCommit, review.merchant === d.pkg.merchant ? leaf : null)
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path.startsWith("/api/rep/")) return (await import("./rep.ts")).repApi(req, res, path)
  const read = await ops.read()
  let m: RegExpMatchArray | null
  if (req.method === "GET" && path === "/api/config") {
    const n = await views.merchantCount(read)
    const demo: number[] = []
    for (let i = 0; i < n; i++) if (ops.keys.merchantAdmins.has((await views.merchant(read, i)).admin)) demo.push(i)
    return json(res, 200, { contractId: CONTRACT, rpcUrl: net.rpcUrl, networkPassphrase: net.networkPassphrase, demoMerchants: demo, usdc: await views.usdc(read), usdcIssuer: ops.keys.usdcIssuer?.publicKey(), arbiter: await views.arbiter(read) })
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
  if (req.method === "GET" && path === "/api/search") {
    const q = String(new URL(req.url ?? "", "http://x").searchParams.get("q") ?? "").slice(0, 200)
    const sn = await snapshot()
    return json(res, 200, await federatedSearch(q, adapters, sn.merchants, sn.reviews))
  }
  if (req.method === "GET" && path === "/api/disputes") return json(res, 200, store.disputes().map(({ pkg, ...d }) => d))
  if (req.method === "GET" && (m = path.match(/^\/api\/disputes\/(\d+)\/check$/))) {
    const id = Number(m[1])
    const d = store.disputes().find((x) => x.id === id)
    if (!d) return json(res, 404, { error: "ReviewNotFound" })
    return json(res, 200, { check: await checkStored(d) })
  }
  if (req.method !== "POST") return json(res, 404, { error: "NotFound" })
  if (limited(req)) return json(res, 429, { error: "RateLimited" })
  const b = await body(req)

  // Context provider hook (docs/context-providers.md): a provider verifies its own evidence, then add_member.
  if (path === "/api/context/attest") {
    return json(res, 501, { error: "NotImplemented", message: "context provider attestation is not wired yet; see docs/context-providers.md" })
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
    if (!r.ok) return fail(res, r)
    const id = Number(r.value)
    store.putReview(id, { text: b.text, txHash: r.txHash, time: Date.now(), ...(b.label === "demo-activity" ? { demoActivity: true } : {}) })
    return json(res, 200, { txHash: r.txHash, reviewId: id })
  }
  if (path === "/api/checkout") {
    if (!isInt(b.merchant) || !isDec(b.commitment)) return fail(res, { error: "BadParams" })
    const r = await ops.checkout(b.merchant, BigInt(b.commitment))
    if (!r.ok) return fail(res, r)
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

function serveStatic(res: ServerResponse, path: string) {
  let f = join(STATIC, path === "/" ? "index.html" : path)
  if (!f.startsWith(STATIC) || !existsSync(f) || statSync(f).isDirectory()) f = join(STATIC, "index.html")
  if (!existsSync(f)) return json(res, 404, { error: "app not built" })
  const ext = extname(f)
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": ext === ".html" ? "no-cache" : "public, max-age=86400" })
  res.end(readFileSync(f))
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" })
      return res.end()
    }
    if (path.startsWith("/api/")) return await api(req, res, path)
    serveStatic(res, path)
  } catch (e) {
    json(res, 500, { error: "Unknown", message: String((e as any)?.message ?? e).slice(0, 200) })
  }
}).listen(Number(process.env.PORT ?? 8080), () => console.log(`pos server on :${process.env.PORT ?? 8080}, contract ${CONTRACT}`))
