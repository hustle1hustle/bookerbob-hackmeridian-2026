// com.bookerbob.patronage: a UCP checkout extension. The buyer claims "I bought here before"
// in context.eligibility; the business answers with a verification action; the buyer's agent
// answers with a Semaphore v4 membership proof against the merchant's on-chain tree. The
// business never learns which past order, or which person, the proof stands for.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { toBeHex } from "ethers/utils"
import { MERCHANT, NET, currentSeason, ctxScope, leaves, merchant, perks, treeOf, groupKey, type GroupRef } from "./core.ts"

export const NS = "com.bookerbob.patronage"
export const EXT_VERSION = "2026-10-25"
export const STELLAR_HANDLER_ID = "stellar.usdc"
export const STELLAR_HANDLER_NS = "com.bookerbob.stellar_usdc"

/** The store prices in AED minor units; the chain in raw test USDC (7 decimals). Fixed demo rate:
 *  150.00 AED = 40.80 USDC, so 1 fils = 27_200 raw. */
export const RAW_PER_STORE_MINOR = BigInt(process.env.UCP_RAW_PER_STORE_MINOR ?? 27_200)

export interface StoredClaim { group: GroupRef; root: string; nullifier: string; proof: { a: string; b: string; c: string } }

export interface Session {
  checkoutId: string
  claimed: boolean
  season: number
  /** Set once a proof checked out against the contract (simulation). */
  /** Claims the contract accepted (simulation), one per policy group; bps = stacked, capped discount. */
  verified?: { guest: string; claims: StoredClaim[]; bps: number; at: number }
  /** What the merchant admin co-signed for the Stellar rail. */
  quote?: { payer: string; amount: string; orderRef: string; itemsMinor: number; at: number }
  code?: { code: string; id: string; endsAt: string }
  /** Fresh per-purchase commitment the buyer wants added to the merchant tree once paid. */
  nextCommitment?: string
  paid?: { via: "stellar" | "card"; txHash?: string; order?: { id: string; name: string } | null; joinTx?: string; redeemTx?: string; at: number }
}

interface State {
  sessions: Record<string, Session>
  /** nullifier -> checkout id. A proof backs one live code at a time, and a paid one forever. */
  nullifiers: Record<string, string>
  /** Stellar payments already turned into an order. */
  usedTx: Record<string, string>
}

const DIR = process.env.UCP_DATA_DIR ?? "data"
const FILE = `${DIR}/state.json`
let state: State = { sessions: {}, nullifiers: {}, usedTx: {} }
try {
  state = JSON.parse(readFileSync(FILE, "utf8"))
} catch {}
export const save = () => {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(state, null, 1))
}
export const st = () => state

/** Checkout ids carry a `?key=` secret; sessions are keyed by the bare gid. */
export const sessionKey = (id: string) => id.split("?")[0]
export const session = (id: string): Session | undefined => state.sessions[sessionKey(id)]
export function openSession(id: string, claimed: boolean): Session {
  const k = sessionKey(id)
  const s = (state.sessions[k] ??= { checkoutId: k, claimed, season: currentSeason() })
  s.claimed ||= claimed
  save()
  return s
}

export const claims = (checkout: any): boolean => Array.isArray(checkout?.context?.eligibility) && checkout.context.eligibility.includes(NS)

/** What the business asks the buyer's agent to prove: one membership per policy group it qualifies for. */
export async function verificationAction(s: Session) {
  const m = await merchant()
  const p = await perks()
  const items = p?.items ?? [{ group: { kind: "merchant", id: MERCHANT } as GroupRef, bps: m.discountBps, name: "returning customer" }]
  const groups = []
  for (const it of items) {
    const t = await treeOf(it.group)
    groups.push({
      group: it.group,
      name: it.name,
      bps: it.bps,
      root: t.root,
      size: t.size,
      leaves: it.group.kind === "merchant" ? { contract_view: "get_leaves", args: { merchant: it.group.id } } : { contract_view: "get_group_leaves", args: { group: it.group.id } },
      scope_raw: toBeHex(ctxScope(MERCHANT, it.group, s.season), 32),
    })
  }
  return {
    type: "semaphore_v4_membership",
    network: "stellar:testnet",
    contract: NET.contractId,
    merchant_id: MERCHANT,
    season: s.season,
    tree_depth: 10,
    // Claim every group you are in: discounts add up to max_bps. Each proof binds the same payer.
    groups,
    max_bps: p?.maxBps ?? m.discountBps,
    scope: { kind: "discount", merchant: MERCHANT, season: s.season },
    message: { binds: "payer", formula: 'keccak256("pos/guest" || xdr(ScVal(payer)))', payer: "the Stellar address that pays this checkout" },
    artifacts: "https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-10.{wasm,zkey}",
    submit: { tool: "update_checkout", field: `checkout["${NS}"].proofs`, shape: [{ group: { kind: "merchant|group", id: 0 }, root: "decimal", nullifier: "decimal", proof: { a: "hex G1", b: "hex G2 (c1,c0)", c: "hex G1" } }], payer_field: `checkout["${NS}"].payer` },
    // kept for single-claim clients
    root: groups.find((g) => g.group.kind === "merchant")?.root ?? "0",
    tree_size: groups.find((g) => g.group.kind === "merchant")?.size ?? 0,
    discount_bps: m.discountBps,
  }
}

/** The extension object the business returns on every checkout response it has a session for. */
export async function extensionView(s: Session) {
  if (s.paid) return { status: "joined", paid: s.paid, season: s.season }
  if (s.verified && s.code) return { status: "verified", code: s.code.code, code_expires_at: s.code.endsAt, discount_bps: s.verified.bps, claims: s.verified.claims.map((c) => ({ group: c.group, nullifier: c.nullifier })), payer: s.verified.guest, apply: { tool: "update_checkout", field: "checkout.discounts.codes" } }
  if (s.claimed) return { status: "verification_required", action: await verificationAction(s) }
  return { status: "not_claimed" }
}

/** Rewrites a store checkout response: provisional discount + message while the claim is open. */
export async function decorate(checkout: any, s: Session | undefined) {
  if (!s || !checkout || typeof checkout !== "object") return checkout
  checkout[NS] = await extensionView(s)
  if (s.claimed && !s.verified && !s.paid) {
    const subtotal = checkout.totals?.find((t: any) => t.type === "subtotal")?.amount ?? 0
    const p = await perks()
    const bps = p ? Math.min(p.maxBps, p.items.reduce((a, it) => a + it.bps, 0)) : (await merchant()).discountBps
    checkout.discounts ??= { codes: [], applied: [] }
    checkout.discounts.applied = [
      ...(checkout.discounts.applied ?? []),
      { title: `context perks up to ${bps / 100}%`, amount: Math.floor((subtotal * bps) / 10_000), provisional: true, eligibility: NS },
    ]
    checkout.messages = [
      ...(checkout.messages ?? []),
      { type: "error", code: "eligibility_verification_required", path: `$.${NS}`, content: "Prove the perks you qualify for (past purchase here, network member, verified traveler) to apply the discount, or drop the claim.", severity: "recoverable" },
    ]
    // UCP: a business must not complete with unresolved eligibility claims.
    if (checkout.status === "ready_for_complete") checkout.status = "incomplete"
  }
  return checkout
}

export async function treeLeaves() {
  return leaves()
}
