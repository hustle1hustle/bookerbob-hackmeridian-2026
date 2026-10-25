/**
 * verify_onchain_zk — wallet inspect + basic rating + loyalty claim for ZK / discount.
 *
 * Pipeline:
 *   1. inspect(address)     → txs, age, volume, rating 0–100, tier 1–5  (Horizon READ; no write tx)
 *   2. toDiscountHint(...)  → suggested discount bps (other module may clamp)
 *   3. buildLoyaltyClaim()  → portable claim other modules consume
 *   4. attestLoyaltyClaim() → POST /api/loyalty/attest → testnet write tx (clickable)
 *   5. proveLoyaltyClaim()  → optional Semaphore membership proof on Stellar stack
 *                             (reuses @bookerbob/pos-sdk proveMembership)
 *
 * On connect (Freighter / passkey / local): call verifyOnConnect() so score + claim
 * + attest tx land in one shot. Discount wiring (next module): clamp bps + nullifier
 * into book_with_discount. This module does not call the merchant contract itself.
 */
import type { Identity } from "@semaphore-protocol/identity"
import {
  loadArtifacts,
  proveMembership,
  type Artifacts,
  type MembershipProof,
} from "../../sdk/src/prove.ts"
import { semaphoreHash } from "../../sdk/src/derive.ts"

export const MODULE = "verify_onchain_zk" as const
export const EXPLORER_TX = "https://stellar.expert/explorer/testnet/tx"

export interface VerifyOptions {
  /** Horizon URL. Default: testnet. */
  horizonUrl?: string
  /** How many recent operations to page (cap). */
  opLimit?: number
  /** Injected fetch (tests / custom Horizon proxy). */
  fetch?: typeof fetch
  /** Add Stellar Passport builder signals on top of the Horizon rating. Default: true (keyless path; graceful). */
  passport?: boolean
  /** Stellar Passport origin. Default: the public demo instance. */
  passportBaseUrl?: string
  /** Passport v1 Bearer key (pk_…). Prefer server proxy so pk_ never hits the browser. */
  passportApiKey?: string
  /** BookerBob origin for `GET /api/passport/lookup` (`""` = same host). */
  passportProxyBase?: string
}

/** Raw Stellar Passport signals for one wallet (only what the API returned). */
export interface PassportSignals {
  /** A Passport builder profile matches this stellar address. */
  matched: boolean
  /** Which path produced the signals: v1 profiles (keyed) or leaderboard (keyless). */
  source: "keyed" | "keyless"
  /** Leaderboard points, when the keyless path matched. */
  points?: number
  /** Leaderboard rank band: Bronze → Platinum. */
  rankName?: string
  /** SCF tier from the profile (e.g. "verified"). */
  scfTier?: string
  /** Builder stats when the API exposes them. */
  totalCommits30d?: number
  activeDays30d?: number
  /** GitHub profile URL when known (keyless leaderboard entry). */
  profileUrl?: string
}

/** Passport contribution to the rating: score (0..PASSPORT_CAP) + raw signals. */
export interface PassportScore {
  score: number
  matched: boolean
  signals: PassportSignals
}

export interface WalletInspect {
  module: typeof MODULE
  address: string
  /** Horizon account exists. */
  exists: boolean
  /** Approx account age in days from last_modified_time / paging. */
  ageDays: number
  /** Count of operations sampled. */
  txCount: number
  /** Distinct successful payment ops (incoming or outgoing). */
  paymentCount: number
  /** Rough volume in stroops of native XLM payments sampled (not USDC). */
  nativeVolumeStroops: bigint
  /** 0–100 composite (Horizon wallet signals + optional Passport bonus, clamped). */
  rating: number
  /** 1–5 band for UI / perks. */
  tier: 1 | 2 | 3 | 4 | 5
  /** Stellar Passport builder signals; null when the passport option is off or the account is missing. */
  passport: PassportScore | null
  inspectedAt: number
  horizonUrl: string
}

