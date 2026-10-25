// Presentational: stays, commitment card, review form, discount summary, disclosure panel. Props only.
import type { ReactNode } from "react"
import { formatUsdc, kindLabel, type Merchant, type Stay } from "@bookerbob/pos-sdk"
import { CopyButton, Empty } from "../ui"
import type { DiscloseState } from "../flows"

export interface StayItemProps {
  stay: Stay
  place: Merchant | undefined
  href: string
  word: string
  /** Action links: write review, discount, disclose. */
  actions: ReactNode
}

export function StayItem({ stay, place, href, word, actions }: StayItemProps) {
  return (
    <article className="card">
      <p className="small muted">
        {place ? kindLabel(place.kind) : "place"} · {word} started {new Date(stay.createdAt).toLocaleDateString("en-GB")}
      </p>
      <h2>
        <a href={href}>{place?.name ?? `place #${stay.merchant}`}</a>
      </h2>
      <p className="row small">
        {stay.checkedIn ? <span className="tag ok">checked in, proven</span> : <span className="tag">waiting for checkout at the desk</span>}
        {stay.reviewId !== null && <span className="tag">reviewed</span>}
        {stay.discountSeasonsUsed.length > 0 && <span className="tag">discount used this season</span>}
      </p>
      <div className="row">{actions}</div>
    </article>
  )
}

export function StayList({ items, empty }: { items: ReactNode[]; empty: ReactNode }) {
  return items.length === 0 ? <>{empty}</> : <div className="list">{items}</div>
}

export interface CommitmentCardProps {
  commitment: string
  /** data: URL of the QR image, null while it renders. */
  qr: string | null
  checkedIn: boolean
}

/** What the guest shows at checkout. The commitment is the only thing the hotel receives. */
export function CommitmentCard({ commitment, qr, checkedIn }: CommitmentCardProps) {
  return (
    <section className="card">
      <h2>your stay code</h2>
      <p className="muted small">
        show this at checkout. the hotel adds it to its list of proven stays. it does not carry your name, and only this browser can prove it later.
      </p>
      <div className="row" style={{ alignItems: "flex-start" }}>
        {qr ? <img className="qr" src={qr} alt="QR code of your stay code" /> : <div className="qr" aria-hidden="true" />}
        <div style={{ flex: 1, minWidth: 220 }}>
          <p className="mono">{commitment}</p>
          <CopyButton text={commitment} label="copy stay code" />
        </div>
      </div>
      <p className="small">{checkedIn ? "checked in: this stay is proven." : "not checked in yet. once the desk confirms it, you can review and use returning-guest discounts."}</p>
    </section>
  )
}

export function StarPicker({ value, onChange, disabled }: { value: number; onChange: (n: 1 | 2 | 3 | 4 | 5) => void; disabled?: boolean }) {
  return (
    <div className="row" role="radiogroup" aria-label="rating">
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={n <= value ? "" : "secondary"}
          disabled={disabled}
          onClick={() => onChange(n)}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  )
}

export interface ReviewFormProps {
  placeName: string
  rating: number
  text: string
  onRating: (n: 1 | 2 | 3 | 4 | 5) => void
  onText: (t: string) => void
  onSubmit: () => void
  disabled: boolean
}

export function ReviewForm({ placeName, rating, text, onRating, onText, onSubmit, disabled }: ReviewFormProps) {
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <h2>review {placeName}</h2>
      <p className="muted small">one review per stay. it is posted with a proof that you stayed, never with who you are.</p>
      <StarPicker value={rating} onChange={onRating} disabled={disabled} />
      <label className="section" style={{ marginTop: 12 }}>
        <span className="small muted">what was it like</span>
        <textarea value={text} onChange={(e) => onText(e.target.value)} disabled={disabled} maxLength={1000} />
      </label>
      <p style={{ marginTop: 12 }}>
        <button type="submit" disabled={disabled || rating < 1}>
          prove my stay and post
        </button>
      </p>
    </form>
  )
}

export interface DiscountSummaryProps {
  placeName: string
  price: bigint
  discounted: bigint
  pct: string
  seasonText: string
  usedThisSeason: boolean
  onSubmit: () => void
  disabled: boolean
}

export function DiscountSummary({ placeName, price, discounted, pct, seasonText, usedThisSeason, onSubmit, disabled }: DiscountSummaryProps) {
  return (
    <section className="card">
      <h2>returning guest at {placeName}</h2>
      <p>
        <span className="strike">{formatUsdc(price)} USDC</span> <strong>{formatUsdc(discounted)} USDC</strong> <span className="muted small">{pct} off</span>
      </p>
      <p className="muted small">
        once per season ({seasonText}). the proof shows you stayed here before, not which stay. payment and proof go in one transaction.
      </p>
      {usedThisSeason && <p className="small">this stay already used its discount this season.</p>}
      <button type="button" onClick={onSubmit} disabled={disabled}>
        prove and book for {formatUsdc(discounted)} USDC
      </button>
    </section>
  )
}

export interface DisclosePanelProps {
  placeName: string
  reviewed: boolean
  state: DiscloseState
  onSend: () => void
}

export function DisclosePanel({ placeName, reviewed, state, onSend }: DisclosePanelProps) {
  if (!reviewed) return <Empty title="nothing to disclose yet">disclosure is for a review you wrote, if the hotel disputes it.</Empty>
  return (
    <section className="card">
      <h2>disclose to the arbiter</h2>
      <p className="muted small">
        if {placeName} disputes your review, you can show the arbiter, privately, that it is yours and the stay was real. the arbiter sees which checkout it was. the hotel and the public only see
        "verified stay".
      </p>
      {state.status === "sent" ? (
        <p className="note ok">sent to the arbiter. you will see "verified stay" on your review once it is checked.</p>
      ) : (
        <button type="button" onClick={onSend} disabled={state.status === "building"}>
          {state.status === "building" ? "signing in this browser" : "send to arbiter"}
        </button>
      )}
      {state.status === "error" && <p className="note warn">{state.copy}</p>}
    </section>
  )
}
