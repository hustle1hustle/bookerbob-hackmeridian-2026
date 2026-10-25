// Guest: hero, "ask bob", places list. Hotels are the default view; other kinds one click away.
// Ask bob runs the agent's rank() (shared with the CLI) and sorts the list by Bob's ranking.
import { useMemo, useState } from "react"
import { USDC_DECIMALS, type Review } from "@bookerbob/pos-sdk"
import { parseQuery, pickHeadline, rank } from "@bookerbob/agent"
import { demo } from "../demo"
import { getPlaceReviews, listPlaces, type Place } from "../sdk"
import { useAsync } from "../store"
import { Empty, Loading } from "../ui"
import { PlaceCard, PlaceList } from "../views/places"
import { AskBob, BobPick, Hero } from "../views/bob"
import { Explainer } from "../views/explainer"

const usdc = (p: Place) => Number(p.price) / 10 ** USDC_DECIMALS
const examples = ["hotel under 120", "cafe", "shop under 50"]
/** ?auto=ask&q=... pre-runs a query (demo recording, screenshots). */
const initialAsk = demo.auto === "ask" ? (new URLSearchParams(location.search).get("q") ?? "hotel under 120") : ""

export function PlacesScreen() {
  const { data, error, loading } = useAsync(listPlaces, [])
  const ids = (data ?? []).map((p) => p.id).join(",")
  const reviews = useAsync(async (): Promise<Review[]> => (data ? (await Promise.all(data.map((p) => getPlaceReviews(p.id)))).flat() : []), [ids])
  const [kind, setKind] = useState("hotel")
  const [max, setMax] = useState<number | null>(null)
  const [input, setInput] = useState(initialAsk)
  const [asked, setAsked] = useState(input)

  const kinds = useMemo(() => {
    const present = [...new Set((data ?? []).map((p) => p.kind))]
    const rest = present.filter((k) => k !== "hotel")
    return [...(present.includes("hotel") ? ["hotel"] : []), ...rest, "all"]
  }, [data])

  const ofKind = (data ?? []).filter((p) => kind === "all" || p.kind === kind)
  const cap = Math.ceil(Math.max(0, ...ofKind.map(usdc)))
  const maxPrice = max === null ? cap : Math.min(max, cap)
  const shown = ofKind.filter((p) => usdc(p) <= maxPrice)

  const query = asked.trim() ? parseQuery(asked) : null
  const ranked = query && data && reviews.data && !reviews.loading ? rank(data, reviews.data, query) : null

  return (
    <>
      <Hero />
      <AskBob
        value={input}
        onChange={setInput}
        onAsk={() => setAsked(input)}
        onExample={(x) => {
          setInput(x)
          setAsked(x)
        }}
        onClear={() => {
          setInput("")
          setAsked("")
        }}
        examples={examples}
        active={!!query}
      />
      {loading && !data && <Loading what="places from Stellar testnet" />}
      {error && <Empty title="could not reach Stellar testnet">refresh to retry.</Empty>}
      {data && data.length === 0 && <Empty title="no places yet" />}

      {query && data && (
        <section className="section">
          {!ranked ? (
            <Loading what="proven reviews" />
          ) : (
            <>
              <BobPick pick={ranked[0] ?? null} headline={pickHeadline(query)} href={ranked[0] ? `#/place/${ranked[0].place.id}` : "#/"} />
              {ranked.length > 0 && (
                <div className="grid section" style={{ marginTop: 12 }}>
                  {ranked.map((r, i) => (
                    <PlaceCard key={r.place.id} place={r.place} href={`#/place/${r.place.id}`} note={`#${i + 1}, ${r.reason}`} picked={i === 0} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!query && data && data.length > 0 && (
        <section className="section">
          <h2>places with proven reviews</h2>
          <p className="muted">every rating here comes from a guest who proved they stayed. nobody, including us, knows which guest wrote what.</p>
          <PlaceList
            places={shown}
            kinds={kinds}
            kind={kind}
            onKind={(k) => {
              setKind(k)
              setMax(null)
            }}
            maxPrice={maxPrice}
            priceCap={cap}
            onMaxPrice={setMax}
            hrefFor={(p) => `#/place/${p.id}`}
          />
        </section>
      )}
      <div className="section">
        <Explainer compact />
      </div>
    </>
  )
}
