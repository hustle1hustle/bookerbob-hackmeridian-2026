# Prior work disclosure

This repository was created on Sun 25 Oct 2026, after hacking started (09:00 Lisbon). The first commit contains only the skeleton, `PLAN.md`, this file, `LICENSE` and `.env.example`.

## Existed before the hackathon
- The BookerBob brand and the idea of an agentic hotel desk (ETHGlobal Lisbon 2026, different stack). No code from that project is reused here.
- Team experience with Groth16, Poseidon and BN254 off-chain.

## Taken from open source (with attribution)
- Semaphore v4 circuits and their trusted setup artifacts (semaphore-protocol, MIT). Vendored under `circuits/` / `vendor/` with source links.
- zk-kit libraries (LeanIMT, Poseidon), as npm dependencies.
- circomlib Poseidon parameters, as used by Semaphore.
- Existing Soroban Groth16 verifiers used as references only; any adapted code is marked in place with its source and license.

The exact list of vendored files is kept up to date below as they are added.

| Path | Source | License |
|---|---|---|

## Written during the hackathon
- The whole Soroban contract: Poseidon tree, Groth16 verifier, reviews, discounts, disclosure.
- Proof converter (`scripts/proof_to_soroban.ts`), deploy and seed scripts, benchmark.
- Frontend and agent.