/** Portable claim: feed into discount / context modules. */
export interface LoyaltyClaim {
  module: typeof MODULE
  version: 1
  address: string
  rating: number
  tier: 1 | 2 | 3 | 4 | 5
  /** Suggested returning-guest style bps (0–2500). Host clamps to merchant.discountBps. */
  discountHintBps: number
  /** Scope string for nullifier binding: `loyalty,{merchantId},{season}`. */
  scopeLabel: string
  merchantId: number
  season: number
  inspectedAt: number
}

export interface ProveLoyaltyInput {
  claim: LoyaltyClaim
  /** Semaphore identity (usually stay identity or passkey-derived identity). */
  identity: Identity
  /** Leaves of the group tree this identity belongs to (merchant or context group). */
  leaves: bigint[]
  artifacts?: Artifacts
  artifactsUrl?: string
}

export interface ProveLoyaltyResult {
  claim: LoyaltyClaim
  proof: MembershipProof
  /** Decimal strings ready for Soroban. */
  publicSignals: string[]
  /** Message bound into the proof (rating + address hash). */
  message: bigint
  scope: bigint
}

/** On-chain attestation of a loyalty claim (relayer payment + memo.hash). */
export interface LoyaltyAttest {
  txHash: string
  explorerUrl: string
  digest: string
}

export interface VerifyOnConnectOptions extends VerifyOptions {
  merchantId?: number
  season?: number
  /** BookerBob API origin ("" = same host). */
  apiBase?: string
  /** Post /api/loyalty/attest so there is a clickable testnet tx. Default true. */
  attest?: boolean
  /** Optional Semaphore prove (needs identity already in leaves). */
  prove?: Omit<ProveLoyaltyInput, "claim">
}

export interface VerifyOnConnectResult {
  inspect: WalletInspect
  claim: LoyaltyClaim
  /** 32-byte hex digest of the claim (also memo.hash of the attest tx). */
  digest: string
  attest: LoyaltyAttest | null
  proved: ProveLoyaltyResult | null
}

const DEFAULT_HORIZON = "https://horizon-testnet.stellar.org"

function tierOf(rating: number): 1 | 2 | 3 | 4 | 5 {
  if (rating >= 85) return 5
  if (rating >= 70) return 4
  if (rating >= 50) return 3
  if (rating >= 30) return 2
  return 1
}

/** Map rating → suggested discount bps (max 25%). */
export function ratingToDiscountBps(rating: number): number {
  const r = Math.max(0, Math.min(100, rating))
  return Math.round((r / 100) * 2500)
}

/** Transparent rubric (exported for tests). Caps: age 40 + txs 35 + pays 25. */
export function rateWalletSignals(p: { ageDays: number; txCount: number; paymentCount: number }): number {
  const age = Math.min(40, (p.ageDays / 365) * 40)
  const txs = Math.min(35, Math.log10(1 + p.txCount) * 20)
  const pays = Math.min(25, Math.log10(1 + p.paymentCount) * 18)
  return Math.round(Math.max(0, Math.min(100, age + txs + pays)))
}

/** Stellar Passport demo origin (overridable via passportBaseUrl). */
export const PASSPORT_BASE_URL = "https://demo.stellarpassport.xyz"
/** Max bonus Passport signals can add to the 0–100 rating. */
export const PASSPORT_CAP = 20

const PASSPORT_RANK_SCORE: Record<string, number> = { Bronze: 1, Silver: 2, Gold: 3, Platinum: 4 }

/**
 * Transparent Passport rubric (exported for tests). Additive on top of the Horizon signals.
 * Caps: match 5 + points 5 + rank 4 + scf_tier 3 + commits30d 2 + activeDays30d 1 = 20.
 * Stamps/challenges are dropped: they need a heavy crawl, not a transparent signal.
 */
