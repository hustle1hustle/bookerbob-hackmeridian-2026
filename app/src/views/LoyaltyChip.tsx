// Header chip + place/buy hint for the cached wallet verified-score claim.
import { useSyncExternalStore } from "react"
import { readLoyaltyClaim, walletScoreHintBps, type CachedLoyaltyClaim } from "../loyaltyClaim"
import { useWallet } from "../store"

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb)
  // Same-tab writes from PassConnect do not fire `storage` — poll lightly while mounted.
  const t = window.setInterval(cb, 1500)
  return () => {
    window.removeEventListener("storage", cb)
    window.clearInterval(t)
  }
}

export function useLoyaltyClaim(): CachedLoyaltyClaim | null {
  const address = useWallet()
  return useSyncExternalStore(
    subscribeStorage,
    () => readLoyaltyClaim(address),
    () => null,
  )
}

/** Ask Bob / site-head: tier chip → #pass-connect. */
export function LoyaltyTierChip() {
  const claim = useLoyaltyClaim()
  if (!claim) return null
  return (
    <a className="tag ok loyalty-tier-chip" href="#pass-connect" title={`verified score ${claim.rating}/100`}>
      tier {claim.tier}
      {claim.proof?.nullifier ? " · zk" : ""}
    </a>
  )
}

/** Place / Buy aside: wallet-score discount hint (not a stay proof — separate from returning-guest). */
export function WalletScoreHint({ merchantDiscountBps }: { merchantDiscountBps: number }) {
  const claim = useLoyaltyClaim()
  if (!claim) {
    return (
      <p className="small muted">
        connect and score at <a href="#pass-connect">wallet score</a> for a wallet loyalty hint.
      </p>
    )
  }
  const bps = walletScoreHintBps(claim, merchantDiscountBps)
  const pct = (bps / 100).toFixed(bps % 100 ? 1 : 0)
  return (
    <div className="wallet-score-hint small">
      <p>
        <strong>wallet verified score</strong> · tier {claim.tier} · {claim.rating}/100
        {claim.proof?.nullifier ? " · zk proof ready" : ""}
      </p>
      {bps > 0 ? (
        <p className="muted">
          score hint up to {pct}% off (bps {bps}), clamped to this place. stay-proof discount is separate below.
        </p>
      ) : (
        <p className="muted">no discount room at this place for the score hint.</p>
      )}
      <p>
        <a href="#pass-connect">open score card</a>
      </p>
    </div>
  )
}
