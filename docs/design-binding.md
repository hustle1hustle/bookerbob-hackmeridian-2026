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

- Footer: a "how it works" link to `/how` (site/public/how.html, served by one line in server/src/index.ts), added by the UCP module session with Choly's OK. Restyled in edit 24.

## How it works page (edit 24)

- `vShell()` tab list: a fourth tab "how it works" after my passes, which navigates to `/how` (the footer link was already there).
- After the first load, `?view=agent` / `?view=passes` opens that view and `?connect=1` opens Connect, so the `/how` header and nav land in the right place of the app.
- `site/public/how.html` (not the design file) is restyled to the same language: the app's header (mark, testnet tag, connect →) and tab row with "how it works" current, the type scale, rule-based grids and cards, mono "tx 4d6f75…4580 ↗" links opening in a new tab, the site footer, single column at 390 px. Content, diagrams and tx hashes unchanged.

## Audit fixes

25. **Connect panel (audit CRIT 2)**: a sticky "connections" bar with a close (×) button at the top of the panel; Escape closes it (before any flow), as does a click outside; under 600 px the panel is a full-screen sheet (class `bb-src`, one media rule in the head style) instead of a popover anchored off the left edge.
26. **testnet demo activity (audit CRIT 3b)**: a review the API flags `demoActivity: true` shows a dashed "testnet demo activity" badge next to its proven-stay badges on the place page (title: posted by the BookerBob demo script on testnet, not by an organic guest), and the same words in the merchant's review list. Reviews without the flag are unlabeled. `rv()` carries `demo`.
27. **reused proof, long runs (audit HIGH 4)**: "try a reused proof" without a past purchase at the store stops at the claim step with "you need a past purchase first." (pol-real checks before calling the store; main's NotInTree pre-check covers step 4). `runAgent` catches a thrown run and marks the running step failed, so the run never spins. Booking and review: the chain step has a 60 s limit ("stellar did not answer in 60 s. it may still land. check my passes before you retry"), with retry; close (×) and Escape always work, closing a running flow stops watching it (a run id ignores late events). When a wallet connects for a waiting action, Connect closes so the action shows (it stays open for the score otherwise).
28. **visitor's own price (audit HIGH 5)**: the home "bob shops for you" card shows the real store tee and price; the "returning customer · proven" row and the discounted total only when this browser has a purchase in the store's customer group (`ucp.returning()`), else "your price: full. after your first purchase, −10% as a returning customer." (bps from the chain, `ucp.discountBps()`).
29. **merchant desk (checkout gated server-side)**: for non-operators the confirm button is replaced by "the place itself checks guests in; book to get a pass."
30. **one count, restaurants, scale, wording (audit HIGH 6)**: every "proven stays/customers" number is the place's group size (tree), including the ranking rows ("· N proven stays · M proven reviews") and the hero caption; restaurants are a fourth kind tab (the "restaurants next" chip is gone); /classic/ shows the same /10 scale (star average × 2) with "from N proven reviews"; the BookerBob regular perk says where it comes from ("from your stay at <place>", or "from your stay here").
31. **illustrative comparison (audit HIGH 7)**: the "9.1 from 2,000 reviews elsewhere" line is labelled "illustrative comparison".
32. **Ask Bob query box (audit HIGH 8)**: the bar's query text is an input (placeholder = the kind's demo query); Enter or "ask bob" runs `search(q)` (pol-real, GET /api/search), with "try" chips for the docs/demo-queries.md queries. The log lines are the real result ("N results, M with proven reviews. only those are ranked.", top), the kind tab follows the parsed kind, rows come in the search's order (places open the place page; UCP products open Bob shops with that product chosen). Switching tabs returns to the plain ranking.
33. **/classic/ contract link (audit HIGH 9)**: the footer link reads the contract id from /api/config and stays hidden until known (app/src/Shell.tsx).
34. **MED audit items**: the network pass card's kicker says "pass" (the name is "BookerBob regular" everywhere); the arbiter package has no "reveal" (the fields are held by the arbiter and say so; the three checks below are the real ones); the desk's scan button reads "simulated scan" and its frame "simulated scan: fills a sample commitment"; a flow step shows its elapsed time only when it took 50 ms or more, else ✓ (no "0.00 s"); a shop place without photos has no "product photo" slot.
35. **Stellar wallet tier (edit, marked `bb:stellar-tier`)**: under the wallet row's score line (which stays), a "Stellar wallet tier" block: the explainer verbatim ("your Stellar wallet history earns a tier. places see the tier, never the wallet."), the perk ("+5% at N places"), then either the held state "Stellar wallet tier N · tx ↗" (join tx), a "join with my wallet" button (tier from the existing loyalty score, Horizon only, at or above `/api/stellar-tier/info` minTier), or the honest reason ("connect a Stellar wallet with tier 3+", "your wallet scores tier N, needs 3", passkey C accounts: "connect Freighter or a demo key (G…)"). Join: a dedicated stay identity (never checked in) → `/api/stellar-tier/challenge` → `wallet.signMessage` (SEP-53) → `/api/stellar-tier/join`; server refusals in plain words. The picker's tier row shows the same reason when disabled; My passes gets a "Stellar wallet tier N" attested pass with the tx; the greyed Stellar Passport rows (connect, breakdown) are gone. pol-real: `stellarTier.{info, reason, view, join}`, group key `tier`.
36. **leftovers**: the desk checks in at the place picked in the merchant switcher (and shows that place's tree); a review whose text is missing says "rating only, no text".
37. **connect rows**: the short address shows on the wallet row only (it had spread to REP and regular).
38. **guided merchant and arbiter (marked `bb:guide`)**: a strip under the merchant place switcher and above the arbiter queue: "demo: you are acting as <place>" / "demo: you are acting as the arbiter", three numbered steps in the design's type, the current one filled from real state (merchant: desk success → group grows, an open dispute at this place → step 3; arbiter: no dispute picked → 1, awaiting the guest → 2, disclosed → 3, attested → all ✓). For non-operators the merchant's step 1 says the place adds guests from the booking.
39. **motion from real events**: Ask Bob's lines and row reveal advance on the real search request (first line on send, counts and top on the answer; the timed 380/560 ms ticks are gone); row stagger is 0 with reduced motion. Already event-driven and kept: the proof moment's field modes (download → proving → verifying → settle), the live download bytes, the arbiter's three checks (each waits on its real check), the agent run steps (each on its UCP event). Reduced motion: the hero tree renders once a second at a fixed frame, the skeleton pulse is off, scrolls are instant, and the head style stops all CSS animation. The only timed motion left is the desk's scan frame, labelled "simulated scan".
40. **wallet score line**: the demo key is not scored (a fresh, history-less account); its line reads "wallet score: connect a Stellar wallet with history (Freighter) to earn a tier". A failed score reads "wallet score: not available for this wallet right now" (no reconnect advice, no dash). pol-real: loyalty status `skipped`.
41. **REP demo reset (operator only)**: when `/api/rep/status` says demo, "fresh demo · reset" and "start over" first call `POST /api/rep/demo-reset`; in the REP row an "already joined" refusal reads "this REP account already joined in an earlier demo." with a "reset REP demo" action (resets, then "verify with REP" runs again). Visitors see nothing new.
42. **Ask Bob, federated (judge pass)**: Enter runs the typed value directly (no stale state); the log says how rows are ordered ("by proven rating, weighted by how many reviews back it"); results from outside BookerBob (JMPR hotels) are listed under the ranked rows with "—", "no proven reviews, so not ranked"; empty deal chips are hidden. All seven docs/demo-queries.md queries answer from GET /api/search (places, ucp, jmpr).
43. **one count definition**: "proven stays/customers" = checked-in leaves of the merchant's on-chain tree (group size; classic `provenStays`); reviews are "proven reviews". Rating = average of proven reviews × 2, one decimal, on main and /classic/ (checked: Casa 35 proven stays, 15 proven reviews, 8.5 on both). Server/agent copy still says "from N proven stays" for the review count in `server/src/search/index.ts:43` and `agent/src/rank.ts` (not rendered on main; /classic/ renders its own line).
44. **arbiter package line**: one line "the stay package: secret, leaf and signature, held by the arbiter" instead of "leaf ·" placeholders.
45. **/classic/ plain words**: the wallet panel says "wallet score" and "your Stellar wallet history earns a score and a tier (1 to 5, 5 best). places see the tier, never the wallet." (was "pass_connect · verify_onchain_zk", "verified tier (5→1)", "Groth16 score proof").
46. **final judge pass**: fresh profile, every screen at 1440 and 390, `docs/design-parity/final-*.jpg` (home, two typed Ask Bob queries, hotel/café/shop/restaurant place pages, bob shops, passes, connect, merchant, arbiter, a real booking's proof moment and result, /how, /classic/ home and places).
47. **demo key tier reason**: an unscored demo key says "a demo key is brand new, so it has no tier. connect Freighter with tier 3+".
48. **Ask Bob is the hero (jury feedback, marked `bb:composer`)**: the home hero's left column is now title (smaller), tagline, and a large multi-line composer ("ask bob", 3 rows, 22-32px type, Enter sends, Shift+Enter new line, "ask bob →" button) with the suggestion chips under it and "or watch bob shop at a real store →"; the kind chips and the two hero buttons are gone (the kind tabs stay in the ranking). The placeholder types itself ("a quiet room in lisbon under 120, best proven rating") with a blinking caret, static under reduced motion or once focused. On send, a full-width conversation under the hero: the query as a user bubble, Bob's reply bubble (blinking caret while the request runs), then the top 3 result cards; every number in the reply ("I ranked 5 stays by proven reviews only. 2 more from JMPR hotels have no proven reviews, so I left them out. here are the top 3, with your perks.") comes from the /api/search result, cards from the same rows; "N more ranked below. see the full ranking ↓". The ranking section's headline shrinks and its old query bar, chips and log lines are removed. Screens: docs/design-parity/final-hero-{idle,thinking,answer,answer2}-{d,m}.jpg.
49. **passkey sign-in (marked `bb:passkey-signin`)**: "continue with passkey" / "sign in with my passkey" only call `navigator.credentials.get()` (discoverable, no allowCredentials, PRF in the same prompt) and never create. Nothing found: "no passkey for this site on this device. create one?" with an explicit "create a passkey" button (Connect) or next to "create a new passkey" (wallet row). It never falls back to a demo key. A connected passkey row reads "<passkey name> · original|generation N · G…" with "switch passkey" (pick any passkey, open its own history). The name travels in the credential's user handle ("bb1:<name>"); a passkey signed in from another history opens that history.
