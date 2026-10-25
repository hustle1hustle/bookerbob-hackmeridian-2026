// Guest: my stays, one stay (code + QR), write review, discount booking, disclose to arbiter.
import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { formatUsdc, type DiscountDone, type ReviewDone, type Stay } from "@bookerbob/pos-sdk"
import { autoOnce } from "../demo"
import { useDiscloseFlow, useProofFlow } from "../flows"
import { SEASON, getPlace, listPlaces, sdk, seasonLabel, stayWord, type Place } from "../sdk"
import { ConnectButton, FaucetButton } from "../Shell"
import { bump, go, useAsync, useRevision } from "../store"
import { Empty, Loading, TxLink } from "../ui"
import { ProofMoment } from "../views/flow"
import { discountPct } from "../views/places"
import { CommitmentCard, DisclosePanel, DiscountSummary, ReviewForm, StayItem, StayList } from "../views/stays"

const stayAt = (i: number): Stay | undefined => sdk.stays.list()[i]

function useQr(text: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!text) return
    let live = true
    QRCode.toDataURL(text, { margin: 1, width: 320 }).then((u) => live && setUrl(u), () => live && setUrl(null))
    return () => {
      live = false
    }
  }, [text])
  return url
}

function StayActions({ i, stay, place }: { i: number; stay: Stay; place?: Place }) {
  if (!stay.checkedIn) return <a href={`#/stays/${i}`}>show stay code</a>
  return (
    <>
      <a className="btn" href={`#/stays/${i}/review`}>
        write review
      </a>
      {place && place.discountBps > 0 && (
        <a className="btn secondary" href={`#/stays/${i}/discount`}>
          returning-guest discount
        </a>
      )}
      {stay.reviewId !== null && (
        <a className="btn secondary" href={`#/stays/${i}/disclose`}>
          disclose to arbiter
        </a>
      )}
    </>
  )
}

export function StaysScreen() {
  useRevision()
  const synced = useAsync(() => sdk.stays.sync(), [])
  const places = useAsync(listPlaces, [])
  const [pick, setPick] = useState<number>(0)
  const stays = sdk.stays.list()
  const byId = new Map((places.data ?? []).map((p) => [p.id, p]))

  return (
    <>
      <h1>my stays</h1>
      <p className="muted">kept in this browser only, never on chain. each stay has its own identity, so two stays cannot be linked to each other.</p>
      {synced.loading && <Loading what="check-in status" />}
      <StayList
        items={stays.map((s, i) => (
          <StayItem
            key={i}
            stay={s}
            place={byId.get(s.merchant)}
            href={`#/stays/${i}`}
            word={stayWord(byId.get(s.merchant)?.kind ?? "hotel")}
            actions={<StayActions i={i} stay={s} place={byId.get(s.merchant)} />}
          />
        ))}
        empty={<Empty title="no stays in this browser yet">start one below and show its code at checkout.</Empty>}
      />
      <section className="card section">
        <h2>start a new stay</h2>
        <p className="muted small">creates a fresh stay code in this browser. show it at the desk when you check out.</p>
        {places.data && places.data.length > 0 ? (
          <div className="row">
            <select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="place">
              {places.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                sdk.stays.create(pick)
                bump()
                go(`#/stays/${sdk.stays.list().length - 1}`)
              }}
            >
              create stay code
            </button>
          </div>
        ) : (
          <Loading what="places" />
        )}
      </section>
    </>
  )
}

export function StayScreen({ i }: { i: number }) {
  useRevision()
  useAsync(() => sdk.stays.sync(), [i])
  const stay = stayAt(i)
  const place = useAsync(() => (stay ? getPlace(stay.merchant) : Promise.reject(new Error("no stay"))), [i])
  const qr = useQr(stay?.commitment ?? null)
  if (!stay) return <Empty title="this stay is not in this browser"><a href="#/stays">my stays</a></Empty>
  return (
    <>
      <a className="small" href="#/stays">
        my stays
      </a>
      <h1>{place.data?.name ?? "your stay"}</h1>
      <CommitmentCard commitment={stay.commitment} qr={qr} checkedIn={stay.checkedIn} />
      <div className="row section">
        <StayActions i={i} stay={stay} place={place.data ?? undefined} />
      </div>
    </>
  )
}

function useStayAndPlace(i: number) {
  useRevision()
  const stay = stayAt(i)
  const place = useAsync(() => (stay ? getPlace(stay.merchant) : Promise.reject(new Error("no stay"))), [i])
  return { stay, place: place.data, loading: place.loading }
}

const notHere = <Empty title="this stay is not in this browser"><a href="#/stays">my stays</a></Empty>

