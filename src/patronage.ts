// com.bookerbob.patronage: a UCP checkout extension. The buyer claims "I bought here before"
// in context.eligibility; the business answers with a verification action; the buyer's agent
// answers with a Semaphore v4 membership proof against the merchant's on-chain tree. The
// business never learns which past order, or which person, the proof stands for.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { toBeHex } from "ethers/utils"
import { MERCHANT, NET, currentSeason, discountScope, leaves, merchant } from "./core.ts"

export const NS = "com.bookerbob.patronage"
export const EXT_VERSION = "2026-10-25"
export const STELLAR_HANDLER_ID = "stellar.usdc"
export const STELLAR_HANDLER_NS = "com.bookerbob.stellar_usdc"

/** The store prices in AED; the core merchant holds one price in test USDC. Fixed demo rate. */
export const STORE_TOTAL_FOR_PRICE = Number(process.env.UCP_STORE_PRICE_MINOR ?? 15000) // 150.00 AED

export interface Session {
  checkoutId: string
  claimed: boolean
  season: number
  /** Set once a proof checked out against the contract (simulation). */
  verified?: { guest: string; nullifier: string; root: string; amount: string; at: number }
  code?: { code: string; id: string; endsAt: string }
  /** Fresh per-purchase commitment the buyer wants added to the merchant tree once paid. */
  nextCommitment?: string
  paid?: { via: "stellar" | "card"; txHash?: string; order?: { id: string; name: string } | null; joinTx?: string; at: number }
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

/** What the business asks the buyer's agent to prove. Everything here is public. */
export async function verificationAction(s: Session) {
  const m = await merchant()
  const scope = discountScope(MERCHANT, s.season)
  return {
    type: "semaphore_v4_membership",
    network: "stellar:testnet",
    contract: NET.contractId,
    merchant_id: MERCHANT,
    // Proofs are checked against the contract's root history; this is the current root.
    root: m.root,
    tree_size: m.provenStays,
    tree_depth: 10,
    leaves: { contract_view: "get_leaves", args: { merchant: MERCHANT } },
    scope: { kind: "discount", merchant: MERCHANT, season: s.season, raw: toBeHex(scope, 32), formula: 'keccak256("pos/discount" || be32(merchant) || be32(season))' },
    message: { binds: "payer", formula: 'keccak256("pos/guest" || xdr(ScVal(payer)))', payer: "the Stellar address that pays this checkout" },
    artifacts: "https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-10.{wasm,zkey}",
    submit: { tool: "update_checkout", field: `checkout["${NS}"].proof`, shape: { payer: "G...", root: "decimal", nullifier: "decimal", proof: { a: "hex G1", b: "hex G2 (c1,c0)", c: "hex G1" } } },
    discount_bps: m.discountBps,
  }
}

/** The extension object the business returns on every checkout response it has a session for. */
export async function extensionView(s: Session) {
  if (s.paid) return { status: "joined", paid: s.paid, season: s.season }
  if (s.verified && s.code) return { status: "verified", code: s.code.code, code_expires_at: s.code.endsAt, nullifier: s.verified.nullifier, payer: s.verified.guest, amount_usdc_raw: s.verified.amount, apply: { tool: "update_checkout", field: "checkout.discounts.codes" } }
  if (s.claimed) return { status: "verification_required", action: await verificationAction(s) }
  return { status: "not_claimed" }
}

/** Rewrites a store checkout response: provisional discount + message while the claim is open. */
export async function decorate(checkout: any, s: Session | undefined) {
  if (!s || !checkout || typeof checkout !== "object") return checkout
  checkout[NS] = await extensionView(s)
  if (s.claimed && !s.verified && !s.paid) {
    const subtotal = checkout.totals?.find((t: any) => t.type === "subtotal")?.amount ?? 0
    const bps = (await merchant()).discountBps
    checkout.discounts ??= { codes: [], applied: [] }
    checkout.discounts.applied = [
      ...(checkout.discounts.applied ?? []),
      { title: `returning customer ${bps / 100}%`, amount: Math.floor((subtotal * bps) / 10_000), provisional: true, eligibility: NS },
    ]
    checkout.messages = [
      ...(checkout.messages ?? []),
      { type: "error", code: "eligibility_verification_required", path: `$.${NS}`, content: "Prove a past purchase at this store to apply the returning-customer discount, or drop the claim.", severity: "recoverable" },
    ]
    // UCP: a business must not complete with unresolved eligibility claims.
    if (checkout.status === "ready_for_complete") checkout.status = "incomplete"
  }
  return checkout
}

export async function treeLeaves() {
  return leaves()
}
