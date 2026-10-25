# Stellar Raven and passkeys on Stellar

Sources checked 2026-10-25: [raven.stellar.org](https://raven.stellar.org/), [raven docs](https://raven.stellar.org/docs), [terms](https://raven.stellar.org/terms), `/health`, and Stellar Developer Docs (smart wallets + guestbook passkey tutorial).

**Important split:** Raven is **not** a passkey wallet. It is an MCP gateway for AI agents. Passkeys on Stellar are a separate product stack (WebAuthn + smart contract accounts + relayer). Raven can help an agent *look up* that stack via docs and skills; it does not create passkeys, sign, or submit txs.

---

## 1. What Raven is

**Stellar Raven** is a remote [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives AI coding agents Stellar documentation and ecosystem context through **one** HTTPS endpoint:

```
https://raven.stellar.org/mcp
```

Tagline from the product: official docs, live ecosystem data, community intel, and proven playbooks — cross-referenced — with **no per-service API keys** for the agent. Paste the endpoint, sign in once in the browser, ask.

Public numbers on the landing page (as of check): **60** live operations, **282** catalog entries, **20** playbooks, **1** sign-in, **0** API keys handed to the agent.

### What it is for

| Use | Raven |
|---|---|
| Agent needs Stellar docs / SEPs / RPC / SDK answers | yes |
| Agent needs live ecosystem intel (projects, repos, research) | yes |
| Agent needs step-by-step playbooks (skills) mid-task | yes |
| User signs into a dapp with Touch ID / Face ID | **no** — that is passkeys (section 3) |
| Signing or submitting Stellar transactions | **no** — Raven is read-only |

From the Terms: Raven is a **read-only** information tool. The `execute` sandbox has no network; it only calls host-side adapters. It does **not** sign, authorize, submit transactions, custody assets or keys, or move value.

### Auth model (for the MCP client, not the end-user wallet)

- Browser OAuth via **WorkOS AuthKit**.
- Access tokens ~**1 hour**; clients refresh inside a **90-day** authorization window, then re-login.
- Upstream service credentials stay on Raven's servers; the agent never receives them.
- Fallback: named API key as `Authorization: Bearer name:token` if a client cannot do OAuth.
- Health (no login): `GET https://raven.stellar.org/health`, skills heartbeat `GET https://raven.stellar.org/health/skills`.

Privacy note (Terms): WorkOS may see email; Raven stores only a hashed account id, not names/wallets/keys.

Support: `#raven` on Stellar Developers Discord. Security: private report on `stellar-experimental/stellar-raven` or `frontier@stellar.org`.

---

## 2. How to connect

Endpoint: `https://raven.stellar.org/mcp` (streamable HTTP + OAuth).

### Cursor (`~/.cursor/mcp.json` or project `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "stellar-raven": { "url": "https://raven.stellar.org/mcp" }
  }
}
```

Cursor runs OAuth on first use.

### Claude Code

```bash
claude mcp add --transport http stellar-raven "https://raven.stellar.org/mcp"
# then /mcp → Authenticate → browser sign-in
```

### Codex

```bash
codex mcp add stellar-raven --url "https://raven.stellar.org/mcp"
codex mcp login stellar-raven
```

### Claude Desktop / ChatGPT Connectors

Settings → Connectors → add custom connector → paste `https://raven.stellar.org/mcp` → approve browser sign-in.

### VS Code

```bash
code --add-mcp '{"name":"stellar-raven","type":"http","url":"https://raven.stellar.org/mcp"}'
```

### Clients without native remote OAuth (bridge)

```json
{
  "mcpServers": {
    "stellar-raven": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://raven.stellar.org/mcp", "--transport", "http-only"]
    }
  }
}
```

---

## 3. How Raven works (two tools)

Exactly **two** MCP tools over one catalog (~60 operations, ~20 skills / playbooks, ~200 sections).

### `search`

