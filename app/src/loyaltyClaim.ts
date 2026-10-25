// Shared read of the season loyalty claim cached by PassConnectPanel after verifyOnConnect.
export type CachedLoyaltyClaim = {
  rating: number
  tier: number
  discountHintBps: number
  txCount: number
  digest: string
  txHash: string | null
  explorerUrl: string | null
  proof?: { mode: "group" | "self" | null; nullifier: string | null } | null
}

export const loyaltySeason = () => new Date().getUTCFullYear() * 100 + (new Date().getUTCMonth() + 1)

export function loyaltyCacheKey(addr: string, season = loyaltySeason()) {
  return `bookerbob.loyalty.v2.${season}.${addr}`
}

export function readLoyaltyClaim(addr: string | null | undefined, season = loyaltySeason()): CachedLoyaltyClaim | null {
  if (!addr || typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(loyaltyCacheKey(addr, season))
    return raw ? (JSON.parse(raw) as CachedLoyaltyClaim) : null
  } catch {
    return null
  }
}

/** Clamp wallet score hint to a place's max returning-guest bps. */
export function walletScoreHintBps(claim: CachedLoyaltyClaim | null, merchantDiscountBps: number): number {
  if (!claim) return 0
  return Math.max(0, Math.min(claim.discountHintBps, merchantDiscountBps, 10_000))
}
