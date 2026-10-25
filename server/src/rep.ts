// REP -> BookerBob "verified traveler" handoff. Mounted under /api/rep by one line in index.ts.
// The REP Bob app uses its push-consent rail with Issuer URL = https://<host>/api/rep:
//   POST /api/rep/session  {commitment}     web: open a 2-minute session for one Semaphore commitment
//   GET  /api/rep/pending                   phone: the open request {sid, nonce, aud, contexts, purpose}
//   POST /api/rep/present  {sid, attestations: [{jws, kbJwt}], ...}
//                                           phone: a REP-signed verdict + a holder proof bound to aud and nonce
//   GET  /api/rep/result?sid=               web: pending | passed | failed
//   GET  /?demo=<token> (or /api/rep/demo?token=)  operator: sets the demo cookie once, then redirects to /
//   GET  /api/rep/status                    web: {demo: bool}, whether this browser may open a session
// Sessions open ONLY for the demo operator (REP_DEMO_TOKEN, as cookie or x-bb-demo header): the one phone
// polling /pending is the team's, so a public visitor must never be able to put a request on it. Without
// REP_DEMO_TOKEN no session opens at all. /session, /pending, /present and /result are rate-limited per IP.
// A verdict that checks out (issuer rep-attest.fly.dev, aud bookerbob, this nonce, not revoked, a lodging
// tier from Airbnb or Booking) adds the commitment to the "REP verified traveler" group with the REP attester
// key. Only "passed" is kept: no tier, spend, source or device key is stored or logged. `vps` and
// `presentations` are never read. Every other path, including /receive and /issue, is 404.
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomBytes, createHash, timingSafeEqual } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { record as opsRecord, scrub } from "./ops.ts"
import { Keypair } from "@stellar/stellar-sdk"
import { getClient, write, views, TESTNET } from "../../packages/sdk/src/contract.ts"
import { contractId } from "../../packages/sdk/src/deployment.ts"
import { signerOf } from "./core.ts"
// @ts-ignore plain JS kit, no types
import { verifyRepAttestation } from "./verify-rep.mjs"
import { checkRebind, commitmentKey, siblingsFor, type RebindProof } from "./rebind.ts"

export const REP_ISSUER = "https://rep-attest.fly.dev"
export const AUD = "bookerbob"
const SESSION_MS = 2 * 60_000
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const PLATFORMS = /(^|\.)(airbnb|booking)\.com$/i

type Status = "pending" | "presented" | "passed" | "failed"
interface Session { sid: string; commitment: string; nonce: string; exp: number; status: Status; reason?: string; txHash?: string; viaOperator?: boolean; rebind?: RebindProof; moved?: boolean }

export interface RepDeps {
  /** Adds a commitment to the verified-traveler group; returns the tx hash. */
  addMember: (commitment: bigint) => Promise<string>
  /** On-chain path: the verdict goes to the REP tier issuer (or, REP_ONCHAIN=verdict, to the contract as is); no attester key. */
  addMemberWithRep?: (commitment: bigint, jws: string, kbJwt: string, nonce: string) => Promise<string>
  /** Test hook: a fixed JWKS instead of fetching the issuer's. */
  jwks?: { keys: unknown[] } | null
  now?: () => number
  /** Where the spent-proof set survives a restart (DATA_DIR). */
  stateDir?: string | null
  /** Demo operator token (REP_DEMO_TOKEN). Unset or empty: no session can be opened. */
  demoToken?: string | null
  /** The REP group id (for the rebind challenge and the spent record). */
  groupId?: () => Promise<number>
  /** Moves a membership: replace_member(group, old, new) with the group operator key. */
  replaceMember?: (oldCommitment: bigint, newCommitment: bigint) => Promise<string>
  /** Salt for the stored commitment hashes. */
  salt?: string
}

const sha = (x: string) => createHash("sha256").update(x).digest()
const COOKIE = "bb_demo"
/** Per-IP limits per minute. The phone polls /pending every 2 s (30/min). */
const LIMITS: Record<string, number> = { "/session": 6, "/rebind": 6, "/pending": 45, "/present": 10, "/result": 60, "/demo-reset": 6, "/demo": 10, "/status": 60 }

