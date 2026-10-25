# BookerBob. Google for agentic commerce.
## Proof of loyalty, everywhere you go. UCP module.

A buyer's AI agent shops a real Shopify store over UCP (Universal Commerce Protocol). It claims the
returning-customer discount with a zero-knowledge proof that it bought there before. The store checks
the proof against the BookerBob contract on Stellar, mints a single-use code, and the agent pays in
test USDC on Stellar. The store never learns who the buyer is, or which of its past orders the proof
stands for. The purchase then makes the buyer a proven customer again, under a fresh identity.

The store is `jwq0dd-rp.myshopify.com`, a Shopify test store (external service, see PRIOR_WORK.md).
The core (contract, SDK, Semaphore circuit) is BookerBob Proof of Stay, used unmodified as merchant 5,
kind `shop` (MERCHANT.md).

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
  | book_with_discount (fresh payer signs) --------------------------------------------------->  proof re-verified,
  |                                                                                               nullifier burned, USDC paid
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
- Payment handler `com.bookerbob.stellar_usdc` (id `stellar.usdc`): credential is the Stellar tx hash of
  `book` or `book_with_discount`. The bridge trusts the chain, not the buyer.

## Why payment settles in USDC on Stellar

Shopify does not let a general-access agent complete checkout over the API: `complete_checkout` answers
`checkout_completion_ineligible` ("use the continue_url"), checked on this store with the Bogus Gateway.
A human can still pay by test card through `continue_url` (fallback). On Stellar the agent pays itself,
and one transaction re-verifies the proof, burns the nullifier and moves the money, so a discount and its
payment cannot come apart.

## Evidence (testnet)

| What | Tx / result |
|---|---|
| merchant 5 registered | [`86e53e17…`](https://stellar.expert/explorer/testnet/tx/86e53e1738da0e4ee6ecc39efb8a7ef743988669cd4805b19436fbb49ae1636e) |
| first purchase, full price 40.80 USDC (`book`) | [`a76bfa80…`](https://stellar.expert/explorer/testnet/tx/a76bfa80e5d1bba740ca3a8b1a2081bb7fb92247a611a11f035a66c3f95bc843), joined tree [`b964c162…`](https://stellar.expert/explorer/testnet/tx/b964c162e8971a35a64bcd362277c5406d0b5fb13f3605cc478383ce92dd229b) |
| returning purchase, 36.72 USDC with proof (`book_with_discount`) | [`860c692d…`](https://stellar.expert/explorer/testnet/tx/860c692d2f454fd25a1e75d403de7040ebc5253a10bff1aed5ad2f118a2a770a), joined [`0460ee5b…`](https://stellar.expert/explorer/testnet/tx/0460ee5b80c2c1b912a14fc2a725e147e09ece43bece553d995cd79f2e61fbbd) |
| returning purchase, full agent log | `evidence/run-3-returning.log`, [`eb0944c9…`](https://stellar.expert/explorer/testnet/tx/eb0944c9a5d27d67abf7d9809e088b95e4ae978e63b1be39599f8b97aeaf2490) |
| replayed proof on a new checkout | refused by the contract: `NullifierUsed` (`evidence/replay.log`) |
| forged proof | refused by the contract: `UnknownRoot` |

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

- One item at one price: the core merchant holds a single price (the tee, 150 AED = 40.80 test USDC at a
  fixed demo rate); shipping is not in the on-chain price. Contract request 1 lifts it (CONTRACT_REQUESTS.md).
- The store order record on the Stellar path needs the Shopify app scope `write_draft_orders`; until it is
  granted, the order lives on chain and in the bridge.
- The test-card fallback cannot burn the nullifier on chain today; the bridge reserves it. Contract request 2.
- Delivery details identify a buyer to the store for shipping, as they must; the proof keeps purchase
  history unlinkable, not the parcel.
- The bridge names Shopify's example agent profile when calling the store.
- Testnet only, unaudited verifier (see the core README).
