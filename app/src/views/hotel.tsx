// Presentational: hotel role (place picker, checkout desk form, dispute control). Props only.
import type { ReactNode } from "react"
import type { Dispute, Merchant } from "@bookerbob/pos-sdk"

export function PlacePicker({ places, value, onChange }: { places: Merchant[]; value: number; onChange: (id: number) => void }) {
  return (
    <label className="row small">
      acting for
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export interface CheckoutFormProps {
  placeName: string
  commitment: string
  onCommitment: (v: string) => void
  onConfirm: () => void
  disabled: boolean
  /** FlowStatus for the checkout write. */
  status: ReactNode
  /** Demo place: the BookerBob demo desk signs the checkout. */
  demoDesk: boolean
}

export function CheckoutForm({ placeName, commitment, onCommitment, onConfirm, disabled, status, demoDesk }: CheckoutFormProps) {
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault()
        onConfirm()
      }}
    >
      <h2>checkout desk</h2>
      {demoDesk && <p className="small">demo desk (BookerBob confirms the stay)</p>}
      <p className="muted small">
        paste the guest's stay code. confirming adds it to {placeName}'s proven stays, so the guest can review and come back for the discount. you never learn who wrote which review.
      </p>
      <label>
        <span className="small muted">guest's stay code</span>
        <input type="text" inputMode="numeric" autoComplete="off" value={commitment} onChange={(e) => onCommitment(e.target.value)} style={{ width: "100%" }} />
      </label>
      <p style={{ marginTop: 12 }}>
        <button type="submit" disabled={disabled || commitment.trim() === ""}>
          confirm checkout
        </button>
      </p>
      {status}
    </form>
  )
}

/**
 * Per-review dispute control in the hotel feed. `dispute` comes from the arbiter queue (the guest disclosed);
 * `flagged` is the hotel's own flag on this device (the SDK has no hotel-side open-dispute call yet).
 */
export function DisputeControl({ dispute, verified, flagged, onDispute }: { dispute: Dispute | undefined; verified: boolean; flagged: boolean; onDispute: () => void }) {
  if (verified || dispute?.attestTx) return null
  if (dispute) return <span className="tag">with the arbiter</span>
  if (flagged) return <span className="tag">disputed, waiting for the guest to disclose</span>
  return (
    <button type="button" className="secondary" onClick={onDispute}>
      dispute
    </button>
  )
}
