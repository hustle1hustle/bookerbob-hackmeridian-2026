# Contributing

Two builders, each with an AI session, on one public repo. Hard stop: Mon 26 Oct 12:00 Lisbon.

## Git rules
- `main` is always green and deployable. Never force-push, rebase or squash on `main`.
- Work on branches: `choly/<topic>`, `denis/<topic>`. Merge to `main` by PR (self-merge is fine) or fast-forward. Small PRs, merged often, at least every 2 hours.
- Commit every 30 to 60 minutes per person, conventional commits: `feat(contract): ...`, `feat(app): ...`, `test(verifier): ...`, `fix(sdk): ...`, `docs: ...`. One logical change per commit. The history is our evidence of what was built during the event.
- Pull before you start a block of work: `git pull --ff-only`. If someone else touched the files you are about to change, talk first.
- Secrets only in `.env` (gitignored). `.env.example` lists every variable. No testnet secret keys, no API keys, no tokens in code, commits or screenshots.
- AI sessions follow the same rules and record what they generated in [`docs/ai-usage.md`](docs/ai-usage.md) (the official rules ask where AI meaningfully generated code or assets).
- Tag `v-submission` on the submitted commit. After 12:00 Mon, nothing goes to `main` (only a `post-hack` branch).

## The seam
The app talks to the chain only through `packages/sdk` (`chain`, `prover`, `wallet`, plus local `stays` and `disclosure`). Build UI against `createSdk({ mode: "mock" })`; the testnet implementation keeps the same types. Interface and screens: [`docs/design-handoff.md`](docs/design-handoff.md).

## Checks before merging to main
- `cd contracts/proof_of_stay && cargo test`
- `node packages/sdk/src/smoke.test.ts` and `npx -p typescript@5.6.3 tsc -p packages/sdk`

## Deploys
- Live app: Fly `stellarbob2026` (https://stellarbob2026.xyz). Deploy only from `main` HEAD after `git pull --ff-only` with a clean tree; never from a local tree with uncommitted or unpushed changes. Check `fly releases -a stellarbob2026` first, then log the deploy in [`docs/deploys.md`](docs/deploys.md).
