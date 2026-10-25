// UCP store checkout through the BookerBob UCP bridge (browser-callable, CORS *). Reference client:
// ucp-module/scripts/buy-rest.ts. Steps: /buy/start -> (/buy/prove) -> /buy/quote -> wallet signs -> /buy/send -> /buy/complete.
// The wallet signs through sdk.wallet.signTransaction and the stay identity comes from sdk.stays.identity.
import { getClient, views, TESTNET } from "../../packages/sdk/src/contract.ts"
import { discountMessage, discountScope } from "../../packages/sdk/src/derive.ts"
import { DEFAULT_ARTIFACTS_URL, loadArtifacts, proveMembership } from "../../packages/sdk/src/prove.ts"
import type { Stay } from "@bookerbob/pos-sdk"
import { sdk } from "./sdk"

export const UCP_BRIDGE = (import.meta.env.VITE_UCP_BRIDGE as string | undefined) ?? "https://bookerbob-ucp-bridge.fly.dev"

/** UCP amounts (subtotal, discounts) are in the store currency's minor units: 15000 AED minor = 150.00 AED. */
export const minor = (n: number | undefined) => (n === undefined ? "-" : (n / 100).toFixed(2))

export interface UcpStart {
  checkoutId: string
  currency: string
  subtotal: number
  provisionalDiscount: number
  action: { scope: { season: number } } | null
}
export interface UcpProve {
  verified: boolean
  discount: number
  applied: boolean
  subtotal: number
}
export interface UcpQuote {
  tx_xdr: string
  function: string
  amount_raw: string
  pays_raw: string
  order_ref: string
}
export interface UcpComplete {
  status: string
  receipt: unknown
  joined: boolean
}

/** A bridge step. Any response may be { error }; that becomes a thrown UcpError with the bridge's message. */
export class UcpError extends Error {}
async function post<T>(step: string, body: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(`${UCP_BRIDGE}/buy/${step}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  } catch {
    throw new UcpError("the store did not respond, retry")
  }
  const j = await r.json().catch(() => ({ error: `bad response (${r.status})` }))
  if (j?.error) throw new UcpError(`${step}: ${typeof j.error === "string" ? j.error : JSON.stringify(j.error)}`)
  return j as T
}

export const ucp = {
  start: (b: { variantId: string; qty?: number; claim: boolean; nextCommitment?: string }) => post<UcpStart>("start", b),
  prove: (b: { checkoutId: string; payer: string; root: string; nullifier: string; proof: { a: string; b: string; c: string } }) => post<UcpProve>("prove", b),
  quote: (b: { checkoutId: string; payer: string }) => post<{ quote: UcpQuote }>("quote", b).then((r) => r.quote),
  send: (b: { signedTxXdr: string }) => post<{ txHash: string; paid: string | number }>("send", b),
  complete: (b: { checkoutId: string; txHash: string }) => post<UcpComplete>("complete", b),
}

let netP: Promise<{ rpcUrl: string; networkPassphrase: string; contractId: string }> | null = null
const network = () => (netP ??= fetch("/api/config").then((r) => r.json()).then((c) => ({ ...TESTNET, ...c })))

/**
 * Prove membership in the store's tree with a checked-in local stay, for the store's discount scope.
 * Same derivation the SDK uses (identity from the browser's master secret, discount message bound to the payer).
 */
export async function proveStoreClaim(stay: Stay, payer: string, season: number, onDownload?: (loaded: number, total: number) => void) {
  const net = await network()
  const leaves = await views.leaves(await getClient(net), stay.merchant)
  const artifacts = await loadArtifacts(DEFAULT_ARTIFACTS_URL, onDownload)
  const mp = await proveMembership(sdk.stays.identity(stay), leaves, discountMessage(payer), discountScope(stay.merchant, season), artifacts)
  return { root: mp.root.toString(), nullifier: mp.nullifier.toString(), proof: mp.proof }
}

/** Sign the quote envelope with the connected wallet (source = payer). The envelope already carries the merchant's auth. */
export async function signEnvelope(xdr: string): Promise<string> {
  try {
    return await sdk.wallet.signTransaction(xdr)
  } catch (e) {
    throw new UcpError(e instanceof Error ? e.message : "signing was cancelled")
  }
}
