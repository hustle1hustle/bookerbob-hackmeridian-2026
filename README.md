# BookerBob. Google for agentic commerce.
## Proof of loyalty, everywhere you go. UCP module.

A buyer's AI agent shops a real Shopify store over UCP (Universal Commerce Protocol). It claims the
returning-customer discount with a zero-knowledge proof that it bought there before. The store checks
the proof against the BookerBob contract on Stellar, mints a single-use code, and the agent pays in
test USDC on Stellar. The store never learns who the buyer is, or which of its past orders the proof
stands for. The purchase then makes the buyer a proven customer again, under a fresh identity.

Live bridge: https://bookerbob-ucp-bridge.fly.dev (`/.well-known/ucp`, `/mcp`, `/search`). Try it: `npm run agent -- --bridge https://bookerbob-ucp-bridge.fly.dev`.

The store is `jwq0dd-rp.myshopify.com`, a Shopify test store (external service, see PRIOR_WORK.md).
The core (contract, SDK, Semaphore circuit) is the BookerBob core, used unmodified as merchant 5,
kind `shop` (MERCHANT.md); the contract id comes from the core's `config/testnet.json`.

## Flow

```
agent                         bridge (store's UCP surface)             Shopify store        Stellar (core contract)
  | GET /.well-known/ucp  ->   profile + com.bookerbob.patronage
  |                            + payment handler stellar.usdc
  | search_catalog        ->   passthrough                        ->   catalog
  | create_checkout       ->   create                              ->   checkout
  |   context.eligibility      provisional discount 10% +
  |   [com.bookerbob.patronage]  verification action {root, scope, message binds payer}
  | prove locally (Semaphore v4, depth 10, ~0.5 s)
  | update_checkout {proof} -> dry run of book_with_discount  ------------------------------->  root, nullifier, Groth16
  |                            store mints a single-use code   ->   discountCodeBasicCreate
  | update_checkout discounts.codes -> passthrough              ->   code applied (-10%)
  | update_checkout {stellar_usdc.payer} -> merchant admin co-signs amount + order_ref
  | book_with_discount_amount (fresh payer signs, sends) ------------------------------------->  proof re-verified,
  |                                                                                               nullifier burned, discount
  |                                                                                               applied, USDC paid
  | complete_checkout {handler stellar.usdc, tx_hash} -> reads the tx from chain, checks payer,
  |                            nullifier, season, merchant, cart; records the order
  |                            buyer's fresh commitment joins the merchant tree  --------------->  checkout() as merchant admin
```

Everything the store learns: a valid proof for its own customer tree, a payer address used once, a
new customer commitment. Not which leaf, not which past order, not that two purchases are the same person.

## UCP fit

- Spec-native slot: `checkout.context.eligibility` (buyer claim) + `discounts.applied[].provisional` with
  `eligibility`, and a business-defined verification. UCP leaves verification to the business; a business
  must not complete with unresolved claims (enforced: `eligibility_unresolved`); a failed proof is
  `eligibility_invalid`, recoverable.
- Extension `com.bookerbob.patronage` (version 2026-10-25), extends `dev.ucp.shopping.checkout`.
  UCP's own loyalty extension says eligibility values are claims, not proof, and members must not expose
  stable identifiers. This extension is the missing proof.
