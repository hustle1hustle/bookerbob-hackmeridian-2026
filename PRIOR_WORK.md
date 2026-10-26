# Prior work disclosure

This repository was created on Sun 25 Oct 2026, after hacking started (09:00 Lisbon). Every commit in its history was made during the hackathon.

## Starting point
- The BookerBob brand and the idea of an agentic hotel desk (ETHGlobal Lisbon 2026, different stack). No code from that project is used here.
- REP (the founders' company): its zkTLS prover, the REP Bob iOS app and the REP attester pre-date the event. They are external services from this repo's point of view and their code is not here, except `server/src/verify-rep.mjs`, copied unmodified from REP's verifier kit (listed below).
- No code existed for Proof of Stay before the hackathon.

## Open source we build on

| Component | Source | License | How it is used |
|---|---|---|---|
| Semaphore v4 circuits and trusted setup artifacts (4.13.0, depth 10) | https://github.com/semaphore-protocol/semaphore, https://snark-artifacts.pse.dev | MIT | downloaded unmodified at proving time; golden test vectors in `circuits/golden/` were generated from them |
| `@semaphore-protocol/core` (identity, group, proof) | https://github.com/semaphore-protocol/semaphore | MIT | npm dependency |
| zk-kit (`@zk-kit/artifacts`, LeanIMT) | https://github.com/privacy-scaling-explorations/zk-kit | MIT | npm dependency; the contract's incremental tree follows the LeanIMT insert rule |
| `soroban-poseidon` (circomlib-compatible Poseidon) | https://github.com/stellar/rs-soroban-poseidon | Apache-2.0 | Cargo dependency |
| `soroban-sdk` | https://github.com/stellar/rs-soroban-sdk | Apache-2.0 | Cargo dependency |
| Groth16 verifier structure | https://github.com/stellar/soroban-examples/tree/main/groth16_verifier | Apache-2.0 | reference; `contracts/proof_of_stay/src/verifier.rs` follows the same structure on `crypto::bn254` |
| circomlib (Poseidon parameters, used by Semaphore) | https://github.com/iden3/circomlib | GPL-3.0 | unmodified, through Semaphore's artifacts |
| snarkjs | https://github.com/iden3/snarkjs | GPL-3.0 | unmodified npm dependency for proving and off-chain verification |
| `@stellar/stellar-sdk`, `poseidon-lite`, `ethers` | npm | Apache-2.0 / MIT / MIT | npm dependencies |
| `server/src/verify-rep.mjs` | REP verifier kit (`r3pb0b/commerce`, `src/verify-rep.mjs`), made to be copied | REP Labs, used with permission (the team are REP's founders) | copied unmodified; checks a REP attestation against REP's published key |
| `app/public/design/myc.js` | REP Labs design asset ("mycelium" background) | REP Labs, used with permission | visual background of the first web app (`/classic`) |

External services that shipped: JMPR, read once into `server/data/jmpr-lisbon.json` for Ask Bob's partner hotel snapshot (no live calls at runtime, no bookings); the REP attester and the REP tier issuer (`rep-attest-tier`); the Shopify test store `jwq0dd-rp.myshopify.com`; Stellar testnet RPC and Friendbot. Their code is not in this repository.

## Written during the hackathon
- The whole Soroban contract: incremental Poseidon LeanIMT, Groth16 verifier on BN254, reviews, discounts with USDC, disclosure attestation, and its tests.
- Proof converter (`scripts/proof_to_soroban.ts`), golden proof and fixture generators, shared scope/message derivation, deploy and seed scripts, benchmark.
- Frontend and agent.
- REP tier issuer (`tier-issuer.mjs`, deployed as `rep-attest-tier`): written during the event, kept outside this repo in `r3pb0b/rep-context-mcp` (branch `choly/rep-tier-issuer`); it verifies a REP verdict with REP's verifier kit and signs the 106-byte credential the contract checks. An external service from this repo's point of view.
- `ucp/`: the UCP bridge for a Shopify store (patronage extension, Stellar USDC payment handler, Buy with Bob REST, Ask Bob search) and the buyer's agent. Its prior work and external services: [`ucp/PRIOR_WORK.md`](ucp/PRIOR_WORK.md). In short: the Shopify test store `jwq0dd-rp.myshopify.com` and its Dev Dashboard app pre-date the event (external service, test mode); private pre-hackathon REP commerce code was read for patterns only (single-use discount codes via the Admin API), nothing copied.

AI assistance is disclosed in [`docs/ai-usage.md`](docs/ai-usage.md).
