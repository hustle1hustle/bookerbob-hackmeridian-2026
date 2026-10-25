// Presentational + thin wiring: passkey connect and on-chain ZK verify panel.
import { useState } from "react"
import { errorCopy } from "@bookerbob/pos-sdk"
import { sdk } from "../sdk"
import { useWallet } from "../store"

type Phase = "idle" | "connecting" | "inspecting" | "ready" | "error"

export function PassConnectPanel({ merchantId = 0, season }: { merchantId?: number; season?: number }) {
  const address = useWallet()
  const [phase, setPhase] = useState<Phase>("idle")
  const [copy, setCopy] = useState<string | null>(null)
  const [claim, setClaim] = useState<{
    rating: number
    tier: number
    discountHintBps: number
    txCount: number
    binding?: string
  } | null>(null)

  const seasonNow = season ?? new Date().getUTCFullYear() * 100 + (new Date().getUTCMonth() + 1)

  const connectPasskey = async () => {
    setPhase("connecting")
    setCopy(null)
    try {
      await sdk.wallet.connect("passkey")
      setPhase("idle")
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      setPhase("error")
      setCopy(msg === "UserRejected" ? errorCopy.UserRejected : msg || "passkey failed")
    }
  }

  const runVerify = async () => {
    if (!sdk.wallet.address) {
      setCopy("connect a wallet first")
      setPhase("error")
      return
    }
    setPhase("inspecting")
    setCopy(null)
    try {
      const { verifyWallet } = await import("@bookerbob/verify_onchain_zk")
      const { inspect, claim: c } = await verifyWallet(sdk.wallet.address, merchantId, seasonNow)
      setClaim({
        rating: c.rating,
        tier: c.tier,
        discountHintBps: c.discountHintBps,
        txCount: inspect.txCount,
        binding: typeof localStorage !== "undefined" ? localStorage.getItem("pos.pass_binding") ?? undefined : undefined,
      })
      setPhase("ready")
    } catch (e) {
      setPhase("error")
      setCopy(e instanceof Error ? e.message : "verify failed")
    }
  }

  return (
    <section id="pass-connect" className="card pass-connect" aria-label="passkey and on-chain verify">
      <span className="label">pass_connect · verify_onchain_zk</span>
      <h2>connect with passkey</h2>
      <p className="muted">
        platform passkey (Touch ID / Face ID) binds a Stellar session. then we read the account on Horizon, score a basic rating, and build a loyalty claim other modules use for discounts.
      </p>
      <div className="row" style={{ marginTop: 14 }}>
        {!address || sdk.wallet.kind !== "passkey" ? (
          <button type="button" onClick={connectPasskey} disabled={phase === "connecting"}>
            {phase === "connecting" ? "waiting for passkey…" : "connect with passkey"}
          </button>
        ) : (
          <span className="tag ok">passkey · {address.slice(0, 4)}…{address.slice(-4)}</span>
        )}
        <button type="button" className="secondary" onClick={runVerify} disabled={phase === "inspecting" || !sdk.wallet.address}>
          {phase === "inspecting" ? "reading chain…" : "verify on-chain + rate"}
        </button>
      </div>
      {copy && (
        <p className="note warn" style={{ marginTop: 12 }} role="alert">
          {copy}
        </p>
      )}
      {claim && phase === "ready" && (
        <div className="verdict" style={{ marginTop: 18 }} aria-live="polite">
          <div className="top">
            <span className="seal">loyalty claim</span>
            <span className="label">tier {claim.tier} of 5</span>
          </div>
          <p className="claim">on-chain activity rating</p>
          <p className="band">{claim.rating} / 100</p>
          <div className="bars" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <i key={i} className={i <= claim.tier ? "on" : undefined} />
            ))}
          </div>
          <dl className="kv">
            <dt>ops sampled</dt>
            <dd>{claim.txCount}</dd>
            <dt>discount hint</dt>
            <dd>{(claim.discountHintBps / 100).toFixed(0)}% (bps {claim.discountHintBps})</dd>
            <dt>season</dt>
            <dd className="mono">{seasonNow}</dd>
            {claim.binding && (
              <>
                <dt>pass binding</dt>
                <dd className="mono">{claim.binding}</dd>
              </>
            )}
          </dl>
          <p className="cap">hand this claim to the discount module · proveLoyaltyClaim when the identity is in the tree</p>
        </div>
      )}
    </section>
  )
}
