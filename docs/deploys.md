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
