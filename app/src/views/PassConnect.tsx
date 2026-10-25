// Presentational + thin wiring: passkey / Freighter connect → auto verify_onchain_zk (score + attest tx).
import { useEffect, useRef, useState } from "react"
import { errorCopy, type WalletKind } from "@bookerbob/pos-sdk"
import { sdk } from "../sdk"
import { useWallet } from "../store"
import { TxLink } from "../ui"

type Phase = "idle" | "connecting" | "inspecting" | "ready" | "error"

type ClaimView = {
  rating: number
  tier: number
  discountHintBps: number
  txCount: number
  digest: string
  txHash: string | null
  explorerUrl: string | null
  binding?: string
  kind?: string
  /** Stellar Passport builder bonus from inspect.passport (null when passport is off). */
  passport: { score: number; matched: boolean; rankName?: string; scfTier?: string; profileUrl?: string } | null
}

const seasonNow = () => new Date().getUTCFullYear() * 100 + (new Date().getUTCMonth() + 1)

export function PassConnectPanel({ merchantId = 0, season }: { merchantId?: number; season?: number }) {
  const address = useWallet()
  const [phase, setPhase] = useState<Phase>("idle")
  const [copy, setCopy] = useState<string | null>(null)
  const [claim, setClaim] = useState<ClaimView | null>(null)
  const lastVerified = useRef<string | null>(null)
  const seasonVal = season ?? seasonNow()

  const runVerify = async (addr: string) => {
    if (lastVerified.current === addr && claim) return
    setPhase("inspecting")
    setCopy(null)
    try {
      const { verifyOnConnect } = await import("@bookerbob/verify_onchain_zk")
      const r = await verifyOnConnect(addr, {
        merchantId,
        season: seasonVal,
        attest: true,
        passportProxyBase: "", // same-origin /api/passport/lookup (optional PASSPORT_API_KEY on server)
      })
      lastVerified.current = addr
      setClaim({
        rating: r.claim.rating,
        tier: r.claim.tier,
        discountHintBps: r.claim.discountHintBps,
        txCount: r.inspect.txCount,
        digest: r.digest,
        txHash: r.attest?.txHash ?? null,
        explorerUrl: r.attest?.explorerUrl ?? null,
        binding: typeof localStorage !== "undefined" ? localStorage.getItem("pos.pass_binding") ?? undefined : undefined,
        kind: sdk.wallet.kind ?? undefined,
        passport: r.inspect.passport
          ? {
              score: r.inspect.passport.score,
              matched: r.inspect.passport.matched,
              rankName: r.inspect.passport.signals.rankName,
              scfTier: r.inspect.passport.signals.scfTier,
              profileUrl: r.inspect.passport.signals.profileUrl,
            }
          : null,
      })
      setPhase("ready")
    } catch (e) {
      setPhase("error")
      setCopy(e instanceof Error ? e.message : "verify failed")
    }
  }

  // Auto score + attest whenever a wallet is connected (Freighter, passkey, or demo key).
  useEffect(() => {
    if (!address) {
      lastVerified.current = null
      return
    }
    void runVerify(address)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on address change
  }, [address])

  const connect = async (kind: Extract<WalletKind, "passkey" | "freighter">) => {
    setPhase("connecting")
    setCopy(null)
    try {
      await sdk.wallet.connect(kind)
      // address effect triggers verifyOnConnect
      setPhase("idle")
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      setPhase("error")
      setCopy(
        /not installed/i.test(msg)
          ? "Freighter is not installed in this browser"
          : msg === "UserRejected"
            ? errorCopy.UserRejected
            : msg || `${kind} connect failed`,
      )
    }
  }

  return (
    <section id="pass-connect" className="card pass-connect" aria-label="wallet connect and on-chain verify">
      <span className="label">pass_connect · verify_onchain_zk</span>
      <h2>connect · score · attest</h2>
      <p className="muted">
        Freighter or platform passkey. on connect we read Horizon, score a basic rating, build a loyalty claim, and post a testnet attestation tx you can open on stellar.expert.
      </p>
      <div className="row" style={{ marginTop: 14 }}>
        {!address ? (
          <>
            <button type="button" onClick={() => connect("passkey")} disabled={phase === "connecting"}>
              {phase === "connecting" && sdk.wallet.kind !== "freighter" ? "waiting for passkey…" : "connect with passkey"}
            </button>
            <button type="button" className="secondary" onClick={() => connect("freighter")} disabled={phase === "connecting"}>
              {phase === "connecting" ? "waiting…" : "Freighter"}
            </button>
          </>
        ) : (
          <span className="tag ok">
            {sdk.wallet.kind ?? "wallet"} · {address.slice(0, 4)}…{address.slice(-4)}
          </span>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => address && (lastVerified.current = null, runVerify(address))}
          disabled={phase === "inspecting" || !address}
        >
          {phase === "inspecting" ? "scoring + attesting…" : "re-verify on-chain"}
        </button>
      </div>
      {copy && (
        <p className="note warn" style={{ marginTop: 12 }} role="alert">
          {copy}
        </p>
      )}
      {claim && (phase === "ready" || phase === "inspecting") && (
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
            {claim.passport && (
              <>
                <dt>stellar passport</dt>
                <dd>
                  {claim.passport.matched ? (
                    <>
                      builder bonus +{claim.passport.score}
                      {claim.passport.rankName ? ` · ${claim.passport.rankName}` : ""}
                      {claim.passport.scfTier ? ` · ${claim.passport.scfTier}` : ""}
                      {claim.passport.profileUrl ? (
                        <>
                          {" · "}
                          <a href={claim.passport.profileUrl} target="_blank" rel="noreferrer">
                            github
                          </a>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">no linked builder profile (bonus 0)</span>
                  )}
                </dd>
              </>
            )}
            <dt>discount hint</dt>
            <dd>{(claim.discountHintBps / 100).toFixed(0)}% (bps {claim.discountHintBps})</dd>
            <dt>season</dt>
            <dd className="mono">{seasonVal}</dd>
            <dt>claim digest</dt>
            <dd className="mono">{claim.digest.slice(0, 10)}…</dd>
            {claim.binding && (
              <>
                <dt>pass binding</dt>
                <dd className="mono">{claim.binding}</dd>
              </>
            )}
            <dt>attest tx</dt>
            <dd>
              {claim.txHash ? (
                <TxLink href={claim.explorerUrl ?? sdk.chain.explorerTx(claim.txHash)} hash={claim.txHash}>
                  attested on testnet
                </TxLink>
              ) : phase === "inspecting" ? (
                <span className="muted">posting…</span>
              ) : (
                <span className="muted">no write tx (attest skipped or failed)</span>
              )}
            </dd>
          </dl>
          <p className="cap">inspect is Horizon-only; the clickable tx is /api/loyalty/attest · proveLoyaltyClaim when the identity is in the tree</p>
        </div>
      )}
    </section>
  )
}
