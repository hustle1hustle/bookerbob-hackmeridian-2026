# Design parity: Proof of Loyalty v2

Each pair is `<screen>-design.jpg` (the delivered file over `pol-mock.js`, served from `design/`) and `<screen>-real.jpg` (the same file at `/` over `pol-real.js`, Stellar testnet, local backend). Both were driven in headless Chrome at 1440 px through `window.__bb.jump(name)`. The flows (`flow-*`, `agent-*`, `passes`) on the real side come from real clicks: a passkey made by a CDP virtual authenticator, a real pay, and a real UCP purchase. Overlays are captured at viewport size.

Verdict per diff: **data** = the real data differs (expected), **craft** = the layout or behaviour differs (to fix), **server** = needs a backend change.

## Priority screens

| Screen | Diff | Kind |
|---|---|---|
| home | 7 stays / 3 cafés / 3 shops instead of 3 / 1 / 1; real names, areas, prices, ratings; hero caption "casa azulejo nove · 20 proven guests" | data |
| home | ranking scores are real proven averages on the /10 scale (9.3 ... 7.3) | data |
| home | "bob shops for you" card: 40.80 / -4.08 / 36.72 is design copy; it matches the real store and the real claim purchase | data (matches) |
| home | before the first load finishes (about 7 s cold), the kind counts show 0 and the ranking is empty | craft, caused by latency; see "server" below |
| place-hotel (Casa Azulejo Nove) | real rooms, area and note from the catalog; 20 proven stays; 3 policy lines | data |
| place-hotel | two reviews show "text unavailable" (reviews posted outside the backend; the design's own empty-text state) | data |
| place-hotel | those reviews' "proven stay ↗" links point to `/tx/null` (the design links every review to EXPLORER + txHash) | server (backfill review tx hashes) or a one-line guard in index.html |
| proofs picker + breakdown | the eligible proof is ticked by default; ineligible ones are greyed with real reasons ("no stay here yet", "not attested") | matches |
| pay flow (flow-success) | real: 110.00 → 104.50, "network member −5%"; steps timed from real events (proving files 23.9 s, verifying 20.7 s) | data |
| pay flow, more than one night | fails at `/api/cosign` with BadParams (see "server") | **server, blocking** |
| place-shop (REP store) | product is now the real store item ("rep ship of theseus tee", 40.80) from the UCP bridge; no size picker (the store has no sizes), so it drops cleanly | data |
| place-shop | the cart line still appends the design's default size (", m") | craft (one-line index.html edit, pending) |
| place-shop | title "REP Store (Shopify)" wraps to two lines (the real on-chain name) | data |
| agent run (UCP) | real run: 40.80 USDC paid (tx 6336ed47…); without a past purchase the claim steps read "skipped: no claim" | data |
| agent run | step copy "spends the nullifier" is jargon | copy fix (next commit) |
| passes | real passes from this browser's stays plus the network pass; no credentials (a fresh browser holds none, so the card drops) | data |

## Other screens (rendered, not driven end to end yet)

`place-cafe`, `review`, `merchant-hotel`, `merchant-shop`, `arbiter`, `connect`: rendered with real data through jump. `flow-rejected` and `flow-error` are not driven yet. The review, disclose, arbiter-check and attest flows follow in the next commits.

## Server or SDK changes needed

1. **`/api/cosign` rejects every server-priced cart (blocking).** The browser's stellar-sdk signs auth entries with a `soroban_authorization_with_address` preimage, while `server/src/catalog.ts` `cosign()` (line 53) reads only `soroban_authorization` / `sorobanAuthorization`, so `fn` is undefined and it throws BadParams. Fix: `const auth = plain.soroban_authorization ?? plain.sorobanAuthorization ?? plain.soroban_authorization_with_address`. Affected: hotel bookings over more than one night (the design's default is 2), café menus, any cart that isn't the single list price.
2. **`/api/config` takes 2.5 to 6.4 s per request.** It reads every merchant one by one to build `demoMerchants`, with no cache. It gates the first paint (the contract id comes from it). Fix: cache it, or `Promise.all`.
3. **Review tx hashes.** Reviews posted outside the backend have `txHash: null`, and the design links them anyway. A backfill (or a guard in index.html) removes the dead link.
