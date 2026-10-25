# Design binding: Proof of Loyalty v2

The Claude Design deliverable `Proof of Loyalty v2.dc.html` is served byte-exact at `/` from `site/public/`, with its runtime `support.js`. These lines differ from the delivered file:

1. its data import points at `./pol-real.js` instead of `./pol-mock.js`;
2. the merchant view's two place labels, hardcoded as mock names ("alfama nine · hotel", "rep store · shop"), are built from the real place names;
3. `<script src="/ops.js"></script>` as the first script in `<body>` (the backend's error tracker: errors only, scrubbed, no ids or cookies);
4. the shop cart line appends the chosen size only when the product has sizes (the real store item has none, so it no longer shows a made-up ", m").
5. **connect control** (marked `bb:connect-control`): the header's connect / disconnect buttons are replaced by one button showing a status chip per source (key, rep, passport, network; filled = connected, tinted = pending, red = failed, hollow = not connected) and a popover listing each source with what it proves, its status and one action. Data and actions come from new `pol-real` exports: `sources()`, `rep.start()` / `rep.poll()`, `passport.check()`, `wallet.current()`, and `wallet.connect('demo key')`. Class additions: `state.src`, `loadSources`, `openSources`, `srcAct`, `vSources` (merged into `renderVals`). `reload()` refreshes the sources. Built only with the v2 tokens; the whole block can be swapped for a Claude Design version.
6. the place picker shows a "connect REP for +5%" link under an unearned verified-traveler perk, which opens the popover at REP.
7. a review whose transaction hash is unknown shows a plain "proven stay" badge instead of a link to `/tx/null`.
8. **no zeros before data**: until the component is `ready` (places loaded), the kind counts in the hero and the category tabs and the "my passes" count render empty instead of 0, and the ranking shows one line in the design's rank-line style, "reading the proven reviews". After the load, real counts, and an empty state only when there is truly nothing.
9. the customer-group label reads "N of 1024" (the real tree capacity, pol-real `TREE_CAP`) instead of the hardcoded "of 32"; the 32-cell grid stays as drawn.
10. the arbiter's package fields that are words ("held by the arbiter") are shown as they are, not cut like a hash.
11. **one connect for every entry point**: `requireWallet` (book, buy, review, dispute, attest, the agent) opens the header connect at the wallet with the reason on top ("connect to book."), and the pending action runs once the wallet connects. The design's old connect modal is no longer opened. Below the wallet, "add for more perks" lists REP, Stellar Passport and BookerBob regular, each with what it unlocks at this place from the on-chain policy ("+5% here"), or across the network ("+5% at 12 places").
12. **visible tx links**, short hash plus ↗, opening stellar.expert testnet in a new tab:
    - flow receipt: the payment ("confirmed on Stellar · tx …"), every proof used ("✓ BookerBob regular · tx …"), and the new pass ("new pass: Pátio do Vento · tx …"). No more receipt toggle;
    - proof rows in the book panel: each held proof shows the tx that made it true, or "joined earlier" when the backend has none;
    - header connect: connected sources show "joined · tx …";
    - my passes: each place pass shows its checkout tx, or "joined earlier"; the BookerBob regular and REP passes show theirs;
    - agent run: steps are expanded by default, and their tx links read "tx …↗".
13. **names**: "network member" → "BookerBob regular"; "verified traveler" → "REP verified traveler · from REP", with one explainer line wherever it appears.
14. **how your perks add up** on the place page: per source, what it proves, its % at this place, and whether it is counted, held over the cap, used this season or not held; then the sum, the place's cap and the price. Stellar Passport is a greyed "not active" row ("coming. not a perk at any place yet, so it is not counted."): no place policy has a Passport group today, so it never changes the price.
15. **my passes**: the tab count equals the cards shown (place passes + BookerBob regular + REP when held); "no passes yet" only at zero; "your first stay or purchase adds a place pass" when only group passes exist; shop passes read "bought <date>"; long names wrap instead of clipping.
16. **agent headline from the run**: "paid 40.80 usdc. full price. next time it's 10% off, proven." for a first purchase, and "paid 36.72 usdc. 10% off, proven." when the claim was applied (the % from the real cart). It was hardcoded to "10% off, proven" before.

Data behind these (pol-real): `membershipTx()` reads `GET /api/checkout-tx` (place passes) and `GET /api/member-tx` (groups), cached; tx saved at join time when known (pay's new pass, UCP join). Eligibility rows carry `txHash`, `held`, `explain` and `atPlaces`; memberships carry `txHash`; `sources(placeId)` carries `txHash` and `perk`; `pay()` returns `passTx`; UCP steps carry evidence (UCP profile URL, product, Shopify variant, proof time in ms, Stellar check tx when the bridge returns one, payment tx, Shopify order, join tx).

Sources and what they read:

| Source | Status from | Action |
|---|---|---|
| wallet | SDK wallet (passkey, Freighter, or a demo key remembered in this browser) | passkey / freighter / demo key, or disconnect |
| REP verified traveler | only for the demo operator's browser (`GET /api/rep/status` → `{demo}`); otherwise "soon": "REP verified traveler is coming to the REP app" with a link to `REP_APP_URL` (pol-real export, one value), and the picker's "connect REP for +5%" opens the REP app too. For the demo browser: membership in the attested "REP verified traveler" group (connected); a REP session in progress (pending, "approve in REP Bob on your phone"); a refused or expired one (failed) | verify with REP: a fresh stay at the store that is never checked in, `POST /api/rep/session`, then `/api/rep/result` polled every 2 s |
| Stellar Passport | `GET /api/passport/lookup?address=` (verify_onchain_zk `fetchPassport`, read only) | check (needs a wallet) |
| network member | this browser's checked-in stays | none (comes with the first stay or purchase) |

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

## Copy: plain words, no chain jargon

Visible text says "verified", "proven", "confirmed on Stellar" (only next to a transaction link), "your proof", "nobody sees who you are". Hashes, roots and transaction ids stay small and one click away. Error codes and JS keys (`NullifierUsed`, ...) are unchanged.

| Where | Was | Now |
|---|---|---|
| index.html footer | stellar testnet · semaphore v4 | stellar testnet · proofs made on your device |
| index.html agent step 6 (`AGL`) and pol-real `UCP_STEPS` | stellar verifies, spends the nullifier | stellar checks the proof, once |
| pol-real `UCP_STEPS` step 6 detail | proof valid. the one-time nullifier is spent, so this discount cannot be reused. ... | proof valid. it works once, so this discount cannot be reused. ... |
| pol-real `UCP_STEPS` step 5 detail | semaphore v4, made on this device. ... | made on this device. your secret never leaves it. |
| index.html preset failure and pol-real failure detail | refused. this proof was spent before, so the nullifier check failed. | refused. this proof was already used, so it cannot count twice. |
| index.html `ERR.HotelNotFound` | this place is not on chain. | this place is not listed. |
| index.html `ERR.ReviewNotFound` | it is no longer on chain. | it is no longer listed. |
| index.html header connect reason | to act on chain | to continue |
| /classic `Shell.tsx` banner | every review is a real proof on chain | every review is a real, verified proof |
| /classic `Stays.tsx` | kept in this browser only, never on chain. | kept in this browser only, never shared. |
| /classic `PassConnect.tsx` | pass_connect · verify_onchain_zk; re-verify on-chain; on-chain activity rating | passkey · wallet check; verify again; wallet activity rating |

## Links (edit 17)

Every reference the UI shows is a real link (new tab) or is removed; no fake links.

- Agent run: "UCP profile ↗" (the bridge's `/.well-known/ucp`), "product page on Shopify ↗" (bridge `/search` `url`), the payment tx; with a claim, "stellar checks the proof, once" and "discount confirmed" link the payment tx and say "same transaction as the payment" (UCP `book_with_discount_amount` verifies and spends the proof inside the payment); the Shopify order shows its order number (the bridge returns no order URL, so no link); "join the customer group" links the join tx (`/buy/complete` `joined`, else `/api/checkout-tx`). Steps carry an optional `link` (`{url, label}`), rendered next to the tx link. The cart shows its payment tx when paid (no "receipt" toggle).
- Desk: the checkout tx reads "tx …↗"; the root stays small and copies the full value on click (⧉).
- Arbiter, store view, merchant orders: "tx …↗" with the short hash.
- Connect: the connected wallet's address links to its stellar.expert account.

## Operator fresh demo (edit 18, marked `bb:operator-demo`)

Visible only when `demo.isOperator()` is true (the demo cookie, `GET /api/rep/status`). Outside a demo: "fresh demo · reset" starts a clean identity (`demo.reset()`). Inside one (`demo.active()` set): a "fresh demo" tag, "reset" for another clean identity, and "back to my passkey" (`demo.exit()`), which returns to the operator's own passkey / Freighter / demo-key state. Both reload the page; the namespace is fixed at load.

## Passkey: sign in or create (edit 19)

The wallet row in Connect offers "sign in with my passkey" (`wallet.connect('passkey')`) and "create a new passkey" (`createPasskey()`, called straight from the click so WebAuthn keeps the gesture; a new named credential in a new storage namespace, then a reload: zero passes, zero memberships), plus Freighter and demo key. The row's copy: "face id. no seed phrase. your proofs come back on any of your devices." When `createPasskey()` returns `{ fallback, why }`, the reason shows calmly under the wallet row next to Freighter and demo key, never as an error.

## First paint, generations, dropped claims (edits 20-22)

20. **first paint**: the page head starts `GET /api/state` (`window.__polState`) and preloads `pol-real.js`; `load()` hydrates from that one snapshot (strings to BigInt), estimates the current ledger from the newest timed review until `/api/ledger` answers, builds the contract client only when a held proof needs a spent check, and never waits on the UCP bridge. A live chain read follows ~4 s later and the page re-reads on `pol:data`. Until the places are in, the ranking shows three skeleton rows in the real row layout (pulse off with reduced motion), and the counts stay empty. Measured on a local backend: first card 0.51 s cold (fresh browser), 0.50 s warm (was 4.1 s / 1.7 s).
21. **passkey generations**: with a passkey connected, the wallet row shows "start over with this passkey" (`generations.startOver()` inside the click) with the note "your earlier history stays on Stellar. this starts a new, unlinked one.", and a "switch generation" list ("original", "started HH:MM"; `generations.switchTo(ns)`). A REP verify refused with "this presentation already joined" says "a new generation needs a new proof in REP Bob."
22. **dropped claims**: the receipt lists claims `pay()` could not prove in this session greyed, "○ <label> · this proof isn't available in this session, not counted"; the price shown is already recomputed.

## Bob shops: products, headline, pay full price (edit 23)

- Before the run, "pick what bob buys" shows REP Store's products over UCP (`store.items()`, bridge `/search?q=rep`): image (or the design's "no photo" placeholder when the store has none), title, USDC and AED price, "REP Store · on Shopify ↗" linking to the product page; "bob buys this" sets `store.choose(variantId)` for the next `ucp.run()`. The cart shows the same product card.
- The agent headline uses the run's own `headline` event when present (e.g. "same proof again: refused. it only works once."), else the computed one.
- After a refusal that is not the replay demo, "pay full price" runs `ucp.run({ noClaim: true })`.
- Step 2's label is "add it to the cart" (it was "add the t-shirt", wrong for the cap or a hoodie).
