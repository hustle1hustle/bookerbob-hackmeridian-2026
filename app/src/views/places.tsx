// Presentational: places list, place header, review item, booking panel. Props only.
import type { ReactNode } from "react"
import { averageRating, formatUsdc, kindLabel, type Merchant, type Review } from "@bookerbob/pos-sdk"
import { Empty, Stars, TxLink, VerifiedStay, ago, plural } from "../ui"

const stayNoun = (kind: string) => (kind === "hotel" ? "proven stay" : kind === "shop" ? "proven purchase" : "proven visit")
export const discountPct = (bps: number) => `${Math.round(bps / 100)}%`

/** Verified rating: average of proven reviews only. Zero reviews is a state, never "0.0". */
export function RatingLine({ place }: { place: Merchant }) {
  const avg = averageRating(place)
  if (avg === null) return <p className="muted">no proven reviews yet</p>
  return (
    <p className="row">
      <Stars value={avg} />
      <strong>{avg.toFixed(1)}</strong>
      <span className="muted small">
        from {plural(place.ratingCount, "proven review")}
        {place.verifiedCount > 0 && `, ${place.verifiedCount} verified by an arbiter`}
      </span>
    </p>
  )
}

export function PlaceCard({ place, href }: { place: Merchant; href: string }) {
  return (
    <article className="card">
      <p className="small muted">{kindLabel(place.kind)}</p>
      <h2>
        <a href={href}>{place.name}</a>
      </h2>
      <RatingLine place={place} />
      <p className="small muted">{place.provenStays > 0 ? plural(place.provenStays, stayNoun(place.kind)) : `no ${stayNoun(place.kind)}s yet`}</p>
      <p className="row">
        <strong>{formatUsdc(place.price)} USDC</strong>
        {place.discountBps > 0 && <span className="tag">returning guests {discountPct(place.discountBps)} off</span>}
      </p>
    </article>
  )
}

export interface PlaceListProps {
  places: Merchant[]
  kinds: string[]
  kind: string
  onKind: (k: string) => void
  maxPrice: number
  priceCap: number
  onMaxPrice: (usdc: number) => void
  hrefFor: (p: Merchant) => string
}

export function PlaceList({ places, kinds, kind, onKind, maxPrice, priceCap, onMaxPrice, hrefFor }: PlaceListProps) {
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="row" role="group" aria-label="kind of place">
          {kinds.map((k) => (
            <button key={k} type="button" className={k === kind ? "" : "secondary"} aria-pressed={k === kind} onClick={() => onKind(k)}>
              {k === "all" ? "all places" : kindLabel(k)}
            </button>
          ))}
        </div>
        <label className="row small">
          max price
          <input type="range" min={0} max={priceCap} step={1} value={maxPrice} onChange={(e) => onMaxPrice(Number(e.target.value))} />
          <output>{maxPrice} USDC</output>
        </label>
      </div>
      {places.length === 0 ? (
        <Empty title="nothing under this price">raise the max price to see more places.</Empty>
      ) : (
        <div className="grid">
          {places.map((p) => (
            <PlaceCard key={p.id} place={p} href={hrefFor(p)} />
          ))}
        </div>
      )}
    </>
  )
}

export function PlaceHeader({ place, aside }: { place: Merchant; aside?: ReactNode }) {
  return (
    <header className="section" style={{ marginTop: 0 }}>
      <p className="small muted">{kindLabel(place.kind)}</p>
      <h1>{place.name}</h1>
      <RatingLine place={place} />
      <p className="small muted">{place.provenStays > 0 ? plural(place.provenStays, stayNoun(place.kind)) : `no ${stayNoun(place.kind)}s yet`}</p>
      {aside}
    </header>
  )
}

export interface ReviewItemProps {
  review: Review
  txHref: string | null
  /** Hotel view: the dispute control for this review. */
  action?: ReactNode
}

/** No author, ever. Stars, text or "text unavailable", proof link, verified mark, age. */
export function ReviewItem({ review, txHref, action }: ReviewItemProps) {
  return (
    <article className="card">
      <div className="row">
        <Stars value={review.rating} />
        {review.verified && <VerifiedStay />}
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {ago(review.time, review.ledger)}
        </span>
      </div>
      {review.text ? <p>{review.text}</p> : <p className="muted">text unavailable</p>}
      <div className="row">
        <TxLink href={txHref} hash={review.txHash} />
        {action}
      </div>
    </article>
  )
}

export function ReviewFeed({ reviews, txHrefFor, actionFor }: { reviews: Review[]; txHrefFor: (r: Review) => string | null; actionFor?: (r: Review) => ReactNode }) {
  if (reviews.length === 0) return <Empty title="no proven reviews yet">reviews appear here once a checked-in guest proves their stay.</Empty>
  return (
    <div className="list">
      {reviews.map((r) => (
        <ReviewItem key={r.id} review={r} txHref={txHrefFor(r)} action={actionFor?.(r)} />
      ))}
    </div>
  )
}
