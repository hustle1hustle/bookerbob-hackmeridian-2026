# Module: `verify_onchain_zk`

Package: `@bookerbob/verify_onchain_zk`  
Path: `packages/verify_onchain_zk/`

Inspect a Stellar wallet on Horizon, compute a **basic on-chain rating**, build a portable **loyalty claim**, **attest it on testnet** (clickable tx), and optionally issue a **Semaphore / Groth16 membership proof** on the same ZK stack as Proof of Stay.

Downstream modules (discount, context perks) consume the claim — this module does **not** call `book_with_discount` itself.

## Pipeline

```
address (Freighter / passkey / local)
  → inspectWallet()         // Horizon READ — no write tx
  → buildLoyaltyClaim()     // discountHintBps, scopeLabel
  → claimDigest()           // SHA-256 of claim fields
  → attestLoyaltyClaim()    // POST /api/loyalty/attest → WRITE tx (1 stroop + memo.hash)
  → proveLoyaltyClaim()     // optional ZK, when identity ∈ leaves
  → other module            // clamp bps, book / redeem
```

**Is there a tx on verify?**  
- `inspectWallet` / `verifyWallet` alone → **no**. Horizon reads only.  
- `verifyOnConnect` (default) / `attestLoyaltyClaim` → **yes**. Relayer pays 1 stroop to the guest with `memo.hash = claimDigest`. Explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`.

## API

```ts
import {
  verifyOnConnect,       // connect-time: score + claim + attest
  inspectWallet,
  buildLoyaltyClaim,
  verifyWallet,
  claimDigest,
  attestLoyaltyClaim,
  proveLoyaltyClaim,
  ratingToDiscountBps,
  clampDiscountBps,
  rateWalletSignals,
  fetchPassport,         // Stellar Passport builder signals (never throws)
  ratePassportSignals,   // transparent Passport rubric (exported for tests)
  explorerTxUrl,
} from "@bookerbob/verify_onchain_zk"

// After Freighter or passkey connect:
const { inspect, claim, digest, attest } = await verifyOnConnect(address)
// inspect.passport → { score, matched, signals } | null (null when passport: false)

// Horizon-only (no write):
const { inspect, claim } = await verifyWallet(address, merchantId, season)

// Passport options (on VerifyOptions / VerifyOnConnectOptions):
const inspect = await inspectWallet(address, {
  passport: true,                    // default; false → skip Passport entirely
  passportApiKey: "pk_…",            // optional Bearer key for /api/v1/profiles
  passportBaseUrl: "https://demo.stellarpassport.xyz", // default
})
```

Also re-exported from `@bookerbob/pos-sdk` as `verify_onchain_zk.*`.

## Rating rubric (transparent)

| Signal | Cap |
|---|---|
| Account age (~1 year → full) | 40 |
| log10(1 + ops sampled) | 35 |
| log10(1 + payment ops) | 25 |
| **Wallet total** | **100** |

Tier: 1 (&lt;30), 2 (30+), 3 (50+), 4 (70+), 5 (85+).

### Stellar Passport bonus (optional, default on)

On top of the Horizon signals, `fetchPassport(address, opts)` matches the wallet to a
[Stellar Passport](https://demo.stellarpassport.xyz) builder profile and `ratePassportSignals`
adds a transparent bonus. Total rating = wallet + passport, still clamped 0–100; tiers unchanged.

| Passport signal | Cap |
|---|---|
| Linked builder (`stellar_address` match) | 5 |
| Leaderboard points (log10 scale) | 5 |
| `rankName` (Bronze 1 → Platinum 4) | 4 |
| `scf_tier` ("verified" 3, other 1) | 3 |
| `totalCommits30d` (log10 scale) | 2 |
| `activeDays30d` (linear, /10) | 1 |
| **Passport cap** | **20** |

Stamps/challenges are dropped: they need a heavy crawl, not a transparent signal.

**Two match paths** (`passportBaseUrl`, default `https://demo.stellarpassport.xyz`):

| Path | When | Calls |
|---|---|---|
| keyed (preferred) | `passportProxyBase: ""` → BookerBob `GET /api/passport/lookup` | Server uses optional `PASSPORT_API_KEY`; browser never sees `pk_…` |
| keyed (direct) | `passportApiKey` set | Paginated `GET /api/v1/profiles` (`builders[]`), match by `stellar_address` |
| keyless | no key | `GET /api/leaderboard?…&limit=10` → `/api/builder/public/<slug>` until `stellar_address` matches |

Live shapes verified against the demo instance on 2026-10-25 (`leaderboard`, `builder/public`; `v1/profiles` returns 401 without a key).

**Graceful degrade (hard rule):** no key / no match / API down → Passport score 0, `inspectWallet`
never throws, and the rating is exactly the Horizon-only score. With `passport: false` the field is
`null` and no Passport endpoint is called. Only top-10 leaderboard builders can match keyless —
pass `passportApiKey` to cover the full builder set.

`discountHintBps = round(rating/100 * 2500)` (max 25%). Always clamp to the merchant’s `discount_bps`.

## Attest tx (testnet)

`POST /api/loyalty/attest` body: `{ address, rating, tier, merchantId, season, digest, … }`  
Server (`Ops.attestLoyalty`): classic payment **1 stroop** from relayer → guest, `Memo.hash(digest)`.

## Scope / message binding

- Scope label: `loyalty,{merchantId},{season}` (hashed into circuit scope).
- Message binds `address|rating|tier` so the claim cannot be swapped after proving.

Nullifier is unique per (identity, scope) — one loyalty proof per season per stay identity, same pattern as reviews/discounts.

## Design (app)

Home card **pass_connect · verify_onchain_zk**: Freighter **or** passkey. On connect (also from header Connect), auto-runs `verifyOnConnect` → verdict + **clickable attest tx**.

## Tests

```bash
node --experimental-strip-types --test packages/verify_onchain_zk/src/index.test.ts
```

Covers: rubric, Horizon-stub inspect (asserts **zero** write POSTs), claim digest, mocked attest (asserts **one** POST + explorer URL), `verifyOnConnect` with `attest:true|false`, Passport rubric caps, keyed/keyless match stubs (no network), no-match/API-down → score 0 with rating unchanged, `passport:false` → zero Passport GETs.

## Wiring to discount (next)

1. Guest connects via Freighter / `pass_connect`.
2. `verifyOnConnect` → show hint + tx link.
3. At booking: `clampDiscountBps` + existing discount prove **or** `proveLoyaltyClaim` if using a context-group tree.
4. Pass `claim` JSON in UI state / agent handoff; do not put secrets on chain.

## Honest limits

- Horizon sample is capped (`opLimit`, default 100) — rating is a demo signal, not credit scoring.
- Attest is a classic payment + memo, not a Soroban loyalty contract call.
- ZK prove requires prior tree membership (checkout). Rating alone does not mint a leaf.
- Passport data comes from the public demo instance (unstable internal API); keyless matching sees only the top-10 leaderboard, and a missing wallet on Horizon returns `passport: null`.
