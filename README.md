LFG

# BookerBob: Proof of Loyalty

**BookerBob. Google for agentic commerce. Proof of loyalty, everywhere you go.**

Customers prove they were customers of a place without revealing who they are. In return they get honest reviews and returning-customer discounts, and BookerBob, their agent, ranks and books places using only reviews nobody can buy. First medium: hotels (the hotel flow is "proof of stay").

- Live demo: [https://stellarbob2026.xyz](https://stellarbob2026.xyz) (read-only without a wallet; a demo key in the browser is enough to walk the full cycle). API: `https://stellarbob2026.xyz/api/config`
- Video: _link at submission_
- Contract (Stellar testnet): [`CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY`](https://stellar.expert/explorer/testnet/contract/CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY)
- Built at HackMeridian 2026 (Stellar), Genesis path, track Stellar Unlocked, by team BookerBob. Plan: [PLAN.md](PLAN.md). Prior work: [PRIOR_WORK.md](PRIOR_WORK.md). AI usage: [docs/ai-usage.md](docs/ai-usage.md). Raven MCP + passkeys on Stellar: [docs/raven.md](docs/raven.md).

## Problem

1. Reviews on travel platforms are inflated, and neither a guest nor the guest's agent can tell a real review from a bought one.
2. Returning-guest discounts require handing the hotel personal data and history. The guest pays for the discount with their data.

Users: the guest, the place (hotel, café, shop), and the guest's agent that books on their behalf.

## How it works

One zero-knowledge primitive, three uses. A Semaphore v4 proof says "I hold one of the leaves in this place's customer tree" without saying which one. Only the nullifier scope changes:

| Use | What the guest proves | Nullifier scope | On-chain effect |
|---|---|---|---|
| Review | I stayed here | `review, place` | one review per stay, author unknown |
| Returning-guest discount | I stayed here before | `discount, place, season` | lower price once per season per past stay, USDC paid in the same transaction |
| Dispute disclosure | this review is mine and the stay is real | outside the circuit | the arbiter marks the review "verified stay"; the place never learns who |

```
checkout            the place (or the BookerBob demo desk) inserts the guest's per-stay commitment
   |                into the place's Poseidon Merkle tree, on chain
   v
proof in browser    Semaphore v4 Groth16 proof over BN254: membership + nullifier, bound to
   |                a message the contract recomputes (rating and text hash, or the paying address)
   v
Soroban contract    root must be in the place's recent root history (never 0), inputs canonical,
   |                scope and message computed on chain, Groth16 pairing check, nullifier burned
   v
review / discount   review stored with its text hash; or price * (1 - discount) in USDC, same tx
   |
   v
dispute             guest privately hands the arbiter dk and a signature by the stay identity;
                    arbiter checks off chain and calls attest_review
```

Each stay gets its own identity derived from a master secret in the browser, so two stays at the same place are two unrelated leaves: nobody can see "this guest came back".

## Stellar, specifically

- **BN254 host functions (CAP-0074, Protocol 25)**: `g1_add`, `g1_mul` and `pairing_check` run the Groth16 verifier in the contract ([`verifier.rs`](contracts/proof_of_stay/src/verifier.rs)), the same structure as the official `soroban-examples` verifier, ported to `crypto::bn254`.
- **Poseidon permutation (CAP-0075)** through SDF's [`soroban-poseidon`](https://github.com/stellar/rs-soroban-poseidon) with circomlib parameters: the contract maintains the LeanIMT customer tree itself ([`tree.rs`](contracts/proof_of_stay/src/tree.rs)), and its root matches the Semaphore JS library byte for byte (test `lean_imt_root_matches_js`).
- **USDC through a Stellar Asset Contract**: the discounted payment is a SAC `transfer` inside `book_with_discount`, so the proof check and the payment are one transaction. On testnet we use our own USDC issuer so seed guests can be funded without a faucet; the token address is a constructor argument, so Circle's testnet USDC is a drop-in.
- **keccak256 host function** reproduces Semaphore's `hash(x) = keccak256(x) >> 8` for message and scope.
- Versions: Protocol 29 testnet, `soroban-sdk` 28, `stellar-cli` 28.1.0.

Example testnet transactions (seed run, all real proofs):

| Step | Tx |
|---|---|
| deploy (v2) | [`28e9b1e0…`](https://stellar.expert/explorer/testnet/tx/28e9b1e0b3475d8d3d87ab0f36172943f22463b0d887cac892d4e959c99efc17) |
| checkout (leaf into the on-chain Poseidon tree) | [`07163e0a…`](https://stellar.expert/explorer/testnet/tx/07163e0a259c693c186d67ca5df6794bcb30f2be700065002d1ed48f0af6f0b9) |
| anonymous review (Groth16 verified on chain) | [`86c01995…`](https://stellar.expert/explorer/testnet/tx/86c01995cc6e8d084ff55d17e5ac750160d295a3dc8ec83221587a16e01129b8) |
| full-price booking (USDC) | [`c078b6fa…`](https://stellar.expert/explorer/testnet/tx/c078b6fa9261998bd998d918c06aa9246f92899a2a0fd4908186952cd5911eab) |
| returning-guest booking (proof + USDC in one tx, 110 to 93.5 USDC) | [`bacf4990…`](https://stellar.expert/explorer/testnet/tx/bacf4990eb6ed224e82dd54f55c02787fc63bc9cd80a3fd7342e31753e6376dd) |
| arbiter attestation | [`6e50a72e…`](https://stellar.expert/explorer/testnet/tx/6e50a72e6d869186785e0d3eb42db551b2f94f8c9e0dd6a58fc576440a957ebf) |
| golden proof gate: valid proof `true` / tampered input `false` | [`0637fea7…`](https://stellar.expert/explorer/testnet/tx/0637fea7161f51651e9d6323e22f936cf807f17cbd36dba159c174065366e6ad) / [`b97d19f0…`](https://stellar.expert/explorer/testnet/tx/b97d19f03aa2fa3509cddfafc30c468da752342d74e5ca8a12223c1a2d424b97) |

More in [docs/testnet.md](docs/testnet.md).

## Context perks

Loyalty does not have to stop at one place. A place's discount policy can reward **context groups**: its own returning customers, a **chain group** (every stay at any member place is enrolled at checkout, "guest anywhere in the network") and **attested groups** owned by independent context providers (REP "verified traveler" from Booking proofs, a Stellar wallet history module, later booking partners). `book_with_context` stacks one proof per group, caps the total, and pays in one transaction. On testnet: a guest whose only stay was at Casa Azulejo Nove booked Pátio do Vento with the network and verified-traveler perks, 95 to 85.5 USDC, [`f9c5b201…`](https://stellar.expert/explorer/testnet/tx/f9c5b2019acd616db39074a5e4442fe7b3d253cdbeb1e676d1349427a4fadb9d). Providers plug in without contract changes: [docs/context-providers.md](docs/context-providers.md).

## Agentic checkout over UCP

The same proof works at a real store. [`ucp/`](ucp/README.md) is a bridge for a Shopify test store that speaks the Universal Commerce Protocol: the buyer's agent searches the store (it shows up in Ask Bob as a UCP source), proves it is a returning customer of merchant 5 in our contract, gets the discount applied at checkout, and pays in test USDC on Stellar through `book_with_discount_amount`, with the store's admin co-signing the order amount. A card payment can still spend the discount on chain through `redeem`. Details, evidence logs and its own prior-work notes: [ucp/README.md](ucp/README.md).

## Numbers

From [docs/bench.md](docs/bench.md):

| | |
|---|---|
| Groth16 verification on Soroban | about 31M CPU instructions, 7.8% of the per-transaction limit |
| Poseidon tree insert | about 1.1M CPU instructions |
| Booking with 3 stacked context proofs | about 88M CPU instructions (22% of the limit, measured in the host test budget) |
| Proof on chain | 256 bytes + root + nullifier |
| Browser proving | about 0.3 to 1.5 s, after a one-time ~4.2 MB download (depth-10 artifacts) |

## Security model

Principle: private by default, accountable when needed.

| Party | Sees | Does not see |
|---|---|---|
| Public | places, ratings, review texts, that each review comes from some checked-in stay, nullifiers, bookings and their payer addresses | which stay wrote which review |
| Place | the commitments it checked in, its reviews, payments to it | which of its guests wrote a review, or that a discount payer stayed before under another identity |
| Arbiter | for a disputed review only: the disclosure package (dk, signature, leaf index), so which checkout it was | anything about undisputed reviews |
| Nobody | the guest's master secret and per-stay identities never leave the browser | |

The contract has an admin-gated `upgrade()` so fixes keep the contract ID and its state. On testnet the admin is our deployer key; a production deployment would hand it to a multisig or a timelock. Merchant-quoted amounts (`book_amount`, `book_with_discount_amount`) and `redeem` (discount spent while the order is paid on another rail, such as a card) require the merchant admin's signature; the discount is still applied by the contract and the nullifier is the same one, so it is one discount per past stay per season whatever the rail.

The contract enforces: a root only from the place's own recent root history and never 0 (the Semaphore circuit does not bound the path length, so depth overflow yields root 0); every public input below the BN254 field modulus (the host silently reduces otherwise); scope and message computed on chain, never taken from the client; the discount proof bound to the paying address, so a proof seen in the mempool cannot be front-run; nullifiers in persistent storage.

Honest limitations of the demo:
- Reviews are submitted by a shared relayer account, so the sender address does not link the author. Every booking is paid from a **fresh one-time address**: the guest's browser makes a key per booking, BookerBob sponsors its account reserve and USDC trustline and fee-bumps the booking (`server/src/payer.ts`), so the guest never holds XLM and two discounted bookings by one guest come from unrelated addresses (`scripts/privacy-test.ts`: [`13a7527f…`](https://stellar.expert/explorer/testnet/tx/13a7527f69da0b1012db223f4d0299e2cf58dcaa21d058aa4dc7f08ec6a48d97) and [`ae6ebd58…`](https://stellar.expert/explorer/testnet/tx/ae6ebd58c377b90d23ed5046153c28360ac8e51b26e4edf0847fc44a70a3a046), same guest, two payers). On testnet the one-time payer is funded by our test-USDC faucet; in production it would be funded from a private balance (for example a confidential token or a privacy pool), since a direct transfer from the guest's main account would link the two again.
- On testnet, demo places are checked in by the BookerBob backend (it holds those demo admin keys) and the arbiter is our backend. In production a place signs its own checkouts, and the arbiter should be a blind node (TEE or MPC), because it learns which checkout a disputed review came from.
- The verifier follows the official example, which its README describes as unaudited.
- Trustless REP verification on Stellar (native P-256) is built and tested (`add_member_with_rep`, `scripts/rep-onchain.sh`); it is off in the demo because the full verdict would be public. Production: a tier-only reissue from REP plus a pairwise device key.

## Post-quantum

Groth16's zero-knowledge is perfect, so the anonymity of review authors holds even against a future quantum computer. Soundness (forging new proofs) is what a quantum computer would break. The migration path is lattice-based SNARKs with zero-knowledge as they mature; as Stellar notes, there is no drop-in post-quantum replacement for pairing-based SNARKs yet.

## Beyond hotels

The contract is merchant-generic: a merchant of any `kind` (hotel, café, shop, ...) is "a place where you were a customer": one tree of customers per merchant, one nullifier per (action, merchant, period). The same circuit and contract shape extends to merchants over UCP (Universal Commerce Protocol), with reviews only from proven buyers and a returning-customer discount the buyer's agent applies at agentic checkout, and then to restaurants, services and events. The demo leads with hotels; the seed also runs a café and a shop through the same cycle.

## Repository

```
contracts/proof_of_stay   Soroban contract: verifier, Poseidon LeanIMT, reviews, discounts, attestations, tests
circuits/golden           golden Semaphore v4 test vectors (proof, public signals, vkey, contract fixtures)
packages/sdk              TypeScript SDK: chain / prover / wallet bind points, mock and testnet implementations
packages/pass_connect     Passkey (WebAuthn) → Stellar session — docs/modules/pass_connect.md
packages/verify_onchain_zk  Wallet inspect + rating + loyalty ZK claim — docs/modules/verify_onchain_zk.md
server                    BookerBob backend: demo desk, review relayer, demo arbiter, test USDC faucet, static app
app                       web app (guest / place / arbiter)
scripts                   deploy, golden proof gate, seed, end-to-end test, benchmark
docs                      verification log, testnet record, benchmarks, design handoff, AI usage, modules/
```

## Setup

Requirements: Rust with the `wasm32v1-none` target, `stellar-cli` 28.x, Node 22+.

```bash
npm install                                    # workspaces: packages/sdk, server, scripts, app
stellar contract build --manifest-path contracts/proof_of_stay/Cargo.toml   # tests upgrade to the built wasm
cd contracts/proof_of_stay && cargo test       # verifier, tree parity with JS, full contract cycle, v2 auth checks
cd ../.. && npm run test:sdk                   # SDK mock smoke test
node scripts/golden_proof.mjs                  # regenerate and snarkjs-verify the golden proof
```

Deploy your own (testnet):

```bash
stellar keys generate deployer --network testnet --fund     # plus arbiter, relayer, usdc-issuer, hotel1..3, cafe1, shop1, guest1
./scripts/deploy.sh                    # test USDC SAC (unless USDC_SAC_ID is set) + contract; writes config/testnet.json
./scripts/gate.sh                      # golden proof true, tampered input false, on chain
node scripts/seed.ts                   # places, checkouts, proven reviews, bookings, disputes (contract ID from config/testnet.json)
./scripts/dev-server.sh                # backend on :8080 with keys from the local stellar keystore
API=http://localhost:8080 node scripts/e2e.ts            # full cycle as a new guest
```

Environment variables: see [.env.example](.env.example). Secrets (relayer, arbiter, USDC issuer, demo place admins) are only ever host secrets or the local stellar keystore.

## Prior work and attribution

The starting point was the BookerBob brand and the idea of an agentic hotel desk; no code existed. Semaphore v4 circuits and trusted setup, zk-kit, `soroban-poseidon` and the `soroban-examples` verifier structure are used with attribution. Details: [PRIOR_WORK.md](PRIOR_WORK.md). Where AI generated code or assets: [docs/ai-usage.md](docs/ai-usage.md).

## Roadmap

- Let a UCP order be an entry into a merchant's tree, so a buyer's agent applies the returning-customer discount at agentic checkout.
- Fund the one-time payer from a private balance (confidential tokens or a privacy pool) instead of the testnet faucet.
- Real hotels via a booking partner, with real reviews only; past stays imported with zkTLS.
- Night resale on SDEX, hidden ratings revealed at k>=5, portable loyalty across a hotel network.
- Blind arbiter in a TEE, agent spending limits via OpenZeppelin policies and x402.

## License

MIT, see [LICENSE](LICENSE).
