# AI usage

HackMeridian allows AI tools and asks for attribution. This file lists where AI substantially generated code or assets. It is updated as the project moves.

Tool: Claude Code (Anthropic, model Claude Opus 5.5), directed and reviewed by the team. Commits with substantial AI-written content carry a `Co-Authored-By: Claude` trailer.

## Written with Claude Code so far

| Area | Files | What the AI did | What the team did |
|---|---|---|---|
| Plan and docs | `PLAN.md`, `PRIOR_WORK.md`, `docs/verify.md`, this file | translated and structured the team's plan into English; compiled the verification log from primary sources | wrote the product brief, made every product and scope decision, reviewed |
| Source verification | `docs/verify.md` | read Semaphore v4, soroban-sdk, rs-soroban-poseidon and Stellar docs; ran RPC queries | chose what to verify, reviewed findings |
| Golden test vectors | `scripts/golden_proof.mjs`, `scripts/fixtures.ts`, `circuits/golden/` | wrote the generators; vectors come from the unmodified Semaphore artifacts | reviewed |
| Proof converter | `scripts/proof_to_soroban.ts` | wrote it | reviewed |
| Shared derivation | `scripts/lib/pos.ts` | wrote scope, message and stay-identity derivation | reviewed |
| Soroban contract | `contracts/proof_of_stay/src/*.rs` | wrote the BN254 Groth16 verifier, incremental LeanIMT, reviews, discount with USDC, attestation, and all tests | specified the design and the mandatory checks, reviewed |
| SDK types and mock | `packages/sdk/src/*` | wrote the chain / prover / wallet interfaces, the in-memory mock, fixtures (fictional hotels and review copy) and the smoke test | defined the bind points and data contract in the design handoff, reviewed |
| SDK testnet implementation | `packages/sdk/src/{testnet,contract,derive,prove,convert,disclosure}.ts` | wrote browser proving, contract client, Freighter and demo-key wallets, local stays, disclosure build/check | specified the bind points and flows, reviewed |
| Backend | `server/src/*` | wrote the demo desk, review relayer, demo arbiter, test USDC faucet and review-text store | decided the trust model (BookerBob confirms stays on testnet), reviewed |
| Seed | `scripts/seed.ts`, `server/data/seed-*.json` | wrote the seed and the fictional places and review texts; every seed review is a real proof and transaction | chose the places and the demo story, reviewed |
| Testnet deploy | `scripts/deploy.sh`, `docs/testnet.md` | wrote the deploy script, ran deploy and the golden-proof gate on testnet | reviewed |
| Contributing guide, design handoff | `CONTRIBUTING.md`, `docs/design-handoff.md` | edited from the team's flow and handoff docs | wrote the flow and the handoff |
| Web app functional shell | `app/*` | wrote the Vite + React app over the SDK: routing, role switcher, read-only mode, per-action state machines, thin presentational components, neutral styling, screenshots | defined screens, moments, copy rules and the functional-shell scope; the visual layer comes from the team's design pass |

## Not AI-generated
- Product idea, problem framing, scope and cut decisions.
- Semaphore circuits and trusted setup (third party, see `PRIOR_WORK.md`).

Prompt logs are not committed.
