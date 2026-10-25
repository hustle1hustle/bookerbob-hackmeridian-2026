// Presentational: Ask Bob landing (hero, box, chips, sources), result cards with perks, Buy with Bob timeline and cart.
// Props only, no SDK access.
import type { ReactNode } from "react"
import { formatUsdc, kindLabel, type Perks, type SearchResponse, type SearchResult } from "@bookerbob/pos-sdk"
import type { BuyState, BuyStep } from "../buy"
import { Stars, TxLink } from "../ui"

export function AskHero() {
  return (
    <div className="hero-copy">
      <span className="label hero-eb">proof of loyalty · everywhere you go</span>
      <h1 className="statement">
        BookerBob. <em>Google for agentic commerce.</em>
      </h1>
      <p className="hero-sub">Proof of loyalty, everywhere you go. Bob ranks places by reviews nobody can buy, and your proven stays unlock perks wherever you book.</p>
      <p className="hero-proof">
        <span>live on Stellar testnet.</span>
      </p>
    </div>
  )
}

export interface AskBoxProps {
  value: string
  onChange: (v: string) => void
  onAsk: () => void
  onExample: (q: string) => void
  examples: string[]
  sources: SearchResponse["sources"] | null
  busy: boolean
}

export function AskBox({ value, onChange, onAsk, onExample, examples, sources, busy }: AskBoxProps) {
  return (
    <form
      className="card ask-bob"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onAsk()
      }}
    >
      <span className="label">ask bob</span>
      <label htmlFor="ask-bob" className="sr">
        ask bob
      </label>
      <div className="row" style={{ marginTop: 8 }}>
        <input id="ask-bob" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="hotel in lisbon under 120" style={{ flex: 1, minWidth: 200 }} />
        <button type="submit" disabled={busy || value.trim() === ""}>
          {busy ? "asking" : "ask"}
        </button>
      </div>
      <div className="row small" style={{ marginTop: 8 }}>
        {examples.map((x) => (
          <button key={x} type="button" className="secondary" onClick={() => onExample(x)}>
            {x}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        ranked by proven reviews only. reviews nobody can buy.
        {sources && <> sources: {sources.map((s) => `${s.id} ${s.status === "ok" ? "ok" : s.status}`).join(", ")}.</>}
      </p>
    </form>
  )
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`

/** "your perks here": eligible lines checked, others greyed with what would earn them. */
export function PerksList({ perks }: { perks: Perks }) {
  return (
    <div className="small">
      <p>
        <strong>your perks here</strong>
      </p>
      <ul className="steps">
        {perks.items.map((p, i) => (
          <li key={i} data-state={p.eligible ? "done" : "todo"}>
            {p.eligible ? "✓" : "○"} {p.label} {pct(p.bps)} off{!p.eligible && <span className="muted"> (earn it with {earnHint(p.group.kind, p.label)})</span>}
          </li>
        ))}
      </ul>
      <p>
        {perks.bps > 0 && <span className="strike">{formatUsdc(perks.price)}</span>} <strong>{formatUsdc(perks.finalPrice)} USDC</strong>
        {perks.bps > 0 && <span className="muted"> ({pct(perks.bps)} off, up to {pct(perks.maxBps)})</span>}
      </p>
    </div>
  )
}
const earnHint = (kind: string, label: string) =>
  kind === "merchant" ? (label.startsWith("returning") ? "a proven past stay here" : "a proven stay at that place") : `a proven stay in the ${label}`

export interface ResultCardProps {
  r: SearchResult
  pick: boolean
  href: string | null
  /** undefined = not tied to a merchant; null = no perks policy; "loading" while it is read. */
  perks: Perks | null | undefined | "loading"
  buy: ReactNode
}

export function ResultCard({ r, pick, href, perks, buy }: ResultCardProps) {
  const ucp = r.extra?.ucp as string | undefined
  return (
    <article className="card" data-picked={pick ? "true" : undefined}>
      <p className="small muted row">
        <span>{kindLabel(r.kind)}</span>
        <span className="tag">{r.source === "places" ? "place" : r.source === "ucp" ? "UCP store" : r.source}</span>
        {pick && <strong>Bob's pick</strong>}
      </p>
      {r.imageUrl && <img src={r.imageUrl} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 6 }} />}
      <h2>{href ? <a href={href}>{r.title}</a> : r.title}</h2>
      {r.provenRating !== null ? (
        <p className="row">
          <Stars value={r.provenRating} /> <span className="small">{r.reason}</span>
        </p>
      ) : (
        <p className="muted small">no proven reviews yet</p>
      )}
      <p>
        <strong>{r.price.toFixed(2)} {r.currency}</strong>
      </p>
      {perks === "loading" && <p className="small muted">checking your perks here</p>}
      {perks && perks !== "loading" && <PerksList perks={perks} />}
      <div className="row">
        {buy}
        {r.url && (
          <a className="btn secondary" href={r.url} target="_blank" rel="noreferrer">
            open in store
          </a>
        )}
        {ucp && (
          <a className="small" href={ucp} target="_blank" rel="noreferrer">
            UCP profile
          </a>
        )}
      </div>
    </article>
  )
}

const stepLabel: Record<BuyStep, string> = {
  parse: "parse intent",
  search: "search sources",
  rank: "rank by proven reviews",
  perks: "check your perks",
  prove: "prove membership",
  pay: "pay in USDC on Stellar",
  done: "done",
}
const order: BuyStep[] = ["parse", "search", "rank", "perks", "prove", "pay", "done"]

export function BuyTimeline({ state, txHref }: { state: BuyState; txHref: string | null }) {
  const at = order.indexOf(state.phase as BuyStep)
  const failedAt = state.phase === "error" || state.phase === "alreadyDone" ? order.findIndex((s) => state.done[s] === undefined) : -1
  return (
    <ol className="steps" aria-live="polite">
      {order.map((s, i) => {
        const finished = state.done[s] !== undefined
        const active = !finished && (i === at || i === failedAt)
        const detail =
          state.done[s] ||
          (active && s === "prove" && state.download && state.download.total > 0 ? `fetching proving files, ${(state.download.loaded / 1e6).toFixed(1)} of ${(state.download.total / 1e6).toFixed(1)} MB` : "")
        return (
          <li key={s} data-state={finished ? "done" : active ? "active" : "todo"}>
            {stepLabel[s]} {detail && <span className="small muted">{detail}</span>}
            {s === "done" && finished && state.result && (
              <>
                {" "}
                <TxLink href={txHref} hash={state.result.txHash}>
                  payment on Stellar
                </TxLink>
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function Cart({ title, perks, listPrice, result }: { title: string; perks: Perks | null | undefined; listPrice: bigint | null; result?: BuyState["result"] }) {
  const price = perks?.price ?? listPrice
  return (
    <aside className="card">
      <h3>cart</h3>
      <p>{title}</p>
      {price !== null && price !== undefined && (
        <p className="small">
          list price <strong>{formatUsdc(price)} USDC</strong>
        </p>
      )}
      {perks?.items
        .filter((i) => i.eligible)
        .map((i, k) => (
          <p key={k} className="small">
            {i.label}: -{pct(i.bps)} ({formatUsdc((perks.price * BigInt(i.bps)) / 10_000n)} USDC)
          </p>
        ))}
      {perks && perks.bps > 0 && perks.bps < perks.items.filter((i) => i.eligible).reduce((a, i) => a + i.bps, 0) && <p className="small muted">capped at {pct(perks.maxBps)}</p>}
      <p>
        final price <strong>{result ? formatUsdc(result.paid) : perks ? formatUsdc(perks.finalPrice) : price != null ? formatUsdc(price) : "-"} USDC</strong>
        {result && <span className="small"> paid</span>}
      </p>
    </aside>
  )
}
