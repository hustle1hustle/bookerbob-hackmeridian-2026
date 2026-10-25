# UCP act: recording script (75 s)

Title card: **BookerBob. Google for agentic commerce. Proof of loyalty, everywhere you go.**
(Descriptive comparison only: no Google logo, colors or partnership wording.)

## Before recording (off camera, ~5 min)

1. Terminal: font 20 pt, dark theme, window 120 x 30, `cd ucp` (or `~/dev/hackmeridian/ucp-module`).
2. The buyer already has a past purchase at the store: `npm run agent -- --bridge https://bookerbob-ucp-bridge.fly.dev` once (full price, joins the tree). Do this before, not on camera.
3. At least 2 funded payers left: `python3 -c "import json; print(len(json.load(open('agent/.payers.json'))))"`; if fewer, `npx tsx --env-file=.env scripts/make-payers.ts 4 && npx tsx --env-file=.env scripts/fund-payers.ts`.
4. Browser (Arc), three tabs in this order:
   - A: https://jwq0dd-rp.myshopify.com/products/rep-field-tee (the tee, 150 AED)
   - B: https://stellar.expert/explorer/testnet/contract/CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY
   - C: Shopify admin, Orders list (logged in)
5. Type, do not run, in the terminal: `npm run agent -- --bridge https://bookerbob-ucp-bridge.fly.dev`
6. Screen recorder on the whole screen; hide notifications (Do Not Disturb).

## Shot list

| t | Action | On screen | Voice |
|---|---|---|---|
| 0:00 | title card (3 s) | tagline | |
| 0:03 | show tab A | the tee, 150 AED, a normal Shopify store | "A real Shopify store. A buyer's agent shops it over UCP, the open protocol for agentic checkout." |
| 0:10 | switch to terminal, press Enter | `store profile: … patronage yes, Stellar USDC yes` | "The store advertises one new thing: it accepts proof that you bought here before." |
| 0:17 | wait | `found "REP ship of theseus tee"`, `buyer has … past purchase(s) here` | "Our agent remembers it was here. It does not tell the store which visit." |
| 0:24 | wait | `store asks: Semaphore membership in merchant 5 tree`, `proof generated in ~600 ms` | "It proves membership in the store's customer list, on the device, in half a second." |
| 0:32 | wait | `store verified the proof against the Stellar contract, single-use code BB-…` | "The store does not trust the agent. It asks the contract on Stellar." |
| 0:38 | wait | `code applied by the store: -15.00 AED` | "Shopify applies a real discount, through standard UCP." |
| 0:43 | wait | `store co-signed book_with_discount_amount … pays 36.72 USDC`, then `paid 36.72 USDC on Stellar, tx …` | "One Stellar transaction re-checks the proof, burns the nullifier, and pays in USDC." |
| 0:52 | cmd-click the stellar.expert link in the last line | the tx on stellar.expert: `book_with_discount_amount`, 36.72 USDC | |
| 0:57 | switch to tab C, refresh | newest order `#10xx`, Paid, note "Paid 36.72 test USDC on Stellar testnet, tx …", tags `patronage-proof` | "The order lands in the store's admin, paid, with the transaction on it. The store never learned who." |
| 1:04 | terminal: `npx tsx scripts/failed-paths.ts https://bookerbob-ucp-bridge.fly.dev` | `forged claim … InvalidProof`, `reused proof … NullifierUsed` | "A forged claim fails. Reusing a proof fails. One discount per purchase per season, enforced on Stellar." |
| 1:12 | end card (3 s) | "Proof of loyalty, everywhere you go." + contract id | |

## If something breaks while recording

- Shopify `Rate limit exceeded`: wait 60 s, rerun.
- Slow testnet (> 20 s between lines): cut the wait in edit and label it "sped up"; never fake output.
- Fallback footage: `evidence/run-3-live-bridge.log` and `evidence/run-4-order-recorded.log` are real runs (Sun 25 Oct) with their tx hashes; order `#1005` in the admin is the recorded one.

No personal data on screen: the buyer email is `buyer@example.com`, payers are fresh testnet keys.
