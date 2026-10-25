// Presentational + thin wiring: passkey / Freighter → score + attest + ZK score proof.
import { useEffect, useRef, useState } from "react"
import { errorCopy, type WalletKind } from "@bookerbob/pos-sdk"
import { loyaltyCacheKey, loyaltySeason, readLoyaltyClaim } from "../loyaltyClaim"
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
  proof: {
    mode: "group" | "self" | null
    nullifier: string | null
    publicSignals: string[] | null
  } | null
}

const seasonNow = loyaltySeason

function loadCache(addr: string, season: number): ClaimView | null {
  return readLoyaltyClaim(addr, season) as ClaimView | null
}

function saveCache(addr: string, season: number, claim: ClaimView) {
  try {
    localStorage.setItem(loyaltyCacheKey(addr, season), JSON.stringify(claim))
  } catch {
    /* quota */
  }
}

function fromResult(r: Awaited<ReturnType<typeof import("@bookerbob/verify_onchain_zk").verifyOnConnect>>, prev?: ClaimView | null): ClaimView {
  const nullifier =
    r.proved?.proof?.nullifier != null
      ? String(r.proved.proof.nullifier)
      : r.proved?.publicSignals?.[1] != null
        ? String(r.proved.publicSignals[1])
        : null
  return {
    rating: r.claim.rating,
    tier: r.claim.tier,
    discountHintBps: r.claim.discountHintBps,
    txCount: r.inspect.txCount,
    digest: r.digest,
    txHash: r.attest?.txHash ?? prev?.txHash ?? null,
    explorerUrl: r.attest?.explorerUrl ?? prev?.explorerUrl ?? (prev?.txHash ? sdk.chain.explorerTx(prev.txHash) : null),
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
    proof: r.proved
      ? {
          mode: r.proofMode,
          nullifier: nullifier ? String(nullifier) : null,
          publicSignals: r.proved.publicSignals ?? null,
        }
      : prev?.proof ?? null,
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

function ScoreRubric() {
  return (
    <details className="score-rubric">
      <summary>how we score</summary>
      <ul>
        <li>
          <b>Horizon</b> (0–100): account age ≤40 · log ops ≤35 · log payments ≤25. 1-stroop loyalty-attest dust ignored.
        </li>
        <li>
          <b>Stellar Passport</b> (0–20 bonus, then clamp 100): linked builder · points · rank · scf_tier · 30d activity.
        </li>
        <li>
          <b>Tier</b>: 5 ≥85 · 4 ≥70 · 3 ≥50 · 2 ≥30 · 1 below.
        </li>
        <li>
          <b>ZK</b>: Groth16 binds rating|tier|address into message (Semaphore stack). Default self-membership; group leaves when enrolled.
        </li>
      </ul>
    </details>
  )
}

export function PassConnectPanel({ merchantId = 0, season }: { merchantId?: number; season?: number }) {
  const address = useWallet()
  const [phase, setPhase] = useState<Phase>("idle")
  const [copy, setCopy] = useState<string | null>(null)
  const [claim, setClaim] = useState<ClaimView | null>(null)
  const [proving, setProving] = useState(false)
  const lastVerified = useRef<string | null>(null)
  const seasonVal = season ?? seasonNow()

  const runVerify = async (addr: string, opts: { force?: boolean } = {}) => {
    const cached = loadCache(addr, seasonVal)
    if (!opts.force && lastVerified.current === addr && claim) return
    if (!opts.force && cached && lastVerified.current !== addr) {
      setClaim(cached)
      lastVerified.current = addr
      setPhase("ready")
      void refreshQuiet(addr, cached)
      return
    }

    setPhase("inspecting")
    setProving(true)
    setCopy(null)
    try {
      const { verifyOnConnect } = await import("@bookerbob/verify_onchain_zk")
      const alreadyAttested = Boolean(cached?.txHash)
      const r = await verifyOnConnect(addr, {
        merchantId,
        season: seasonVal,
        attest: !alreadyAttested,
        proveScore: true,
        passportProxyBase: "",
      })
      lastVerified.current = addr
      const next = fromResult(r, cached)
      setClaim(next)
      saveCache(addr, seasonVal, next)
      setPhase("ready")
    } catch (e) {
      setPhase("error")
      setCopy(e instanceof Error ? e.message : "verify failed")
    } finally {
      setProving(false)
    }
  }

  const refreshQuiet = async (addr: string, prev: ClaimView) => {
    try {
      const { verifyOnConnect } = await import("@bookerbob/verify_onchain_zk")
      const r = await verifyOnConnect(addr, {
        merchantId,
        season: seasonVal,
        attest: false,
        // Keep prior ZK if we already have one; skip re-download unless missing.
        proveScore: !prev.proof?.nullifier,
        passportProxyBase: "",
      })
      const next = fromResult(r, prev)
      setClaim(next)
      saveCache(addr, seasonVal, next)
    } catch {
      /* keep cached */
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
      <h2>connect · score · prove</h2>
      <p className="muted">
        Freighter or passkey → verified tier (5→1), loyalty claim, one season attest tx, and a Groth16 score proof on the Proof of Stay stack.
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
          {phase === "inspecting" ? (proving ? "proving…" : "scoring…") : "re-check score"}
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
          <p className="cap">Horizon → Passport → attest → ZK score proof (first artifacts download ~4 MB)</p>
        </div>
      )}
      {claim && (phase === "ready" || phase === "inspecting") && (
        <div className="verdict" style={{ marginTop: 18 }} aria-live="polite">
          <div className="top">
            <span className="seal">loyalty claim</span>
            <span className="label">season {seasonVal}</span>
          </div>
          <VerifiedScore tier={claim.tier} rating={claim.rating} pending={phase === "inspecting"} />
          <ScoreRubric />
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
                    </>
                  ) : (
                    <span className="muted">no linked builder (bonus 0)</span>
                  )}
                </dd>
              </>
            )}
            <dt>discount hint</dt>
            <dd>{(claim.discountHintBps / 100).toFixed(0)}% (bps {claim.discountHintBps})</dd>
            <dt>zk score proof</dt>
            <dd>
              {claim.proof?.nullifier ? (
                <>
                  ready · {claim.proof.mode === "group" ? "group membership" : "self-membership"} · nullifier{" "}
                  <span className="mono">{claim.proof.nullifier.slice(0, 10)}…</span>
                </>
              ) : proving || phase === "inspecting" ? (
                <span className="muted">proving…</span>
              ) : (
                <span className="muted">not issued (artifacts failed or skipped)</span>
              )}
            </dd>
            <dt>claim digest</dt>
            <dd className="mono">{claim.digest.slice(0, 10)}…</dd>
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
            UX home for this flow: this card (#pass-connect). Also surface tier chip in Ask Bob header after connect, and discount hint on Place/Buy.
          </p>
        </div>
      )}
    </section>
  )
}
