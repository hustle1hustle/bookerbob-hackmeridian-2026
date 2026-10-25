// "Verified traveler with REP": the guest approves on the REP Bob app; BookerBob checks the REP-signed verdict
// and adds a fresh identity of this browser to the "REP verified traveler" group. Only yes or no is kept.
import { useEffect, useRef, useState } from "react"
import { sdk } from "../sdk"
import { bump } from "../store"
import { TxLink } from "../ui"

type Phase = { k: "idle" } | { k: "waiting"; sid: string; until: number } | { k: "passed"; tx: string | null } | { k: "failed"; why: string }

// A dedicated, never-checked-in stay identity: it joins only the REP group, so the public group tree
// cannot be joined with any merchant's customer tree.
const REP_STAY_MERCHANT = 5

const post = async (path: string, body: unknown) => (await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()

export function RepVerify() {
  const [phase, setPhase] = useState<Phase>({ k: "idle" })
  const [now, setNow] = useState(Date.now())
  const timer = useRef<number | null>(null)

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), [])

  const start = async () => {
    const stay = sdk.stays.create(REP_STAY_MERCHANT)
    const r = await post("/api/rep/session", { commitment: stay.commitment }).catch(() => ({ error: "network" }))
    if (r.error) return setPhase({ k: "failed", why: "bookerbob could not open a request, retry" })
    setPhase({ k: "waiting", sid: r.sid, until: r.expiresAt })
    timer.current = window.setInterval(async () => {
      setNow(Date.now())
      const res = await fetch(`/api/rep/result?sid=${r.sid}`).then((x) => x.json()).catch(() => null)
      if (!res || res.status === "pending") {
        if (Date.now() > r.expiresAt + 5000) (clearInterval(timer.current!), setPhase({ k: "failed", why: "the request expired, try again" }))
        return
      }
      clearInterval(timer.current!)
      if (res.status === "passed") {
        setPhase({ k: "passed", tx: res.txHash || null })
        bump() // perks re-read: the REP group now counts
      } else setPhase({ k: "failed", why: res.reason === "expired" ? "the request expired, try again" : "REP could not confirm it" })
    }, 2000)
  }

  return (
    <section className="card section">
      <h3>verified traveler</h3>
      {phase.k === "idle" && (
        <>
          <p className="muted">prove past stays with REP and get the verified-traveler perk where places honor it. bookerbob keeps only yes or no.</p>
          <button type="button" onClick={start}>
            verify with REP
          </button>
        </>
      )}
      {phase.k === "waiting" && (
        <p>
          open REP Bob on your phone and approve the request. {Math.max(0, Math.ceil((phase.until - now) / 1000))} s left.
        </p>
      )}
      {phase.k === "passed" && (
        <p>
          verified traveler. your perks now include it.{" "}
          {phase.tx && (
            <TxLink href={sdk.chain.explorerTx(phase.tx)} hash={phase.tx}>
              added on Stellar
            </TxLink>
          )}
        </p>
      )}
      {phase.k === "failed" && (
        <>
          <p className="muted">{phase.why}</p>
          <button type="button" className="secondary" onClick={() => setPhase({ k: "idle" })}>
            try again
          </button>
        </>
      )}
    </section>
  )
}
