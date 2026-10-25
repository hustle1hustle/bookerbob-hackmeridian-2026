# Deploys

Live: https://stellarbob2026.xyz (Fly app `stellarbob2026`). Protocol: deploy only from `main` HEAD after `git pull --ff-only`, with a clean tree; check `fly releases -a stellarbob2026` first and pull if the last release is newer than HEAD; add one line here after each deploy; never destroy or recreate the app.

| When (UTC) | Commit | Who | Note |
|---|---|---|---|
| 2026-10-25 ~14:10 | 93e9077 | brain session | fresh payer per booking; previous release v5 (Denis) |
| 2026-10-25 ~14:30 | 0c90a8e | brain session | release v7 after v6; Fly secret REP_ATTESTER_SECRET added |