export function createRep(deps: RepDeps) {
  const sessions = new Map<string, Session>()
  // One REP PRESENTATION joins once: rep-attest re-signs the same presentation on demand with any holder key,
  // so the spent key is its attestation_hash (sha256 of the presentation bytes), persisted under DATA_DIR.
  // Known limit: one notarized session can yield several presentations (another reveal set), so this raises
  // the cost of a sybil but does not bound it per account; that needs a stable id from REP (header hash or
  // account tag). The demo-operator gate on /session is what bounds it today.
  // spent proof -> {group, hash of the commitment it currently backs}; one line per change, the last one wins.
  // A legacy line (proof only) cannot be moved. Moving is how "start over" keeps exactly one membership.
  const spentFile = deps.stateDir ? join(deps.stateDir, "rep-spent-proofs.txt") : null
  // spent presentation -> how its join came (demo operator or not) and, for moves, {group, hash of the
  // commitment it currently backs}. Line format "key op|user [group commitmentHash]"; the last line wins.
  // Every session has been operator-only since the rep-gate, so a legacy line (no flag) is an operator join.
  // A line without group/hash (legacy) cannot be moved.
  type Spent = { viaOperator: boolean; group?: number; ch?: string }
  const spent = new Map<string, Spent>()
  // presentations with a join in flight: a concurrent second session is refused, but nothing is recorded until the add succeeds
  const inflight = new Set<string>()
  if (spentFile && existsSync(spentFile)) {
    for (const line of readFileSync(spentFile, "utf8").split("\n").filter(Boolean)) {
      const [k, op, g, ch] = line.split(" ")
      spent.set(k, { viaOperator: op === undefined || op === "op", ...(g && ch ? { group: Number(g), ch } : {}) })
    }
  }
  const salt = deps.salt ?? "bookerbob-rep"
  const groupOf = deps.groupId ?? (async () => 1)
  const lineOf = (k: string, v: Spent) => `${k} ${v.viaOperator ? "op" : "user"}${v.group !== undefined && v.ch ? ` ${v.group} ${v.ch}` : ""}\n`
  const record = (k: string, v: Spent) => {
    spent.set(k, v)
    if (spentFile) {
      try {
        mkdirSync(deps.stateDir!, { recursive: true })
        appendFileSync(spentFile, lineOf(k, v))
      } catch {}
    }
  }
  const persistAll = () => {
    if (!spentFile) return
    try {
      mkdirSync(deps.stateDir!, { recursive: true })
      writeFileSync(spentFile, [...spent].map(([k, v]) => lineOf(k, v)).join(""))
    } catch {}
  }
  const proofKey = (ah: string) => createHash("sha256").update(`bookerbob/rep/proof/${ah}`).digest("hex")
  const now = () => (deps.now ? deps.now() : Date.now())
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" })
    res.end(JSON.stringify(body))
  }
  const read = async (req: IncomingMessage): Promise<any> => {
    let s = ""
    for await (const c of req) {
      s += c
      if (s.length > 256_000) throw new Error("too large")
    }
    return s ? JSON.parse(s) : {}
  }
  const isDemo = (req: IncomingMessage): boolean => {
    const want = deps.demoToken
    if (!want) return false
    const cookie = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    const got = String(req.headers["x-bb-demo"] ?? (cookie ? decodeURIComponent(cookie) : ""))
    return got.length > 0 && timingSafeEqual(sha(got), sha(want))
  }
  const hits = new Map<string, number[]>()
  const limited = (req: IncomingMessage, sub: string): boolean => {
    const route = Object.keys(LIMITS).find((r) => sub.startsWith(r))
    if (!route) return false
    const key = `${route} ${req.headers["fly-client-ip"] ?? req.socket.remoteAddress}`
    const t = now()
    const h = (hits.get(key) ?? []).filter((x) => t - x < 60_000)
    h.push(t)
    hits.set(key, h)
    if (hits.size > 5000) hits.clear()
    return h.length > LIMITS[route]
  }
  const expire = () => {
    for (const s of sessions.values()) if (s.status === "pending" && now() > s.exp) (s.status = "failed"), (s.reason = "expired")
    if (sessions.size > 500) for (const [k, s] of sessions) if (s.status !== "pending") sessions.delete(k)
  }

  async function present(b: any): Promise<{ code: number; body: unknown }> {
    expire()
    const s = typeof b?.sid === "string" ? sessions.get(b.sid) : undefined
    if (!s) return { code: 404, body: { error: "unknown session" } }
    if (s.status === "failed" && s.reason === "expired") return { code: 410, body: { error: "expired" } }
    // One presentation per session: the nonce is spent before anything is checked, so a replay never verifies.
    if (s.status !== "pending") return { code: 409, body: { error: "nonce already used" } }
    s.status = "presented"
    const a = Array.isArray(b.attestations) ? b.attestations[0] : null
    if (!a || typeof a.jws !== "string" || typeof a.kbJwt !== "string") return fail(s, "no attestation")
    const r = await verifyRepAttestation(a.jws, {
      issuer: REP_ISSUER,
      audience: AUD,
      kbJwt: a.kbJwt,
      nonce: s.nonce,
      checkRevocation: true,
      ...(deps.jwks ? { jwks: deps.jwks } : {}),
      now: Math.floor(now() / 1000),
    })
    if (!r.valid) return fail(s, (r.reasons as string[]).join(","))
    // Fail closed when the status list could not be read (verify-rep leaves that policy to us).
    if (!r.payload?.status?.status_list) return fail(s, "no revocation status")
    if (typeof r.verdict?.lodging_spend_tier !== "string" || !r.verdict.lodging_spend_tier) return fail(s, "no lodging tier")
    if (typeof r.payload.server_name !== "string" || !PLATFORMS.test(r.payload.server_name)) return fail(s, "not a lodging platform")
    const ah = r.payload.attestation_hash
    if (typeof ah !== "string" || ah.length < 16) return fail(s, "no attestation hash")
    const pk = proofKey(ah)
    const group = await groupOf()
    if (inflight.has(pk)) return fail(s, "a join with this presentation is in progress")
    if (spent.has(pk)) {
      // Already joined: only a MOVE is allowed, proven by the old identity (signed at /rebind for this session).
      // The move is the group operator's replace_member in every mode (the attester key also operates the
      // group when joins go through the tier credential).
      const entry = spent.get(pk)!
      if (!s.rebind || entry.group === undefined || !entry.ch) return fail(s, "this presentation already joined")
      if (!deps.replaceMember) return fail(s, "move is not configured")
      if (entry.group !== group) return fail(s, "this presentation joined another group")
      if (entry.ch !== commitmentKey(salt, s.rebind.oldCommitment)) return fail(s, "the old identity does not hold this membership")
      try {
        s.txHash = await deps.replaceMember(BigInt(s.rebind.oldCommitment), BigInt(s.commitment))
        record(pk, { viaOperator: entry.viaOperator, group, ch: commitmentKey(salt, s.commitment) })
        s.status = "passed"
        s.moved = true
        return { code: 200, body: { ok: true, moved: true } }
      } catch (e) {
        return fail(s, `replace_member failed: ${String((e as Error).message).slice(0, 80)}`)
      }
    }
    // sessions open only for the demo operator today, so this join is an operator join. The presentation is
    // recorded as spent only AFTER the add succeeds: a failed add must not turn every retry into "already joined".
    inflight.add(pk)
    try {
      // The off-chain checks above still run first (they also cover revocation, which the contract cannot read).
      if (deps.addMemberWithRep) {
        try {
          s.txHash = await deps.addMemberWithRep(BigInt(s.commitment), a.jws, a.kbJwt, s.nonce)
        } catch (e) {
          // The tier issuer keeps its own spent set per presentation, which the demo reset cannot clear. For the
          // operator's own rehearsal joins only, the operator key adds the member instead.
          if (!(s.viaOperator !== false && /already minted/i.test(String((e as Error).message)))) throw e
          s.txHash = await deps.addMember(BigInt(s.commitment))
        }
      } else s.txHash = await deps.addMember(BigInt(s.commitment))
      record(pk, { viaOperator: s.viaOperator !== false, group, ch: commitmentKey(salt, s.commitment) })
      s.status = "passed"
      return { code: 200, body: { ok: true } }
    } catch (e) {
      return fail(s, `add_member failed: ${String((e as Error).message).slice(0, 80)}`)
    } finally {
      inflight.delete(pk)
    }
  }
  const fail = (s: Session, reason: string) => {
    s.status = "failed"
    s.reason = reason
    // the reason reaches ops-watch (no PII: reasons are fixed phrases plus an error tail, scrubbed)
    opsRecord({ source: "server", kind: "rep verify-failed", message: scrub(reason, 200) })
    return { code: 400, body: { error: "verification failed" } }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    const sub = path.replace(/^\/api\/rep/, "")
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" })
        return void res.end()
      }
      if (limited(req, sub)) return json(res, 429, { error: "RateLimited" })
      if (req.method === "GET" && sub === "/status") {
        let group: number | null = null
        try {
          group = await groupOf()
        } catch {}
        return json(res, 200, { demo: isDemo(req), group })
      }
      if (req.method === "GET" && sub.startsWith("/demo")) {
        // also reached as /?demo=<token> (one line in index.ts)
        const q = new URL(req.url ?? path, "http://x").searchParams
        const token = q.get("token") ?? q.get("demo") ?? ""
        if (!deps.demoToken || !token || !timingSafeEqual(sha(token), sha(deps.demoToken))) return json(res, 403, { error: "Forbidden" })
        res.writeHead(302, { location: q.get("fresh") === "1" ? "/?fresh=1" : "/", "set-cookie": `${COOKIE}=${encodeURIComponent(token)}; Path=/api; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`, "cache-control": "no-store" })
        return void res.end()
      }
      if (req.method === "POST" && sub === "/session") {
        // demo operator only: the polling phone is the team's
        if (!isDemo(req)) return json(res, 403, { error: "demo operator only", message: "REP verify runs through the REP app; watch it in the demo video" })
        const b = await read(req)
        const c = typeof b.commitment === "string" && /^\d{1,78}$/.test(b.commitment) ? BigInt(b.commitment) : 0n
        if (c === 0n || c >= FR) return json(res, 400, { error: "commitment must be a nonzero field element (decimal)" })
        expire()
        // One open request at a time: the phone answers the newest.
        for (const s of sessions.values()) if (s.status === "pending") (s.status = "failed"), (s.reason = "superseded")
        const sid = randomBytes(12).toString("hex")
        const s: Session = { sid, commitment: c.toString(), nonce: `pos:${c}:${randomBytes(16).toString("hex")}`, exp: now() + SESSION_MS, status: "pending", viaOperator: true }
        sessions.set(sid, s)
        return json(res, 200, { sid, nonce: s.nonce, expiresAt: s.exp })
      }
      if (req.method === "POST" && sub === "/rebind") {
        // "start over": the browser signs with its OLD identity that this session's commitment replaces it
        if (!isDemo(req)) return json(res, 403, { error: "demo operator only" })
        const b = await read(req)
        const s = typeof b.sid === "string" ? sessions.get(b.sid) : undefined
        if (!s || s.status !== "pending") return json(res, 404, { error: "unknown or closed session" })
        const r = checkRebind(b.rebind, await groupOf(), s.commitment, s.nonce)
        if (!r) return json(res, 400, { error: "the old identity's signature does not check out" })
        s.rebind = r
        return json(res, 200, { ok: true })
      }
      if (req.method === "POST" && sub === "/demo-reset") {
        // Live demos only: the operator forgets its OWN spent presentations so the same REP proof can join
        // again from a fresh start. Joins from non-operator flows are never touched. The old leaf stays in the
        // group on Stellar (a dead identity); production keeps one presentation, one membership.
        if (!isDemo(req)) return json(res, 403, { error: "demo operator only" })
        let cleared = 0
        for (const [k, v] of spent) if (v.viaOperator) (spent.delete(k), cleared++)
        persistAll()
        return json(res, 200, { ok: true, cleared })
      }
      if (req.method === "GET" && sub === "/pending") {
        expire()
        const s = [...sessions.values()].reverse().find((x) => x.status === "pending")
        if (!s) return json(res, 200, {})
        return json(res, 200, { sid: s.sid, nonce: s.nonce, aud: AUD, contexts: ["travel"], purpose: "BookerBob: are you a verified traveler? It keeps only yes or no." })
      }
      if (req.method === "POST" && sub === "/present") {
        const r = await present(await read(req))
        return json(res, r.code, r.body)
      }
      if (req.method === "GET" && sub.startsWith("/result")) {
        expire()
        // index.ts routes on the pathname only; the query lives on req.url
        const sid = new URL(req.url ?? path, "http://x").searchParams.get("sid") ?? ""
        const s = sessions.get(sid)
        if (!s) return json(res, 404, { error: "unknown session" })
        const status = s.status === "presented" ? "pending" : s.status
        return json(res, 200, { status, ...(s.status === "passed" ? { txHash: s.txHash, ...(s.moved ? { moved: true } : {}) } : {}), ...(s.status === "failed" ? { reason: s.reason } : {}) })
      }
    } catch {
      return json(res, 400, { error: "bad request" })
    }
    // /receive, /issue and everything else: not a REP issuer, never read.
    return json(res, 404, { error: "NotFound" })
  }

  return { handle, present, sessions }
}

