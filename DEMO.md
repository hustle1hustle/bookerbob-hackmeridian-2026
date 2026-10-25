# Demo script: UCP module (about 75 s inside the main video)

Title card: **BookerBob. Google for agentic commerce. Proof of loyalty, everywhere you go.**
(Descriptive comparison only: no Google logo, colors or partnership wording.)

Setup off camera: bridge running (`npm run bridge`), buyer already has one past purchase at the store
(first `npm run agent`), terminal font large, a browser tab on stellar.expert.

| Time | Screen | Line |
|---|---|---|
| 0:00 | Shopify storefront, the tee, 150 AED | "A real Shopify store. Our agent shops it the way agents will: over UCP." |
| 0:08 | terminal: `npm run agent`, first lines (profile, patronage yes, Stellar USDC yes) | "The store advertises one new thing: it accepts proof that you bought here before." |
| 0:18 | "store asks: Semaphore membership…", "proof generated in ~500 ms" | "The agent proves it is one of this store's past customers. Which one stays on the phone." |
| 0:30 | "store verified the proof against the Stellar contract, single-use code" | "The store does not trust the agent. It asks the contract on Stellar." |
| 0:38 | "code applied by the store: -15.00 AED" | "Shopify applies a real discount code, through standard UCP." |
| 0:45 | "paid 36.72 USDC on Stellar", click the tx on stellar.expert | "One Stellar transaction re-checks the proof, burns the nullifier, pays in USDC." |
| 0:55 | last line: "store saw: … Not who the buyer is, nor which past order." | "Loyalty without a loyalty account." |
| 1:02 | `npx tsx scripts/replay.ts` -> `NullifierUsed` | "Reuse the same proof: Stellar says no. One discount per purchase per season." |
| 1:12 | end card: tagline + merchant 5 contract link | "Proof of loyalty, everywhere you go." |

Fallback if the network is slow: play `evidence/run-3-returning.log` timings as captured (real run, Sun 25 Oct 13:13).
