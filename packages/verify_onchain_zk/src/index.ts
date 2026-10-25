/**
 * verify_onchain_zk — wallet inspect + basic rating + loyalty claim for ZK / discount.
 *
 * Pipeline:
 *   1. inspect(address)     → txs, age, volume, rating 0–100, tier 1–5
 *   2. toDiscountHint(...)  → suggested discount bps (other module may clamp)
 *   3. buildLoyaltyClaim()  → portable claim other modules consume
 *   4. proveLoyaltyClaim()  → optional Semaphore membership proof on Stellar stack
 *                             (reuses @bookerbob/pos-sdk proveMembership)
 *
 * Discount wiring (next module): take `LoyaltyClaim.discountHintBps` + proof
 * nullifier into book_with_discount / redeem. This module does not call the
 * merchant contract itself.
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

export interface VerifyOptions {
  /** Horizon URL. Default: testnet. */
  horizonUrl?: string
  /** How many recent operations to page (cap). */
  opLimit?: number
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
  /** 0–100 composite. */
  rating: number
  /** 1–5 band for UI / perks. */
  tier: 1 | 2 | 3 | 4 | 5
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

function scoreInspect(p: { ageDays: number; txCount: number; paymentCount: number }): number {
  // Simple, transparent rubric — document in docs/modules/verify_onchain_zk.md
  const age = Math.min(40, (p.ageDays / 365) * 40) // up to 40 pts for ~1y
  const txs = Math.min(35, Math.log10(1 + p.txCount) * 20) // diminishing
  const pays = Math.min(25, Math.log10(1 + p.paymentCount) * 18)
  return Math.round(Math.max(0, Math.min(100, age + txs + pays)))
}

async function horizonGet(base: string, path: string): Promise<any> {
  const url = `${base.replace(/\/$/, "")}${path}`
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`horizon ${res.status}: ${path}`)
  return res.json()
}

/** Inspect a Stellar account on Horizon; compute basic rating. */
export async function inspectWallet(address: string, opts: VerifyOptions = {}): Promise<WalletInspect> {
  const horizonUrl = opts.horizonUrl ?? DEFAULT_HORIZON
  const limit = Math.min(200, opts.opLimit ?? 100)
  const account = await horizonGet(horizonUrl, `/accounts/${address}`)
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
      inspectedAt: Date.now(),
      horizonUrl,
    }
  }
  const ops = await horizonGet(horizonUrl, `/accounts/${address}/operations?order=desc&limit=${limit}`)
  const records: any[] = ops?._embedded?.records ?? []
  let paymentCount = 0
  let nativeVolumeStroops = 0n
  for (const op of records) {
    if (op.type === "payment" || op.type === "path_payment_strict_send" || op.type === "path_payment_strict_receive") {
      paymentCount++
      if (op.asset_type === "native" && op.amount) {
        // amount is string in XLM; convert roughly to stroops
        const xlm = Number(op.amount)
        if (Number.isFinite(xlm)) nativeVolumeStroops += BigInt(Math.round(xlm * 10_000_000))
      }
    }
  }
  const lastMod = account.last_modified_time ? Date.parse(account.last_modified_time) : Date.now()
  // Horizon does not always expose created_at; use paging_token / last_modified as proxy floor
  const createdGuess = account.id && records.length ? Date.parse(records[records.length - 1]?.created_at ?? "") : lastMod
  const ageMs = Date.now() - (Number.isFinite(createdGuess) ? createdGuess : lastMod)
  const ageDays = Math.max(0, ageMs / 86_400_000)
  const txCount = records.length
  const rating = scoreInspect({ ageDays, txCount, paymentCount })
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
    inspectedAt: Date.now(),
    horizonUrl,
  }
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

/** Convenience: inspect → claim in one call. */
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

export { semaphoreHash, loadArtifacts }
