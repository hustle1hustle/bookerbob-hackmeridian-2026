// Presentational: hotel role (place picker, checkout desk form, dispute control). Props only.
import type { ReactNode } from "react"
import type { Merchant } from "@bookerbob/pos-sdk"
import type { Dispute } from "../disputes"

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
}

export function CheckoutForm({ placeName, commitment, onCommitment, onConfirm, disabled, status }: CheckoutFormProps) {
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault()
        onConfirm()
      }}
    >
      <h2>checkout desk</h2>
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

/** Per-review dispute control in the hotel feed. */
export function DisputeControl({ dispute, verified, canAct, onDispute }: { dispute: Dispute | undefined; verified: boolean; canAct: boolean; onDispute: () => void }) {
  if (verified) return null
  if (dispute?.attestTx) return null
  if (dispute) return <span className="tag">{dispute.pkg ? "with the arbiter" : "disputed, waiting for the guest"}</span>
  return (
    <button type="button" className="secondary" onClick={onDispute} disabled={!canAct} title={canAct ? undefined : "connect to dispute"}>
      dispute
    </button>
  )
}
