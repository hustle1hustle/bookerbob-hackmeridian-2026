# Benchmarks

Stellar testnet, Protocol 29, contract `CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL`. Measured 2026-10-25T12:56Z with `scripts/bench.ts`.

Measured on an earlier contract (wasm `aefe7d26`), not the live one. Same verifier and tree code as the live v2 contract `CBEGVNZF…L5EBY` (wasm `d66cd00f`); v2 added context groups, the REP tier check and member replacement (a new tree update path, the insert path is unchanged).

## Groth16 verification (Semaphore v4, depth 10, 4 public inputs)

| Metric | Value |
|---|---|
| CPU instructions (simulated `verify`) | 31,121,024 (7.8% of the 400M per-transaction limit) |
| Min resource fee | 0.00166 XLM |
| Proof size on chain | 256 bytes (G1 64 + G2 128 + G1 64) + 2 x 32-byte inputs (root, nullifier) |
| Browser proving | about 0.3 to 1.5 s after a one-time ~4.2 MB download (wasm 1.8 MB + zkey 2.4 MB) |

## Real transactions (instructions declared after simulation)

| Call | CPU instructions | Fee | Tx |
|---|---|---|---|
| checkout (Poseidon tree insert) | 1,116,170 | 2.31965 XLM charged (max 2.66798) | [5adc7373…](https://stellar.expert/explorer/testnet/tx/5adc7373f98a2e8ccf291364a6eb80788860cb697b4badad662d77584dc16cca) |
| post_review (Groth16 verify + nullifier) | 31,838,541 | 4.66679 XLM charged (max 5.36699) | [c6a4736a…](https://stellar.expert/explorer/testnet/tx/c6a4736a5244a803e5ad20f9785e03e155eaacc392f4550058ca412229d33bad) |
| book (USDC transfer) | 1,061,212 | 0.00084 XLM charged (max 0.00133) | [5178f2ad…](https://stellar.expert/explorer/testnet/tx/5178f2ad2934fb8c537362559e75f8336ed6bcd5d7b0cc604e6f59b959ad4925) |
| book_with_discount (Groth16 verify + USDC) | 31,663,810 | 1.13461 XLM charged (max 1.30499) | [6630cb3d…](https://stellar.expert/explorer/testnet/tx/6630cb3d8d1d7c2f5ae983cce0f367dd57c6ec618c4d71a6cdaf275e444b2743) |
| attest_review | 1,128,948 | 0.00057 XLM charged (max 0.00105) | [7fe480b5…](https://stellar.expert/explorer/testnet/tx/7fe480b5e350af050cf67b29a156f0305a97a7f4f9ee00e73b1fb0556ee9cf92) |
| add_member_with_tier (P-256 REP credential + group insert), live contract `CBEGVNZF` | 9,386,214 (2.3% of the limit) | 0.0046585 XLM charged | [b1d54046…](https://stellar.expert/explorer/testnet/tx/b1d540463dfff82ea998f12a80162915549af1cbe5b1e874de2e3d0292bca81f) |

Host test budget, not a testnet tx: a booking with two stacked context proofs (`book_with_context`, test `stacked_claims_are_capped`, `cargo test stacked_claims_are_capped -- --nocapture`) prints 58,946,132 CPU, 14.7% of the 400M limit.

## Notes
- CPU: the Groth16 check is about 31M instructions, under 8% of the per-transaction limit, so a proof, a nullifier write and a USDC transfer fit in one transaction with a wide margin.
- Fees on writes are dominated by storage rent, not compute: every write extends its entries' TTL by 500,000 ledgers (about 29 days) so the demo state survives judging. `book` and `attest_review`, which write little, cost under 0.001 XLM.
- Poseidon tree insert (depth up to 10, circomlib parameters via the CAP-0075 permutation) is about 1.1M instructions.
