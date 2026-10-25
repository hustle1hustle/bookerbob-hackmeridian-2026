// App shell in REP Labs layout: mark, nav, paper. Bind points unchanged.
import { useEffect, useState, type ReactNode } from "react"
import { autoOnce } from "./demo"
import { errorCopy, formatUsdc, type WalletKind } from "@bookerbob/pos-sdk"
import { useWriteFlow } from "./flows"
import { faucet, sdk } from "./sdk"
import { useAsync, useRoute, useWallet, type Role } from "./store"
import { LoyaltyTierChip } from "./views/LoyaltyChip"

const roles: { id: Role; label: string; to: string }[] = [
  { id: "guest", label: "Guest", to: "#/" },
  { id: "hotel", label: "Hotel", to: "#/desk" },
  { id: "arbiter", label: "Arbiter", to: "#/arbiter" },
]

export function RoleSwitcher({ role }: { role: Role }) {
  return (
    <ul className="nav" aria-label="view as">
      {roles.map((r) => (
        <li key={r.id}>
          <a href={r.to} aria-current={role === r.id ? "page" : undefined}>
            {r.label}
          </a>
        </li>
      ))}
    </ul>
  )
}

type ConnectState = { status: "idle" } | { status: "choosing" } | { status: "connecting"; kind: WalletKind } | { status: "error"; copy: string }

/** "get test USDC": sdk.chain.faucet() through the faucet state machine. Also offered on InsufficientFunds. */
export function FaucetButton() {
  const flow = useWriteFlow("faucet")
  const run = () => flow.run(faucet)
  const runFlow = flow.run
  useEffect(() => {
    if (sdk.wallet.address && autoOnce("faucet")) void runFlow(faucet)
  }, [runFlow])
  return (
    <span className="row">
      <button type="button" className="secondary" onClick={run} disabled={flow.state.status === "submitting"}>
        {flow.state.status === "submitting" ? "minting" : "get test USDC"}
      </button>
      {flow.state.status === "success" && (
        <span className="small" role="status">
          added
        </span>
      )}
      {flow.state.status === "error" && <span className="small">{flow.state.copy}</span>}
      {flow.state.status === "needsWallet" && <span className="small">connect first</span>}
    </span>
  )
}

function Balance() {
  const address = useWallet()
  const bal = useAsync(() => sdk.chain.balance(), [address])
  if (bal.data == null) return null
  return <span className="small mono">{formatUsdc(bal.data)} USDC</span>
}

const kindName: Record<string, string> = { local: "demo key", freighter: "Freighter", passkey: "passkey" }

/** Connect states: idle, choosing, connecting, error. Connected shows address, test USDC balance and the faucet. */
export function ConnectButton() {
  const address = useWallet()
  const [st, setSt] = useState<ConnectState>({ status: "idle" })

  const connect = async (kind: WalletKind) => {
    setSt({ status: "connecting", kind })
    try {
      await sdk.wallet.connect(kind)
      setSt({ status: "idle" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      setSt({ status: "error", copy: /not installed/i.test(msg) ? "Freighter is not installed in this browser" : errorCopy.UserRejected })
    }
  }

  if (address)
    return (
      <div className="row connect-slot">
        <span className="small">
          {address.slice(0, 4)}…{address.slice(-4)} <span className="muted">({kindName[sdk.wallet.kind ?? ""] ?? sdk.wallet.kind})</span>
        </span>
        <Balance />
        <FaucetButton />
        <button type="button" className="secondary" onClick={() => sdk.wallet.disconnect()}>
          disconnect
        </button>
      </div>
    )

  if (st.status === "idle")
    return (
      <button type="button" onClick={() => setSt({ status: "choosing" })}>
        connect
      </button>
    )

  const busy = st.status === "connecting"
  return (
    <div className="row connect-slot" role="group" aria-label="connect with">
      <button type="button" onClick={() => connect("local")} disabled={busy}>
        {busy && st.kind === "local" ? "creating your demo key" : "demo key"}
      </button>
      <button type="button" className="secondary" onClick={() => connect("freighter")} disabled={busy}>
        {busy && st.kind === "freighter" ? "waiting for Freighter" : "Freighter"}
      </button>
      <button type="button" className="secondary" onClick={() => connect("passkey")} disabled={busy}>
        {busy && st.kind === "passkey" ? "waiting for passkey…" : "passkey"}
      </button>
      {!busy && (
        <button type="button" className="secondary" onClick={() => setSt({ status: "idle" })}>
          cancel
        </button>
      )}
      {st.status === "error" && <span className="small">{st.copy}</span>}
    </div>
  )
}

declare global {
  interface Window {
    BookerBobMyc?: { boot: () => void }
  }
}

export function Shell({ children }: { children: ReactNode }) {
  const { role, path } = useRoute()
  const address = useWallet()
  // the hero (with the field canvas) is the Ask Bob landing: #/ and #/ask/<query>
  const home = (path[0] ?? "") === "" || path[0] === "ask"
  // the contract id comes from the backend config; the link stays hidden until it is known (never an empty id)
  const [contractId, setContractId] = useState("")
  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((c) => setContractId(String(c?.contractId ?? ""))).catch(() => {})
  }, [])

  // myc.js boots on first paint; React mounts the hero canvas later — re-run once it exists.
  useEffect(() => {
    const t = window.setTimeout(() => window.BookerBobMyc?.boot(), 40)
    return () => window.clearTimeout(t)
  }, [home])

  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        skip to content
      </a>

      <div className={home ? "hero" : "app-head"}>
        {home && <canvas className="hero-field" aria-hidden="true" />}
        <div className="wrap">
          <header className="site-head">
            <a className="mark" href="#/">
              <b>Booker</b>Bob
            </a>
            <div className="head-actions">
              <RoleSwitcher role={role} />
              <LoyaltyTierChip />
              <ConnectButton />
            </div>
          </header>
        </div>
      </div>

      <div className="app-body">
        <div className="banner">
          <div className="wrap">demo data on Stellar testnet · fictional places · every review is a real, verified proof</div>
        </div>
        {!address && (
          <div className="banner">
            <div className="wrap">read-only without a wallet · connect to book, review or check someone in</div>
          </div>
        )}
        {role === "guest" && (
          <div className="wrap">
            <nav className="guest-sub" aria-label="guest">
              <a href="#/" aria-current={home ? "page" : undefined}>
                ask bob
              </a>
              <a href="#/places" aria-current={path[0] === "places" || path[0] === "place" ? "page" : undefined}>
                places
              </a>
              <a href="#/stays" aria-current={path[0] === "stays" ? "page" : undefined}>
                my stays
              </a>
              <a href="#/about">what each party sees</a>
            </nav>
          </div>
        )}
        <main id="main" className="wrap app-main">
          {children}
        </main>
      </div>

      <footer className="site-foot">
        <div className="wrap">
          <span className="mark-mini">
            <b>Booker</b>Bob
          </span>
          <span>Proof of Loyalty · everywhere you go</span>
          <a href="#/about">what each party sees</a>
          {contractId && (
            <a href={`https://stellar.expert/explorer/testnet/contract/${contractId}`} target="_blank" rel="noreferrer">
              contract on stellar.expert
            </a>
          )}
          <a href="https://stellarbob2026.xyz/" target="_blank" rel="noreferrer">
            stellarbob2026.xyz
          </a>
          <span className="muted mono">sdk {sdk.mode}</span>
        </div>
      </footer>
    </div>
  )
}
