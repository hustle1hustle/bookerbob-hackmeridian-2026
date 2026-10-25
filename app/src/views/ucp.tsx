// Presentational: generic step timeline and the UCP store cart (AED and USDC). Props only.
import type { ReactNode } from "react"

/** Store amounts arrive in minor units (fils): 15000 = 150.00 AED. */
const minor = (n: number) => (n / 100).toFixed(2)

/** Done steps with detail, the active one, the rest todo. On failure the first open step is marked active. */
export function StepTimeline({
  steps,
  done,
  phase,
  failed,
  detailFor,
  tail,
}: {
  steps: { id: string; label: string }[]
  done: Partial<Record<string, string>>
  phase: string
  failed: boolean
  detailFor?: (id: string) => string
  tail?: (id: string) => ReactNode
}) {
  const firstOpen = steps.findIndex((s) => done[s.id] === undefined)
  return (
    <ol className="steps" aria-live="polite">
      {steps.map((s, i) => {
        const finished = done[s.id] !== undefined
        const active = !finished && (s.id === phase || (failed && i === firstOpen))
        const detail = done[s.id] || (active && detailFor ? detailFor(s.id) : "")
        return (
          <li key={s.id} data-state={finished ? "done" : active ? "active" : "todo"}>
            {s.label} {detail && <span className="small muted">{detail}</span>}
            {finished && tail?.(s.id)}
          </li>
        )
      })}
    </ol>
  )
}

export interface UcpCartProps {
  title: string
  imageUrl: string | null
  listUsdc: number
  currency?: string
  subtotal?: number
  provisionalDiscount?: number
  proved?: { applied: boolean; discount: number; subtotal: number }
  paysRaw?: string
  paidRaw?: string
}

/** Live cart for a store purchase: the store's own currency (AED) and what is paid in USDC. */
export function UcpCart({ title, imageUrl, listUsdc, currency, subtotal, provisionalDiscount, proved, paysRaw, paidRaw }: UcpCartProps) {
  const usdc = (raw?: string) => (raw === undefined ? null : (Number(raw) / 1e7).toFixed(2))
  const shown = paidRaw ?? paysRaw
  return (
    <aside className="card">
      <h3>cart</h3>
      {imageUrl && <img src={imageUrl} alt="" style={{ width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 6 }} />}
      <p>{title}</p>
      {listUsdc > 0 && (
        <p className="small">
          listed <strong>{listUsdc.toFixed(2)} USDC</strong>
        </p>
      )}
      {subtotal !== undefined && (
        <p className="small">
          store subtotal <strong>
            {minor(subtotal)} {currency}
          </strong>
        </p>
      )}
      {!!provisionalDiscount && !proved && (
        <p className="small muted">
          returning customer, if proven: -{minor(provisionalDiscount)} {currency}
        </p>
      )}
      {proved?.applied && (
        <p className="small">
          returning customer (proven): -{minor(proved.discount)} {currency}, now {minor(proved.subtotal)} {currency}
        </p>
      )}
      {shown && (
        <p>
          {paidRaw ? "paid" : "to pay"} <strong>{usdc(shown)} USDC</strong>
        </p>
      )}
    </aside>
  )
}
