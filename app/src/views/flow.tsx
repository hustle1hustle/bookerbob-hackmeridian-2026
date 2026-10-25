// Presentational renderers for FlowState. Every state of every action has a branch here.
import type { ReactNode } from "react"
import type { FlowState } from "../flows"
import { Note } from "../ui"

const mb = (b: number) => (b / 1_000_000).toFixed(1)

export interface FlowStatusProps {
  state: FlowState<any>
  /** Shown for needsWallet (e.g. the connect control). */
  connect?: ReactNode
  /** Rendered on success. */
  success?: ReactNode
  submittingText?: string
  onRetry?: () => void
  /** Offered when the error is InsufficientFunds (e.g. the "get test USDC" control). */
  faucet?: ReactNode
}

/** Plain writes (book, checkout, attest): idle renders nothing. */
export function FlowStatus({ state, connect, success, submittingText = "sending to Stellar testnet", onRetry, faucet }: FlowStatusProps) {
  switch (state.status) {
    case "idle":
      return null
    case "needsWallet":
      return (
        <Note>
          connect to continue. {connect}
        </Note>
      )
    case "submitting":
    case "downloading":
    case "proving":
    case "verifying":
      return <p className="muted" role="status">{submittingText}</p>
    case "success":
      return <Note tone="ok">{success}</Note>
    case "alreadyDone":
      return <Note>{state.copy}</Note>
    case "error":
      return (
        <Note tone="warn">
          {state.copy}{" "}
          {state.error === "InsufficientFunds" && faucet}
          {onRetry && (
            <button type="button" className="secondary" onClick={onRetry}>
              retry
            </button>
          )}
        </Note>
      )
  }
}

type StepState = "todo" | "active" | "done" | "skipped"

export interface ProofMomentProps {
  state: FlowState<any>
  /** Proving files were cached at start: the download step is shown as skipped. */
  cached: boolean
  connect?: ReactNode
  /** Final frame on success, e.g. "proof verified, price dropped". */
  success: ReactNode
  /** Final frame for the calm "already used" refusal. */
  alreadyDone: (copy: string) => ReactNode
  onRetry: () => void
  /** Offered when the error is InsufficientFunds. */
  faucet?: ReactNode
}

/** The proof moment: preparing, proving, verifying on Stellar, done. Advances only on real prover events. */
export function ProofMoment({ state, cached, connect, success, alreadyDone, onRetry, faucet }: ProofMomentProps) {
  if (state.status === "idle") return null
  if (state.status === "needsWallet") return <Note>connect to continue. {connect}</Note>

  const order = { downloading: 0, proving: 1, verifying: 2, submitting: 2, success: 3, alreadyDone: 3, error: 3 } as const
  const at = order[state.status]
  const step = (i: number): StepState => (i === 0 && cached ? "skipped" : i < at ? "done" : i === at ? "active" : "todo")
  const dl =
    state.status === "downloading" && state.total > 0 ? `${mb(state.loaded)} of ${mb(state.total)} MB` : cached ? "already loaded" : "about 4 MB, fetched when needed"

  return (
    <section className="card" aria-live="polite">
      <ol className="steps">
        <li data-state={step(0)}>preparing proving files <span className="small muted">{dl}</span></li>
        <li data-state={step(1)}>proving in your browser <span className="small muted">your stay identity stays on this device</span></li>
        <li data-state={step(2)}>verifying on Stellar</li>
        <li data-state={state.status === "success" || state.status === "alreadyDone" ? "done" : "todo"}>done</li>
      </ol>
      {state.status === "success" && success}
      {state.status === "alreadyDone" && alreadyDone(state.copy)}
      {state.status === "error" && (
        <Note tone="warn">
          {state.copy}{" "}
          {state.error === "InsufficientFunds" && faucet}
          <button type="button" className="secondary" onClick={onRetry}>
            retry
          </button>
        </Note>
      )}
    </section>
  )
}
