// Landing: Ask Bob. Free text goes to sdk.search (server-ranked, federated); results keep the server order.
// Routes: #/ (empty), #/ask/<query> (shareable), Buy with Bob at #/buy/<merchantId>/<query>.
import { useEffect, useState } from "react"
import type { Perks } from "@bookerbob/pos-sdk"
import { demo } from "../demo"
import { sdk } from "../sdk"
import { go, useAsync, useWallet } from "../store"
import { Empty, Loading } from "../ui"
import { AskBox, AskHero, ResultCard } from "../views/askbob"
import { Explainer } from "../views/explainer"
import { PassConnectPanel } from "../views/PassConnect"

const examples = ["hotel in lisbon under 120", "hotel under 100", "coffee nearby", "restaurant dinner", "t-shirt under 50 usdc"]

export function AskBobScreen({ initial }: { initial: string }) {
  const start = initial || (demo.auto === "ask" ? (new URLSearchParams(location.search).get("q") ?? examples[0]) : "")
  const [input, setInput] = useState(start)
  const [asked, setAsked] = useState(start)
  const address = useWallet()
  const res = useAsync(() => (asked.trim() ? sdk.search.query(asked) : Promise.resolve(null)), [asked])
  // never show the previous query's results while a new one loads
  const current = res.data && res.data.query === asked ? res.data : null
  const ids = [...new Set((current?.results ?? []).map((r) => r.merchantId).filter((x): x is number => x !== null))]
  // perks depend on this browser's stays; re-read when the wallet changes too
  const perks = useAsync(async () => new Map<number, Perks | null>(await Promise.all(ids.map(async (id) => [id, await sdk.chain.perks(id)] as const))), [ids.join(","), address])

  const ask = (q: string) => {
    setInput(q)
    setAsked(q)
    if (q.trim()) history.replaceState(null, "", `#/ask/${encodeURIComponent(q)}`)
  }
  useEffect(() => setInput(start), [start])

  const results = current?.results ?? []
  return (
    <>
      <AskHero />
      <AskBox value={input} onChange={setInput} onAsk={() => ask(input)} onExample={ask} examples={examples} sources={current?.sources ?? null} busy={!!asked && !current && !res.error} />
      <PassConnectPanel />
      {asked && !current && !res.error && <Loading what="places and stores" />}
      {res.error && <Empty title="bob could not search right now">refresh to retry.</Empty>}
      {current && results.length === 0 && <Empty title="nothing matches yet">try a higher price or another kind.</Empty>}
      {results.length > 0 && (
        <div className="grid section">
          {results.map((r, i) => (
            <ResultCard
              key={`${r.source}-${r.merchantId ?? r.title}-${i}`}
              r={r}
              pick={i === 0}
              href={r.merchantId !== null ? `#/place/${r.merchantId}` : null}
              perks={r.merchantId === null ? undefined : perks.loading || !perks.data ? "loading" : (perks.data.get(r.merchantId) ?? null)}
              buy={
                // places: on-chain booking with perks; UCP hits: checkout through the UCP bridge
                r.source === "places" && r.merchantId !== null ? (
                  <button type="button" onClick={() => go(`#/buy/${r.merchantId}/${encodeURIComponent(asked)}`)}>
                    buy with bob
                  </button>
                ) : r.source === "ucp" && typeof r.extra?.variantId === "string" ? (
                  <button type="button" onClick={() => go(`#/buy-ucp/${encodeURIComponent(r.extra!.variantId as string)}/${encodeURIComponent(asked)}`)}>
                    buy with bob
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      )}
      {!asked && (
        <p className="section muted small">
          or browse <a href="#/places">all places</a>.
        </p>
      )}
      <div className="section">
        <Explainer compact />
      </div>
    </>
  )
}
