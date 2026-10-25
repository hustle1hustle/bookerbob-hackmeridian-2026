// Thin presentational primitives. Props only, no SDK access, no state beyond trivial UI.
import { useState, type ReactNode } from "react"

export function Stars({ value }: { value: number }) {
  const n = Math.round(value)
  return (
    <span className="stars" role="img" aria-label={`${value.toFixed(1).replace(/\.0$/, "")} of 5 stars`}>
      {"★".repeat(n)}
      {"☆".repeat(5 - n)}
    </span>
  )
}

/** Explorer link for a tx. Renders nothing when there is no hash (never a dead link). */
export function TxLink({ href, hash, children }: { href: string | null; hash: string | null; children?: ReactNode }) {
  if (!href || !hash) return null
  return (
    <a className="small" href={href} target="_blank" rel="noreferrer">
      {children ?? "proof verified on Stellar"} <span className="mono">{hash.slice(0, 6)}…{hash.slice(-4)}</span>
    </a>
  )
}

export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard blocked: the value stays selectable on screen */
        }
      }}
    >
      {done ? "copied" : label}
    </button>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p>
        <strong>{title}</strong>
      </p>
      {children}
    </div>
  )
}

/** Says what is being read. Ends in data, an empty state or an error, never spins forever. */
export function Loading({ what }: { what: string }) {
  return (
    <p className="muted" role="status">
      reading {what}
    </p>
  )
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
  return (
    <div className={`note ${tone}`} role={tone === "warn" ? "alert" : "status"}>
      {children}
    </div>
  )
}

export const VerifiedStay = () => <span className="tag ok">verified stay</span>

export function ago(time: number | null, ledger: number): string {
  if (time == null) return `ledger ${ledger.toLocaleString("en-US")}`
  const s = Math.max(0, (Date.now() - time) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  return d < 30 ? `${d} ${d === 1 ? "day" : "days"} ago` : new Date(time).toLocaleDateString("en-GB")
}

export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`
