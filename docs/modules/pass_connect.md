# Module: `pass_connect`

Package: `@bookerbob/pass_connect`  
Path: `packages/pass_connect/`

Connect a guest with a **platform passkey** (WebAuthn / Touch ID / Face ID) and produce a Stellar-capable session that the rest of the app can use like Freighter or the demo key.

## What it does

1. Creates or reuses a WebAuthn credential.
2. Derives a 32-byte seed:
   - **prf** — WebAuthn PRF extension (preferred; seed never stored).
   - **credential-bound** — fallback hash of credential id + local salt (seed stored in `localStorage`).
3. Builds a Stellar **G…** Ed25519 keypair, Friendbot-funds on first create (testnet).
4. Returns `PassSession` for the host SDK.

Raven is **not** used here (Raven is an MCP docs gateway). See `docs/raven.md`.

## API

```ts
import {
  connectPasskey,
  restorePasskey,
  clearStored,
  isPasskeyAvailable,
  PassConnectException,
  type PassSession,
} from "@bookerbob/pass_connect"

const { session, seed } = await connectPasskey({ rpName: "BookerBob" })
// session.address, session.credentialId, session.binding
```

Wire into Proof of Stay SDK:

```ts
await sdk.wallet.connect("passkey") // packages/sdk/src/testnet.ts
```

## Design (app)

- Header connect chooser: **passkey** button (enabled).
- Home panel `PassConnectPanel`: connect + hand-off to `verify_onchain_zk`.

## Phase 2 hook

Replace seed→G… with **Smart Account Kit** `C…` wallets + OpenZeppelin Channels relayer (`/api/send`). Keep the same `PassSession` shape (`address`, `kind: "passkey"`). Documented in `docs/raven.md` §4.

## Errors

| Code | UI |
|---|---|
| `PasskeyUnsupported` | browser has no WebAuthn |
| `UserCancelled` | map to SDK `UserRejected` |
| `PasskeyFailed` | generic failure |
