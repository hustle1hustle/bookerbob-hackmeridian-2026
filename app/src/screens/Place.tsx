// Guest: one place. Header, review feed, book at full price or with the returning-guest discount.
import { useEffect } from "react"
import { averageRating, errorCopy, formatUsdc } from "@bookerbob/pos-sdk"
import { autoOnce } from "../demo"
import { useWriteFlow } from "../flows"
import { getPlace, getPlaceReviews, sdk, stayWord } from "../sdk"
import { ConnectButton, FaucetButton } from "../Shell"
import { useAsync } from "../store"
import { Empty, Loading, TxLink } from "../ui"
import { FlowStatus } from "../views/flow"
import { PlaceHeader, ReviewFeed, discountPct } from "../views/places"
import { RatingCompare } from "../views/explainer"
import { WalletScoreHint } from "../views/LoyaltyChip"

/** Static demo copy for the comparison block (handoff), not data. */
const PUBLIC_DEMO = { rating: "9.1", count: "2,000" }

export function PlaceScreen({ id }: { id: number }) {
  const place = useAsync(() => getPlace(id), [id])
  const reviews = useAsync(() => getPlaceReviews(id), [id])
  const book = useWriteFlow<{ paid: bigint }>("book")

  const runBook = book.run
  useEffect(() => {
    if (place.data && autoOnce("book")) void runBook(() => sdk.chain.book(id))
  }, [place.data, id, runBook])

  if (place.loading && !place.data) return <Loading what="this place" />
  if (!place.data) return <Empty title={errorCopy.MerchantNotFound}><a href="#/">back to places</a></Empty>
  const p = place.data
  const word = stayWord(p.kind)
  const pastStays = sdk.stays.list().map((s, i) => ({ s, i })).filter(({ s }) => s.merchant === id && s.checkedIn)
  const discounted = (p.price * BigInt(10_000 - p.discountBps)) / 10_000n

  return (
    <>
      <a href="#/" className="small">
        all places
      </a>
      <div className="cols section" style={{ marginTop: 8 }}>
        <div>
          <PlaceHeader place={p} />
          {p.kind === "hotel" && (
            <RatingCompare
              publicRating={PUBLIC_DEMO.rating}
              publicCount={PUBLIC_DEMO.count}
              proven10={averageRating(p) === null ? null : averageRating(p)! * 2}
              provenCount={p.ratingCount}
            />
          )}
          <h2 className="section">proven reviews</h2>
          {reviews.loading && !reviews.data ? (
            <Loading what="reviews" />
          ) : (
            <ReviewFeed reviews={reviews.data ?? []} txHrefFor={(r) => (r.txHash ? sdk.chain.explorerTx(r.txHash) : null)} />
          )}
        </div>

        <aside className="card">
          <h2>book</h2>
          <p>
            <strong>{formatUsdc(p.price)} USDC</strong> <span className="muted small">{p.kind === "hotel" ? "per night" : "per order"}, paid in USDC on Stellar</span>
          </p>
          <button type="button" onClick={() => book.run(() => sdk.chain.book(id))} disabled={book.state.status === "submitting"}>
            book at full price
          </button>
          <FlowStatus
            state={book.state}
            connect={<ConnectButton />}
            faucet={<FaucetButton />}
            onRetry={() => book.run(() => sdk.chain.book(id))}
            success={
              book.state.status === "success" && (
                <>
                  booked, paid {formatUsdc(book.state.result.paid)} USDC.{" "}
                  <TxLink href={sdk.chain.explorerTx(book.state.result.txHash)} hash={book.state.result.txHash}>
                    payment on Stellar
                  </TxLink>
                </>
              )
            }
          />

          <div className="section">
            <WalletScoreHint merchantDiscountBps={p.discountBps} />
          </div>

          {p.discountBps > 0 && (
            <div className="section">
              <h3>returning guest, {discountPct(p.discountBps)} off</h3>
              <p>
                <span className="strike">{formatUsdc(p.price)}</span> <strong>{formatUsdc(discounted)} USDC</strong>
              </p>
              {pastStays.length > 0 ? (
                <a className="btn" href={`#/stays/${pastStays[0].i}/discount`}>
                  book with discount
                </a>
              ) : (
                <p className="small muted">
                  needs a proven past {word} here. the proof shows you were a guest, not which one.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
