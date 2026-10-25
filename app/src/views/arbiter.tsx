// Presentational: arbiter dispute card with the 3-step check. Props only. The package never reaches this view.
import type { ReactNode } from "react"
import type { Review } from "@bookerbob/pos-sdk"
import type { CheckState } from "../flows"
import { Stars, ago } from "../ui"

const checkRows: { key: "commitmentMatches" | "signatureValid" | "leafInTree"; label: string }[] = [
  { key: "commitmentMatches", label: "the guest's secret matches the review's disclosure commitment" },
  { key: "signatureValid", label: "the stay identity signed this review" },
  { key: "leafInTree", label: "the stay is in the place's tree of checkouts" },
]

export function CheckList({ state }: { state: CheckState }) {
  if (state.status === "idle") return null
  if (state.status === "error") return <p className="note warn">{state.copy}</p>
  return (
    <ol className="steps">
      {checkRows.map((row) => {
        const v = state.status === "checked" ? state.result[row.key] : null
        return (
          <li key={row.key} data-state={v === null ? "active" : v ? "done" : "todo"}>
            {v === null ? "checking: " : v ? "ok: " : "failed: "}
            {row.label}
          </li>
        )
      })}
    </ol>
  )
}

export interface DisputeCardProps {
  placeName: string
  reviewId: number
  review: Review | null
  openedAt: number
  attested: boolean
  check: CheckState
  onCheck: () => void
  onAttest: () => void
  canAttest: boolean
  /** FlowStatus for the attest write, or the "already attested" note. */
  attestStatus: ReactNode
}

export function DisputeCard({ placeName, reviewId, review, openedAt, attested, check, onCheck, onAttest, canAttest, attestStatus }: DisputeCardProps) {
  return (
    <article className="card">
      <p className="small muted">
        {placeName} · review #{reviewId} · disclosed {ago(openedAt, 0)}
      </p>
      {review ? (
        <p className="row">
          <Stars value={review.rating} /> {review.text ?? <span className="muted">text unavailable</span>}
        </p>
      ) : (
        <p className="muted small">review not loaded</p>
      )}
      <CheckList state={check} />
      {!attested && (
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={onCheck} disabled={check.status === "checking"}>
            {check.status === "checked" ? "check again" : "run the 3 checks"}
          </button>
          <button type="button" onClick={onAttest} disabled={!canAttest}>
            attest verified stay
          </button>
        </div>
      )}
      {check.status === "checked" && !check.allOk && <p className="note warn">a check failed. do not attest.</p>}
      {attestStatus}
    </article>
  )
}
