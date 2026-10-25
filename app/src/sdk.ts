// The one seam between the app and the SDK.
// Swap mock for testnet with VITE_SDK_MODE=testnet; nothing else changes.
import { createSdk, kindLabel, type ErrorName, type Merchant } from "@bookerbob/pos-sdk"
import { demo } from "./demo"

const mode = import.meta.env.VITE_SDK_MODE === "testnet" ? "testnet" : "mock"

let failOnce: ErrorName | null = demo.fail
export const sdk = createSdk({
  mode,
  // testnet: same-origin BookerBob backend (vite dev proxies /api to it)
  testnet: { apiUrl: "" },
  mock: {
    speed: demo.speed,
    failNext: () => {
      const f = failOnce
      failOnce = null
      return f
    },
  },
})

export type Place = Merchant
export const listPlaces = () => sdk.chain.listMerchants()
export const getPlace = (id: number) => sdk.chain.getMerchant(id)
export const getPlaceReviews = (id: number) => sdk.chain.getReviews(id)
export { kindLabel }

/** "stay" for hotels, "visit" or "purchase" elsewhere (handoff: Places, not only hotels). */
export const stayWord = (kind: string): string => (kind === "hotel" ? "stay" : kind === "shop" ? "purchase" : "visit")

/** Returning-guest discount season for the demo. The seed used season 1; agent and seed must match. */
export const SEASON = 1
export const seasonLabel = (season: number) => `season ${season}`
