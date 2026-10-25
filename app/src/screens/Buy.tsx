// Buy with Bob: the agent run for one place, as a step timeline plus a live cart.
import { useEffect } from "react"
import { autoOnce } from "../demo"
import { useBuyFlow } from "../buy"
import { getPlace, sdk } from "../sdk"
import { ConnectButton, FaucetButton } from "../Shell"
import { useAsync } from "../store"
import { Empty, Loading, Note } from "../ui"
import { BuyTimeline, Cart } from "../views/askbob"
import { WalletScoreHint } from "../views/LoyaltyChip"

export function BuyScreen({ merchantId, query }: { merchantId: number; query: string }) {
  const place = useAsync(() => getPlace(merchantId), [merchantId])
  const flow = useBuyFlow(merchantId, query)
  const st = flow.state
  const run = flow.run
  useEffect(() => {
    if (place.data && sdk.wallet.address && autoOnce("buy")) void run()
  }, [place.data, run])

  if (place.loading && !place.data) return <Loading what="this place" />
  if (!place.data) return <Empty title="this place does not exist"><a href="#/">ask bob</a></Empty>
  const running = st.phase !== "idle" && st.phase !== "needsWallet" && st.phase !== "error" && st.phase !== "alreadyDone" && st.phase !== "done"

  return (
    <>
      <a className="small" href={query ? `#/ask/${encodeURIComponent(query)}` : "#/"}>
        back to results
      </a>
      <h1>buy with bob</h1>
      <p className="muted">
        "{query || place.data.name}". bob searches, ranks by proven reviews, checks your perks, proves them in this browser and pays in USDC on Stellar.
      </p>
      <div className="cols section">
        <section className="card">
          <BuyTimeline state={st} txHref={st.result ? sdk.chain.explorerTx(st.result.txHash) : null} />
          {st.phase === "idle" && (
            <button type="button" onClick={run}>
              buy {place.data.name} with bob
            </button>
          )}
          {st.phase === "needsWallet" && (
            <Note>
              connect to let bob pay. <ConnectButton />
            </Note>
          )}
          {st.phase === "done" && st.result && (
            <div>
              <h2>{st.result.bps ? "proof verified, price dropped" : "booked"}</h2>
              <p>paid {(Number(st.result.paid) / 1e7).toFixed(2)} USDC{st.result.saved ? `, saved ${(Number(st.result.saved) / 1e7).toFixed(2)}` : ""}.</p>
            </div>
          )}
          {st.phase === "alreadyDone" && st.error && <Note>{st.error.copy}</Note>}
          {st.phase === "error" && st.error && (
            <Note tone="warn">
              {st.error.copy} {st.error.name === "InsufficientFunds" && <FaucetButton />}{" "}
              <button type="button" className="secondary" onClick={run}>
                retry
              </button>
            </Note>
          )}
          {running && <p className="small muted" role="status">bob is working</p>}
        </section>
        <div>
          <Cart title={place.data.name} perks={st.perks} listPrice={place.data.price} result={st.result} />
          <div className="card section" style={{ marginTop: 12 }}>
            <WalletScoreHint merchantDiscountBps={place.data.discountBps} />
          </div>
        </div>
      </div>
    </>
  )
}
