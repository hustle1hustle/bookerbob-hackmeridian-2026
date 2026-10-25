// Buy with Bob, UCP store branch, as an explicit state machine:
// parse + search + rank (server), start checkout, prove (only with a claim), quote, sign, pay, complete.
import { useCallback, useEffect, useRef, useState } from "react"
import { errorCopy, isErr, type SearchResult } from "@bookerbob/pos-sdk"
import { describeParse, describeSources } from "./buy"
import { faucet, sdk } from "./sdk"
import { bump } from "./store"
import { UcpError, minor, proveStoreClaim, signEnvelope, ucp, type UcpComplete, type UcpProve, type UcpQuote, type UcpStart } from "./ucp"

export type UcpStep = "parse" | "search" | "rank" | "start" | "prove" | "quote" | "sign" | "pay" | "complete" | "done"
export const ucpSteps: { id: UcpStep; label: string }[] = [
  { id: "parse", label: "parse intent" },
  { id: "search", label: "search sources" },
  { id: "rank", label: "rank by proven reviews" },
  { id: "start", label: "start checkout" },
  { id: "prove", label: "prove past purchase" },
  { id: "quote", label: "quote in USDC" },
  { id: "sign", label: "sign in this browser" },
  { id: "pay", label: "pay in USDC on Stellar" },
  { id: "complete", label: "complete order" },
  { id: "done", label: "done" },
]

export interface UcpBuyState {
  phase: "idle" | "needsWallet" | UcpStep | "error"
  done: Partial<Record<UcpStep, string>>
  hit?: SearchResult
  checkout?: UcpStart
  claim?: boolean
  proved?: UcpProve
  quote?: UcpQuote
  txHash?: string
  paidRaw?: string
  complete?: UcpComplete
  download?: { loaded: number; total: number }
  error?: { copy: string }
}

export const usdcRaw = (raw: string | number | undefined) => (raw === undefined ? "-" : (Number(raw) / 1e7).toFixed(2))

export function useUcpBuyFlow(variantId: string, query: string) {
  const [state, setState] = useState<UcpBuyState>({ phase: "idle", done: {} })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const off = sdk.wallet.onChange((a) => a && setState((s) => (s.phase === "needsWallet" ? { phase: "idle", done: {} } : s)))
    return () => {
      alive.current = false
      off()
    }
  }, [])
  const set = (f: (s: UcpBuyState) => UcpBuyState) => alive.current && setState(f)

  const run = useCallback(async () => {
    const payer = sdk.wallet.address
    if (!payer) return set(() => ({ phase: "needsWallet", done: {} }))
    try {
      set(() => ({ phase: "parse", done: {} }))
      const search = await sdk.search.query(query)
      const idx = search.results.findIndex((r) => r.source === "ucp" && r.extra?.variantId === variantId)
      const hit = idx >= 0 ? search.results[idx] : undefined
      if (!hit) throw new UcpError("this item is not in the results for this search any more")
      const merchant = hit.merchantId
      set(() => ({
        phase: "start",
        hit,
        done: { parse: describeParse(search.parsed), search: describeSources(search.sources), rank: `#${idx + 1} of ${search.results.length}: ${hit.reason}` },
      }))

      // the payer needs test USDC and the USDC trustline; the faucet adds both
      const bal = (await sdk.chain.balance()) ?? 0n
      if (bal === 0n) {
        const f = await faucet()
        if (isErr(f)) throw new UcpError(errorCopy[f.error] ?? errorCopy.Unknown)
      }

      // claim only with a checked-in stay at this store; always join its tree with a fresh stay once paid
      const perks = merchant !== null ? await sdk.chain.perks(merchant) : null
      const returning = perks?.items.find((i) => i.group.kind === "merchant" && i.group.id === merchant)
      if (merchant !== null) await sdk.stays.sync()
      const past = merchant !== null ? sdk.stays.list().find((s) => s.merchant === merchant && s.checkedIn) : undefined
      // a checked-in stay at the store is the claim; an on-chain policy line, when present, must agree
      const claim = !!past && (returning ? returning.eligible : true)
      const next = merchant !== null ? sdk.stays.create(merchant).commitment : undefined
      bump()
      const checkout = await ucp.start({ variantId, qty: 1, claim, nextCommitment: next })
      set((s) => ({
        ...s,
        phase: "prove",
        checkout,
        claim,
        done: { ...s.done, start: `${minor(checkout.subtotal)} ${checkout.currency}${checkout.provisionalDiscount ? `, returning-customer discount if proven ${minor(checkout.provisionalDiscount)} ${checkout.currency}` : ""}` },
      }))

      if (claim && past && checkout.action) {
        const p = await proveStoreClaim(past, payer, checkout.action.scope.season, (loaded, total) => set((s) => ({ ...s, download: { loaded, total } })))
        const proved = await ucp.prove({ checkoutId: checkout.checkoutId, payer, ...p })
        set((s) => ({ ...s, phase: "quote", proved, done: { ...s.done, prove: proved.applied ? `verified, ${minor(proved.discount)} ${checkout.currency} off` : "proof checked, no discount applied" } }))
      } else {
        set((s) => ({ ...s, phase: "quote", done: { ...s.done, prove: "skipped: no past purchase here to prove, full price" } }))
      }

      const quote = await ucp.quote({ checkoutId: checkout.checkoutId, payer })
      set((s) => ({ ...s, phase: "sign", quote, done: { ...s.done, quote: `${usdcRaw(quote.pays_raw)} USDC (${quote.function})` } }))
      const signed = await signEnvelope(quote.tx_xdr)
      set((s) => ({ ...s, phase: "pay", done: { ...s.done, sign: `signed by ${sdk.wallet.kind === "local" ? "the demo key" : sdk.wallet.kind}` } }))
      const sent = await ucp.send({ signedTxXdr: signed })
      set((s) => ({ ...s, phase: "complete", txHash: sent.txHash, paidRaw: String(sent.paid), done: { ...s.done, pay: `paid ${usdcRaw(sent.paid)} USDC` } }))
      const complete = await ucp.complete({ checkoutId: checkout.checkoutId, txHash: sent.txHash })
      set((s) => ({ ...s, phase: "done", complete, done: { ...s.done, complete: `${complete.status}${complete.joined ? ", you joined the store's proven customers" : ""}`, done: "" } }))
    } catch (e) {
      console.error("[ucp buy]", e)
      set((s) => ({ ...s, phase: "error", error: { copy: e instanceof UcpError ? e.message : errorCopy.Unknown } }))
    } finally {
      bump()
      setTimeout(bump, 6000) // the balance view settles a ledger later
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId, query])

  return { state, run }
}
