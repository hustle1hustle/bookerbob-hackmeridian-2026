# AI usage

HackMeridian allows AI tools and asks for attribution. This file lists where AI substantially generated code or assets. It is updated as the project moves.

Tools: Claude Code (Anthropic, model Claude Opus 5.5) and Claude Design (Anthropic) for the visual design, directed and reviewed by the team; Cursor for one teammate's commits. Commits with substantial AI-written content carry a `Co-Authored-By: Claude` or `Co-authored-by: Cursor` trailer.

## Where AI wrote code or assets

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
| UCP module | `ucp/*` | wrote the UCP bridge for the Shopify test store (patronage extension, Stellar USDC payment handler, Buy with Bob REST, Ask Bob search), the buyer's agent, the context-perk checkout and the evidence runs (Claude Code, the UCP session) | chose UCP and the store, set the flow and the trust model, reviewed; see `ucp/PRIOR_WORK.md` |
| Ask Bob search and partner hotels | `server/src/search/*`, `scripts/jmpr-snapshot.ts`, `server/data/jmpr-lisbon.json` | wrote the federated search over places, the UCP store and JMPR, and the static Lisbon snapshot builder | decided snapshot-only (no live JMPR calls from the site), reviewed |
| REP verified traveler handoff | `server/src/rep.ts`, `server/src/rep.test.ts`, `app/src/views/RepVerify.tsx`, `docs/rep-handoff.md` | wrote the push-consent handoff, the attester path to group 1 and its tests; `server/src/verify-rep.mjs` is REP's kit, copied unmodified | defined what is kept (pass or fail only), ran the device test, reviewed |
| On-chain REP check and audit fixes | `contracts/proof_of_stay/src/{tier,lib}.rs`, `src/test_tier.rs`, `src/test.rs`, `scripts/rep-onchain.sh` | wrote the native P-256 check (first of the full REP verdict, then of the tier credential that replaced it for privacy), the fixes from the contract audit (ledger seasons, shared chain scope, non-blocking chain enrollment, credential audience), their tests, the `REP_ONCHAIN` server flag and the runbook | approved the plan, decided to keep it off in the demo for privacy, reviewed |
| Ops | `server/src/ops*`, `ucp/src/ops.ts`, `scripts/ops-watch.sh`, `docs/deploys.md` | wrote the error tracker (no external account, no personal data) and the watch script; ran deploys and kept the deploy log | set the deploy protocol, reviewed |
| UI design | `site/*`, `docs/design-parity/*`, `docs/design-binding.md` | the visual design was generated with Claude Design (Anthropic) from the team's handoff docs; Claude Code ported it to `site/` over real data (pol-real adapter) and recorded parity renders | wrote the handoff docs, chose the direction, reviewed the renders |
| Teammate modules and redesign | `packages/pass_connect`, `packages/verify_onchain_zk`, `app/` restyle (REP Labs style), Fly config | AI-assisted (Cursor), share not itemized; these commits carry a `Co-authored-by: Cursor` trailer | written and directed by the teammate |

## Not AI-generated
- Product idea, problem framing, scope and cut decisions, the trust model, the design handoff docs.
- Semaphore circuits and trusted setup (third party, see `PRIOR_WORK.md`).

Prompt logs are not committed.
