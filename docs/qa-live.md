# Live QA, judge's-eye pass

Target: https://stellarbob2026.xyz (new design, two builds deployed during the pass, ~15:00 to 16:20 UTC
Sun 25 Oct) and https://bookerbob-ucp-bridge.fly.dev. Headless Chrome, fresh profile per run, a virtual WebAuthn
authenticator with PRF for the passkey, desktop 1280x860 and mobile 390x844. Screenshots in `docs/qa-live/`.
`/api/ops/errors` was empty throughout (it does not record the 400 below).

## CRIT

### 1. Booking fails on the new design (every quoted booking)
Repro: `/` -> CONNECT -> PASSKEY (or DEMO KEY) -> click outside the panel -> Belém Garden Inn -> `BOOK · 240.00`.
Result: "that did not look right. nothing was sent." `POST /api/payer/feebump` returns `400 {"error":"BadParams"}`.
Screenshot: `qa-live/crit-booking-fails.png`.

Cause, verified: the signed inner `book_amount` transaction declares a resource fee of 239,443,544 stroops
(23.9 XLM). The server refuses any sponsored transaction above `MAX_FEE_STROOPS` = 10 XLM (`server/src/payer.ts:8`).
Re-simulating the same signed transaction on testnet RPC asks for `minResourceFee` 73,923 stroops (0.0074 XLM), so
the fee comes from the simulation made before `tx.signAuthEntries` (the merchant co-sign), not from the network.
Fix: in `site/src/pol-real.ts` (~303-314), re-simulate after `signAuthEntries` and before `tx.sign()`. Fallback:
raise the cap. `/classic/` plain `book` (no co-sign) works: [`1b967bd6…`](https://stellar.expert/explorer/testnet/tx/1b967bd649273d61c6bf9a3a8bde41b07369f7b8c4800e46457338cb81c90bb2).

Impact: no stay can be booked on the new design, so passes, reviews, the double-review refusal and the perks
picker with a real pass cannot be shown from a fresh browser. Each failed attempt still opens and funds a fresh
payer (`/api/payer/open` and `/activate` succeed first).

## HIGH

### 2. "text unavailable" reviews on the merchant desk
Repro: MERCHANT -> Casa Azulejo Nove. Two reviews read "text unavailable", one of them marked "✓ verified stay".
The review-text store is missing entries for reviews that exist on chain. Screenshot: `qa-live/high-text-unavailable.png`.

## LOW

3. The connect panel stays open after connecting and covers the right half of the hero. Escape does not close it;
   a click elsewhere does. `qa-live/low-connect-panel.png`.
4. The connect panel's REP card reads "SOON. REP verified traveler is coming to the REP app" in a fresh browser,
   while the REP handoff works live ([`38bd6a7f…`](https://stellar.expert/explorer/testnet/tx/38bd6a7f38987c745624d363124c27f7a0e2bd8764b2051e3afdbe5474c34106)).
   By design per b5bb34c (verify only in the demo browser); check that the recording browser shows the verify path.
5. `/classic/`: the "connect with passkey →" link goes to `#pass-connect`, which the hash router renders as
   "page not found". `qa-live/low-classic-passkey-404.png`.
6. `/classic/`: the footer link "contract on stellar.expert" has an empty contract id until `/api/config` loads.
7. Jargon a judge reads: "root 0x064821…3e85c7" and "customer group 22 of 32" on the merchant desk (32 is not the
   tree size, which is 1024); "commitment matches", "leaf in the group", "signature held b…iter" (truncated) on the
   arbiter. The Bob Shops steps read "stellar checks the proof, once" in the latest build (an earlier build said
   "spends the nullifier").
8. Ask Bob on the new design runs one canned query ("a quiet room in lisbon, best proven rating", AGAIN). There is
   no free-text box, so the queries in `docs/demo-queries.md` can only be typed on `/classic/`.
9. Mobile 390 px: no horizontal scroll. The header stacks into three rows (logo, role switch, connect) and takes
   about the first 280 px. `qa-live/landing-390.png`.

## Checked, works

| Flow | Result |
|---|---|
| Read-only landing | loads, no console errors, DOMContentLoaded 0.4 s desktop / 1.6 s mobile emulation, network idle about 4.5 s; `pol-real.js` is 1.67 MB |
| Ask Bob (new design) | canned ranking renders: Belém 9.3, Casa Azulejo, Chiado... `qa-live/askbob-canned.png` |
| Ask Bob (`/classic/`) | the five chips from `docs/demo-queries.md` are present |
| Place page | rooms, nights, discounts, reviews with "PROVEN STAY ↗" links to stellar.expert, perks with reasons |
| Connect | passkey (virtual authenticator, PRF) and demo key both connect |
| Arbiter | REVEAL then RUN THE CHECKS: commitment, signature, leaf all PASS. ATTEST not clicked, to keep live data unchanged. `qa-live/arbiter-checks.png` |
| `/classic/` booking | demo key, Belém, "book at full price": paid 120 USDC, tx `1b967bd6…` |
| Bob shops without a wallet | asks to connect first |
| UCP bridge | `/.well-known/ucp` 200 |

## Not covered

- Review, double review and the perks picker with a real pass: blocked by CRIT 1 on the new design.
- Merchant desk checkout and UCP "RUN BOB" with a wallet: the runs did not complete within the pass (the connect
  panel and a redeploy mid-run); rerun after CRIT 1 is fixed.
- Dispute from the guest side.

## Note for the upgrade

Testnet rent is high today: uploading a 53 KB wasm cost about 9.4k XLM at 15:30 UTC (2.9k XLM at 13:20 for the
context-groups upgrade). Fund the deployer before `scripts/rep-onchain.sh upgrade`.
