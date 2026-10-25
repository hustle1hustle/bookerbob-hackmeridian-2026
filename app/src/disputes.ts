// Dispute queue. The SDK has no dispute transport yet (no openDispute / listDisputes, no channel
// that carries the guest's DisclosurePackage to the arbiter), so this lives in the page's memory:
// it works within one browser session (the demo), and is the seam to replace when the SDK grows one.
import type { DisclosurePackage } from "@bookerbob/pos-sdk"
import { bump } from "./store"

export interface Dispute {
  reviewId: number
  merchant: number
  /** Who raised it: the hotel disputes a review, or the guest discloses first. */
  openedBy: "hotel" | "guest"
  /** The guest's private package, once disclosed. Only the arbiter view reads it. */
  pkg: DisclosurePackage | null
  /** Set after the arbiter's attest transaction. */
  attestTx: string | null
}

const queue = new Map<number, Dispute>()

export const listDisputes = (): Dispute[] => [...queue.values()]
export const disputeFor = (reviewId: number): Dispute | undefined => queue.get(reviewId)

export function openDispute(reviewId: number, merchant: number) {
  if (!queue.has(reviewId)) queue.set(reviewId, { reviewId, merchant, openedBy: "hotel", pkg: null, attestTx: null })
  bump()
}

export function attachDisclosure(pkg: DisclosurePackage) {
  const d = queue.get(pkg.reviewId)
  queue.set(pkg.reviewId, d ? { ...d, pkg } : { reviewId: pkg.reviewId, merchant: pkg.merchant, openedBy: "guest", pkg, attestTx: null })
  bump()
}

export function markAttested(reviewId: number, txHash: string) {
  const d = queue.get(reviewId)
  if (d) queue.set(reviewId, { ...d, attestTx: txHash })
  bump()
}
