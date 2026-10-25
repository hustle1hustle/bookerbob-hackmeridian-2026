// Stellar wallet tier as a context perk. Denis's verify_onchain_zk module scores a wallet (Horizon history,
// plus Stellar Passport signals when PASSPORT_API_KEY is set) into tiers 1..5 (5 best). A wallet at or above
// STELLAR_TIER_MIN puts ONE fresh browser identity into the attested group "Stellar wallet tier", so places
// can reward it in zero knowledge. Mounted under /api/stellar-tier by one line in index.ts; the scoring is
// Denis's inspectWallet, unchanged.
//   GET  /api/stellar-tier/info                                         {minTier, group, explainer}
//   GET  /api/stellar-tier/challenge?address=G...&commitment=<decimal>   a message for the wallet to sign
//   POST /api/stellar-tier/join {address, commitment, nonce, signature} SEP-53 signature (base64) over it
// The wallet signature proves the caller controls the wallet whose tier is used (else anyone could borrow an
// old wallet's history). One join per wallet and one per commitment, kept as salted hashes in DATA_DIR; per-IP
// rate limits. Privacy: this service sees wallet -> commitment for the moment of the join and stores neither;
// the ledger sees only the commitment. The commitment must be a dedicated secret identity of the browser, NOT
// loyaltyIdentity(address, season), which anyone can recompute from the public address.
import type { IncomingMessage, ServerResponse } from "node:http"
import { createHash, randomBytes } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Keypair, StrKey } from "@stellar/stellar-sdk"
import { getClient, write, TESTNET } from "../../packages/sdk/src/contract.ts"
import { contractId } from "../../packages/sdk/src/deployment.ts"
import { signerOf } from "./core.ts"

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const GROUP_NAME = "Stellar wallet tier"
export const EXPLAINER = "your Stellar wallet history earns a tier. places see the tier, never the wallet."
const CHALLENGE_MS = 2 * 60_000
const LIMITS: Record<string, number> = { "/challenge": 20, "/join": 6 }

export interface StellarTierDeps {
  /** Denis's inspectWallet: the wallet's tier 1..5 (5 best). */
  tierOf: (address: string) => Promise<number>
  /** add_member(group "Stellar wallet tier", commitment) with the attester key; returns the tx hash. */
  addMember: (commitment: bigint) => Promise<string>
  minTier: number
  stateDir?: string | null
  /** salt for the stored wallet / commitment hashes */
  salt: string
  now?: () => number
}

/** SEP-53: the wallet signs sha256("Stellar Signed Message:\n" + message) with its ed25519 key. */
export const sep53Hash = (message: string) => createHash("sha256").update(Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message, "utf8")])).digest()
export const challengeMessage = (address: string, commitment: string, nonce: string) =>
  `BookerBob: join "Stellar wallet tier" with this wallet's history.\naddress: ${address}\ncommitment: ${commitment}\nnonce: ${nonce}`

