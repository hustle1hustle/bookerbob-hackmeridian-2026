// App shell: role switcher, connect, banners, footer. Plain on purpose; the designed shell drops in here.
import { useEffect, useState, type ReactNode } from "react"
import { autoOnce } from "./demo"
import { errorCopy, formatUsdc, type WalletKind } from "@bookerbob/pos-sdk"
import { useWriteFlow } from "./flows"
import { sdk } from "./sdk"
import { useAsync, useRoute, useWallet, type Role } from "./store"

const roles: { id: Role; label: string; to: string }[] = [
  { id: "guest", label: "Guest", to: "#/" },
  { id: "hotel", label: "Hotel", to: "#/desk" },
  { id: "arbiter", label: "Arbiter", to: "#/arbiter" },
]

export function RoleSwitcher({ role }: { role: Role }) {
  return (
    <nav className="roles" aria-label="view as">
      {roles.map((r) => (
        <a key={r.id} href={r.to} aria-current={role === r.id ? "page" : undefined}>
          {r.label}
        </a>
      ))}
    </nav>
  )
}

type ConnectState = { status: "idle" } | { status: "choosing" } | { status: "connecting"; kind: WalletKind } | { status: "error"; copy: string }

/** "get test USDC": sdk.chain.faucet() through the faucet state machine. Also offered on InsufficientFunds. */
export function FaucetButton() {
  const flow = useWriteFlow("faucet")
  const run = () => flow.run(() => sdk.chain.faucet())
  const runFlow = flow.run
  useEffect(() => {
    if (sdk.wallet.address && autoOnce("faucet")) void runFlow(() => sdk.chain.faucet())
  }, [runFlow])
  return (
    <span className="row">
      <button type="button" className="secondary" onClick={run} disabled={flow.state.status === "submitting"}>
        {flow.state.status === "submitting" ? "minting" : "get test USDC"}
      </button>
      {flow.state.status === "success" && <span className="small" role="status">added</span>}
      {flow.state.status === "error" && <span className="small">{flow.state.copy}</span>}
      {flow.state.status === "needsWallet" && <span className="small">connect first</span>}
    </span>
  )
}

function Balance() {
  const address = useWallet()
  const bal = useAsync(() => sdk.chain.balance(), [address])
  if (bal.data == null) return null
  return <span className="small">{formatUsdc(bal.data)} USDC</span>
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
      <div className="row">
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
    <div className="row" role="group" aria-label="connect with">
      <button type="button" onClick={() => connect("local")} disabled={busy}>
        {busy && st.kind === "local" ? "creating your demo key" : "demo key in this browser"}
      </button>
      <button type="button" className="secondary" onClick={() => connect("freighter")} disabled={busy}>
        {busy && st.kind === "freighter" ? "waiting for Freighter" : "Freighter"}
      </button>
      <button type="button" className="secondary" disabled title="coming soon">
        passkey (coming soon)
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

export function Shell({ children }: { children: ReactNode }) {
  const { role } = useRoute()
  const address = useWallet()
  return (
    <>
      <a className="skip" href="#main">
        skip to content
      </a>
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#/">
            BookerBob <span className="muted">· Proof of Loyalty</span> <span className="small muted">everywhere you go</span>
          </a>
          <RoleSwitcher role={role} />
          <ConnectButton />
        </div>
      </header>
      <div className="banner">
        <div className="wrap">demo data on Stellar testnet. the places are fictional; every review is a real proof checked on chain.</div>
      </div>
      {!address && (
        <div className="banner">
          <div className="wrap">read-only. every place, rating and review is visible. connect to book, review or check someone in.</div>
        </div>
      )}
      {role === "guest" && (
        <nav className="wrap row small" aria-label="guest" style={{ paddingTop: 12 }}>
          <a href="#/">ask bob</a>
          <a href="#/places">places</a>
          <a href="#/stays">my stays</a>
        </nav>
      )}
      <main id="main" className="wrap">
        {children}
      </main>
      <footer>
        <div className="wrap">
          <span>BookerBob · Proof of Loyalty, everywhere you go.</span>
          <a href="#/about">what each party sees</a>
          <a href={sdk.chain.explorerContract()} target="_blank" rel="noreferrer">
            contract on stellar.expert
          </a>
          <span className="muted">sdk: {sdk.mode}</span>
        </div>
      </footer>
    </>
  )
}
