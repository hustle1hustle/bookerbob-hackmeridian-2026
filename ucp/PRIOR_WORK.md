# Prior work and external services

Written fresh during HackMeridian 2026 (from Sun 25 Oct). Nothing below is copied in.

## External services (not our code)
- **Shopify test store** `jwq0dd-rp.myshopify.com`: created before the event for an earlier REP pilot. Products, the Dev Dashboard app and its client-credentials grant pre-date the hackathon. Used here as a third-party merchant through Shopify's own UCP endpoint (`/api/ucp/mcp`) and the Admin API. Payments on Shopify are test mode (Bogus Gateway).
- **Stellar testnet**, Soroban RPC, friendbot.
- **Semaphore v4 artifacts** (PSE, ceremony 2024-07-13), downloaded at run time.

## Core we consume (same team, this event)
- The BookerBob core in this repo: the contract (id from `config/testnet.json`) and `packages/sdk`. Not modified by this module; written in parallel by the same team during the event.

## Pre-hackathon private code read for patterns only (not copied)
- `r3pb0b/commerce` (REP Bob commerce server, private): the pattern of a server that verifies a buyer credential and has the store mint a single-use discount code via the Admin API (`discountCodeBasicCreate`, usage limit 1), and the observation that a new code takes 5 to 15 s to go live. Re-implemented here in `src/shopify.ts` with a ZK proof in place of the earlier signed attestation.
- `rep-ucp-wt` (REP iOS UCP worktree, private): how a UCP checkout is created and a code is applied through `discounts.codes`.

## Libraries
`@stellar/stellar-sdk` (Apache-2.0), `@semaphore-protocol/*` (MIT), `snarkjs` (GPL-3.0, unmodified dependency), `ethers` (MIT), `poseidon-lite` (MIT).

## AI
Code and docs in this module were written with Claude Code (Anthropic), directed and reviewed by the team.
