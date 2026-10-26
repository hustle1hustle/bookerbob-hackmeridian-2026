# Proof of Loyalty: plan

_Plan written at kickoff; README and docs/bench.md are current._

Team BookerBob. HackMeridian 2026 (Stellar), Lisbon, ONE16. Hacking window: Sun 25 Oct 09:00 to Mon 26 Oct 12:00 (Lisbon), no late submissions.
Path: **Genesis** (idea to MVP). Thematic track: **Stellar Unlocked**, which names this case directly: "ZK, natively: use the Poseidon and BN254 host functions to build verifiers, private voting, membership proofs".
The portal form takes one thematic track. Composed elements (USDC via SAC, passkey wallet, agent) are described in a separate line of the submission.

Every technical claim below was checked against primary sources. Sources and details: [`docs/verify.md`](docs/verify.md). **OPEN** marks a question without an answer yet.

---

## 0. Rules we build against

- Judging is async: demo video, deck, GitHub repo, submission answers. Judges ask: does the core feature work and can they test it themselves; is it clear what was built during the event.
- A clear README with specs does most of the work for judges.
- Starting from an existing project is allowed, but the README and demo must show the starting point and what was built during the hackathon. Prior work must be disclosed; undisclosed prior work disqualifies.
- AI tools are allowed and encouraged, with attribution: the submission names where AI substantially generated code or assets. See [`docs/ai-usage.md`](docs/ai-usage.md).
- Submission: repo link, demo video **2 to 4 minutes** on YouTube or Vimeo, deck as PDF, PPTX, PPT or HTML up to 20 MiB.
- Live URL, contract IDs and testnet transaction hashes are not mandatory, but they are the best way for judges to test the feature themselves. We ship all three.
- **OPEN:** exact fields of the submit form.

## 1. Product

**Hero:** BookerBob. Google for agentic commerce. Proof of loyalty, everywhere you go. (A descriptive comparison only: no Google logo, colors or implied partnership.) **Name:** Proof of Loyalty. **Tagline:** everywhere you go. **Brand and agent:** BookerBob. **First medium:** hotels; the hotel flow is labelled "proof of stay".

**One line:** customers prove they were customers of a place without revealing who they are, and in return get honest reviews and returning-customer discounts. BookerBob, their agent, books using only this kind of data.

**Security principle:** private by default, accountable when needed.

**Problem:**
1. Reviews on travel platforms are inflated, and neither a guest nor an agent can tell a real review from a bought one.
2. Returning-guest discounts require handing the hotel personal data and history. The guest pays for the discount with their data.

**One ZK primitive, three uses** (one Semaphore circuit, only the nullifier scope changes):