export function ratePassportSignals(p: PassportSignals): number {
  if (!p.matched) return 0
  const match = 5
  const points = Math.min(5, Math.log10(1 + (p.points ?? 0)) * 2.5)
  const rank = PASSPORT_RANK_SCORE[p.rankName ?? ""] ?? 0
  const scf = p.scfTier ? (p.scfTier.toLowerCase() === "verified" ? 3 : 1) : 0
  const commits = Math.min(2, Math.log10(1 + (p.totalCommits30d ?? 0)) * 2)
  const days = Math.min(1, (p.activeDays30d ?? 0) / 10)
  return Math.round(Math.max(0, Math.min(PASSPORT_CAP, match + points + rank + scf + commits + days)))
}

/** Options for the Passport fetch alone (subset of VerifyOptions). */
export interface PassportOptions {
  passportBaseUrl?: string
  passportApiKey?: string
  /** BookerBob origin for server lookup (`""` = same host). Keeps pk_ off the client. */
  passportProxyBase?: string
  fetch?: typeof fetch
}

async function passportGet(base: string, path: string, f: typeof fetch, key?: string): Promise<unknown> {
  const res = await f(`${base}${path}`, key ? { headers: { authorization: `Bearer ${key}` } } : undefined)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`passport ${res.status}: ${path}`)
  return res.json().catch(() => null)
}

/** Accept a bare array or wrappers ({builders|profiles|data|entries|…}). */
function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === "object") {
    for (const k of ["builders", "profiles", "data", "entries", "leaderboard", "results"]) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v as Record<string, unknown>[]
    }
  }
  return []
}

function nextCursorOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const o = payload as Record<string, unknown>
  if (o.has_more === false) return null
  return typeof o.next_cursor === "string" && o.next_cursor ? o.next_cursor : null
}

function numOf(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined
}

function strOf(x: unknown): string | undefined {
  return typeof x === "string" && x ? x : undefined
}

function signalsFromProfile(
  profile: Record<string, unknown>,
  source: PassportSignals["source"],
  extra: Partial<PassportSignals> = {},
): PassportSignals {
  const stats = (profile.stats ?? {}) as Record<string, unknown>
  return {
    matched: true,
    source,
    points: numOf(profile.points) ?? extra.points,
    rankName: strOf(profile.rankName) ?? extra.rankName,
    scfTier: strOf(profile.scf_tier) ?? extra.scfTier,
    totalCommits30d: numOf(stats.totalCommits30d) ?? extra.totalCommits30d,
    activeDays30d: numOf(stats.activeDays30d) ?? extra.activeDays30d,
    profileUrl: extra.profileUrl,
  }
}

/**
 * Builder slug for /api/builder/public/<slug> from a leaderboard profileUrl.
 * The live API returns relative paths ("/builder/<slug>"); a full github.com URL also works.
 */
function builderSlug(profileUrl: string | undefined): string | undefined {
  if (!profileUrl) return undefined
  try {
    const u = new URL(profileUrl, PASSPORT_BASE_URL)
    if (u.hostname === "github.com") return u.pathname.split("/").filter(Boolean)[0]
    const segs = u.pathname.split("/").filter(Boolean)
    if (segs[0] === "builder") return segs[1]
  } catch {
    /* not a URL */
  }
  return undefined
}

/**
 * Fetch Stellar Passport signals for a wallet. Never throws.
 * - Prefer `passportProxyBase` → BookerBob `GET /api/passport/lookup` (server holds PASSPORT_API_KEY).
 * - With `passportApiKey`: paginate GET /api/v1/profiles (`builders[]`), match by stellar_address.
 * - Keyless: GET /api/leaderboard (max 10) → /api/builder/public/<slug> until address matches.
 */
