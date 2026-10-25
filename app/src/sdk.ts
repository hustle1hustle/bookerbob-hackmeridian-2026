// The one seam between the app and the SDK.
// Swap mock for testnet with VITE_SDK_MODE=testnet; nothing else changes.
import { createSdk, kindLabel, type ErrorName, type Merchant } from "@bookerbob/pos-sdk"
import { demo } from "./demo"

const mode = import.meta.env.VITE_SDK_MODE === "testnet" ? "testnet" : "mock"

let failOnce: ErrorName | null = demo.fail
export const sdk = createSdk({
  mode,
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

/**
 * Returning-guest discount season. The SDK takes a number and leaves the calendar to the app:
 * one season per calendar quarter. Must match whatever the agent and seed scripts use.
 */
export function currentSeason(now = new Date()): number {
  return now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3)
}
export function seasonLabel(season: number): string {
  return `${["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"][season % 4]} ${Math.floor(season / 4)}`
}
