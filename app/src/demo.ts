// Query parameters used only to drive states for screenshots and the demo recording.
//   ?wallet=passkey|freighter   connect on load (mock wallet)
//   ?speed=0.5                   mock timing multiplier
//   ?fail=UnknownRoot            make the next write fail with that error
//   ?auto=review|discount|disclose|checkout|attest|book   start the action on load
import type { ErrorName, WalletKind } from "@bookerbob/pos-sdk"

const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search)
const wallet = q.get("wallet")
const speed = Number(q.get("speed"))

export const demo = {
  wallet: wallet === "passkey" || wallet === "freighter" ? (wallet as WalletKind) : null,
  speed: Number.isFinite(speed) && q.has("speed") ? speed : 1,
  fail: (q.get("fail") as ErrorName | null) ?? null,
  auto: q.get("auto"),
}

/** True once per page load for a given auto action, so effects do not repeat it. */
const fired = new Set<string>()
export function autoOnce(action: string): boolean {
  if (demo.auto !== action || fired.has(action)) return false
  fired.add(action)
  return true
}
