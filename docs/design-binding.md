# Design binding: Proof of Loyalty v2

The Claude Design deliverable `Proof of Loyalty v2.dc.html` is served byte-exact at `/` from `site/public/`, with its runtime `support.js`. Two lines differ from the delivered file:

1. its data import points at `./pol-real.js` instead of `./pol-mock.js`;
2. the merchant view's two place labels, hardcoded as mock names ("alfama nine · hotel", "rep store · shop"), are built from the real place names.

`pol-real.js` is bundled from [`site/src/pol-real.ts`](../site/src/pol-real.ts) and exports exactly the mock's interface over the SDK, the contract and the BookerBob backend. The earlier app shell stays at `/classic/`.

Place ids: the design hardcodes 0 (hotel), 1, 3 (café) and 4 (the real shop). Ids map 1:1 to merchant ids, except design 4 = the UCP store (merchant 5) and design 5 = merchant 4.

| Mock field or call | Real source | Available today |
|---|---|---|
| `chain.listPlaces()` id, name, kind, admin, price, discount_bps | contract `get_merchant` | yes |
| place `area`, `note` | backend catalog `server/data/catalog.json` (demo copy for fictional places); UCP store: fixed line | catalog yes, labelled demo |
| place `offers` (rooms, menu items) | backend catalog; offer 0 is the on-chain list price | yes (catalog) |
| `rating`, `review_count`, `verified_count`, `rating_sum` | contract `get_reviews` | yes |
| `group_size` (proven customers) | contract tree size | yes |
| `roots` | current tree root | yes (current root only) |
| `chain.getPolicy` policy, max_bps | contract `get_policy` (context groups); places without a policy: own `discount_bps` | yes |
| `chain.getReviews` rating, hashes, nullifier, verified, ledger, txHash | contract + backend store (tx hash) | yes; txHash null for reviews posted outside the backend |
| `backend.getText(hash)` | backend store, checked against the on-chain sha256 | yes; "text unavailable" when missing |
| `chain.checkout` | demo desk (`/api/checkout`) or merchant wallet | yes |
| `chain.pay(place, cart, groups)` | fresh one-time payer, stacked claims (`book_with_context`), cart totals priced by the server and co-signed by the demo desk (`/api/quote`, `/api/cosign`), fee-bumped | yes |
| `chain.postReview` | SDK prover + relayer | yes |
| `chain.openDispute` | backend `/api/disputes/open` (off chain, awaits the guest's disclosure) | yes, off chain, no tx |
| `chain.attest` | demo arbiter: server-side 3-step check, then `attest_review` | yes |
| `chain.getDisputes` package fields | held by the arbiter backend, never sent to browsers; shown as "held by the arbiter" | redacted by design |
| `arbiter.check(id, commitment / signature / tree)` | `/api/disputes/:id/check` | yes |
| `local.memberships()` | this browser's checked-in stays (SDK `stays`), leaf index from chain | yes |
| membership `when` | local check-in date only ("checked in 25 oct 2026"); no stay date ranges on chain | partial |
| membership `secret` | never displayed: "kept in this browser" | by design |
| `local.credentials()` | membership in attested groups (REP verified traveler, other providers) | yes; a fresh browser holds none |
| `local.eligibility(place)` | policy groups x this browser's stays x on-chain nullifier `is_spent` | yes |
| `disclosure.send` | SDK disclosure build + `/api/disputes` | yes |
| `store.orders()` | Shopify admin orders through the UCP bridge | **no**: returns [], the card drops |
| `ucp.run()` steps, cart | UCP bridge `/buy/start, /buy/prove, /buy/quote, /buy/send, /buy/complete` | yes; order id once the bridge writes draft orders |
| `prover.prove(kind, place, {groups})` | real artifact download; pay: one membership proof per group, bound to a fresh payer; review: proof made in `postReview` (it binds rating and text) | yes |
| `wallet.connect('passkey' / 'freighter')` | SDK passkey (pass_connect) or Freighter; a demo key in this browser if neither works, reported as such | yes |
| `LEDGER_NOW` | `/api/ledger` (latest ledger) | yes |
| `SEASON` | contract season 1, label "2026 · autumn" | static label |
| `config.forceError`, `sparse`, preset flows | design tooling only, not reachable on the live site | n/a |

Data the design does not have a slot for: restaurants (we seed three; the design lists them as "restaurants next").
