// One explicit state machine per action. Views render a FlowState and call the hook's run/reset;
// they never touch the SDK. The proof flows advance only on real prover events.
import { useCallback, useEffect, useReducer, useRef } from "react"
import { errorCopy, nullifierCopy, isErr, type ErrorName, type ProofEvent, type ProofRequest, type WriteOk, type WriteResult } from "@bookerbob/pos-sdk"
import { sdk } from "./sdk"
import { bump } from "./store"

export type Action = "review" | "discount" | "book" | "checkout" | "attest"

export type FlowState<R = {}> =
  | { status: "idle" }
  | { status: "needsWallet" }
  | { status: "downloading"; loaded: number; total: number } // proof flows, first use only
  | { status: "proving" } // proof flows
  | { status: "verifying" } // proof flows: tx submitted, Stellar checks the proof
  | { status: "submitting" } // plain writes (book, checkout, attest)
  | { status: "success"; result: WriteOk & R }
  /** The system working as designed: NullifierUsed on review/discount, DuplicateLeaf on checkout. */
  | { status: "alreadyDone"; error: ErrorName; copy: string }
  | { status: "error"; error: ErrorName; copy: string }

export type FlowEvent<R> =
  /** cached: proving files already in the browser (prover.ready()), so no download stage. */
  | { type: "start"; cached?: boolean }
  | { type: "noWallet" }
  | { type: "walletConnected" }
  | { type: "submitted" }
  | { type: "proof"; ev: ProofEvent }
  | { type: "result"; result: WriteResult<R> }
  | { type: "reset" }

export const busy = (s: FlowState<any>) => s.status === "downloading" || s.status === "proving" || s.status === "verifying" || s.status === "submitting"

/** Human copy for an error in the context of an action (handoff copy, from the SDK). */
export function copyFor(error: ErrorName, action?: Action): string {
  if (error === "NullifierUsed" && (action === "review" || action === "discount")) return nullifierCopy[action]
  return errorCopy[error] ?? errorCopy.Unknown
}
const calm = (error: ErrorName, action: Action) =>
  (error === "NullifierUsed" && (action === "review" || action === "discount")) || (error === "DuplicateLeaf" && action === "checkout")

function settle<R>(result: WriteResult<R>, action: Action): FlowState<R> {
  if (isErr(result)) {
    if (result.error === "WalletNotConnected") return { status: "needsWallet" }
    const copy = copyFor(result.error, action)
    return calm(result.error, action) ? { status: "alreadyDone", error: result.error, copy } : { status: "error", error: result.error, copy }
  }
  return { status: "success", result: result as WriteOk & R }
}

/** Pure transition function. Exported so the machine can be tested without React. */
export function transition<R>(state: FlowState<R>, ev: FlowEvent<R>, action: Action): FlowState<R> {
  switch (ev.type) {
    case "reset":
      return { status: "idle" }
    case "noWallet":
      return { status: "needsWallet" }
    case "walletConnected":
      return state.status === "needsWallet" ? { status: "idle" } : state
    case "start":
      if (busy(state)) return state
      if (action !== "review" && action !== "discount") return { status: "submitting" }
      return ev.cached ? { status: "proving" } : { status: "downloading", loaded: 0, total: 0 }
    case "submitted":
      return { status: "submitting" }
    case "proof": {
      const p = ev.ev
      if (p.stage === "download") return { status: "downloading", loaded: p.loaded, total: p.total }
      if (p.stage === "proving") return { status: "proving" }
      if (p.stage === "verifying") return { status: "verifying" }
      return settle(p.result as WriteResult<R>, action)
    }
    case "result":
      return settle(ev.result, action)
  }
}

function useMachine<R>(action: Action) {
  const [state, dispatch] = useReducer((s: FlowState<R>, e: FlowEvent<R>) => transition(s, e, action), { status: "idle" } as FlowState<R>)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const off = sdk.wallet.onChange((a) => a && dispatch({ type: "walletConnected" }))
    return () => {
      alive.current = false
      off()
    }
  }, [])
  const send = useCallback((e: FlowEvent<R>) => alive.current && dispatch(e), [])
  return { state, send }
}

/** Review or discount: drives the UI from sdk.prover.prove(req) events. */
export function useProofFlow<R>(action: "review" | "discount") {
  const { state, send } = useMachine<R>(action)
  /** Whether the proving files were already cached when this run started (the view drops the download step). */
  const cachedAtStart = useRef(sdk.prover.ready())
  const run = useCallback(
    async (req: ProofRequest) => {
      if (!sdk.wallet.address) return send({ type: "noWallet" })
      cachedAtStart.current = sdk.prover.ready()
      send({ type: "start", cached: cachedAtStart.current })
      try {
        for await (const ev of sdk.prover.prove(req)) send({ type: "proof", ev })
      } catch {
        send({ type: "result", result: { error: "Network" } })
      }
      bump()
    },
    [send],
  )
  return { state, run, cached: cachedAtStart.current, reset: () => send({ type: "reset" }) }
}

/** Book, checkout, attest: one write call, no proof. */
export function useWriteFlow<R>(action: "book" | "checkout" | "attest") {
  const { state, send } = useMachine<R>(action)
  const run = useCallback(
    async (call: () => Promise<WriteResult<R>>) => {
      if (!sdk.wallet.address) return send({ type: "noWallet" })
      send({ type: "start" })
      try {
        send({ type: "result", result: await call() })
      } catch {
        send({ type: "result", result: { error: "Network" } })
      }
      bump()
    },
    [send],
  )
  return { state, run, reset: () => send({ type: "reset" }) }
}
