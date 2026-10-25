// The one seam between the app and the SDK.
// Swap mock for testnet with VITE_SDK_MODE=testnet; nothing else changes.
import { createSdk, isErr, kindLabel, type ErrorName, type Merchant, type WriteResult } from "@bookerbob/pos-sdk"
import { demo } from "./demo"
import { currentSeason } from "../../packages/sdk/src/derive.ts"

const mode = import.meta.env.VITE_SDK_MODE === "testnet" ? "testnet" : "mock"

let failOnce: ErrorName | null = demo.fail
export const sdk = createSdk({
  mode,
  // testnet: same-origin BookerBob backend (vite dev proxies /api to it)
  testnet: { apiUrl: "", artifactsUrl: "/artifacts/semaphore/4.13.0" },
  mock: {
    speed: demo.speed,
    failNext: () => {
      const f = failOnce
      failOnce = null
      return f
    },
  },
})

/**
 * Test USDC (and the trustline) for the connected wallet. Right after a new demo key is funded by friendbot the
 * first attempt can fail while the account settles, so try once more after a short pause.
 */
export async function faucet(): Promise<WriteResult> {
  const once = () => sdk.chain.faucet().catch((): WriteResult => ({ error: "Unknown" }))
  const r = await once()
  if (!isErr(r) || r.error === "WalletNotConnected") return r
  await new Promise((ok) => setTimeout(ok, 4000))
  return once()
}

export type Place = Merchant
export const listPlaces = () => sdk.chain.listMerchants()
export const getPlace = (id: number) => sdk.chain.getMerchant(id)
export const getPlaceReviews = (id: number) => sdk.chain.getReviews(id)
export { kindLabel }

/** "stay" for hotels, "visit" or "purchase" elsewhere (handoff: Places, not only hotels). */
export const stayWord = (kind: string): string => (kind === "hotel" ? "stay" : kind === "shop" ? "purchase" : "visit")

/** Returning-guest discount season for the demo. The seed used season 1; agent and seed must match. */
export const SEASON = currentSeason()
export const seasonLabel = (season: number) => `season ${season}`