export function createStellarTier(deps: StellarTierDeps) {
  const now = () => (deps.now ? deps.now() : Date.now())
  const challenges = new Map<string, { address: string; commitment: string; exp: number }>()
  const file = deps.stateDir ? join(deps.stateDir, "stellar-tier-joined.txt") : null
  const pending = new Set<string>()
  const joined = new Set<string>(file && existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [])
  const h = (kind: string, v: string) => createHash("sha256").update(`${deps.salt}|${kind}|${v}`).digest("hex")
  const remember = (k: string) => {
    joined.add(k)
    if (file) {
      try {
        mkdirSync(deps.stateDir!, { recursive: true })
        appendFileSync(file, k + "\n")
      } catch {}
    }
  }
  const hits = new Map<string, number[]>()
  const limited = (req: IncomingMessage, route: string) => {
    const key = `${route} ${req.headers["fly-client-ip"] ?? req.socket.remoteAddress}`
    const t = now()
    const l = (hits.get(key) ?? []).filter((x) => t - x < 60_000)
    l.push(t)
    hits.set(key, l)
    if (hits.size > 5000) hits.clear()
    return l.length > (LIMITS[route] ?? 30)
  }
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" })
    res.end(JSON.stringify(body))
  }
  const validCommitment = (c: unknown) => typeof c === "string" && /^\d{1,78}$/.test(c) && BigInt(c) > 0n && BigInt(c) < FR

  async function joinGroup(b: any): Promise<{ code: number; body: unknown }> {
    const { address, commitment, nonce, signature } = b ?? {}
    if (typeof address !== "string" || !StrKey.isValidEd25519PublicKey(address)) return { code: 400, body: { error: "a G... wallet address is required" } }
    if (!validCommitment(commitment)) return { code: 400, body: { error: "commitment must be a nonzero field element (decimal)" } }
    const ch = typeof nonce === "string" ? challenges.get(nonce) : undefined
    if (!ch || ch.exp < now()) return { code: 410, body: { error: "challenge expired, ask for a new one" } }
    challenges.delete(nonce) // single use, whatever happens next
    if (ch.address !== address || ch.commitment !== commitment) return { code: 400, body: { error: "challenge was issued for another wallet or identity" } }
    let ok = false
    try {
      ok = Keypair.fromPublicKey(address).verify(sep53Hash(challengeMessage(address, commitment, nonce)), Buffer.from(String(signature ?? ""), "base64"))
    } catch {}
    if (!ok) return { code: 401, body: { error: "the wallet signature does not check out" } }
    const wk = h("wallet", address)
    const ck = h("commitment", commitment)
    if (joined.has(wk) || pending.has(wk)) return { code: 409, body: { error: "this wallet already joined" } }
    if (joined.has(ck) || pending.has(ck)) return { code: 409, body: { error: "this identity already joined" } }
    // reserved before the first await, so two concurrent joins cannot both pass; released if it does not land
    pending.add(wk)
    pending.add(ck)
    try {
      const tier = await deps.tierOf(address)
      if (!(tier >= deps.minTier)) return { code: 403, body: { error: "wallet tier below the threshold", minTier: deps.minTier, tier } }
      const txHash = await deps.addMember(BigInt(commitment))
      remember(wk)
      remember(ck)
      return { code: 200, body: { ok: true, txHash, tier, group: GROUP_NAME } }
    } catch (e) {
      return { code: 502, body: { error: `add_member failed: ${String((e as Error).message).slice(0, 80)}` } }
    } finally {
      pending.delete(wk)
      pending.delete(ck)
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    const sub = path.replace(/^\/api\/stellar-tier/, "")
    try {
      if (req.method === "GET" && sub === "/info") return json(res, 200, { minTier: deps.minTier, group: GROUP_NAME, explainer: EXPLAINER })
      if (req.method === "GET" && sub === "/challenge") {
        if (limited(req, "/challenge")) return json(res, 429, { error: "RateLimited" })
        const q = new URL(req.url ?? path, "http://x").searchParams
        const address = q.get("address") ?? ""
        const commitment = q.get("commitment") ?? ""
        if (!StrKey.isValidEd25519PublicKey(address)) return json(res, 400, { error: "a G... wallet address is required" })
        if (!validCommitment(commitment)) return json(res, 400, { error: "commitment must be a nonzero field element (decimal)" })
        for (const [k, v] of challenges) if (v.exp < now()) challenges.delete(k)
        if (challenges.size > 2000) return json(res, 429, { error: "busy" })
        const nonce = randomBytes(16).toString("hex")
        challenges.set(nonce, { address, commitment, exp: now() + CHALLENGE_MS })
        return json(res, 200, { nonce, message: challengeMessage(address, commitment, nonce), expiresAt: now() + CHALLENGE_MS, minTier: deps.minTier })
      }
      if (req.method === "POST" && sub === "/join") {
        if (limited(req, "/join")) return json(res, 429, { error: "RateLimited" })
        let s = ""
        for await (const c of req) {
          s += c
          if (s.length > 8_000) return json(res, 413, { error: "too large" })
        }
        const r = await joinGroup(JSON.parse(s || "{}"))
        return json(res, r.code, r.body)
      }
    } catch {
      return json(res, 400, { error: "bad request" })
    }
    return json(res, 404, { error: "NotFound" })
  }
  return { handle, joinGroup, challenges }
}

let live: ReturnType<typeof createStellarTier> | null = null
let groupId: Promise<number> | null = null

/** The deployed handler: attester key STELLAR_TIER_ATTESTER_SECRET, group "Stellar wallet tier" (or STELLAR_TIER_GROUP_ID),
 *  threshold STELLAR_TIER_MIN (default 3 on Denis's 1..5 ladder). Works without PASSPORT_API_KEY (on-chain history only);
 *  with it, Denis's scoring adds the Passport signals. */
export function stellarTierApi(req: IncomingMessage, res: ServerResponse, path: string) {
  live ??= createStellarTier({
    minTier: Number(process.env.STELLAR_TIER_MIN ?? 3),
    stateDir: process.env.DATA_DIR || null,
    salt: process.env.STELLAR_TIER_SALT || contractId(),
    async tierOf(address) {
      const { inspectWallet } = await import("../../packages/verify_onchain_zk/src/index.ts")
      const w = await inspectWallet(address, { passport: true, passportApiKey: process.env.PASSPORT_API_KEY || undefined, passportBaseUrl: process.env.PASSPORT_BASE_URL || undefined })
      return Number(w.tier)
    },
    async addMember(commitment) {
      const secret = process.env.STELLAR_TIER_ATTESTER_SECRET
      if (!secret) throw new Error("STELLAR_TIER_ATTESTER_SECRET not set")
      const kp = Keypair.fromSecret(secret)
      const net = { ...TESTNET, rpcUrl: process.env.STELLAR_RPC_URL ?? TESTNET.rpcUrl, contractId: contractId() }
      const c = await getClient(net, signerOf(kp, net.networkPassphrase))
      groupId ??= (async () => {
        if (process.env.STELLAR_TIER_GROUP_ID) return Number(process.env.STELLAR_TIER_GROUP_ID)
        const g = (((await (c as any).list_groups()).result ?? []) as any[]).find((x) => String(x.name) === GROUP_NAME)
        if (!g) throw new Error("group not found")
        return Number(g.id)
      })()
      const r = await write(c, "add_member", { group: await groupId, id_commitment: commitment })
      if (r.ok) return r.txHash
      if (r.error === "DuplicateLeaf") return ""
      throw new Error(r.error)
    },
  })
  return live.handle(req, res, path)
}
