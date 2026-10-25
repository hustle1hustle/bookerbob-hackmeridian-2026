// Arbiter role: dispute queue (packages redacted), the 3-step check where the package is held, attest.
import { useEffect } from "react"
import type { Dispute, Review } from "@bookerbob/pos-sdk"
import { autoOnce } from "../demo"
import { useCheckFlow, useWriteFlow } from "../flows"
import { getPlaceReviews, listPlaces, sdk } from "../sdk"
import { ConnectButton } from "../Shell"
import { useAsync } from "../store"
import { Empty, Loading, TxLink } from "../ui"
import { FlowStatus } from "../views/flow"
import { DisputeCard } from "../views/arbiter"

function DisputeItem({ d, placeName, review }: { d: Dispute; placeName: string; review: Review | null }) {
  const check = useCheckFlow()
  const attest = useWriteFlow("attest")
  const attested = !!d.attestTx || !!review?.verified
  const doAttest = () => attest.run(() => sdk.chain.attest(d.id))

  const runCheck = check.check
  useEffect(() => {
    if (!attested && autoOnce("attest", `check-${d.id}`)) void runCheck(d.id)
  }, [d.id, attested, runCheck])

  return (
    <DisputeCard
      placeName={placeName}
      reviewId={d.id}
      review={review}
      openedAt={d.openedAt}
      attested={attested}
      check={check.state}
      onCheck={() => check.check(d.id)}
      onAttest={doAttest}
      canAttest={check.state.status === "checked" && check.state.allOk && attest.state.status !== "submitting"}
      attestStatus={
        attest.state.status !== "idle" ? (
          <FlowStatus
            state={attest.state}
            connect={<ConnectButton />}
            submittingText="attesting on Stellar testnet"
            onRetry={doAttest}
            success={
              attest.state.status === "success" && (
                <>
                  attested. the review now shows "verified stay"; the place never learns who.{" "}
                  <TxLink href={sdk.chain.explorerTx(attest.state.result.txHash)} hash={attest.state.result.txHash}>
                    attestation on Stellar
                  </TxLink>
                </>
              )
            }
          />
        ) : (
          attested && (
            <p className="note ok">
              attested: verified stay.{" "}
              {d.attestTx && (
                <TxLink href={sdk.chain.explorerTx(d.attestTx)} hash={d.attestTx}>
                  attestation on Stellar
                </TxLink>
              )}
            </p>
          )
        )
      }
    />
  )
}

export function ArbiterScreen() {
  const places = useAsync(listPlaces, [])
  const queue = useAsync(() => sdk.disclosure.queue(), [])
  const disputes = queue.data ?? []
  const merchants = [...new Set(disputes.map((d) => d.merchant))]
  const reviews = useAsync(async () => (await Promise.all(merchants.map(getPlaceReviews))).flat(), [merchants.join(",")])
  const nameOf = (id: number) => places.data?.find((p) => p.id === id)?.name ?? `place #${id}`
  const reviewOf = (id: number) => reviews.data?.find((r) => r.id === id) ?? null
  const isOpen = (d: Dispute) => !d.attestTx && !reviewOf(d.id)?.verified
  const sorted = [...disputes.filter(isOpen), ...disputes.filter((d) => !isOpen(d))]

  return (
    <>
      <h1>dispute queue</h1>
      <p className="muted">
        a guest can privately show you that a disputed review is theirs and the stay was real. the check runs where the guest's package is held; you see the result, then attest. the place and
        the public only ever see "verified stay".
      </p>
      {queue.loading && !queue.data && <Loading what="disputes" />}
      {queue.error && <Empty title="could not load the dispute queue">refresh to retry.</Empty>}
      {queue.data && disputes.length === 0 && <Empty title="no disputes">when a guest discloses a disputed review, it shows up here.</Empty>}
      {disputes.length > 0 && (
        <div className="list section">
          {sorted.map((d) => (
            <DisputeItem key={d.id} d={d} placeName={nameOf(d.merchant)} review={reviewOf(d.id)} />
          ))}
        </div>
      )}
      <p className="small muted section">today the arbiter sees which checkout a disclosure points to. a blind arbiter (TEE or MPC) is on the roadmap.</p>
    </>
  )
}