let live: ReturnType<typeof createRep> | null = null
let groupId: Promise<number> | null = null

async function client(secretEnv: string) {
  const secret = process.env[secretEnv]
  if (!secret) throw new Error(`${secretEnv} not set`)
  const kp = Keypair.fromSecret(secret)
  const net = { ...TESTNET, rpcUrl: process.env.STELLAR_RPC_URL ?? TESTNET.rpcUrl, contractId: contractId() }
  const c = await getClient(net, signerOf(kp, net.networkPassphrase))
  groupId ??= (async () => {
    if (process.env.REP_GROUP_ID) return Number(process.env.REP_GROUP_ID)
    const gs = ((await (c as any).list_groups()).result ?? []) as any[]
    const g = gs.find((x) => String(x.name) === "REP verified traveler")
    if (!g) throw new Error("group not found")
    return Number(g.id)
  })()
  return { c, group: await groupId }
}

const done = (r: Awaited<ReturnType<typeof write>>) => {
  if (r.ok) return r.txHash
  // Already verified earlier with the same identity: still a member, nothing to add.
  if (r.error === "DuplicateLeaf") return ""
  throw new Error(r.error === "Unknown" ? (r.message ?? r.error) : r.error)
}

/** The REP tier issuer (rep-attest-tier): full verdict in, 106-byte tier credential + P-256 signature out. */
export async function tierCredential(base: string, b: { jws: string; kbJwt: string; nonce: string; commitment: string; contract?: string; group?: number }): Promise<{ cred: Buffer; sig: Buffer }> {
  const r = await fetch(`${base.replace(/\/$/, "")}/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(15_000) })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || typeof j.cred !== "string" || typeof j.sig !== "string") throw new Error(`tier issuer ${r.status}${j.reasons ? " " + j.reasons.join(",") : ""}${j.error ? ` (${j.error})` : ""}`)
  const cred = Buffer.from(j.cred, "base64url")
  const sig = Buffer.from(j.sig, "base64url")
  if (cred.length !== 106 || sig.length !== 64) throw new Error("tier issuer returned a malformed credential")
  return { cred, sig }
}

/** The deployed handler, group "REP verified traveler". Default: the REP attester key (REP_ATTESTER_SECRET) calls
 *  add_member. REP_ONCHAIN=1: the REP tier issuer (REP_TIER_URL) checks the verdict and signs a compact
 *  credential (commitment + tier byte, nothing else), and any funded relayer (REP_RELAYER_SECRET, no group
 *  rights) submits it to add_member_with_tier, which the contract checks with secp256r1. REP_ONCHAIN=verdict:
 *  the raw verdict goes to add_member_with_rep, which publishes its bands and the device key; kept for tests. */
export function repApi(req: IncomingMessage, res: ServerResponse, path: string) {
  const mode = process.env.REP_ONCHAIN === "1" ? "tier" : process.env.REP_ONCHAIN === "verdict" ? "verdict" : "attester"
  const tierUrl = process.env.REP_TIER_URL ?? "https://rep-attest-tier.fly.dev"
  live ??= createRep({
    demoToken: process.env.REP_DEMO_TOKEN || null,
    stateDir: process.env.DATA_DIR || null,
    salt: process.env.REP_SPENT_SALT || contractId(),
    async groupId() {
      if (process.env.REP_GROUP_ID) return Number(process.env.REP_GROUP_ID)
      return (await client(mode === "attester" ? "REP_ATTESTER_SECRET" : "REP_RELAYER_SECRET")).group
    },
    async addMember(commitment) {
      const { c, group } = await client("REP_ATTESTER_SECRET")
      return done(await write(c, "add_member", { group, id_commitment: commitment }))
    },
    async replaceMember(oldCommitment, newCommitment) {
      // replace_member(group, old, new, siblings of the old leaf), group operator only; a stale path (BadPath,
      // someone joined in between) is re-read once
      const { c, group } = await client("REP_ATTESTER_SECRET")
      for (let attempt = 0; ; attempt++) {
        const siblings = siblingsFor(await views.groupLeaves(c, group), oldCommitment)
        const r = await write(c, "replace_member", { group, old_commitment: oldCommitment, new_commitment: newCommitment, siblings })
        if (r.ok || attempt > 0 || !/BadPath|#25/.test(String(r.message ?? r.error))) return done(r)
      }
    },
    ...(mode === "tier"
      ? {
          async addMemberWithRep(commitment: bigint, jws: string, kbJwt: string, nonce: string) {
            // the credential's audience pins this contract and group: sha256("<contract>:<group>")
            const { c, group } = await client("REP_RELAYER_SECRET")
            const { cred, sig } = await tierCredential(tierUrl, { jws, kbJwt, nonce, commitment: commitment.toString(), contract: contractId(), group })
            return done(await write(c, "add_member_with_tier", { group, id_commitment: commitment, cred, sig }))
          },
        }
      : mode === "verdict"
        ? {
            async addMemberWithRep(commitment: bigint, jws: string, kbJwt: string) {
              const { c, group } = await client("REP_RELAYER_SECRET")
              return done(await write(c, "add_member_with_rep", { group, id_commitment: commitment, verdict: Buffer.from(jws), kb: Buffer.from(kbJwt) }))
            },
          }
        : {}),
  })
  return live.handle(req, res, path)
}