export function ReviewScreen({ i }: { i: number }) {
  const { stay, place } = useStayAndPlace(i)
  const flow = useProofFlow<ReviewDone>("review")
  const [rating, setRating] = useState<number>(0)
  const [text, setText] = useState("")
  const submit = (r = rating, t = text) => stay && r >= 1 && flow.run({ kind: "review", stay, rating: r as 1 | 2 | 3 | 4 | 5, text: t.trim() })

  const run = flow.run
  useEffect(() => {
    if (stay && autoOnce("review")) {
      const t = "quiet street, kind desk, the breakfast was simple and good"
      setRating(4)
      setText(t)
      void run({ kind: "review", stay, rating: 4, text: t })
    }
  }, [stay, run])

  if (!stay) return notHere
  const busy = flow.state.status !== "idle" && flow.state.status !== "error" && flow.state.status !== "needsWallet"
  return (
    <>
      <a className="small" href="#/stays">
        my stays
      </a>
      <div className="list" style={{ marginTop: 8 }}>
        <ReviewForm placeName={place?.name ?? "this place"} rating={rating} text={text} onRating={setRating} onText={setText} onSubmit={() => submit()} disabled={busy} />
        <ProofMoment
          state={flow.state}
          cached={flow.cached}
          connect={<ConnectButton />}
          onRetry={() => submit()}
          success={
            flow.state.status === "success" && (
              <div>
                <h2>proof verified, review posted</h2>
                <p className="muted">it shows on {place?.name ?? "the place"} with your stars, not your name.</p>
                <TxLink href={sdk.chain.explorerTx(flow.state.result.txHash)} hash={flow.state.result.txHash} />{" "}
                <a href={`#/place/${stay.merchant}`}>see it on the place page</a>
              </div>
            )
          }
          alreadyDone={(copy) => (
            <div>
              <h2>{copy}</h2>
              <p className="muted">
                one review per stay, and Stellar keeps count without knowing who you are. nothing new was posted.
              </p>
              <a href={`#/place/${stay.merchant}`}>read the reviews</a>
            </div>
          )}
        />
      </div>
    </>
  )
}

export function DiscountScreen({ i }: { i: number }) {
  const { stay, place } = useStayAndPlace(i)
  const flow = useProofFlow<DiscountDone>("discount")
  const season = SEASON
  const submit = () => stay && flow.run({ kind: "discount", stay, season })

  const run = flow.run
  useEffect(() => {
    if (stay && autoOnce("discount")) void run({ kind: "discount", stay, season })
  }, [stay, run, season])

  if (!stay) return notHere
  if (!place) return <Loading what="this place" />
  const discounted = (place.price * BigInt(10_000 - place.discountBps)) / 10_000n
  const busy = flow.state.status !== "idle" && flow.state.status !== "error" && flow.state.status !== "needsWallet"
  return (
    <>
      <a className="small" href="#/stays">
        my stays
      </a>
      <div className="list" style={{ marginTop: 8 }}>
        <DiscountSummary
          placeName={place.name}
          price={place.price}
          discounted={discounted}
          pct={discountPct(place.discountBps)}
          seasonText={seasonLabel(season)}
          usedThisSeason={stay.discountSeasonsUsed.includes(season) && flow.state.status === "idle"}
          onSubmit={submit}
          disabled={busy || !stay.checkedIn}
        />
        <ProofMoment
          state={flow.state}
          cached={flow.cached}
          connect={<ConnectButton />}
          faucet={<FaucetButton />}
          onRetry={submit}
          success={
            flow.state.status === "success" && (
              <div>
                <h2>proof verified, price dropped</h2>
                <p>
                  <span className="strike">{formatUsdc(place.price)}</span> <strong>{formatUsdc(flow.state.result.paid)} USDC</strong>
                </p>
                <p className="muted">
                  paid {formatUsdc(flow.state.result.paid)} USDC, saved {formatUsdc(flow.state.result.saved)}.
                </p>
                <TxLink href={sdk.chain.explorerTx(flow.state.result.txHash)} hash={flow.state.result.txHash}>
                  payment and proof on Stellar
                </TxLink>
              </div>
            )
          }
          alreadyDone={(copy) => (
            <div>
              <h2>{copy}</h2>
              <p className="muted">each past stay unlocks the discount once per season. you can still book at full price.</p>
              <a href={`#/place/${stay.merchant}`}>book at full price</a>
            </div>
          )}
        />
      </div>
    </>
  )
}

export function DiscloseScreen({ i }: { i: number }) {
  const { stay, place } = useStayAndPlace(i)
  const flow = useDiscloseFlow()
  const send = flow.send
  useEffect(() => {
    if (stay && stay.reviewId !== null && autoOnce("disclose")) void send(stay)
  }, [stay, send])
  if (!stay) return notHere
  return (
    <>
      <a className="small" href="#/stays">
        my stays
      </a>
      <div style={{ marginTop: 8 }}>
        <DisclosePanel placeName={place?.name ?? "the hotel"} reviewed={stay.reviewId !== null} state={flow.state} onSend={() => send(stay)} />
      </div>
    </>
  )
}