| Use | What the guest proves | scope | On-chain effect |
|---|---|---|---|
| Review | I stayed here (leaf in the hotel's tree) | `review, hotel` | one review per stay, author unknown |
| Returning-guest discount | I stayed here before | `discount, hotel, season` | lower price, once per season per past stay, USDC payment in the same transaction |
| Disclosure in a dispute | this review is mine and the stay is real | outside the circuit, see 3.5 | arbiter sets an on-chain "verified stay" mark, the hotel never learns the identity |

## 2. Scope

**Core:**
1. Contract with a Poseidon Merkle tree of guests per hotel. A leaf is added at checkout, authorized by the hotel.
2. Groth16 verifier on the BN254 host functions.
3. Anonymous reviews with nullifiers.
4. Returning-guest discount with USDC payment in one transaction.

**If core is done:**
5. Dispute disclosure.
6. Guest passkey login, timebox 1 hour, fallback Freighter.
7. Agent: thin TS layer, reads verified ratings, picks a hotel, applies the discount.

**After core, in order (see 3.9):**
8. JMPR: real hotels, free sandbox bookings, BookerBob confirms the stay.
9. zkTLS: import past stays from Booking.

**Roadmap:** beyond hotels (see 2.1), night resale on SDEX, a night as an asset, path payments, x402 and OpenZeppelin policies, anonymous cashback, hidden ratings revealed at k>=5, portable loyalty inside a hotel network.

### 2.1 Beyond hotels: one module for any merchant
The primitive is not about hotels. The contract is merchant-generic: a `Merchant` with a `kind` (`hotel`, `cafe`, `shop`, `restaurant`, ...) is "a place where you were a customer": one tree of customers per merchant, and a nullifier per (action, merchant, period). Scopes are `review, merchant` and `discount, merchant, season`; circuit, tree and proofs do not depend on the kind. The demo leads with hotels; the seed also carries a café and a shop through the same cycle.

The same shape covers:
- **Merchants over UCP (Universal Commerce Protocol):** reviews only from proven buyers, and a returning-customer discount that the buyer's own agent applies at agentic checkout.
- Restaurants, services, events, subscriptions: anywhere there is "was a customer" and where reviews and loyalty are today paid for with someone else's data.

Roadmap: a UCP order as an entry into the tree. Which stage comes first after the core (UCP merchants or JMPR hotels, see 3.9) is **OPEN**.

## 3. Architecture

### 3.1 Stack (verified)
- Network: testnet and mainnet run Protocol 29. BN254 and Poseidon are available since Protocol 25, `g1_msm` and Fr arithmetic since Protocol 26.
- Contracts: Rust, `soroban-sdk` 28 (as in the official examples). Wasm built with `stellar contract build`.
- CLI: `stellar-cli` 28.1.0.
- BN254: `env.crypto().bn254()`: `g1_add`, `g1_mul`, `g1_msm`, `pairing_check`. Uncompressed big-endian points, G1 64 bytes, G2 128 bytes.
- Poseidon: the host exposes only the permutation. The circomlib-compatible hash comes from the SDF crate `soroban-poseidon` (`poseidon_hash::<3, Bn254Fr>`).
- Verifier: same structure as the official `soroban-examples/groth16_verifier/contracts/bn254_verifier`. Measured cost about 31M CPU, about 7.8% of the per-transaction limit.
- Circuits: Semaphore v4 as is, artifacts 4.13.0 from the official ceremony (400+ participants, July 2024). Tree depth pinned to **10**: zkey 2.4 MB, browser proof about 0.3 s.
- Frontend: Vite + stellar-sdk, public URL.
- USDC testnet: SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, faucet.circle.com (needs a trustline).

### 3.2 Identities
- Guest master secret on the client (demo: localStorage or derived from a passkey).
- One Semaphore identity per stay, derived deterministically from `(master, hotel, stay_counter)`. Otherwise the same commitment inserted twice would reveal "this guest came back".
- At checkout the guest gives the hotel only the commitment of that identity.

### 3.3 Contract `proof_of_stay`
Storage:
- `Hotel { admin, name, price, discount_bps, tree (LeanIMT), root_history (ring of 30) }`
- Nullifiers: one **persistent** entry per nullifier. Temporary storage does not work: once its TTL expires the entry is deleted and the nullifier can be spent again.
- Reviews, aggregates `(sum, count, verified_count)`, the depth-10 verifying key (set in the constructor), arbiter, USDC token.

Functions: constructor, `register_hotel`, `checkout` (on-chain leaf insert), `book`, `book_with_discount`, `post_review`, `attest_review`, views.

**Mandatory contract checks:**
1. A root is accepted only from its own hotel's root history, and **root 0 is always rejected**. The Semaphore circuit does not bound the path length: with a depth above the maximum the root becomes 0 and the proof passes for any secret.
2. Every public input is below the field modulus r. Otherwise the host silently reduces it mod r and one nullifier could be recorded under two encodings.
3. The contract computes scope and message itself from `hotel`, `season`, `rating` and hashes, never taking them from the client.
4. In `book_with_discount` the proof message binds the payer: `message = keccak("pos/guest" || xdr(guest))`. Without it anyone who sees the proof in the mempool could front-run the transaction, take the discount and burn the guest's nullifier.

### 3.4 Semaphore v4 compatibility (verified against source)
- Public inputs in this exact order: `[merkleRoot, nullifier, hash(message), hash(scope)]`. Tree depth is not an input; it selects the key (one VK per depth), so one depth is pinned.
- `hash(m) = keccak256(m as 32 bytes big-endian) >> 8`. The contract repeats it with `env.crypto().keccak256`.
- nullifier = Poseidon(hash(scope), secret), commitment = Poseidon(BabyJubJub public key).
- LeanIMT: circomlib Poseidon t=3, no zero hashes, a lone left node is promoted unchanged. The contract tree does exactly the same.
- snarkjs G2 coordinates come as `[c0, c1]`, Soroban expects `c1, c0`; one converter swaps them.
- First test: the contract tree root matches JS byte for byte. Fallback if it does not: off-chain tree, hotel publishes the root.

### 3.5 Disclosure without a new circuit
- The review message includes `disclosure_commit = Poseidon(dk)`, `dk` a random secret.
- In a dispute the guest privately gives the arbiter `dk` and a signature by the stay identity (`identity.signMessage`, EdDSA-Poseidon). The arbiter checks off-chain and calls `attest_review`.
- The signature is bound to the leaf, so the arbiter sees which checkout it is. In production the arbiter must be a blind node (TEE/MPC). Roadmap.

### 3.6 Agent
`agent/` TS script: request "hotel in Lisbon under N USDC", reads `get_rating` for all hotels, ranks by proven reviews only, picks one; if the guest has a past stay there, proves it and calls `book_with_discount`, else `book`.

### 3.7 Frontend (three roles, one page with a switcher)
- **Guest:** login, hotels with verified rating, booking, "my stays", write a review, apply discount.
- **Hotel:** guest checkout (QR / paste commitment), feed of anonymous reviews, dispute button.
- **Arbiter:** dispute queue, disclosure check, attest.
- Every action links its tx hash to stellar.expert (testnet).

### 3.8 Seed data
3 fictional hotels, ~8 checkouts, 20 to 30 reviews through the real cycle (proof, transaction, nullifier) from test guests, 1 discount, 1 dispute. Marked "demo data, testnet" on the site.

### 3.9 Hotels and reviews: three stages

_Shipped: stage 1 and a read-only partner snapshot in search; sandbox bookings and zkTLS import were cut._

Strict order: the next stage starts only when the previous one works end to end on testnet.

**Stage 1, core.** Fictional demo hotels, checkout signed by our test hotel admin. Enough for the full demo.

**Stage 2, JMPR (after core).**
- Real Lisbon hotels and prices through our backend (the JMPR key stays server-side).
- JMPR sandbox bookings are free, so the cycle booking, confirmation, checkout, review, discount can be shown live.
- BookerBob as the platform confirms the stay: after a confirmed booking the backend signs `checkout`, the hotel does not need to integrate.
- Real reviews only for real past bookings by the team.
- JMPR is listed in PRIOR_WORK as an external service.

**Stage 3, zkTLS (after stage 2).** Import a past Booking stay as a second way into the tree: a notary signs, the contract checks the signature. External prover and notary are disclosed as prior work, their code is not in this repo. **OPEN:** TLSNotary signature format and its verification in Soroban. If not reached, one roadmap frame.

**Rule for all stages:** real hotels get only reviews for real stays; seed data only on fictional hotels.

### 3.10 Testnet TTL
Minimum persistent TTL on testnet is about 7 days. Extend the TTL of the contract instance, roots and tree before and after judging (26 to 28 Oct), or the demo state may be archived.

## 4. Repository rules

- Public repo, created after hacking started (25 Oct, after 09:00), so the commit history shows what was built during the event.
- Frequent atomic conventional commits. No squash, no history rewrite, no force-push on main. Tag `v-submission` on the submitted commit; no commits to main after 12:00 Mon (only a `post-hack` branch).
- AI attribution in [`docs/ai-usage.md`](docs/ai-usage.md) and in the submission. Prompt logs are not committed.
- Third-party code only in `vendor/` or as dependencies, with attribution. Semaphore and zk-kit are MIT; circomlib and snarkjs are GPL-3.0, used unmodified as dependencies. All listed in [`PRIOR_WORK.md`](PRIOR_WORK.md).
- Secrets only in `.env` (gitignored); the repo has `.env.example`. No testnet account keys in code.

```
/contracts/proof_of_stay      Rust, Soroban
/circuits                     golden Semaphore vectors, artifact notes
/scripts                      golden proof, fixtures, proof_to_soroban.ts, deploy, seed, bench
/agent                        TS agent
/app                          frontend
/docs                         verify.md, ai-usage.md, architecture.md, bench.md
PLAN.md  PRIOR_WORK.md  README.md  .env.example
```

## 5. Timeline (Lisbon)

| By | Ready | Check |
|---|---|---|
| 13:00 Sun | repo, skeleton, testnet accounts, golden Semaphore proof | `snarkjs groth16 verify` ok |
| 15:00 Sun | contract Poseidon tree matches JS | otherwise fallback 3.4 |
| **18:00 Sun** | **golden proof passes the verifier on testnet, a modified input fails** | tx hash |
| 01:00 Mon | full contract deployed to testnet | full-cycle integration test |
| 06:00 Mon | three-role frontend, seed, agent, live URL | a judge walks the cycle alone |
| 09:00 Mon | cost benchmark, README, docs | bench.md |
| 11:00 Mon | video, deck, submission texts | checklist in section 8 |
| 11:00-11:45 | submission, tag `v-submission` | form confirmation |

**Cut rule:** if the verifier does not work by 18:00, the whole team works on it. If behind at 01:00, cut disclosure first, then the agent. The discount is never cut. JMPR and zkTLS start only after core and are cut first.

Roles: A circuits, converter, verifier. B tree, contract, USDC, deploy, seed. C frontend, passkey, agent, video, README.

## 6. Risks

1. ~~Poseidon mismatch with circomlib~~: closed, `soroban-poseidon` reproduces the Semaphore root exactly.
2. G2 order and endianness: known fix (c0/c1 swap), covered by the golden test.
3. Verification budget: about 7% of the limit. Measure tree insert (10 hashes) in wasm.
4. zkey weight in the browser: 2.4 MB at depth 10.
5. Passkey eats time: timebox 1 hour.
6. Sender address links the review author: reviews are sent by a relayer or a fresh account; noted in README.
7. Root 0 and non-canonical inputs: closed by the checks in 3.3.
8. The official bn254_verifier is unaudited (per its README); noted in our README.

## 7. README outline

1. Name (Proof of Loyalty), tagline (everywhere you go), one line, live URL, video, contract ID.
2. Problem (two facts) and users (guest, hotel, guest's agent).
3. How it works: checkout, tree, proof, review/discount, disclosure.
4. Stellar specifics: Poseidon (on-chain tree), BN254 pairing + G1 ops (Groth16 verifier), USDC via SAC (discounted payment in one tx), passkey wallet; versions (Protocol 29, soroban-sdk 28); verification cost; testnet contract ID and at least 3 tx hashes (checkout, review, discount payment).
5. Security model: what the hotel, the arbiter and the public see, and what nobody sees.
6. Numbers: Soroban verification cost, browser proving time, proof size.
7. Post-quantum: Groth16 zero-knowledge is perfect, so review-author anonymity survives a quantum computer; soundness (forging new proofs) is quantum-vulnerable; migration path is lattice-based SNARKs with ZK as they mature. No drop-in PQ replacement for pairing SNARKs exists yet.
8. Setup / install / env vars / deploy / seed / run agent.
9. Starting point and what was built during the hackathon; prior work ([`PRIOR_WORK.md`](PRIOR_WORK.md)); AI usage ([`docs/ai-usage.md`](docs/ai-usage.md)).
10. Roadmap: beyond hotels (UCP orders as tree entries, proven-buyer reviews and returning-customer discounts at agentic checkout), night resale on SDEX, hidden ratings revealed at k>=5, portable loyalty, blind arbiter in a TEE, agent spending limits via OpenZeppelin policies and x402.

## 8. Video, deck, submission

**Video (2 to 4 minutes, YouTube or Vimeo, real time or labeled timelapse):**

| Time | Screen | Point |
|---|---|---|
| 0:00 | final frame "proof verified, price dropped" | cold open with the result |
| 0:08 | the two problem facts | fake reviews, discount = giving up data |
| 0:15 | "reviews nobody can buy": the agent ranks places by proven reviews only | the search part of agentic commerce |
| 0:25 | guest: passkey login, agent picks a hotel by verified rating | user value |
| 0:55 | USDC booking, checkout, leaf appears in the tree, explorer | Stellar on-chain |
| 1:25 | anonymous review: proof verified on-chain; second review from the same stay rejected | ZK + anti-sybil |
| 1:55 | return booking: proved past stay, lower price, one tx | money |
| 2:25 | dispute: guest discloses to arbiter, hotel sees only "verified" | accountable when needed |
| 2:45 | verification cost, contract IDs, tagline | technical close |

No real personal data on screen.

**Deck (8 to 10 slides, PDF/PPTX/HTML up to 20 MiB):** problem, solution in one line, how it works (one circuit), why Stellar (native ZK host functions), demo screens, security model, numbers, market (reviews + loyalty in travel), roadmap, team.

**Submission checklist:**
- [ ] public repo, tag `v-submission`
- [ ] README per section 7
- [ ] live URL opens without a wallet in view mode
- [ ] video uploaded, 2 to 4 minutes
- [ ] deck
- [ ] contract ID and at least 3 testnet tx hashes (checkout, review, discount payment)
- [ ] PRIOR_WORK.md, starting point stated
- [ ] AI attribution paragraph
- [ ] Stellar Unlocked selected, separate line on Composed elements (USDC/SAC, passkey wallet, agent)
- [ ] video timestamps of key moments in the submission text