Ranks operations and whole skills against a natural-language query. Operation hits come with a ready-to-call TypeScript signature. Skill hits list `availableSections` (individual sections are not searchable; agents read them by exact section id).

### `execute`

Runs one JavaScript script in a **no-network sandbox**. Service calls go through host-side adapters (credentials + policy on the server). Allowed host helpers inside the sandbox include: `codemode.spec`, `codemode.search`, `codemode.catalog`, `codemode.describe`, `codemode.skill.read`, `codemode.skill.run`, `codemode.artifact.info`, `codemode.artifact.read`.

Working loop:

1. `search({ query: "…", limit: 3 })` → ranked hits with signatures  
2. `execute` composes those operations in one script  

Every service call resolves to `{ ok: true, data, asOf, … }` or `{ ok: false, error }` — payloads live under `.data`. Empty/`soft-empty`/`caveat` semantics are documented on the Raven docs page; do not treat soft-empty as proof of absence.

Artifacts: large truncated outputs may report an artifact id; read with `codemode.artifact.read` (expire ~7 days; MCP OAuth clients only).

### Four source families

| Family | Prefix | Who | Trust for |
|---|---|---|---|
| Lumenloop | `lumenloop.*` | Lumen Loop (independent) | community / editorial ecosystem: projects, research, content, SCF context |
| Scout | `scout.*` | Stellar Light | live ecosystem graph: projects, repos, builders, partners, hackathons, audits, stablecoins |
| Stellar Docs | `stellarDocs.*` | SDF | **authority** for protocol, standards, API shapes |
| Skills | `skills.*` | Lumen Loop, OZ, SDF, Stellar Light, Trustless Work | pinned operational playbooks (build, integration, security, data), read section by section |

Guidance: ecosystem facts start at Lumenloop/Scout; protocol claims are unverified until **stellarDocs** confirms them.

Landing page also groups playbooks under themes such as smart contracts, payments, dApps, data & indexing.

### What you get vs wiring it yourself

Without Raven: one MCP (or key) per service, many tool schemas in context, you cross-reference. With Raven: one endpoint, two tools, catalog kept against live services, composition inside `execute`.

---

## 4. Passkeys on Stellar (what BookerBob actually needs)

This is **not** Raven. It is the Stellar / OpenZeppelin stack for “wallet without seed phrase or Freighter”.

Our product already plans: guest passkey first, Freighter fallback (`docs/design-handoff.md`, `PLAN.md`). SDK today: Freighter + demo local key; passkey throws “not available yet” (`packages/sdk/src/testnet.ts`).

### Concepts

| Term | Meaning |
|---|---|
| **WebAuthn** | Browser standard: device creates a keypair, proves possession with challenge/response (Touch ID, Face ID, hardware key). No seed phrase. |
| **Passkey** | Platform/hardware credential that implements WebAuthn. |
| **secp256r1** | Curve most authenticators use. Stellar verifies it on-chain since Protocol 21. |
| **Smart wallet** | Contract account (`C…`) that holds assets; auth in `__check_auth`, not a single classic secret key. |
| **Relayer / Channels** | Sponsors fees and sequence numbers so the user does not need XLM to act (paymaster-like). |

Flow in practice:

1. **Registration** — WebAuthn create → store public key / credential id in contract state; deploy a smart account for the user.  
2. **Signing** — WebAuthn assertion over the payload when the user approves.  
3. **Verification** — contract `__check_auth` checks secp256r1 (+ policies: limits, allow lists, etc.).  
4. **Submit** — relayer wraps and pays fees.

### Two client SDKs (not drop-in compatible)

