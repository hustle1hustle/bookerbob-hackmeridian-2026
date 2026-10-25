# Submission draft: BookerBob

**BookerBob. Google for agentic commerce. Proof of loyalty, everywhere you go.**

HackMeridian 2026, Genesis path, track **Stellar Unlocked**. Team BookerBob.

## Summary

Customers prove on Stellar that they were customers of a place, with a zero-knowledge proof that never says who they are. That proof earns them honest reviews and returning-customer discounts, and their agent, BookerBob, ranks and books places using only reviews nobody can buy, paying in USDC in the same transaction that checks the proof.

## Problem

1. Reviews on travel and commerce platforms are inflated, and neither a buyer nor the buyer's agent can tell a real review from a bought one.
2. Loyalty discounts require handing the merchant personal data and purchase history. The customer pays for the discount with their data.

## How it works

- **Checkout.** The place inserts a per-stay commitment, derived in the guest's browser from a secret that never leaves it, into its own Poseidon Merkle tree on chain.
- **Prove.** The browser makes a Semaphore v4 Groth16 proof (about 0.3 to 1.5 s): "I hold one leaf of this place's tree", with a nullifier whose scope sets the use (review, discount per season, context perk).
- **Verify and pay in one transaction.** The Soroban contract checks the root against the place's recent roots, computes scope and message itself, runs the BN254 pairing check, burns the nullifier and moves USDC through the SAC. The proof is bound to the paying address, so it cannot be front-run.
- **Context perks.** A place's policy also rewards groups: a chain of places, and attested groups from context providers such as REP "verified traveler". `book_with_context` stacks one proof per group, caps the total, one transfer.
- **Agentic checkout.** BookerBob searches our places, a real Shopify test store over UCP, and real Lisbon hotels (a partner snapshot). At the store, the agent claims the returning-customer discount with the same proof and pays in test USDC on Stellar.

## Stellar, specifically (track Stellar Unlocked)

