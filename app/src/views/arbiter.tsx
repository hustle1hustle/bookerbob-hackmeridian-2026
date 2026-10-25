// Presentational: arbiter dispute card with the disclosure package and the 3-step check. Props only.
import type { ReactNode } from "react"
import { shortHex, type DisclosurePackage, type Review } from "@bookerbob/pos-sdk"
import type { CheckState } from "../flows"
import { Stars } from "../ui"

const checkRows: { key: "commitmentMatches" | "signatureValid" | "leafInTree"; label: string }[] = [
  { key: "commitmentMatches", label: "the secret matches the review's disclosure commitment" },
  { key: "signatureValid", label: "the stay identity signed this review" },
  { key: "leafInTree", label: "the stay is in the hotel's tree of checkouts" },
]

export function PackageDetails({ pkg }: { pkg: DisclosurePackage }) {
  return (
    <details>
      <summary className="small">disclosure package (only you see this)</summary>
      <dl className="mono">
        <dt>leaf index</dt>
        <dd>{pkg.leafIndex}</dd>
        <dt>stay commitment</dt>
        <dd>{shortHex(pkg.commitment)}</dd>
        <dt>secret dk</dt>
        <dd>{shortHex(pkg.dk)}</dd>
        <dt>signature</dt>
        <dd>
          r8 {shortHex(pkg.signature.r8[0])}, {shortHex(pkg.signature.r8[1])}; s {shortHex(pkg.signature.s)}
        </dd>
        <dt>public key</dt>
        <dd>
          {shortHex(pkg.publicKey[0])}, {shortHex(pkg.publicKey[1])}
        </dd>
      </dl>
    </details>
  )
}

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
  review: Review | null
  pkg: DisclosurePackage | null
  attested: boolean
  check: CheckState
  onCheck: () => void
  onAttest: () => void
  canAttest: boolean
  /** FlowStatus for the attest write. */
  attestStatus: ReactNode
}

export function DisputeCard({ placeName, review, pkg, attested, check, onCheck, onAttest, canAttest, attestStatus }: DisputeCardProps) {
  return (
    <article className="card">
      <p className="small muted">
        {placeName} · review #{review?.id ?? pkg?.reviewId}
      </p>
      {review && (
        <p className="row">
          <Stars value={review.rating} /> {review.text ?? <span className="muted">text unavailable</span>}
        </p>
      )}
      {!pkg ? (
        <p className="muted small">waiting for the guest's disclosure. nothing to check yet.</p>
      ) : (
        <>
          <PackageDetails pkg={pkg} />
          <CheckList state={check} />
          <div className="row" style={{ marginTop: 8 }}>
            {!attested && (
              <button type="button" className="secondary" onClick={onCheck} disabled={check.status === "checking"}>
                {check.status === "checked" ? "check again" : "run the 3 checks"}
              </button>
            )}
            {!attested && (
              <button type="button" onClick={onAttest} disabled={!canAttest}>
                attest verified stay
              </button>
            )}
          </div>
          {check.status === "checked" && !check.allOk && <p className="note warn">a check failed. do not attest.</p>}
          {attestStatus}
        </>
      )}
    </article>
  )
}
