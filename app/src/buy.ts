// "Buy with Bob": the agent run as an explicit state machine. Every step is a real call:
// parse + search (server /api/search), rank (server ranking), perks (chain.perks), prove (prover events),
// pay (book_with_context or book). The view renders BuyState and never touches the SDK.
import { useCallback, useEffect, useRef, useState } from "react"
import { errorCopy, isErr, nullifierCopy, type ErrorName, type Perks, type SearchResponse, type SearchResult, type Usdc } from "@bookerbob/pos-sdk"
import { SEASON, sdk } from "./sdk"
import { bump } from "./store"

export type BuyStep = "parse" | "search" | "rank" | "perks" | "prove" | "pay" | "done"
export const buySteps: BuyStep[] = ["parse", "search", "rank", "perks", "prove", "pay", "done"]

export type BuyPhase = "idle" | "needsWallet" | BuyStep | "alreadyDone" | "error"

export interface BuyState {
  phase: BuyPhase
  /** Steps finished so far, with a one-line detail each. "skipped" steps are marked done with a detail. */
  done: Partial<Record<BuyStep, string>>
  search?: SearchResponse
  hit?: SearchResult
  rankIndex?: number
  perks?: Perks | null
  download?: { loaded: number; total: number }
  result?: { txHash: string; paid: Usdc; saved?: Usdc; bps?: number }
  error?: { name: ErrorName; copy: string }
}

export const describeParse = (p: SearchResponse["parsed"]) =>
  [p.kind ? `kind ${p.kind}` : "any kind", p.maxPrice !== null ? `under ${p.maxPrice} USDC` : "no price cap", p.terms.length ? `terms: ${p.terms.join(" ")}` : ""].filter(Boolean).join(", ")
export const describeSources = (s: SearchResponse["sources"]) => s.map((x) => `${x.id} ${x.status === "ok" ? x.count : x.status}`).join(", ")
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`

export function useBuyFlow(merchantId: number, query: string) {
  const [state, setState] = useState<BuyState>({ phase: "idle", done: {} })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const off = sdk.wallet.onChange((a) => a && setState((s) => (s.phase === "needsWallet" ? { phase: "idle", done: {} } : s)))
    return () => {
      alive.current = false
      off()
    }
  }, [])
  const set = (f: (s: BuyState) => BuyState) => alive.current && setState(f)
  const fail = (name: ErrorName, perks: boolean) =>
    set((s) =>
      name === "WalletNotConnected"
        ? { ...s, phase: "needsWallet" }
        : name === "NullifierUsed" && perks
          ? { ...s, phase: "alreadyDone", error: { name, copy: `${nullifierCopy.discount}: your perks here are used for this season` } }
          : { ...s, phase: "error", error: { name, copy: errorCopy[name] ?? errorCopy.Unknown } },
    )

  const run = useCallback(async () => {
    if (!sdk.wallet.address) return set(() => ({ phase: "needsWallet", done: {} }))
    try {
      set(() => ({ phase: "parse", done: {} }))
      const search = await sdk.search.query(query)
      set((s) => ({ ...s, phase: "search", search, done: { ...s.done, parse: describeParse(search.parsed) } }))
      set((s) => ({ ...s, phase: "rank", done: { ...s.done, search: describeSources(search.sources) } }))
      const idx = search.results.findIndex((r) => r.merchantId === merchantId)
      const hit = idx >= 0 ? search.results[idx] : undefined
      const place = hit ? null : await sdk.chain.getMerchant(merchantId)
      const rankLine = hit ? `#${idx + 1} of ${search.results.length}: ${hit.reason}` : `${place?.name ?? "this place"} is not in this search's results; buying it directly`
      set((s) => ({ ...s, phase: "perks", hit, rankIndex: idx, done: { ...s.done, rank: rankLine } }))

      const perks = await sdk.chain.perks(merchantId)
      const eligible = perks?.items.filter((i) => i.eligible) ?? []
      const perksLine = !perks ? "no perks policy at this place" : eligible.length ? `${eligible.map((i) => `${i.label} ${pct(i.bps)}`).join(" + ")} = ${pct(perks.bps)} off` : "no perks earned here yet"
      set((s) => ({ ...s, perks, done: { ...s.done, perks: perksLine } }))

      if (perks && perks.bps > 0) {
        set((s) => ({ ...s, phase: "prove" }))
        for await (const ev of sdk.prover.prove({ kind: "context", merchant: merchantId, season: SEASON })) {
          if (ev.stage === "download") set((s) => ({ ...s, phase: "prove", download: { loaded: ev.loaded, total: ev.total } }))
          else if (ev.stage === "proving") set((s) => ({ ...s, phase: "prove" }))
          else if (ev.stage === "verifying")
            set((s) => ({ ...s, phase: "pay", done: { ...s.done, prove: `${eligible.length} membership ${eligible.length === 1 ? "proof" : "proofs"}, made in this browser` } }))
          else {
            const r = ev.result
            if (isErr(r)) return fail(r.error, true)
            const ok = r as { txHash: string; paid: Usdc; saved: Usdc; bps: number }
            set((s) => ({ ...s, phase: "done", result: ok, done: { ...s.done, pay: `paid ${fmt(ok.paid)} USDC, saved ${fmt(ok.saved)}`, done: "" } }))
          }
        }
      } else {
        set((s) => ({ ...s, phase: "pay", done: { ...s.done, prove: "skipped: nothing to prove, paying full price" } }))
        const r = await sdk.chain.book(merchantId)
        if (isErr(r)) return fail(r.error, false)
        set((s) => ({ ...s, phase: "done", result: r, done: { ...s.done, pay: `paid ${fmt(r.paid)} USDC`, done: "" } }))
      }
    } catch (e) {
      console.error("[buy]", e)
      fail(e instanceof TypeError ? "Network" : "Unknown", false)
    } finally {
      bump()
      setTimeout(bump, 6000) // the balance view settles a ledger later
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, query])

  return { state, run, reset: () => setState({ phase: "idle", done: {} }) }
}

const fmt = (v: Usdc) => (Number(v) / 1e7).toFixed(2)
