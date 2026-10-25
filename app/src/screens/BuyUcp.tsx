// Buy with Bob for a UCP store item: the agent run through the UCP bridge, timeline plus a live cart (AED and USDC).
import { useEffect } from "react"
import { autoOnce } from "../demo"
import { ucpSteps, useUcpBuyFlow, usdcRaw } from "../buyUcp"
import { sdk } from "../sdk"
import { ConnectButton } from "../Shell"
import { useWallet } from "../store"
import { Note, TxLink } from "../ui"
import { StepTimeline, UcpCart } from "../views/ucp"

export function BuyUcpScreen({ variantId, query, title }: { variantId: string; query: string; title: string }) {
  const address = useWallet()
  const flow = useUcpBuyFlow(variantId, query)
  const st = flow.state
  const run = flow.run
  useEffect(() => {
    if (address && autoOnce("buy")) void run()
  }, [address, run])

  const running = !["idle", "needsWallet", "error", "done"].includes(st.phase)
  return (
    <>
      <a className="small" href={query ? `#/ask/${encodeURIComponent(query)}` : "#/"}>
        back to results
      </a>
      <h1>buy with bob</h1>
      <p className="muted">"{query}". bob checks out at the store over UCP, proves a past purchase if you have one, and pays in USDC on Stellar.</p>
      <div className="cols section">
        <section className="card">
          <StepTimeline
            steps={ucpSteps}
            done={st.done}
            phase={st.phase}
            failed={st.phase === "error"}
            detailFor={(id) => (id === "prove" && st.download && st.download.total > 0 ? `fetching proving files, ${(st.download.loaded / 1e6).toFixed(1)} of ${(st.download.total / 1e6).toFixed(1)} MB` : "")}
            tail={(id) =>
              id === "done" && st.txHash ? (
                <>
                  {" "}
                  <TxLink href={sdk.chain.explorerTx(st.txHash)} hash={st.txHash}>
                    payment on Stellar
                  </TxLink>
                </>
              ) : null
            }
          />
          {st.phase === "idle" && (
            <button type="button" onClick={run}>
              buy {st.hit?.title ?? title} with bob
            </button>
          )}
          {st.phase === "needsWallet" && (
            <Note>
              connect to let bob pay (demo key or Freighter). <ConnectButton />
            </Note>
          )}
          {st.phase === "done" && (
            <div>
              <h2>{st.proved?.applied ? "proof verified, price dropped" : "paid"}</h2>
              <p>paid {usdcRaw(st.paidRaw)} USDC at the store.</p>
            </div>
          )}
          {st.phase === "error" && st.error && (
            <Note tone="warn">
              {st.error.copy}{" "}
              <button type="button" className="secondary" onClick={run}>
                retry
              </button>
            </Note>
          )}
          {running && (
            <p className="small muted" role="status">
              bob is working
            </p>
          )}
        </section>
        <UcpCart
          title={st.hit?.title ?? title}
          imageUrl={st.hit?.imageUrl ?? null}
          listUsdc={st.hit?.price ?? 0}
          currency={st.checkout?.currency}
          subtotal={st.checkout?.subtotal}
          provisionalDiscount={st.checkout?.provisionalDiscount}
          proved={st.proved}
          paysRaw={st.quote?.pays_raw}
          paidRaw={st.paidRaw}
        />
      </div>
    </>
  )
}
