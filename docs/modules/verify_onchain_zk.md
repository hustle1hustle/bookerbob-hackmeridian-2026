# Module: `verify_onchain_zk`

Package: `@bookerbob/verify_onchain_zk`  
Path: `packages/verify_onchain_zk/`

Inspect a Stellar wallet on Horizon, compute a **basic on-chain rating**, build a portable **loyalty claim**, and optionally issue a **Semaphore / Groth16 membership proof** on the same ZK stack as Proof of Stay (Soroban verifier).

Downstream modules (discount, context perks) consume the claim — this module does **not** call `book_with_discount` itself.

## Pipeline

```
address
  → inspectWallet()        // txs, payments, age → rating 0–100, tier 1–5
  → buildLoyaltyClaim()    // discountHintBps, scopeLabel
  → proveLoyaltyClaim()    // optional ZK, when identity ∈ leaves
  → other module           // clamp bps, book / redeem
```

## API

```ts
import {
  inspectWallet,
  buildLoyaltyClaim,
  verifyWallet,
  proveLoyaltyClaim,
  ratingToDiscountBps,
  clampDiscountBps,
  type WalletInspect,
  type LoyaltyClaim,
  type ProveLoyaltyResult,
} from "@bookerbob/verify_onchain_zk"

const { inspect, claim } = await verifyWallet(address, merchantId, season)
// claim.discountHintBps → feed discount UI / contract args (clamped)

const bps = clampDiscountBps(claim.discountHintBps, merchant.discountBps)

// When the guest's identity is already a leaf (checkout / context group):
const proved = await proveLoyaltyClaim({
  claim,
  identity,   // Semaphore Identity
  leaves,     // bigint[] from on-chain tree
})
// proved.proof → Soroban hex; proved.claim stays the portable metadata
```

Also re-exported from `@bookerbob/pos-sdk` as `verify_onchain_zk.*`.

## Rating rubric (transparent)

| Signal | Cap |
|---|---|
| Account age (~1 year → full) | 40 |
| log10(1 + ops sampled) | 35 |
| log10(1 + payment ops) | 25 |
| **Total** | **100** |

Tier: 1 (&lt;30), 2 (30+), 3 (50+), 4 (70+), 5 (85+).

`discountHintBps = round(rating/100 * 2500)` (max 25%). Always clamp to the merchant’s `discount_bps`.

## Scope / message binding

- Scope label: `loyalty,{merchantId},{season}` (hashed into circuit scope).
- Message binds `address|rating|tier` so the claim cannot be swapped after proving.

Nullifier is unique per (identity, scope) — one loyalty proof per season per stay identity, same pattern as reviews/discounts.

## Design (app)

Home card **pass_connect · verify_onchain_zk**: after passkey (or any wallet) connect, **verify on-chain + rate** shows a REP-style verdict (tier bars, discount hint).

## Wiring to discount (next)

1. Guest connects via `pass_connect`.
2. `verify_onchain_zk.verifyWallet` → show hint.
3. At booking: `clampDiscountBps` + existing `sdk.prover.prove({ kind: "discount", stay, season })` **or** `proveLoyaltyClaim` if using a context-group tree.
4. Pass `claim` JSON in UI state / agent handoff; do not put secrets on chain.

## Honest limits

- Horizon sample is capped (`opLimit`, default 100) — rating is a demo signal, not credit scoring.
- Native XLM volume only in the inspect summary; USDC SAC volume can be added later.
- Proof requires prior tree membership (checkout). Rating alone does not mint a leaf.
