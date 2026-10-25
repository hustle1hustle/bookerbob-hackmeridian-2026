// Lightweight error tracker: no external account, no personal data. Imported once in index.ts (its import
// installs the hooks) and routed by one line:
//   POST /api/ops/client-error   browser errors from /ops.js (size-capped, rate-limited, scrubbed)
//   GET  /api/ops/errors?since=  the ring (last 500), Authorization: Bearer $OPS_TOKEN
//   GET  /api/ops/health         uptime, release, chain RPC and UCP bridge reachability, last error time
//   GET  /ops.js                 the browser reporter (server/src/ops-client.js), one <script> tag per page
// Server side it records every 5xx response (method + path only), console.error lines, unhandled
// rejections and uncaught exceptions. Everything stored is scrubbed of query strings, Stellar addresses,
// long decimals (commitments, nullifiers), long hex and emails. With a volume (DATA_DIR) it also
// appends to ops-errors.jsonl there.
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { appendFileSync, existsSync, statSync, renameSync } from "node:fs"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { timingSafeEqual, createHash } from "node:crypto"

export interface OpsError { at: number; source: "client" | "server"; kind: string; message: string; stack?: string; path?: string; release?: string; ua?: string }

const RING = 500
const ring: OpsError[] = []
const started = Date.now()
export const RELEASE = process.env.RELEASE ?? process.env.FLY_IMAGE_REF?.split(":").pop() ?? process.env.FLY_MACHINE_VERSION ?? "dev"
const FILE = process.env.DATA_DIR && existsSync(process.env.DATA_DIR) ? join(process.env.DATA_DIR, "ops-errors.jsonl") : null

