// Arbiter role: dispute queue, 3-step disclosure check, attest.
import { useEffect } from "react"
import { autoOnce } from "../demo"
import { attachDisclosure, listDisputes, markAttested, type Dispute } from "../disputes"
import { useCheckFlow, useWriteFlow } from "../flows"
import { getPlaceReviews, listPlaces, sdk } from "../sdk"
import { ConnectButton } from "../Shell"
import { useAsync, useRevision } from "../store"
import { Empty, Loading, TxLink } from "../ui"
import { FlowStatus } from "../views/flow"
import { DisputeCard } from "../views/arbiter"
import type { Review } from "@bookerbob/pos-sdk"

function DisputeItem({ d, placeName, review }: { d: Dispute; placeName: string; review: Review | null }) {
  const check = useCheckFlow()
  const attest = useWriteFlow("attest")
  const attested = !!d.attestTx || !!review?.verified
  const doAttest = () =>
    attest.run(async () => {
      const r = await sdk.chain.attest(d.reviewId)
      if ("txHash" in r) markAttested(d.reviewId, r.txHash)
      return r
    })

  const runCheck = check.check
  useEffect(() => {
    if (d.pkg && autoOnce("attest", "check")) void runCheck(d.pkg)
  }, [d.pkg, runCheck])

  return (
    <DisputeCard
      placeName={placeName}
      review={review}
      pkg={d.pkg}
      attested={attested}
      check={check.state}
      onCheck={() => d.pkg && check.check(d.pkg)}
      onAttest={doAttest}
      canAttest={check.state.status === "checked" && check.state.allOk && attest.state.status !== "submitting"}
      attestStatus={
        attest.state.status !== "idle" ? (
          <FlowStatus
            state={attest.state}
            connect={<ConnectButton />}
            onRetry={doAttest}
            success={
              attest.state.status === "success" && (
                <>
                  attested. the review now shows "verified stay"; the hotel never learns who.{" "}
                  <TxLink href={sdk.chain.explorerTx(attest.state.result.txHash)} hash={attest.state.result.txHash}>
                    attestation on Stellar
                  </TxLink>
                </>
              )
            }
          />
        ) : (
          attested && <p className="note ok">already attested: verified stay.</p>
        )
      }
    />
  )
}

/** Demo only (?auto=attest): a guest in this browser reviews, then discloses, so the queue has a package to check. */
function useArbiterScenario() {
  useEffect(() => {
    if (!autoOnce("attest", "scenario")) return
    void (async () => {
      const stay = sdk.stays.list().find((s) => s.checkedIn && s.reviewId === null)
      if (!stay || !sdk.wallet.address) return
      await sdk.chain.postReview(stay, 4, "kind desk, quiet room, would stay again")
      attachDisclosure(await sdk.disclosure.build(stay))
    })()
  }, [])
}

export function ArbiterScreen() {
  useRevision()
  useArbiterScenario()
  const places = useAsync(listPlaces, [])
  const disputes = listDisputes()
  const merchants = [...new Set(disputes.map((d) => d.merchant))]
  const reviews = useAsync(async () => (await Promise.all(merchants.map(getPlaceReviews))).flat(), [merchants.join(",")])
  const nameOf = (id: number) => places.data?.find((p) => p.id === id)?.name ?? `place #${id}`
  const reviewOf = (id: number) => reviews.data?.find((r) => r.id === id) ?? null
  const open = disputes.filter((d) => !d.attestTx && !reviewOf(d.reviewId)?.verified)
  const done = disputes.filter((d) => !open.includes(d))

  return (
    <>
      <h1>dispute queue</h1>
      <p className="muted">
        a guest can privately show you that a disputed review is theirs and the stay was real. you check three things, then attest. the hotel and the public only ever see "verified stay".
      </p>
      {places.loading && !places.data && <Loading what="disputes" />}
      {disputes.length === 0 ? (
        <Empty title="no disputes">when a hotel disputes a review, it shows up here.</Empty>
      ) : (
        <div className="list section">
          {[...open, ...done].map((d) => (
            <DisputeItem key={d.reviewId} d={d} placeName={nameOf(d.merchant)} review={reviewOf(d.reviewId)} />
          ))}
        </div>
      )}
      <p className="small muted section">
        today the arbiter sees which checkout a disclosure points to. a blind arbiter (TEE or MPC) is on the roadmap.
      </p>
    </>
  )
}