export async function fetchPassport(address: string, opts: PassportOptions = {}): Promise<PassportScore> {
  const base = (opts.passportBaseUrl ?? PASSPORT_BASE_URL).replace(/\/$/, "")
  const f = opts.fetch ?? fetch
  const source: PassportSignals["source"] = opts.passportApiKey ? "keyed" : "keyless"
  const none: PassportScore = { score: 0, matched: false, signals: { matched: false, source } }

  if (opts.passportProxyBase !== undefined) {
    try {
      const proxy = opts.passportProxyBase.replace(/\/$/, "")
      const res = await f(`${proxy}/api/passport/lookup?address=${encodeURIComponent(address)}`)
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as PassportScore | null
        if (body && typeof body.score === "number" && typeof body.matched === "boolean" && body.signals) return body
      }
    } catch {
      /* fall through */
    }
  }

  try {
    if (opts.passportApiKey) {
      let cursor: string | null = null
      for (let page = 0; page < 20; page++) {
        const q = cursor
          ? `/api/v1/profiles?limit=100&cursor=${encodeURIComponent(cursor)}`
          : `/api/v1/profiles?limit=100`
        const payload = await passportGet(base, q, f, opts.passportApiKey)
        const rows = rowsOf(payload)
        const profile = rows.find((r) => r.stellar_address === address)
        if (profile) {
          const signals = signalsFromProfile(profile, "keyed")
          return { score: ratePassportSignals(signals), matched: true, signals }
        }
        cursor = nextCursorOf(payload)
        if (!cursor || rows.length === 0) break
      }
      return none
    }
    const payload = await passportGet(base, "/api/leaderboard?metric=points&window=all&limit=10", f)
    for (const entry of rowsOf(payload).slice(0, 10)) {
      const slug = builderSlug(strOf(entry.profileUrl))
      if (!slug) continue
      const payloadB = await passportGet(base, `/api/builder/public/${slug}`, f)
      if (!payloadB || typeof payloadB !== "object") continue
      const wrap = payloadB as Record<string, unknown>
      const profile = (wrap.builder && typeof wrap.builder === "object" ? wrap.builder : wrap) as Record<string, unknown>
      if (profile.stellar_address !== address) continue
      const rawUrl = strOf(entry.profileUrl)
      const topStats = (wrap.stats ?? {}) as Record<string, unknown>
      const signals = signalsFromProfile(profile, "keyless", {
        points: numOf(entry.points) ?? numOf(entry.value),
        rankName: strOf(entry.rankName),
        profileUrl: rawUrl ? (rawUrl.startsWith("/") ? `${base}${rawUrl}` : rawUrl) : undefined,
        totalCommits30d: numOf(topStats.totalCommits30d),
        activeDays30d: numOf(topStats.activeDays30d),
      })
      return { score: ratePassportSignals(signals), matched: true, signals }
    }
    return none
  } catch {
    return none
  }
}

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_TX}/${txHash.replace(/^0x/, "")}`
}

async function horizonGet(base: string, path: string, f: typeof fetch = fetch): Promise<any> {
  const url = `${base.replace(/\/$/, "")}${path}`
  const res = await f(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`horizon ${res.status}: ${path}`)
  return res.json()
}

/** Inspect a Stellar account on Horizon; compute basic rating. READ only — no write tx. */
export async function inspectWallet(address: string, opts: VerifyOptions = {}): Promise<WalletInspect> {
  const horizonUrl = opts.horizonUrl ?? DEFAULT_HORIZON
  const limit = Math.min(200, opts.opLimit ?? 100)
  const f = opts.fetch ?? fetch
  const account = await horizonGet(horizonUrl, `/accounts/${address}`, f)
  if (!account) {
    return {
      module: MODULE,
      address,
      exists: false,
      ageDays: 0,
      txCount: 0,
      paymentCount: 0,
      nativeVolumeStroops: 0n,
      rating: 0,
      tier: 1,
      passport: null,
      inspectedAt: Date.now(),
      horizonUrl,
    }
  }
  const ops = await horizonGet(horizonUrl, `/accounts/${address}/operations?order=desc&limit=${limit}`, f)
  const records: any[] = ops?._embedded?.records ?? []
  // Drop BookerBob loyalty-attest dust (1 stroop) so re-verify after /api/loyalty/attest does not inflate the score.
  const scored = records.filter((op) => !isLoyaltyAttestDust(op))
  let paymentCount = 0
  let nativeVolumeStroops = 0n
  for (const op of scored) {
    if (op.type === "payment" || op.type === "path_payment_strict_send" || op.type === "path_payment_strict_receive") {
      paymentCount++
      if (op.asset_type === "native" && op.amount) {
        const xlm = Number(op.amount)
        if (Number.isFinite(xlm)) nativeVolumeStroops += BigInt(Math.round(xlm * 10_000_000))
      }
    }
  }
  const lastMod = account.last_modified_time ? Date.parse(account.last_modified_time) : Date.now()
  // Prefer account birth from Horizon sequence paging; fall back to oldest scored op, then last_modified.
  const createdGuess = account.id && scored.length ? Date.parse(scored[scored.length - 1]?.created_at ?? "") : lastMod
  const ageMs = Date.now() - (Number.isFinite(createdGuess) ? createdGuess : lastMod)
  const ageDays = Math.max(0, ageMs / 86_400_000)
  const txCount = scored.length
  // Optional Passport bonus (default on): never throws, no match / no key / API down → score 0.
  const passport =
    opts.passport === false
      ? null
      : await fetchPassport(address, {
          passportBaseUrl: opts.passportBaseUrl,
          passportApiKey: opts.passportApiKey,
          passportProxyBase: opts.passportProxyBase,
          fetch: f,
        })
  const walletRating = rateWalletSignals({ ageDays, txCount, paymentCount })
  const rating = Math.round(Math.max(0, Math.min(100, walletRating + (passport?.score ?? 0))))
  return {
    module: MODULE,
    address,
    exists: true,
    ageDays: Math.round(ageDays * 10) / 10,
    txCount,
    paymentCount,
    nativeVolumeStroops,
    rating,
    tier: tierOf(rating),
    passport,
    inspectedAt: Date.now(),
    horizonUrl,
  }
}

/** True for the 1-stroop native payment used by Ops.attestLoyalty (memo.hash claim digest). */
export function isLoyaltyAttestDust(op: { type?: string; asset_type?: string; amount?: string }): boolean {
  if (op.type !== "payment" || op.asset_type !== "native" || !op.amount) return false
  const xlm = Number(op.amount)
  return Number.isFinite(xlm) && xlm > 0 && xlm <= 0.0000001
}

/** Build a claim other modules can pass around (no proof yet). */
export function buildLoyaltyClaim(inspect: WalletInspect, merchantId: number, season: number): LoyaltyClaim {
  return {
    module: MODULE,
    version: 1,
    address: inspect.address,
    rating: inspect.rating,
    tier: inspect.tier,
    discountHintBps: ratingToDiscountBps(inspect.rating),
    scopeLabel: `loyalty,${merchantId},${season}`,
    merchantId,
    season,
    inspectedAt: inspect.inspectedAt,
  }
}

function encodeMessage(claim: LoyaltyClaim): bigint {
  // Bind rating + address into the circuit message (pre-hash; proveMembership hashes again).
  const enc = new TextEncoder().encode(`pos/loyalty|${claim.address}|${claim.rating}|${claim.tier}`)
  let h = 0n
  for (const b of enc) h = (h * 257n + BigInt(b)) % (1n << 200n)
  return h
}

function encodeScope(claim: LoyaltyClaim): bigint {
  const enc = new TextEncoder().encode(claim.scopeLabel)
  let h = 0n
  for (const b of enc) h = (h * 251n + BigInt(b)) % (1n << 200n)
  return h
}

/**
 * Issue a Groth16 membership proof for the loyalty claim on the Stellar/Semaphore stack.
 * Requires the identity to already be a leaf in `leaves` (checkout / context group insert).
 */
export async function proveLoyaltyClaim(input: ProveLoyaltyInput): Promise<ProveLoyaltyResult> {
  const artifacts = input.artifacts ?? (await loadArtifacts(input.artifactsUrl))
  const message = encodeMessage(input.claim)
  const scope = encodeScope(input.claim)
  const proof = await proveMembership(input.identity, input.leaves, message, scope, artifacts)
  return {
    claim: input.claim,
    proof,
    publicSignals: proof.publicSignals,
    message,
    scope,
  }
}

/** Convenience: inspect → claim in one call. Horizon only — no write tx. */
export async function verifyWallet(
  address: string,
  merchantId: number,
  season: number,
  opts: VerifyOptions = {},
): Promise<{ inspect: WalletInspect; claim: LoyaltyClaim }> {
  const inspect = await inspectWallet(address, opts)
  return { inspect, claim: buildLoyaltyClaim(inspect, merchantId, season) }
}

/** Clamp hint to a merchant's max discount. */
export function clampDiscountBps(hintBps: number, merchantDiscountBps: number): number {
  return Math.max(0, Math.min(hintBps, merchantDiscountBps, 10_000))
}

/** Stable 32-byte hex digest of a loyalty claim (memo.hash payload). */
export async function claimDigest(claim: LoyaltyClaim): Promise<string> {
  const payload = new TextEncoder().encode(
    `pos/loyalty/v1|${claim.address}|${claim.rating}|${claim.tier}|${claim.discountHintBps}|${claim.scopeLabel}|${claim.inspectedAt}`,
  )
  const dig = await crypto.subtle.digest("SHA-256", payload)
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Ask BookerBob to post a testnet attestation tx (relayer → guest, 1 stroop, memo.hash = digest).
 * This is the write path that makes a clickable stellar.expert link after connect.
 */
export async function attestLoyaltyClaim(
  claim: LoyaltyClaim,
  opts: { apiBase?: string; fetch?: typeof fetch; digest?: string } = {},
): Promise<LoyaltyAttest> {
  const digest = opts.digest ?? (await claimDigest(claim))
  const base = (opts.apiBase ?? "").replace(/\/$/, "")
  const f = opts.fetch ?? fetch
  const res = await f(`${base}/api/loyalty/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: claim.address,
      rating: claim.rating,
      tier: claim.tier,
      merchantId: claim.merchantId,
      season: claim.season,
      discountHintBps: claim.discountHintBps,
      digest,
      inspectedAt: claim.inspectedAt,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { txHash?: string; error?: string; message?: string }
  if (!res.ok || !body.txHash) {
    throw new Error(body.message || body.error || `loyalty attest failed (${res.status})`)
  }
  return { txHash: body.txHash, explorerUrl: explorerTxUrl(body.txHash), digest }
}

/**
 * Connect-time pipeline: Horizon score → claim → optional attest tx → optional ZK prove.
 * Use after Freighter, passkey, or local wallet connect.
 */
export async function verifyOnConnect(address: string, opts: VerifyOnConnectOptions = {}): Promise<VerifyOnConnectResult> {
  const merchantId = opts.merchantId ?? 0
  const season = opts.season ?? new Date().getUTCFullYear() * 100 + (new Date().getUTCMonth() + 1)
  const { inspect, claim } = await verifyWallet(address, merchantId, season, opts)
  const digest = await claimDigest(claim)
  let attest: LoyaltyAttest | null = null
  if (opts.attest !== false) {
    attest = await attestLoyaltyClaim(claim, { apiBase: opts.apiBase, fetch: opts.fetch, digest })
  }
  let proved: ProveLoyaltyResult | null = null
  if (opts.prove) {
    proved = await proveLoyaltyClaim({ ...opts.prove, claim })
  }
  return { inspect, claim, digest, attest, proved }
}

export { semaphoreHash, loadArtifacts }
