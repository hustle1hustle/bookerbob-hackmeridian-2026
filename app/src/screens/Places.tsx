// Guest: all places. Hotels are the default view; other kinds one click away. Bob's ranking lives in Ask Bob (#/).
import { useMemo, useState } from "react"
import { USDC_DECIMALS } from "@bookerbob/pos-sdk"
import { listPlaces, type Place } from "../sdk"
import { useAsync } from "../store"
import { Empty, Loading } from "../ui"
import { PlaceList } from "../views/places"
import { Explainer } from "../views/explainer"

const usdc = (p: Place) => Number(p.price) / 10 ** USDC_DECIMALS

export function PlacesScreen() {
  const { data, error, loading } = useAsync(listPlaces, [])
  const [kind, setKind] = useState("hotel")
  const [max, setMax] = useState<number | null>(null)

  const kinds = useMemo(() => {
    const present = [...new Set((data ?? []).map((p) => p.kind))]
    const rest = present.filter((k) => k !== "hotel")
    return [...(present.includes("hotel") ? ["hotel"] : []), ...rest, "all"]
  }, [data])

  const ofKind = (data ?? []).filter((p) => kind === "all" || p.kind === kind)
  const cap = Math.ceil(Math.max(0, ...ofKind.map(usdc)))
  const maxPrice = max === null ? cap : Math.min(max, cap)
  const shown = ofKind.filter((p) => usdc(p) <= maxPrice)


  return (
    <>
      <h1>all places</h1>
      {loading && !data && <Loading what="places from Stellar testnet" />}
      {error && <Empty title="could not reach Stellar testnet">refresh to retry.</Empty>}
      {data && data.length === 0 && <Empty title="no places yet" />}

      {data && data.length > 0 && (
        <section className="section">
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
