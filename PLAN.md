# Proof of Stay: plan

Team BookerBob. HackMeridian 2026 (Stellar), Lisbon. Hacking window: Sun 25 Oct 09:00 to Mon 26 Oct 12:00 (Lisbon).
Path: Genesis. Track: Stellar Unlocked (ZK on the Protocol 25 "X-Ray" Poseidon and BN254 host functions).
Composed elements (USDC via SAC, passkey wallet, agent) are listed separately in the submission.

Items marked **VERIFY** are checked against primary sources before we rely on them. Results live in `docs/verify.md`.

---

## 1. Product

**One line:** guests prove they stayed at a hotel without revealing who they are, and in return get honest reviews and returning-guest discounts. An agent books using only this kind of data.

**Tagline:** private by default, accountable when needed.

**Problem:**
1. Reviews on travel platforms are inflated, and neither a guest nor an agent can tell a real review from a bought one.
2. Returning-guest discounts require handing the hotel personal data and history. The guest pays for the discount with their data.

**One ZK primitive, three uses** (one Semaphore circuit, only the nullifier scope changes):

| Use | What the guest proves | scope | On-chain effect |
|---|---|---|---|
| Review | I stayed here (leaf in the hotel's tree) | `review \| hotel`, per stay-identity | one review per stay, author unknown |
| Returning-guest discount | I stayed here before | `discount \| hotel \| season` | lower price, once per season per past stay, USDC payment in the same transaction |
| Disclosure in a dispute | this review is mine and the stay is real | outside the circuit, see 3.5 | arbiter sets an on-chain "verified stay" mark, identity is not revealed to the hotel |

---

## 2. Scope

**Core (no demo without these):**
1. Contract with a Poseidon Merkle tree of guests per hotel. A leaf is added at checkout, authorized by the hotel.
2. Groth16 verifier in Soroban on the BN254 host functions.
3. Anonymous reviews with nullifiers.
4. Returning-guest discount with USDC payment in one transaction.

**Cheap and valuable (if core is done):**
5. Dispute disclosure (no new circuit, see 3.5).
6. Guest passkey login (passkey smart wallet). Timebox 1 hour, fallback Freighter.
7. Agent: thin TS layer, reads verified ratings from the contract, picks a hotel, applies the discount if eligible. LLM optional.

**Cut, goes to the roadmap slide:** reselling nights on SDEX, a night as an asset with auth/clawback, path payments, x402 and OpenZeppelin policies, anonymous cashback via claimable balances, hidden ratings (ElGamal on G1 + g1_add, aggregate revealed at k>=5), portable loyalty across a hotel chain.

---

## 3. Architecture

### 3.1 Stack
- Contracts: Rust, `soroban-sdk` with Protocol 25 (X-Ray) crypto primitives. **VERIFY** minimum SDK version and exact method names for BN254 (`g1_add`, `g1_mul`, pairing check / multi-pairing) and Poseidon/Poseidon2 (CAP-0075) in `env.crypto()`.
- CLI: `stellar-cli`, testnet, friendbot for accounts.
- Circuits: circom 2 + snarkjs, **Semaphore v4 circuits as is** (Poseidon + Groth16 on BN254), open source, with attribution.
- Proving: snarkjs in the browser (wasm + zkey). Small tree depth (10 to 16) to keep the zkey light. **VERIFY** published depths of the Semaphore v4 artifacts and their trusted setup.
- Frontend: Vite + stellar-sdk, deployed with a public live URL.
- USDC on testnet via SAC. **VERIFY** testnet USDC SAC address, or issue our own test stablecoin if faster.
- References for the pairing part: existing Groth16 verifiers on X-Ray, soroban-examples. **VERIFY** whether an official example exists.

### 3.2 Identities
- The guest master secret lives on the client (demo: localStorage or derived from a passkey).
- **Per-stay identity:** for each stay a separate Semaphore identity is derived deterministically, `derive(master, hotel, stay_counter)`. Otherwise the same commitment inserted twice would reveal "this guest came back".
- At checkout the guest gives the hotel only the `id_commitment` of that stay-identity.

### 3.3 Contract `proof_of_stay` (one contract, no cross-contract calls)

Storage:
- `Hotel { admin: Address, name, price_usdc, discount_bps, tree: LeanIMT state, root_history: ring buffer (~30) }`
- `Nullifiers: Set<(scope_hash, nullifier)>`
- `Reviews: Vec<Review { hotel, rating: u8 (1..5), content_hash, disclosure_commit, verified: bool, ledger }>`
- `Aggregates: Map<hotel, (sum, count, verified_count)>`
- `VerifyingKey`: Semaphore VK for the chosen depth, set at init.
- `Arbiter: Address`, `UsdcToken: Address`.

Functions:
- `init(arbiter, usdc, vk)`
- `register_hotel(admin, name, price, discount_bps)`, auth admin
- `checkout(hotel, id_commitment)`, auth hotel admin: insert the leaf into the on-chain Poseidon tree, update root history, emit `checkout`
- `book(hotel, guest)`, auth guest: full-price USDC transfer guest to hotel admin
- `book_with_discount(hotel, guest, season, proof, root, nullifier)`, auth guest: root in history, scope = H(`discount|hotel|season`), nullifier unused, Groth16 verify, mark nullifier, transfer `price * (1 - discount)`
- `post_review(hotel, rating, content_hash, disclosure_commit, proof, root, nullifier)`: scope = H(`review|hotel`), message = H(rating, content_hash, disclosure_commit), Groth16 verify, burn nullifier, update review and aggregate. Any address may submit (relayer / fresh account), so the sender address does not link the author.
- `attest_review(review_id)`, auth arbiter, sets `verified = true`
- views: `get_hotel`, `get_reviews(hotel)`, `get_rating(hotel)`, `get_root(hotel)`

### 3.4 Semaphore v4 compatibility (critical path)
- **On-chain Poseidon must match the circuit's Poseidon** (circomlib parameters: BN254 field, width, rounds, constants, MDS). If the host function takes caller-supplied parameters, hardcode the circomlib constants. Test: the same leaf and root computed in JS (`@zk-kit/lean-imt` + poseidon-lite) and in the contract must match byte for byte. This is the first test written.
- **Semaphore v4 public inputs:** **VERIFY** exact order (expected: merkleTreeRoot, nullifier, hash(message), hash(scope)). The JS library hashes message and scope with keccak256 and shifts `>> 8` to fit the field. The contract repeats the same function (`keccak256` + shift) and computes scope itself from `hotel`/`season`, never accepting it from the client. Otherwise a proof for one hotel would pass at another.
- **Proof serialization:** snarkjs outputs decimal strings. Classic trap: G2 coordinate order (c0/c1) and endianness. One converter `scripts/proof_to_soroban.ts` and a golden test: a known valid proof passes, a proof with a modified public input fails.
- Groth16 check: `vk_x = IC0 + sum(pub_i * IC_i)` via g1_mul/g1_add, then one multi-pairing check `e(-A,B) e(alpha,beta) e(vk_x,gamma) e(C,delta) == 1`.

**Fallback if the on-chain Poseidon tree does not match by 15:00 Sun:** the tree is computed off-chain, the hotel publishes the new root in `checkout` together with the leaf (contract stores leaves and trusts the admin root). Weaker, but the ZK check stays on-chain. Documented honestly in the README.

### 3.5 Disclosure without a new circuit
- When reviewing, the guest puts `disclosure_commit = Poseidon(dk)` in the message, `dk` a random secret.
- In a dispute the guest privately gives the arbiter `dk` and a signature by the stay-identity (EdDSA/BabyJubJub in Semaphore v4) over `review_id`, plus their leaf index.
- The arbiter checks off-chain: Poseidon(dk) matches the review, the signature matches the commitment, the commitment is in the hotel tree. Then `attest_review` on-chain.
- The hotel learns only "review confirmed by arbiter". README limitation: the arbiter sees which checkout it is, so in production the arbiter must be a blind node (TEE/MPC). Roadmap.

### 3.6 Agent
- `agent/` TS script: request "hotel in Lisbon under N USDC", reads `get_rating` for all hotels, ranks by rating from proven reviews only, picks one; if the guest has a past stay there, generates a proof and calls `book_with_discount`, else `book`.

### 3.7 Frontend (three roles, one page with a switcher)
- **Guest:** login, hotels with verified rating, booking, "my stays", write a review, apply discount.
- **Hotel:** guest checkout (QR / paste commitment), feed of anonymous reviews, "dispute" button.
- **Arbiter:** dispute queue, disclosure check, attest.
- Every action shows the tx hash linked to stellar.expert (testnet).

### 3.8 Seed data
- `scripts/seed.ts`: 3 fictional hotels, ~8 checkouts, ~6 reviews, 1 discount, 1 dispute, so the live URL shows a populated state.

---

## 4. Repository rules

- New public repo created after hacking started (25 Oct, after 09:00).
- First commit: empty skeleton + `PLAN.md` + `PRIOR_WORK.md` + `LICENSE` (MIT).
- Frequent atomic commits, conventional commit messages.
- No squash, no history rebase, no force-push on main. Work in branches, merge to main by PR or fast-forward.
- Third-party code only in `vendor/` or via dependencies, with source and license. Copied files (Semaphore circuits, zkey artifacts) are listed in PRIOR_WORK.md and README.
- Secrets only in `.env` (gitignored); the repo has `.env.example`. No testnet private keys in code.
- Tag `v-submission` on the submitted commit. No commits to main after 12:00 Mon (only a `post-hack` branch).

```
/contracts/proof_of_stay      Rust, Soroban
/circuits                     vendored Semaphore v4 + artifacts, README with attribution
/scripts                      seed.ts, proof_to_soroban.ts, deploy.sh, bench.ts
/agent                        TS agent
/app                          frontend
/docs                         architecture.md, verify.md, diagrams, bench.md
PLAN.md  PRIOR_WORK.md  README.md  .env.example
```

---

## 5. Timeline (Lisbon)

| By | Ready | Check |
|---|---|---|
| 13:00 Sun | repo, skeleton, testnet accounts, SDK builds, Semaphore proof generates locally | `snarkjs groth16 verify` ok |
| 15:00 Sun (parallel) | on-chain Poseidon tree matches JS | otherwise fallback 3.4 |
| **18:00 Sun** | **golden Semaphore proof passes the Soroban verifier on testnet, a modified input fails** | tx hash |
| 01:00 Mon | full contract: checkout, review, discount + USDC, attest; deployed to testnet | full-cycle integration test |
| 06:00 Mon | three-role frontend, seed, agent, live URL | a judge can walk the cycle |
| 09:00 Mon | verification cost benchmark (CPU instructions / memory from simulateTransaction), README, docs | numbers in bench.md |
| 11:00 Mon | video, deck, submission texts | checklist |
| 11:00-11:45 | submission, tag `v-submission` | form confirmation |

**Cut rule:** if the verifier does not work by 18:00, everything else stops and the whole team works on the verifier. If behind at 01:00, cut disclosure (3.5) first, then the agent. The discount is never cut.

Roles:
- A: circuits, converter, verifier (critical path).
- B: tree, contract, USDC, deploy, seed.
- C: frontend, passkey, agent, video and README.

---

## 6. Risks

1. Poseidon parameter mismatch between circomlib and the host function. Mitigation: test first, fallback 3.4.
2. G2 serialization / endianness in the pairing. Mitigation: golden test and a single converter.
3. Soroban resource budget for verification (4 public inputs + pairing). Mitigation: measure early, keep public inputs minimal.
4. zkey/wasm weight in the browser. Mitigation: small tree depth, lazy loading.
5. Passkey eats time. Timebox 1 hour, fallback Freighter.
6. Transaction sender linked to review author. Mitigation: reviews are submitted by a fresh / relayer account; noted in README.

---

## 7. README outline

1. One line + tagline + live URL + video + contract ID.
2. Problem (two facts) and users (guest, hotel, guest's agent).
3. How it works: checkout, tree, proof, review/discount, disclosure.
4. Stellar specifics: Poseidon host function (on-chain tree), BN254 pairing + G1 ops (Groth16 verifier), USDC via SAC (discounted payment in one tx), passkey wallet, testnet contract IDs and example tx hashes.
5. Security model: what the hotel sees, what the arbiter sees, what the public sees, what nobody sees.
6. Numbers: Soroban verification cost, browser proving time, proof size.
7. Post-quantum: Groth16 zero-knowledge is perfect, so review-author anonymity survives a quantum computer; soundness (forging new proofs) is quantum-vulnerable; migration path is lattice-based SNARKs with ZK as they mature. No drop-in PQ replacement for pairing SNARKs exists yet.
8. Setup / install / env vars / deploy / seed / run agent.
9. Prior work and attribution (PRIOR_WORK.md).
10. Roadmap: night resale on SDEX, hidden ratings revealed at k>=5, portable loyalty across hotels, blind arbiter in a TEE, agent spending limits via OpenZeppelin policies and x402.

---

## 8. Video, deck, submission

**Video (target 3:00, real time or labeled timelapse):**

| Time | Screen | Point |
|---|---|---|
| 0:00 | final frame "proof verified, price dropped" | cold open with the result |
| 0:08 | the two problem facts | fake reviews, discount = giving up data |
| 0:25 | guest: passkey login, agent picks a hotel by verified rating | user value |
| 0:55 | USDC booking, checkout, leaf appears in the tree, explorer | Stellar on-chain |
| 1:25 | anonymous review: proof verified on-chain; second review from the same stay rejected | ZK + anti-sybil |
| 1:55 | return booking: proved past stay, lower price, one tx | money |
| 2:25 | dispute: guest discloses to arbiter, hotel sees only "verified" | accountable when needed |
| 2:45 | verification cost numbers, contract IDs, tagline | technical close |

No real personal data on screen.

**Deck (8-10 slides):** problem, solution in one line, how it works (one circuit), why Stellar (native X-Ray), demo screens, security model, numbers, market (reviews + loyalty in travel), roadmap, team.

**Submission checklist:**
- [ ] public repo, tag `v-submission`
- [ ] README per section 7
- [ ] live URL opens without a wallet in view mode
- [ ] video uploaded
- [ ] deck
- [ ] contract ID and at least 3 testnet tx hashes (checkout, review, discount payment)
- [ ] PRIOR_WORK.md
- [ ] Stellar Unlocked track selected, separate line on Composed elements (USDC/SAC, passkey wallet, agent)
- [ ] video timestamps of key moments in the submission text
