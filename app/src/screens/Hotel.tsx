// Hotel role: checkout desk and review feed with disputes. The place is chosen in the URL (#/desk/:id).
import { useEffect, useState } from "react"
import { shortHex } from "@bookerbob/pos-sdk"
import { autoOnce } from "../demo"
import { disputeFor, openDispute } from "../disputes"
import { useWriteFlow } from "../flows"
import { getPlaceReviews, listPlaces, sdk } from "../sdk"
import { ConnectButton } from "../Shell"
import { go, useAsync, useRevision, useWallet } from "../store"
import { Empty, Loading, TxLink, plural } from "../ui"
import { FlowStatus } from "../views/flow"
import { CheckoutForm, DisputeControl, PlacePicker } from "../views/hotel"
import { PlaceHeader, ReviewFeed } from "../views/places"

function HotelNav({ tab, id }: { tab: "desk" | "feed"; id: number }) {
  return (
    <nav className="row small" aria-label="hotel" style={{ marginBottom: 12 }}>
      <a href={`#/desk/${id}`} aria-current={tab === "desk" ? "page" : undefined}>
        checkout desk
      </a>
      <a href={`#/feed/${id}`} aria-current={tab === "feed" ? "page" : undefined}>
        reviews
      </a>
    </nav>
  )
}

function usePlaces(id: number) {
  const places = useAsync(listPlaces, [])
  const place = places.data?.find((p) => p.id === id)
  return { places, place }
}

export function DeskScreen({ id }: { id: number }) {
  const { places, place } = usePlaces(id)
  const flow = useWriteFlow<{ root: string }>("checkout")
  const [commitment, setCommitment] = useState("")
  const confirm = (c = commitment) => flow.run(() => sdk.chain.checkout(id, c.trim()))

  const run = flow.run
  useEffect(() => {
    // demo: the guest in this browser hands over a fresh stay code
    if (place && autoOnce("checkout")) {
      const c = sdk.stays.create(id).commitment
      setCommitment(c)
      void run(() => sdk.chain.checkout(id, c))
    }
  }, [place, id, run])

  if (places.loading && !places.data) return <Loading what="places" />
  if (!place) return <Empty title="this place does not exist"><a href="#/desk/0">checkout desk</a></Empty>
  return (
    <>
      <HotelNav tab="desk" id={id} />
      <PlacePicker places={places.data ?? []} value={id} onChange={(v) => go(`#/desk/${v}`)} />
      <div className="cols section" style={{ marginTop: 12 }}>
        <CheckoutForm
          placeName={place.name}
          commitment={commitment}
          onCommitment={(v) => {
            setCommitment(v)
            if (flow.state.status !== "idle") flow.reset()
          }}
          onConfirm={() => confirm()}
          disabled={flow.state.status === "submitting"}
          status={
            <FlowStatus
              state={flow.state}
              connect={<ConnectButton />}
              submittingText="adding the stay on Stellar testnet"
              onRetry={() => confirm()}
              success={
                flow.state.status === "success" && (
                  <>
                    checked in. new root <span className="mono">{shortHex(flow.state.result.root)}</span>{" "}
                    <TxLink href={sdk.chain.explorerTx(flow.state.result.txHash)} hash={flow.state.result.txHash}>
                      checkout on Stellar
                    </TxLink>
                  </>
                )
              }
            />
          }
        />
        <aside className="card">
          <h3>{place.name}</h3>
          <p className="small">{place.provenStays > 0 ? plural(place.provenStays, "proven stay") : "no proven stays yet"}</p>
          <p className="small muted">
            current root <span className="mono">{shortHex(place.root)}</span>
          </p>
        </aside>
      </div>
    </>
  )
}

export function FeedScreen({ id }: { id: number }) {
  useRevision()
  const address = useWallet()
  const { places, place } = usePlaces(id)
  const reviews = useAsync(() => getPlaceReviews(id), [id])
  if (places.loading && !places.data) return <Loading what="places" />
  if (!place) return <Empty title="this place does not exist"><a href="#/feed/0">reviews</a></Empty>
  return (
    <>
      <HotelNav tab="feed" id={id} />
      <PlacePicker places={places.data ?? []} value={id} onChange={(v) => go(`#/feed/${v}`)} />
      <PlaceHeader place={place} />
      <p className="muted small">
        you see the stars and the text, never the author. if a review looks wrong, dispute it: the guest can then prove the stay to the arbiter, privately.
      </p>
      {!address && <p className="small">connect to dispute a review.</p>}
      {reviews.loading && !reviews.data ? (
        <Loading what="reviews" />
      ) : (
        <ReviewFeed
          reviews={reviews.data ?? []}
          txHrefFor={(r) => (r.txHash ? sdk.chain.explorerTx(r.txHash) : null)}
          actionFor={(r) => <DisputeControl dispute={disputeFor(r.id)} verified={r.verified} canAct={!!address} onDispute={() => openDispute(r.id, id)} />}
        />
      )}
    </>
  )
}
