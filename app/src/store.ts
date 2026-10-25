// Small app state: hash route, wallet address, and a revision counter for local stays.
import { useEffect, useState, useSyncExternalStore } from "react"
import { sdk } from "./sdk"

// ---- route ----
export type Role = "guest" | "hotel" | "arbiter"
export interface Route {
  path: string[]
  role: Role
}
function parse(): Route {
  const path = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean)
  const head = path[0]
  const role: Role = head === "desk" || head === "feed" ? "hotel" : head === "arbiter" ? "arbiter" : "guest"
  return { path, role }
}
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb)
  return () => window.removeEventListener("hashchange", cb)
}
let cachedHash = ""
let cachedRoute: Route = { path: [], role: "guest" }
export function useRoute(): Route {
  return useSyncExternalStore(subscribeHash, () => {
    if (location.hash !== cachedHash) {
      cachedHash = location.hash
      cachedRoute = parse()
    }
    return cachedRoute
  })
}
export const go = (to: string) => {
  location.hash = to
  window.scrollTo({ top: 0 })
}

// ---- wallet ----
export function useWallet(): string | null {
  return useSyncExternalStore(
    (cb) => sdk.wallet.onChange(cb),
    () => sdk.wallet.address,
  )
}

// ---- generic change bus (stays, reviews, disputes) ----
let rev = 0
const subs = new Set<() => void>()
export const bump = () => {
  rev++
  subs.forEach((f) => f())
}
export function useRevision(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => rev,
  )
}

/** Load async data, re-run when deps or the revision change. Distinguishes loading, error and data. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const r = useRevision()
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  useEffect(() => {
    let live = true
    set((s) => ({ ...s, loading: true }))
    fn().then(
      (data) => live && set({ data, error: null, loading: false }),
      (e) => live && set({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, r])
  return state
}