| Kit | Contract model | When |
|---|---|---|
| **[Smart Account Kit](https://github.com/stellar/smart-account-kit)** | OpenZeppelin Smart Account: context rules, signers, policies | Prefer for BookerBob: aligns with OZ policies / spending limits / Composed track story. Guestbook tutorial uses this. |
| **[Passkey Kit](https://github.com/stellar/passkey-kit)** | Own wallet contract; flat map of passkey / Ed25519 / policy signers | Simpler map; repo says **not independently audited** — review before real value. |

### OpenZeppelin pieces

- **Smart Account** — modular signers + context rules + policies. Docs: [OZ stellar smart account](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account).  
- **Relayer + Stellar Channels** — fee sponsorship, channel accounts. Hosted **testnet**: `https://channels.openzeppelin.com/testnet` (API key from `/testnet/gen`). Replaces retired **Launchtube**.

### Guestbook tutorial API shape (Smart Account Kit)

Browser client (`SmartAccountKit`):

- `account.createWallet()` — signup  
- `account.connectWallet()` — login  
- `account.signAndSubmit()` — sign + submit via relayer URL  
- `account.disconnect()`  
- Events: `walletConnected` / `walletDisconnected`  
- Storage: typically `IndexedDBStorage` (session survives reload; **not** a substitute for the indexer)  
- Config needs: RPC URL, network passphrase, `accountWasmHash`, `webauthnVerifierAddress`, `relayerUrl`, `rpName`

Server proxy (required): kit POSTs to same-origin `/api/send` with `{ func, auth }` **or** `{ xdr }` (never both). Server adds `Authorization: Bearer <RELAYER_API_KEY>` and forwards to Channels. **Never** put the relayer key in the browser.

Also handled for you in the tutorial stack:

- **Funding** `C…` wallets via a Friendbot dance (Friendbot cannot fund contracts directly).  
- **Discovery** credential → contract address via Mercury-hosted smart-account indexer (public reads). Turn off with `indexerUrl: false` and login fails on a fresh device.

Common kit errors worth mapping in UI: `WalletAmbiguousError`, `WalletOwnershipError`, `WalletProvenanceError` (often indexer lag), `WalletCodeNotAcceptedError`. User dismiss of the passkey prompt → `NotAllowedError` / `AbortError` (treat as cancel, not hard failure).

Discord for passkey product help: `#passkeys` (separate from Raven’s `#raven`).

Primary docs:

- https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets  
- https://developers.stellar.org/docs/build/apps/guestbook (full passkey dapp walkthrough)

---

## 5. How Raven and passkeys meet for this repo

| Goal | Use |
|---|---|
| Agent implementing passkey wallet in our SDK | Connect Raven → `search` / `stellarDocs.*` / skills for smart wallets, Smart Account Kit, Channels; then implement in `packages/sdk` |
| End-user “Connect with passkey” in the app | Smart Account Kit (or Passkey Kit) + server `/api/send` + Channels key — **not** Raven |
| MCP OAuth “sign in” when adding Raven to Cursor | WorkOS in the **developer’s** browser — unrelated to guest passkeys |

Suggested BookerBob wiring when we implement passkey:

1. Prefer **Smart Account Kit** + OZ Smart Account (policies path already in roadmap).  
2. Add `PRIVATE_RELAYER_*` secrets on Fly (same pattern as other host secrets); app calls same-origin relay on `stellarbob2026`.  
3. Extend `wallet.connect("passkey")` in `packages/sdk/src/testnet.ts` to drive the kit; keep Freighter + demo key.  
4. Use Raven during implementation as the docs/ecosystem MCP; do not treat Raven as the wallet runtime.

---

## 6. Quick links

| What | URL |
|---|---|
| Raven product | https://raven.stellar.org/ |
| Raven docs | https://raven.stellar.org/docs |
| Raven MCP | https://raven.stellar.org/mcp |
| Raven health | https://raven.stellar.org/health |
| Smart wallets guide | https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets |
| Passkey guestbook tutorial | https://developers.stellar.org/docs/build/apps/guestbook |
| Smart Account Kit | https://github.com/stellar/smart-account-kit |
| Passkey Kit | https://github.com/stellar/passkey-kit |
| OZ Channels testnet | https://channels.openzeppelin.com/testnet |
