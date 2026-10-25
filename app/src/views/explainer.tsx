// Presentational: "what each party sees" and the rating comparison. Props only.

const parties: { who: string; sees: string[] }[] = [
  {
    who: "the hotel",
    sees: ["the stay code it added at checkout", "every review's stars and text, never which guest wrote it", '"verified stay" once an arbiter checked a dispute'],
  },
  {
    who: "the arbiter",
    sees: ["only disputed reviews the guest chose to disclose", "that the review is the guest's, and which checkout it points to", "nothing about the guest's other stays"],
  },
  {
    who: "the public",
    sees: ["places, verified ratings and reviews", "the proof transaction behind each review on Stellar", "no authors"],
  },
  {
    who: "nobody",
    sees: ["which guest wrote which review, unless the guest discloses it to the arbiter", "links between one guest's different stays", "the stay secret, which never leaves the guest's browser"],
  },
]

export function Explainer({ compact }: { compact?: boolean }) {
  return (
    <section>
      <h2>what each party sees</h2>
      <p className="muted">private by default, accountable when needed.{!compact && " one proof, checked on Stellar, decides what each side learns."}</p>
      <div className="sees">
        {parties.map((p) => (
          <div key={p.who} className="card">
            <h3>{p.who}</h3>
            <ul>
              {p.sees.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

export interface RatingCompareProps {
  /** Static demo copy for the left side, never computed. */
  publicRating: string
  publicCount: string
  /** Proven average on a 10-point scale, null when there are no proven reviews. */
  proven10: number | null
  provenCount: number
}

export function RatingCompare({ publicRating, publicCount, proven10, provenCount }: RatingCompareProps) {
  return (
    <div className="compare">
      <div className="card">
        <p className="small muted">public platform rating</p>
        <p>
          <strong>{publicRating}</strong> <span className="muted">/10</span>
        </p>
        <p className="small muted">from {publicCount} unverified reviews</p>
      </div>
      <div className="card">
        <p className="small muted">proven here</p>
        {proven10 === null ? (
          <p className="muted">no proven reviews yet</p>
        ) : (
          <>
            <p>
              <strong>{proven10.toFixed(1)}</strong> <span className="muted">/10</span>
            </p>
            <p className="small muted">
              from {provenCount} proven {provenCount === 1 ? "stay" : "stays"}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