| Protocol feature | Where | Cost (testnet, measured) |
|---|---|---|
| BN254 host functions (CAP-0074): Groth16 verifier, `g1_add`, `g1_mul`, `pairing_check` | `contracts/proof_of_stay/src/verifier.rs` | `verify` 31.1M CPU instructions, 7.8% of the 400M per-tx limit |
| Poseidon permutation (CAP-0075) via `soroban-poseidon`: the contract keeps the LeanIMT tree itself, root equal to the Semaphore JS library byte for byte | `src/tree.rs` | tree insert (checkout) 1.1M instructions |
| USDC through a Stellar Asset Contract: proof check and payment in one tx | `book_with_discount`, `book_with_context`, `book_with_discount_amount` | `book_with_discount` 31.7M instructions, `book` 1.1M |
| keccak256 host function: Semaphore's `hash(x) >> 8` for scope and message | `src/lib.rs` | |
| Native P-256 (`secp256r1_verify`): the contract verifies a REP tier credential signed by the REP tier issuer, so a group can be joined without a trusted operator key | `add_member_with_tier`, `src/tier.rs`, live since the admin upgrade (wasm `d66cd00f…`) | 7.1M instructions including the group insert, 1.8% of the limit ([`43d46b5e…`](https://stellar.expert/explorer/testnet/tx/43d46b5e8ba297e61c3916b09c15fe45add4491418d49434c8dc813500dc2372), upgraded mirror of the live contract) |

Fees on writes are dominated by storage rent (TTL extended about 29 days so the demo survives judging), not compute. Source: `docs/bench.md`.

**Composed elements:** agent checkout over UCP at a real Shopify test store, paid in USDC on Stellar; passkey sign-in (WebAuthn PRF derives the guest's Stellar key, no seed phrase); fresh one-time payer per booking (since 25 Oct 14:06 UTC), with fees and reserves sponsored by BookerBob through fee bumps; real Lisbon hotel inventory from a JMPR snapshot in Ask Bob search.

## Evidence

Contract (Stellar testnet, upgraded in place, ID kept): [`CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY`](https://stellar.expert/explorer/testnet/contract/CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY)

| Tx | What it shows |
|---|---|
| [`86c01995…`](https://stellar.expert/explorer/testnet/tx/86c01995cc6e8d084ff55d17e5ac750160d295a3dc8ec83221587a16e01129b8) | anonymous review, Groth16 verified on chain, author unknown |
| [`bacf4990…`](https://stellar.expert/explorer/testnet/tx/bacf4990eb6ed224e82dd54f55c02787fc63bc9cd80a3fd7342e31753e6376dd) | returning-guest booking: proof and USDC in one tx, 110 to 93.5 USDC (seed run, before one-time payers) |
| [`f9c5b201…`](https://stellar.expert/explorer/testnet/tx/f9c5b2019acd616db39074a5e4442fe7b3d253cdbeb1e676d1349427a4fadb9d) | stacked context perks (network + verified traveler), 95 to 85.5 USDC (seed run, before one-time payers) |
| [`5f4ff99f…`](https://stellar.expert/explorer/testnet/tx/5f4ff99fcd8b2724d233a51d50ead3e8992c99c518a5dea9399538ea822c3fb7) | AI agent at a real Shopify store over UCP: returning-customer proof + network perk, 34.68 USDC, Shopify order #1009 |
| [`38bd6a7f…`](https://stellar.expert/explorer/testnet/tx/38bd6a7f38987c745624d363124c27f7a0e2bd8764b2051e3afdbe5474c34106) | a real REP verdict (zkTLS over the guest's own lodging account), checked by the REP attester, admits a fresh identity to "REP verified traveler": `add_member(1, commitment)` |

Golden proof gate on chain: valid proof `true` [`0637fea7…`](https://stellar.expert/explorer/testnet/tx/0637fea7161f51651e9d6323e22f936cf807f17cbd36dba159c174065366e6ad), tampered input `false` [`b97d19f0…`](https://stellar.expert/explorer/testnet/tx/b97d19f03aa2fa3509cddfafc30c468da752342d74e5ca8a12223c1a2d424b97). Full record: `docs/testnet.md`, `ucp/README.md`.

- Live app: https://stellarbob2026.xyz (read-only without a wallet; a demo key or a passkey walks the full cycle)
- UCP bridge: https://bookerbob-ucp-bridge.fly.dev (`/.well-known/ucp`, `/mcp`, `/search`)
- Code: https://github.com/hustle1hustle/bookerbob-hackmeridian-2026

## Prior work disclosure

- **Brand and idea.** The BookerBob name and the idea of an agentic hotel desk come from an earlier project (ETHGlobal Lisbon 2026, different stack). No code from it is used. The repository was created during the event.
- **REP** is an external context provider. Its zkTLS prover, the REP Bob phone app and the attester `rep-attest.fly.dev` existed before the event and are not in this repository. We copied its public verifier kit (`server/src/verify-rep.mjs`) unmodified and built the handoff and the group around it.
- **External services:** the Shopify test store `jwq0dd-rp.myshopify.com` and its app (pre-date the event, test mode); JMPR, read once into a static snapshot (the site makes no JMPR calls); Stellar testnet RPC and Friendbot.
- **Open source:** Semaphore v4 circuits and trusted setup (MIT), `@semaphore-protocol/core` and zk-kit (MIT), `soroban-sdk` and `soroban-poseidon` (Apache-2.0), the `soroban-examples` Groth16 verifier as structural reference (Apache-2.0), circomlib and snarkjs (GPL-3.0, unmodified), `@stellar/stellar-sdk`, `poseidon-lite`, `ethers`. Details: `PRIOR_WORK.md`, `ucp/PRIOR_WORK.md`.

## AI attribution

Most of the code and docs were written with Claude Code (Anthropic, Claude Opus 5.5), directed and reviewed by the team: the Soroban contract and its tests (verifier, Poseidon tree, reviews, discounts, context groups, the P-256 REP check), the TypeScript SDK and browser proving, the backend (demo desk, relayer, arbiter, faucet, fee-bumped one-time payers, REP handoff, Ask Bob search with the JMPR snapshot, error tracker), the UCP bridge and buyer agent, the deploy, seed and benchmark scripts, the fictional seed places and review texts, and the docs. The visual design is AI-generated: Claude Design (Anthropic) produced it from our handoff docs, and Claude Code ported it to the site over real data. One teammate's modules (passkey session, wallet scoring) and the app restyle were AI-assisted with Cursor, share not itemized. On `main` at e9cf336, 151 of 203 commits carry a `Co-Authored-By: Claude` trailer and 14 mention Cursor (recount at submission: `git log --format=%B | grep -c "Co-Authored-By: Claude"`). The team owned the product idea, the problem framing, scope and cut decisions, the trust model and the mandatory contract checks, the design handoff, and reviewed every change. Per-area detail: `docs/ai-usage.md`, `ucp/PRIOR_WORK.md`.

## Security model

- Public sees places, ratings, review texts and that each comes from some checked-in stay; never which stay. The guest's secrets never leave the browser, and each stay is a separate identity.
- The contract enforces: roots only from the place's recent history and never 0, canonical inputs, scope and message computed on chain, proofs bound to the payer, nullifiers burned in persistent storage, admin-gated `upgrade()`.
- Trusted on testnet: BookerBob checks in demo places, acts as the dispute arbiter, and sponsors one-time payers. In production a place signs its own checkouts and the arbiter becomes a blind node (TEE or MPC).
- Group operators are trusted for membership. Today the REP attester key adds "verified traveler" members after an off-chain check of REP's signed verdict (issuer key, holder binding, nonce, revocation).
- An on-chain REP path (native P-256) removes the trusted operator: a REP tier issuer signs a 106-byte credential and the contract verifies it, so no verdict, spend or device key reaches the ledger. The live contract has it since the admin upgrade (wasm `d66cd00f…`); the backend uses it with `REP_ONCHAIN=1`, with the operator attester as fallback. Open: per-account sybil resistance needs a stable account id from REP. The Groth16 verifier follows the official example, which is unaudited.

## Built during the event

Every commit in the repository was made during the hackathon: `aae8033` (Sun 25 Oct 2026, 11:52 UTC) through `main` HEAD at submission (`26677a3` when this draft was written). Contract, circuits test vectors, SDK, backend, web app, UCP bridge and agent, REP handoff, Ask Bob search, passkey and wallet modules, and all testnet evidence.

## Video

| t | Scene |
|---|---|
| 0:00 | _hook: TBD_ |
| 0:__ | _anonymous review: TBD_ |
| 0:__ | _returning-guest discount, proof + USDC in one tx: TBD_ |
| 0:__ | _context perks and REP verified traveler: TBD_ |
| 0:__ | _agent at the Shopify store over UCP: TBD_ |
| 0:__ | _close: TBD_ |

Video link: https://youtu.be/2z7azyU-_Rw

## Facts not verified while drafting

- The P-256 REP cost (7.1M CPU incl. the group insert) is from a testnet tx on an upgraded mirror of the live contract, measured before the live upgrade.
- "Every commit during the hackathon" relies on `PRIOR_WORK.md`; the first commit is at 11:52 UTC, after the 09:00 Lisbon start.

Confirmed by the team: live URL `stellarbob2026.xyz`; no OpenZeppelin relayer; passkey wording; `38bd6a7f…` is `add_member(1, commitment)` by the REP attester at 14:31:22 UTC; the redesign is Claude Design output.
