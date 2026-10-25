// Presentational: hero, "ask bob" search and Bob's pick. Props only.
import type { Ranked } from "@bookerbob/agent"

export function Hero() {
  return (
    <header>
      <h1>BookerBob.</h1>
      <p>
        <strong>Google for agentic commerce.</strong> Proof of loyalty, everywhere you go.
      </p>
    </header>
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
      className="card section"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onAsk()
      }}
    >
      <label htmlFor="ask-bob">
        <strong>ask bob</strong> <span className="small muted">ranked by proven reviews only. reviews nobody can buy.</span>
      </label>
      <div className="row" style={{ marginTop: 8 }}>
        <input id="ask-bob" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="hotel under 120" style={{ flex: 1, minWidth: 200 }} />
        <button type="submit" disabled={value.trim() === ""}>
          ask
        </button>
        {active && (
          <button type="button" className="secondary" onClick={onClear}>
            clear
          </button>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        try{" "}
        {examples.map((x, i) => (
          <span key={x}>
            {i > 0 && ", "}
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
      <p>
        <strong>Bob picked this: {headline}.</strong>
      </p>
      <p>
        <a href={href}>{pick.place.name}</a>, {pick.reason}.
      </p>
      {pick.score === null && <p className="small">no place in this range has proven reviews yet, so this is the cheapest.</p>}
    </section>
  )
}
