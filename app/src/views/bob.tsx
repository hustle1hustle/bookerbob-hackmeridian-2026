// Presentational: hero, "ask bob" search and Bob's pick. Props only. REP Labs hero language.
import type { Ranked } from "@bookerbob/agent"

export function Hero() {
  return (
    <div className="hero-copy">
      <span className="label hero-eb">proof of loyalty · everywhere you go</span>
      <h1 className="statement">
        agents got smart. <em>they still don't know who really stayed.</em>
      </h1>
      <p className="hero-sub">
        guests prove they were customers without revealing who they are. BookerBob ranks places by reviews nobody can buy, and unlocks a returning-guest discount with the same proof.
      </p>
      <p className="hero-proof">
        <span>live on Stellar testnet.</span>
        <a className="u" href="https://stellarbob2026.xyz/">
          stellarbob2026.xyz
        </a>
      </p>
    </div>
  )
}

export interface AskBobProps {
  value: string
  onChange: (v: string) => void
  onAsk: () => void
  onClear: () => void
  /** An example query: fills the box and asks. */
  onExample: (q: string) => void
  examples: string[]
  active: boolean
}

export function AskBob({ value, onChange, onAsk, onClear, onExample, examples, active }: AskBobProps) {
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
      <label htmlFor="ask-bob">
        <strong>ranked by proven reviews only.</strong> <span className="muted">reviews nobody can buy.</span>
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <input id="ask-bob" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="hotel under 120" />
        <button type="submit" disabled={value.trim() === ""}>
          ask
        </button>
        {active && (
          <button type="button" className="secondary" onClick={onClear}>
            clear
          </button>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        try{" "}
        {examples.map((x, i) => (
          <span key={x}>
            {i > 0 && " · "}
            <button type="button" className="secondary" onClick={() => onExample(x)}>
              {x}
            </button>
          </span>
        ))}
      </p>
    </form>
  )
}

export function BobPick({ pick, headline, href }: { pick: Ranked | null; headline: string; href: string }) {
  if (!pick) return <p className="note">bob found nothing for that. try a higher price or another kind.</p>
  return (
    <section className="note ok" aria-live="polite">
      <p className="label">bob's pick</p>
      <p>
        <strong>{headline}.</strong>
      </p>
      <p>
        <a href={href}>{pick.place.name}</a>
        <span className="muted"> — {pick.reason}</span>
      </p>
      {pick.score === null && <p className="small muted">no place in this range has proven reviews yet, so this is the cheapest.</p>}
    </section>
  )
}
