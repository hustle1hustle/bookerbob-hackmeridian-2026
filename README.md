# Proof of Stay

**Guests prove they stayed at a place without revealing who they are. In return they get honest reviews and returning-guest discounts. An agent books using only this kind of data.**

*Private by default, accountable when needed.*

- Live demo: _coming with the deploy_ (read-only without a wallet; a demo key in the browser is enough to walk the full cycle)
- Video: _link at submission_
- Contract (Stellar testnet): [`CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL`](https://stellar.expert/explorer/testnet/contract/CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL)
- Built at HackMeridian 2026 (Stellar), Genesis path, track Stellar Unlocked, by team BookerBob. Plan: [PLAN.md](PLAN.md). Prior work: [PRIOR_WORK.md](PRIOR_WORK.md). AI usage: [docs/ai-usage.md](docs/ai-usage.md).

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
| deploy | [`0172e855…`](https://stellar.expert/explorer/testnet/tx/0172e855a39a61503f0e1fe25a74567ebc8dc2d5cd1c0e1eb2425d784435469b) |
| checkout (leaf into the on-chain Poseidon tree) | [`5adc7373…`](https://stellar.expert/explorer/testnet/tx/5adc7373f98a2e8ccf291364a6eb80788860cb697b4badad662d77584dc16cca) |
| anonymous review (Groth16 verified on chain) | [`c6a4736a…`](https://stellar.expert/explorer/testnet/tx/c6a4736a5244a803e5ad20f9785e03e155eaacc392f4550058ca412229d33bad) |
| full-price booking (USDC) | [`5178f2ad…`](https://stellar.expert/explorer/testnet/tx/5178f2ad2934fb8c537362559e75f8336ed6bcd5d7b0cc604e6f59b959ad4925) |
| returning-guest booking (proof + USDC in one tx, 110 to 93.5 USDC) | [`6630cb3d…`](https://stellar.expert/explorer/testnet/tx/6630cb3d8d1d7c2f5ae983cce0f367dd57c6ec618c4d71a6cdaf275e444b2743) |
| arbiter attestation | [`7fe480b5…`](https://stellar.expert/explorer/testnet/tx/7fe480b5e350af050cf67b29a156f0305a97a7f4f9ee00e73b1fb0556ee9cf92) |
| golden proof gate: valid proof `true` / tampered input `false` | [`0dd755b0…`](https://stellar.expert/explorer/testnet/tx/0dd755b03eeac00f386d3c1ed417c4ce583a645569aa98e1dc4c00d446e2b5f4) / [`e11f22c4…`](https://stellar.expert/explorer/testnet/tx/e11f22c424bbf6a743bcc68fded6a646dffee1c8756ff8d6830f05d4bab3d58a) |

More in [docs/testnet.md](docs/testnet.md).

## Numbers

From [docs/bench.md](docs/bench.md):

| | |
|---|---|
| Groth16 verification on Soroban | about 31M CPU instructions, 7.8% of the per-transaction limit |
| Poseidon tree insert | about 1.1M CPU instructions |
| Proof on chain | 256 bytes + root + nullifier |
| Browser proving | about 0.3 to 1.5 s, after a one-time ~4.2 MB download (depth-10 artifacts) |

## Security model

| Party | Sees | Does not see |
|---|---|---|
| Public | places, ratings, review texts, that each review comes from some checked-in stay, nullifiers, bookings and their payer addresses | which stay wrote which review |
| Place | the commitments it checked in, its reviews, payments to it | which of its guests wrote a review, or that a discount payer stayed before under another identity |
| Arbiter | for a disputed review only: the disclosure package (dk, signature, leaf index), so which checkout it was | anything about undisputed reviews |
| Nobody | the guest's master secret and per-stay identities never leave the browser | |

The contract enforces: a root only from the place's own recent root history and never 0 (the Semaphore circuit does not bound the path length, so depth overflow yields root 0); every public input below the BN254 field modulus (the host silently reduces otherwise); scope and message computed on chain, never taken from the client; the discount proof bound to the paying address, so a proof seen in the mempool cannot be front-run; nullifiers in persistent storage.

Honest limitations of the demo:
- Reviews are submitted by a shared relayer account, so the sender address does not link the author. A discount payment is made by the guest's own address, which shows that address paid a returning-guest price at that place; fresh payer accounts per booking with a fee relayer are on the roadmap.
- On testnet, demo places are checked in by the BookerBob backend (it holds those demo admin keys) and the arbiter is our backend. In production a place signs its own checkouts, and the arbiter should be a blind node (TEE or MPC), because it learns which checkout a disputed review came from.
- The verifier follows the official example, which its README describes as unaudited.

## Post-quantum

Groth16's zero-knowledge is perfect, so the anonymity of review authors holds even against a future quantum computer. Soundness (forging new proofs) is what a quantum computer would break. The migration path is lattice-based SNARKs with zero-knowledge as they mature; as Stellar notes, there is no drop-in post-quantum replacement for pairing-based SNARKs yet.

## Beyond hotels

The contract is merchant-generic: a merchant of any `kind` (hotel, café, shop, ...) is "a place where you were a customer": one tree of customers per merchant, one nullifier per (action, merchant, period). The same circuit and contract shape extends to merchants over UCP (Universal Commerce Protocol), with reviews only from proven buyers and a returning-customer discount the buyer's agent applies at agentic checkout, and then to restaurants, services and events. The demo leads with hotels; the seed also runs a café and a shop through the same cycle.

## Repository

```
contracts/proof_of_stay   Soroban contract: verifier, Poseidon LeanIMT, reviews, discounts, attestations, tests
circuits/golden           golden Semaphore v4 test vectors (proof, public signals, vkey, contract fixtures)
packages/sdk              TypeScript SDK: chain / prover / wallet bind points, mock and testnet implementations
server                    BookerBob backend: demo desk, review relayer, demo arbiter, test USDC faucet, static app
app                       web app (guest / place / arbiter)
scripts                   deploy, golden proof gate, seed, end-to-end test, benchmark
docs                      verification log, testnet record, benchmarks, design handoff, AI usage
```

## Setup

Requirements: Rust with the `wasm32v1-none` target, `stellar-cli` 28.x, Node 22+.

```bash
npm install                                    # workspaces: packages/sdk, server, scripts, app
cd contracts/proof_of_stay && cargo test       # verifier, tree parity with JS, full contract cycle
cd ../.. && npm run test:sdk                   # SDK mock smoke test
node scripts/golden_proof.mjs                  # regenerate and snarkjs-verify the golden proof
```

Deploy your own (testnet):

```bash
stellar keys generate deployer --network testnet --fund     # plus arbiter, relayer, usdc-issuer, hotel1..3, cafe1, shop1, guest1
./scripts/deploy.sh                    # test USDC SAC (unless USDC_SAC_ID is set) + contract with the depth-10 Semaphore key
./scripts/gate.sh                      # golden proof true, tampered input false, on chain
PROOF_OF_STAY_CONTRACT_ID=C... node scripts/seed.ts      # places, checkouts, proven reviews, bookings, disputes
./scripts/dev-server.sh                # backend on :8080 with keys from the local stellar keystore
API=http://localhost:8080 node scripts/e2e.ts            # full cycle as a new guest
```

Environment variables: see [.env.example](.env.example). Secrets (relayer, arbiter, USDC issuer, demo place admins) are only ever host secrets or the local stellar keystore.

## Prior work and attribution

The starting point was the BookerBob brand and the idea of an agentic hotel desk; no code existed. Semaphore v4 circuits and trusted setup, zk-kit, `soroban-poseidon` and the `soroban-examples` verifier structure are used with attribution. Details: [PRIOR_WORK.md](PRIOR_WORK.md). Where AI generated code or assets: [docs/ai-usage.md](docs/ai-usage.md).

## Roadmap

- Let a UCP order be an entry into a merchant's tree, so a buyer's agent applies the returning-customer discount at agentic checkout.
- Fresh payer per booking with a fee relayer, so discount payments do not link to a long-lived address.
- Real hotels via a booking partner, with real reviews only; past stays imported with zkTLS.
- Night resale on SDEX, hidden ratings revealed at k>=5, portable loyalty across a hotel network.
- Blind arbiter in a TEE, agent spending limits via OpenZeppelin policies and x402.

## License

MIT, see [LICENSE](LICENSE).