/** Removes anything that could identify a person or a wallet before it is stored. */
export function scrub(s: unknown, max = 500): string {
  return String(s ?? "")
    .replace(/\?[^\s"')]*/g, "?…")                       // query strings
    .replace(/\b[GC][A-Z2-7]{55}\b/g, "<addr>")           // Stellar accounts and contracts
    .replace(/\b[SM][A-Z2-7]{55}\b/g, "<secret>")         // just in case
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>")
    .replace(/\b(0x)?[0-9a-f]{32,}\b/gi, "<hex>")         // tx hashes, keys, proofs
    .replace(/\b\d{20,}\b/g, "<num>")                     // commitments, nullifiers, roots
    .slice(0, max)
}
const cleanPath = (p: unknown) => scrub(String(p ?? "").split("?")[0].split("#")[0], 200)

export function record(e: Omit<OpsError, "at">) {
  const x: OpsError = { at: Date.now(), ...e }
  ring.push(x)
  if (ring.length > RING) ring.shift()
  if (FILE) {
    try {
      if (existsSync(FILE) && statSync(FILE).size > 5_000_000) renameSync(FILE, FILE + ".1")
      appendFileSync(FILE, JSON.stringify(x) + "\n")
    } catch {}
  }
}

// ---- server-side hooks, installed once on import ----
const g = globalThis as any
if (!g.__opsHooks) {
  g.__opsHooks = true
  const writeHead = http.ServerResponse.prototype.writeHead
  http.ServerResponse.prototype.writeHead = function (this: ServerResponse, code: number, ...rest: any[]) {
    if (code >= 500) {
      const req = (this as any).req as IncomingMessage | undefined
      record({ source: "server", kind: `http ${code}`, message: `${req?.method ?? "?"} ${cleanPath(req?.url)}`, path: cleanPath(req?.url), release: RELEASE })
    }
    return (writeHead as any).call(this, code, ...rest)
  } as any
  const consoleError = console.error
  console.error = (...a: unknown[]) => {
    record({ source: "server", kind: "console.error", message: scrub(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ")), release: RELEASE })
    consoleError(...a)
  }
  process.on("unhandledRejection", (r) => {
    // recorded and kept alive: a stray rejection should not take the demo down
    record({ source: "server", kind: "unhandledRejection", message: scrub((r as any)?.message ?? r), stack: scrub((r as any)?.stack, 4000), release: RELEASE })
    consoleError("[ops] unhandledRejection", (r as any)?.message ?? r)
  })
  process.on("uncaughtException", (e) => {
    record({ source: "server", kind: "uncaughtException", message: scrub(e?.message), stack: scrub(e?.stack, 4000), release: RELEASE })
    consoleError("[ops] uncaughtException", e)
    process.exit(1) // state is unknown after an uncaught exception; Fly restarts the machine
  })
}

// ---- routes ----
const hits = new Map<string, number[]>()
let globalHits: number[] = []
function limited(req: IncomingMessage): boolean {
  const ip = String(req.headers["fly-client-ip"] ?? req.socket.remoteAddress)
  const now = Date.now()
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  h.push(now)
  hits.set(ip, h)
  if (hits.size > 5000) hits.clear()
  globalHits = globalHits.filter((t) => now - t < 60_000)
  globalHits.push(now)
  return h.length > 20 || globalHits.length > 300
}

const uaFamily = (ua: unknown): string => {
  const s = String(ua ?? "")
  const b = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Other"
  return `${b}${/Mobile|iPhone|Android/.test(s) ? " mobile" : ""}`
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

const authorized = (req: IncomingMessage) => {
  const want = process.env.OPS_TOKEN
  if (!want) return false
  const got = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
  const h = (x: string) => createHash("sha256").update(x).digest()
  return timingSafeEqual(h(got), h(want))
}

async function reachable(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })
    return r.ok
  } catch {
    return false
  }
}

/** true when the browser's Origin (if any) names this host; non-browser posts carry none */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
  } catch {
    return false
  }
}

/** GET /ops.js: the browser reporter, one file for every page (/, /classic/). */
const CLIENT = readFileSync(new URL("./ops-client.js", import.meta.url))
export function opsClient(res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/javascript", "cache-control": "public, max-age=300" })
  res.end(CLIENT)
}

export async function opsApi(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method === "POST" && path === "/api/ops/client-error") {
    if (limited(req)) return json(res, 429, { error: "RateLimited" })
    // a dev page proxying /api to this server (vite, a local build) sends its own Origin: drop it so the ring holds this deploy's errors only
    if (!sameOrigin(req)) return json(res, 202, { ok: true, dropped: "origin" })
    let s = ""
    for await (const c of req) {
      s += c
      if (s.length > 8_000) return json(res, 413, { error: "TooLarge" })
    }
    let b: any = {}
    try {
      b = JSON.parse(s || "{}")
    } catch {
      return json(res, 400, { error: "BadParams" })
    }
    record({ source: "client", kind: scrub(b.kind ?? "error", 40), message: scrub(b.message), stack: b.stack ? scrub(b.stack, 4000) : undefined, path: cleanPath(b.path), release: scrub(b.release, 60), ua: uaFamily(req.headers["user-agent"]) })
    return json(res, 200, { ok: true })
  }
  if (req.method === "GET" && path === "/api/ops/errors") {
    if (!process.env.OPS_TOKEN) return json(res, 503, { error: "OPS_TOKEN not set" })
    if (!authorized(req)) return json(res, 401, { error: "Unauthorized" })
    const since = Number(new URL(req.url ?? "", "http://x").searchParams.get("since") ?? 0) || 0
    return json(res, 200, { now: Date.now(), release: RELEASE, errors: ring.filter((e) => e.at > since) })
  }
  if (req.method === "GET" && path === "/api/ops/health") {
    const rpc = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org"
    const bridge = process.env.UCP_BRIDGE_URL ?? "https://bookerbob-ucp-bridge.fly.dev"
    const [chain, ucp] = await Promise.all([
      reachable(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) }),
      reachable(`${bridge}/health`),
    ])
    const last = ring[ring.length - 1]
    return json(res, 200, { ok: chain, uptimeSec: Math.round((Date.now() - started) / 1000), release: RELEASE, chainRpc: chain, ucpBridge: ucp, errors: ring.length, lastErrorAt: last?.at ?? null })
  }
  return json(res, 404, { error: "NotFound" })
}