- Payment handler `com.bookerbob.stellar_usdc` (id `stellar.usdc`): the agent asks for a quote with
  `update_checkout checkout["com.bookerbob.stellar_usdc"] = {payer}`; the merchant admin co-signs the
  pre-discount amount (the cart's items at a fixed demo rate) and an `order_ref` (hash of the checkout) into
  `book_amount` or `book_with_discount_amount`; the payer signs and sends; the credential is the tx hash.
  The bridge reads the tx from chain and checks order ref, amount, payer, nullifier and season.
- Card rail: when a human pays by test card through `continue_url`, the bridge calls `redeem()` so the
  discount nullifier still burns on Stellar: one discount per past purchase per season across rails.

## Context perks

The store's policy on chain mirrors the BookerBob places: its own returning customers 10%, the BookerBob
Lisbon network 5%, REP verified travelers 5%, capped at 15%. The verification action lists every group;
the agent proves each one it is in (with a still-unspent nullifier) and the payer signs one
`book_with_context` with all claims and the merchant-co-signed amount. The store's single-use code carries
the same capped percentage. Network membership comes from a real paid visit to a network place
(`npm run visit`).

## Why payment settles in USDC on Stellar

Shopify does not let a general-access agent complete checkout over the API: `complete_checkout` answers
`checkout_completion_ineligible` ("use the continue_url"), checked on this store with the Bogus Gateway.
A human can still pay by test card through `continue_url` (fallback). On Stellar the agent pays itself,
and one transaction re-verifies the proof, burns the nullifier and moves the money, so a discount and its
payment cannot come apart.

## Evidence (testnet)

Contract v2 `CBEGVNZF…L5EBY` (frozen id):

| What | Tx / result |
|---|---|
| merchant 5 registered | [`4447cc1a…`](https://stellar.expert/explorer/testnet/tx/4447cc1a1cbb1753be44021e9deb1f3f44a422350eb2a0c6dd9d688a1c210466) |
| first purchase, `book_amount` 40.80 USDC co-signed by the store | [`3babdbf4…`](https://stellar.expert/explorer/testnet/tx/3babdbf4ad9b407bf6155bdc4afa7bc5408af7b2b3fb69bdad26a64938442fa5), `evidence/run-1-first-purchase.log` |
| returning purchase, `book_with_discount_amount` with proof, 36.72 USDC | [`d61a94c0…`](https://stellar.expert/explorer/testnet/tx/d61a94c0d65637e2996eb2adb09c5159dcf69088e5eaba68f5ddee4bd5ae2623), `evidence/run-2-returning.log` (19 s end to end) |
| returning purchase through the live bridge on Fly | [`c4507f45…`](https://stellar.expert/explorer/testnet/tx/c4507f4552838e942174e33db278774e0a1682b42371a716a7992e1cbaeb6bdb), `evidence/run-3-live-bridge.log` |
| context perks stacked: returning customer 10% + BookerBob network 5% (cap 15%), `book_with_context` 34.68 USDC, Shopify order #1009 | [`5f4ff99f…`](https://stellar.expert/explorer/testnet/tx/5f4ff99fcd8b2724d233a51d50ead3e8992c99c518a5dea9399538ea822c3fb7), `evidence/run-5-context-perks.log`, `evidence/order-1009.json` |
| replayed proof | `evidence/replay.log` |

Earlier on v1 `CBZ7I3VO…5MTL` (`evidence/v1/`): full price [`a76bfa80…`](https://stellar.expert/explorer/testnet/tx/a76bfa80e5d1bba740ca3a8b1a2081bb7fb92247a611a11f035a66c3f95bc843), returning with proof 36.72 USDC [`eb0944c9…`](https://stellar.expert/explorer/testnet/tx/eb0944c9a5d27d67abf7d9809e088b95e4ae978e63b1be39599f8b97aeaf2490), replay refused `NullifierUsed`, forged proof refused `UnknownRoot`.

## Ask Bob search

`GET /search?q=&max_price=` (USDC): the store's UCP catalog as `[{source: "ucp", merchantId, title, kind, price, currency, url, provenRating, reviewCount, verifiedCount, ...}]`, ratings from the chain only.

## Run

```
npm install
git clone https://github.com/hustle1hustle/bookerbob-hackmeridian-2026 .core   # the core SDK, pinned in src/core.ts
cp .env.example .env                                                          # Shopify app + merchant admin
npm run bridge                                                                # http://localhost:8787
npm run agent                                                                 # first run: full price, joins the tree
npm run agent                                                                 # second run: proves, gets 10% off
npx tsx scripts/replay.ts                                                     # double spend refused on chain
```

## Limits, stated plainly

- AED to test USDC at a fixed demo rate (150 AED = 40.80 USDC); shipping stays off the on-chain amount.
- The store order record on the Stellar path needs the Shopify app scope `write_draft_orders`; until it is
  granted, the order lives on chain and in the bridge.
- Delivery details identify a buyer to the store for shipping, as they must; the proof keeps purchase
  history unlinkable, not the parcel.
- The bridge names Shopify's example agent profile when calling the store.
- Testnet only, unaudited verifier (see the core README).
