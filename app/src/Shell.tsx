// App shell: role switcher, connect, banners, footer. Plain on purpose; the designed shell drops in here.
import { useState, type ReactNode } from "react"
import { errorCopy, type WalletKind } from "@bookerbob/pos-sdk"
import { sdk } from "./sdk"
import { useRoute, useWallet, type Role } from "./store"

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

/** Connect states: idle, choosing (passkey / Freighter), connecting, error; connected shows the address. */
export function ConnectButton() {
  const address = useWallet()
  const [st, setSt] = useState<ConnectState>({ status: "idle" })

  const connect = async (kind: WalletKind) => {
    setSt({ status: "connecting", kind })
    try {
      await sdk.wallet.connect(kind)
      setSt({ status: "idle" })
    } catch {
      setSt({ status: "error", copy: errorCopy.UserRejected })
    }
  }

  if (address)
    return (
      <div className="row">
        <span className="small">
          connected {address.slice(0, 4)}…{address.slice(-4)} <span className="muted">({sdk.wallet.kind})</span>
        </span>
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

  return (
    <div className="row" role="group" aria-label="connect with">
      <button type="button" onClick={() => connect("passkey")} disabled={st.status === "connecting"}>
        {st.status === "connecting" && st.kind === "passkey" ? "waiting for passkey" : "passkey"}
      </button>
      <button type="button" className="secondary" onClick={() => connect("freighter")} disabled={st.status === "connecting"}>
        {st.status === "connecting" && st.kind === "freighter" ? "waiting for Freighter" : "Freighter"}
      </button>
      {st.status !== "connecting" && (
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
            BookerBob · proof of stay
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
      <main id="main" className="wrap">
        {children}
      </main>
      <footer>
        <div className="wrap">
          <span>private by default, accountable when needed.</span>
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
