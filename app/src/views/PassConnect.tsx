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
  passport: { score: number; matched: boolean; rankName?: string; scfTier?: string; profileUrl?: string } | null
}

const seasonNow = () => new Date().getUTCFullYear() * 100 + (new Date().getUTCMonth() + 1)
const cacheKey = (addr: string, season: number) => `bookerbob.loyalty.v1.${season}.${addr}`

function loadCache(addr: string, season: number): ClaimView | null {
  try {
    const raw = localStorage.getItem(cacheKey(addr, season))
    return raw ? (JSON.parse(raw) as ClaimView) : null
  } catch {
    return null
  }
}

function saveCache(addr: string, season: number, claim: ClaimView) {
  try {
    localStorage.setItem(cacheKey(addr, season), JSON.stringify(claim))
  } catch {
    /* quota */
  }
}

/** Big verified-score ladder: 5 · 4 · 3 · 2 · 1 (current lit). */
function VerifiedScore({ tier, rating, pending }: { tier: number; rating?: number; pending?: boolean }) {
  return (
    <div className="verified-score" aria-label={pending ? "computing verified score" : `verified score tier ${tier} of 5`}>
      <p className="claim">{pending ? "computing verified score…" : "verified score"}</p>
      <ol className="tier-ladder" aria-hidden="true">
        {[5, 4, 3, 2, 1].map((n) => (
          <li key={n} className={n === tier && !pending ? "on" : n < tier && !pending ? "reached" : undefined}>
            <b>{n}</b>
          </li>
        ))}
      </ol>
      {!pending && rating != null && (
        <p className="band">
          tier {tier} <span className="muted">· {rating} / 100</span>
        </p>
      )}
      {pending && <p className="band muted">5 · 4 · 3 · 2 · 1</p>}
    </div>
  )
}

export function PassConnectPanel({ merchantId = 0, season }: { merchantId?: number; season?: number }) {
  const address = useWallet()
  const [phase, setPhase] = useState<Phase>("idle")
  const [copy, setCopy] = useState<string | null>(null)
  const [claim, setClaim] = useState<ClaimView | null>(null)
  const lastVerified = useRef<string | null>(null)
  const seasonVal = season ?? seasonNow()

  const runVerify = async (addr: string, opts: { force?: boolean } = {}) => {
    const cached = loadCache(addr, seasonVal)
    // Same address + season: keep stable claim; only force re-reads Horizon (no new attest).
    if (!opts.force && lastVerified.current === addr && claim) return
    if (!opts.force && cached && lastVerified.current !== addr) {
      setClaim(cached)
      lastVerified.current = addr
      setPhase("ready")
      // Soft refresh in background without posting another attest tx (that was inflating the score).
      void refreshQuiet(addr, cached)
      return
    }

    setPhase("inspecting")
    setCopy(null)
    try {
      const { verifyOnConnect } = await import("@bookerbob/verify_onchain_zk")
      const alreadyAttested = Boolean(cached?.txHash)
      const r = await verifyOnConnect(addr, {
        merchantId,
        season: seasonVal,
        // Re-attest only the first time this season — each attest is a 1-stroop payment that used to bump the score.
        attest: !alreadyAttested,
        passportProxyBase: "",
      })
      lastVerified.current = addr
      const next: ClaimView = {
        rating: r.claim.rating,
        tier: r.claim.tier,
        discountHintBps: r.claim.discountHintBps,
        txCount: r.inspect.txCount,
        digest: r.digest,
        txHash: r.attest?.txHash ?? cached?.txHash ?? null,
        explorerUrl: r.attest?.explorerUrl ?? cached?.explorerUrl ?? (cached?.txHash ? sdk.chain.explorerTx(cached.txHash) : null),
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
      }
      setClaim(next)
      saveCache(addr, seasonVal, next)
      setPhase("ready")
    } catch (e) {
      setPhase("error")
      setCopy(e instanceof Error ? e.message : "verify failed")
    }
  }

  const refreshQuiet = async (addr: string, prev: ClaimView) => {
    try {
      const { verifyOnConnect } = await import("@bookerbob/verify_onchain_zk")
      const r = await verifyOnConnect(addr, {
        merchantId,
        season: seasonVal,
        attest: false,
        passportProxyBase: "",
      })
      const next: ClaimView = {
        ...prev,
        rating: r.claim.rating,
        tier: r.claim.tier,
        discountHintBps: r.claim.discountHintBps,
        txCount: r.inspect.txCount,
        digest: r.digest,
        passport: r.inspect.passport
          ? {
              score: r.inspect.passport.score,
              matched: r.inspect.passport.matched,
              rankName: r.inspect.passport.signals.rankName,
              scfTier: r.inspect.passport.signals.scfTier,
              profileUrl: r.inspect.passport.signals.profileUrl,
            }
          : null,
      }
      setClaim(next)
      saveCache(addr, seasonVal, next)
    } catch {
      /* keep cached claim */
    }
  }

  useEffect(() => {
    if (!address) {
      lastVerified.current = null
      setClaim(null)
      return
    }
    void runVerify(address)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  const connect = async (kind: Extract<WalletKind, "passkey" | "freighter">) => {
    setPhase("connecting")
    setCopy(null)
    try {
      await sdk.wallet.connect(kind)
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
        Freighter or platform passkey. on connect we score a verified tier (5→1), build a loyalty claim, and post one testnet attestation tx for the season.
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
          onClick={() => address && void runVerify(address, { force: true })}
          disabled={phase === "inspecting" || !address}
        >
          {phase === "inspecting" ? "scoring…" : "re-check score"}
        </button>
      </div>
      {copy && (
        <p className="note warn" style={{ marginTop: 12 }} role="alert">
          {copy}
        </p>
      )}
      {phase === "inspecting" && !claim && (
        <div className="verdict" style={{ marginTop: 18 }} aria-live="polite">
          <VerifiedScore tier={0} pending />
          <p className="cap">reading Horizon · optional Passport · then one attest tx if this season has none yet</p>
        </div>
      )}
      {claim && (phase === "ready" || phase === "inspecting") && (
        <div className="verdict" style={{ marginTop: 18 }} aria-live="polite">
          <div className="top">
            <span className="seal">loyalty claim</span>
            <span className="label">season {seasonVal}</span>
          </div>
          <VerifiedScore tier={claim.tier} rating={claim.rating} pending={phase === "inspecting"} />
          <dl className="kv">
            <dt>ops scored</dt>
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
                            profile
                          </a>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">no linked builder (bonus 0)</span>
                  )}
                </dd>
              </>
            )}
            <dt>discount hint</dt>
            <dd>{(claim.discountHintBps / 100).toFixed(0)}% (bps {claim.discountHintBps})</dd>
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
                <span className="muted">no write tx yet</span>
              )}
            </dd>
          </dl>
          <p className="cap">
            tier ladder 5→1 · same address keeps one attest per season (re-check does not mint another dust payment)
          </p>
        </div>
      )}
    </section>
  )
}
