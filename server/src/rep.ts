// REP -> BookerBob "verified traveler" handoff. Mounted under /api/rep by one line in index.ts.
// The REP Bob app uses its push-consent rail with Issuer URL = https://<host>/api/rep:
//   POST /api/rep/session  {commitment}     web: open a 2-minute session for one Semaphore commitment
//   GET  /api/rep/pending                   phone: the open request {sid, nonce, aud, contexts, purpose}
//   POST /api/rep/present  {sid, attestations: [{jws, kbJwt}], ...}
//                                           phone: a REP-signed verdict + a holder proof bound to aud and nonce
//   GET  /api/rep/result?sid=               web: pending | passed | failed
// A verdict that checks out (issuer rep-attest.fly.dev, aud bookerbob, this nonce, not revoked, a lodging
// tier from Airbnb or Booking) adds the commitment to the "REP verified traveler" group with the REP attester
// key. Only "passed" is kept: no tier, spend, source or device key is stored or logged. `vps` and
// `presentations` are never read. Every other path, including /receive and /issue, is 404.
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import { Keypair } from "@stellar/stellar-sdk"
import { getClient, write, TESTNET } from "../../packages/sdk/src/contract.ts"
import { contractId } from "../../packages/sdk/src/deployment.ts"
import { signerOf } from "./core.ts"
// @ts-ignore plain JS kit, no types
import { verifyRepAttestation } from "./verify-rep.mjs"

export const REP_ISSUER = "https://rep-attest.fly.dev"
export const AUD = "bookerbob"
const SESSION_MS = 2 * 60_000
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const PLATFORMS = /(^|\.)(airbnb|booking)\.com$/i

type Status = "pending" | "presented" | "passed" | "failed"
interface Session { sid: string; commitment: string; nonce: string; exp: number; status: Status; reason?: string; txHash?: string }

export interface RepDeps {
  /** Adds a commitment to the verified-traveler group; returns the tx hash. */
  addMember: (commitment: bigint) => Promise<string>
  /** On-chain path (REP_ONCHAIN=1): the contract checks the verdict itself (`add_member_with_rep`), no attester key. */
  addMemberWithRep?: (commitment: bigint, jws: string, kbJwt: string) => Promise<string>
  /** Test hook: a fixed JWKS instead of fetching the issuer's. */
  jwks?: { keys: unknown[] } | null
  now?: () => number
}

export function createRep(deps: RepDeps) {
  const sessions = new Map<string, Session>()
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
    try {
      // The off-chain checks above still run first (they also cover revocation, which the contract cannot read).
      s.txHash = deps.addMemberWithRep
        ? await deps.addMemberWithRep(BigInt(s.commitment), a.jws, a.kbJwt)
        : await deps.addMember(BigInt(s.commitment))
      s.status = "passed"
      return { code: 200, body: { ok: true } }
    } catch (e) {
      return fail(s, `add_member failed: ${String((e as Error).message).slice(0, 80)}`)
    }
  }
  const fail = (s: Session, reason: string) => {
    s.status = "failed"
    s.reason = reason
    return { code: 400, body: { error: "verification failed" } }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    const sub = path.replace(/^\/api\/rep/, "")
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" })
        return void res.end()
      }
      if (req.method === "POST" && sub === "/session") {
        const b = await read(req)
        const c = typeof b.commitment === "string" && /^\d{1,78}$/.test(b.commitment) ? BigInt(b.commitment) : 0n
        if (c === 0n || c >= FR) return json(res, 400, { error: "commitment must be a nonzero field element (decimal)" })
        expire()
        // One open request at a time: the phone answers the newest.
        for (const s of sessions.values()) if (s.status === "pending") (s.status = "failed"), (s.reason = "superseded")
        const sid = randomBytes(12).toString("hex")
        const s: Session = { sid, commitment: c.toString(), nonce: `pos:${c}:${randomBytes(16).toString("hex")}`, exp: now() + SESSION_MS, status: "pending" }
        sessions.set(sid, s)
        return json(res, 200, { sid, expiresAt: s.exp })
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
        return json(res, 200, { status, ...(s.status === "passed" ? { txHash: s.txHash } : {}), ...(s.status === "failed" ? { reason: s.reason } : {}) })
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

/** The deployed handler, group "REP verified traveler". Default: the REP attester key (REP_ATTESTER_SECRET) calls
 *  add_member. REP_ONCHAIN=1: any funded relayer (REP_RELAYER_SECRET, holds no group rights) submits the verdict
 *  to add_member_with_rep and the contract checks it. OFF by default: the verdict and the holder proof become
 *  public tx arguments, which publishes its bands (tier, approximate spend, city band, source) and the device key. */
export function repApi(req: IncomingMessage, res: ServerResponse, path: string) {
  const onchain = process.env.REP_ONCHAIN === "1"
  live ??= createRep({
    async addMember(commitment) {
      const { c, group } = await client("REP_ATTESTER_SECRET")
      return done(await write(c, "add_member", { group, id_commitment: commitment }))
    },
    ...(onchain
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
