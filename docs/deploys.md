# Deploys

Live: https://stellarbob2026.xyz (Fly app `stellarbob2026`). **Protocol (everyone, including teammates deploying from their own machine): deploy only from `main` HEAD after `git pull --ff-only`, with a clean tree, never from a local tree with uncommitted or unpushed changes (that silently overwrites fixes others shipped).** Then: check `fly releases -a stellarbob2026` first and pull if the last release is newer than HEAD; add one line here after each deploy; never destroy or recreate the app.

| When (UTC) | Commit | Who | Note |
|---|---|---|---|
| 2026-10-25 ~14:10 | 93e9077 | brain session | fresh payer per booking; previous release v5 (Denis) |
| 2026-10-25 ~14:30 | 0c90a8e | brain session | release v7 after v6; Fly secret REP_ATTESTER_SECRET added |
| 2026-10-25 ~14:50 | 144f4ff | brain session | REP result fix; after v7 (Denis) |
| 2026-10-25 ~15:30 | b7f065e | brain session | Claude Design v2 fixes + REP demo gate; REP_DEMO_TOKEN live |
| 2026-10-25 ~15:35 | 4e1b10e | brain session | review 409 + 5xx diagnostics, rep-tier, proving files from our origin; previous v15 came from a teammate's local tree |
| 2026-10-25 ~16:05 | 1b09d84 | brain session | booking fee fix (re-simulate after cosign) + review text backfill |
| 2026-10-25 ~16:30 | 03cb80b | brain session | clickable references, proving files from our origin + Cache API, operator fresh demo |
| 2026-10-25 (evening) | 46f50bb | brain session | UCP pay #13 = missing USDC trustline (faucet funds never-funded keys), demo key not scored, rate limit 120/min |
| 2026-10-25 (evening) | 5ea9644 | brain session | operator REP demo reset (server) |
| 2026-10-25 ~18:50 WET | 54ac576 | brain session | inline ZK steps in the flow, Ask Bob hero, passkey sign-in never creates, rep-onchain-tier matching wasm d66cd00f, rebind client; contract upgraded before it |
| 2026-10-25 ~19:05 WET | b8be83a | brain session | rebind server (operator replace_member in every mode) + client, deck v7 |
| 2026-10-25 (evening) | 0c8de61, 2d9d05d | brain session | intermediate fixes, deployed by brain (exact times not logged) |
| 2026-10-25 (evening) | 3275202 | brain session | UCP reused-proof demo resends the stored proof (same nullifier), store tree read live; 1e99a9a after it is docs/deck only, no redeploy |
