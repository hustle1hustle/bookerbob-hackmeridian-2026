# REP verified traveler -> BookerBob

A guest who has proven past stays in REP (zkTLS over their own Airbnb or Booking account) becomes a
**REP verified traveler** in BookerBob: their browser's fresh Semaphore identity joins the context group
"REP verified traveler" (group 1), which places reward in their discount policy (5% in the demo policies,
UCP store included). REP signs a verdict; BookerBob checks it and keeps only yes or no.

## How it works

```
web (BookerBob)                         server /api/rep                         phone (REP Bob)
"verify with REP"  -- POST /session {commitment} -> sid, nonce "pos:<commitment>:<rand>", 2 min
                                        GET /pending  <---------------------  polls every 2 s
                                        {sid, nonce, aud: "bookerbob", contexts: ["travel"]}
                                                                              consent sheet, user approves
                                        POST /present <---------------------  {sid, attestations: [{jws, kbJwt}]}
                                        verify-rep.mjs: issuer https://rep-attest.fly.dev (ES256 JWKS),
                                        typ, profile, signature, exp, revocation list (fail closed),
                                        holder KB-JWT: key = cnf.jkt, aud bookerbob, this nonce, at_hash, fresh;
                                        lodging_spend_tier present, server_name airbnb/booking
                                        add_member(group 1, commitment)   (REP attester key)
poll GET /result?sid  -> passed (+ tx)
```

- Only `passed` / `failed` is kept; tier, spend, source and device key are dropped after the check and never logged.
- `vps` and `presentations` in the phone's body are never read. `/receive`, `/issue` and any other path are 404.
- One presentation per session: the nonce is spent before anything is checked, so a replay never verifies.
- The web uses a dedicated, never-checked-in stay identity, so the public group tree does not join with any place's customer tree.

Code: `server/src/rep.ts` (mounted by one line in `server/src/index.ts`), `server/src/verify-rep.mjs` (REP's verifier kit, copied unmodified), web `app/src/views/RepVerify.tsx`. Tests: `node --test server/src/rep.test.ts` (valid verdict, forged signature, expired session, reused nonce, wrong audience, revoked / no tier / non-lodging source, 404s).

## Deploy

One Fly secret on the backend app: `REP_ATTESTER_SECRET` = the secret of the stellar-cli identity `rep-attester` (the operator of group 1). Set it without printing it, for example:

```
fly secrets set --app <backend app> REP_ATTESTER_SECRET="$(stellar keys show rep-attester)" > /dev/null
```

Optional `REP_GROUP_ID` (default: the group named "REP verified traveler").

## Choly's phone (5 min)

1. Use the **Oct 15 REP Bob build** (live `rep-attest.fly.dev`). Do NOT rebuild from `bob/account-app`: its attest URL is not deployed and it would fall back to sending the raw presentation.
2. **First** make a fresh Airbnb proof in REP Bob (so the wallet holds a current REP verdict).
3. **Then** DevTools -> Issuer URL = `https://stellarbob2026.xyz/api/rep`. (Set before a new proof, new proofs would POST to `{base}/receive`, which is 404 here.)
4. Keep REP Bob in the foreground (it polls only while open).
5. On the laptop: BookerBob -> Ask Bob -> "verify with REP" -> on the phone the consent sheet appears -> tick travel -> share -> the web says "verified traveler" with the Stellar tx.

Undo afterwards: clear the Issuer URL in DevTools.

## 10 s video

| t | Screen | Line |
|---|---|---|
| 0:00 | web, tap "verify with REP" | "Your past stays, proven in REP." |
| 0:03 | phone: consent sheet "BookerBob: are you a verified traveler?", tap share | "You approve on your phone." |
| 0:07 | web: "verified traveler", Stellar tx link; a place's price drops by the 5% perk | "BookerBob keeps only yes. The discount follows you." |

## Evidence: device run (Sun 25 Oct 2026)

| Time (Lisbon = UTC) | What | Tx |
|---|---|---|
| 14:31:22 | Choly's phone (REP Bob, Oct 15 build) shared an Airbnb-based REP verdict; BookerBob verified it and added the browser's fresh identity to "REP verified traveler" (group 1). Web: "verified traveler. your perks now include it." | [`38bd6a7f38987c745624d363124c27f7a0e2bd8764b2051e3afdbe5474c34106`](https://stellar.expert/explorer/testnet/tx/38bd6a7f38987c745624d363124c27f7a0e2bd8764b2051e3afdbe5474c34106) |
| 14:23:27 | The first attempt: the server verified and added the member, but the web card showed a failure because `/result` could not read the session id (fixed in d701dc6, deployed 14:30). | [`52f3b3c2…ffc358c`](https://stellar.expert/explorer/testnet/tx/52f3b3c26fc0397fe4da3c165b2d223834156ea09c507dd0a1fd9bd65ffc358c) |

## On-chain check (branch choly/rep-onchain, flag OFF by default)

`add_member_with_rep(group, id_commitment, verdict, kb)` lets anyone join group 1 with a REP verdict that the
contract checks itself, so membership no longer depends on a trusted attester server. The attester path
(`add_member` with the `rep-attester` key) stays as the default and the fallback.

- Input: the compact verdict JWS and the phone's compact KB-JWT, exactly as presented. The contract decodes
  base64url itself and verifies both ES256 signatures with the host's secp256r1 (`env.crypto().secp256r1_verify`,
  SEC-1 key, sha256 digest, raw r||s). The host takes only low-S; JOSE signers emit either, so the contract maps
  s to n - s first.
- Checks: typ and alg; REP's key pinned per group by the contract admin (`set_rep_issuer`, rotation = the same
  call); iss, rep_profile 1, nbf, exp, `max_age` since iat (default 7 days); a non-empty `lodging_spend_tier`;
  `server_name` airbnb.com or booking.com; the KB header's `jwk` hashes (RFC 7638) to `cnf.jkt` and signed the
  proof; aud `bookerbob`; `at_hash` over this exact verdict; KB iat within 300 s of the ledger clock; nonce
  `pos:<id_commitment>:<rand>`, so a proof can only add the commitment it was made for.
- Replay: one verdict adds one member. The spent key is sha256 of the verdict's signing input, which excludes the
  signature, so an n - s copy of the same verdict is refused too.
- Not on-chain: the issuer's revocation status list. `exp` and `max_age` bound the window; the server still
  checks revocation before it submits.
- Cost: about 6.5M CPU instructions (limit 100M) and 160 KB memory; the wasm is 59 KB.
- Tests: `cargo test` in `contracts/proof_of_stay` (`test_rep.rs`: real-shape verdict, low and high S, forged
  issuer, rotated key, wrong device key, wrong aud, at_hash for another verdict, nonce for another commitment,
  expired, too old, stale holder proof, before nbf, no tier, not a lodging source, wrong iss, replay, S-flip
  replay). Fixtures come from `fixtures/gen-rep.mjs`: the live verdict's shape signed with throwaway keys, with no
  PII and synthetic hashes. They agree case by case with REP's own `verify-rep.mjs`.

**Privacy cost, why the flag is OFF.** The verdict and the holder proof become permanent, public tx arguments.
A rep-attest verdict carries more than the tier: `lodging_spend_approx` (spend rounded to $5k), `city_footprint`,
`server_name`, `evidence_time`, `attestation_hash`, the status index, and the device key (in the KB header, and
as `cnf.jkt`). The device key is the same for every verifier, so all on-chain joins from one phone are linkable.
The contract stores nothing beyond the replay key, but the arguments stay in the ledger. So this path is
trustless but publishes band details. Production needs a tier-only issuer-signed verdict (SD-JWT or a
tier-only JWS from rep-attest) and a pairwise holder key per verifier.

### Tier credential (REP_ONCHAIN=1): the privacy-safe on-chain path

`REP_ONCHAIN=1` no longer submits the raw verdict. The backend sends the verdict and holder proof to the REP tier
issuer (`REP_TIER_URL`, default `https://rep-attest-tier.fly.dev`, code `tier-issuer.mjs` in REP-CORE/rep-context-mcp),
which runs the same full verification off chain and signs a 106-byte credential with its own P-256 key:
`"REPTIER1" | kid u8 | sha256("rep-verified-traveler") | tier u8 | commitment | iat | exp | jti`. The tier byte is 1
("qualified at the policy minimum") unless the issuer runs with `REP_TIER_BANDS=1`. One REP presentation mints one credential; a notarized session can yield several presentations, so sybil resistance per account needs a stable id from REP (open).
The relayer submits `add_member_with_tier(group, id_commitment, cred, sig)`; the contract checks the signature with
secp256r1 against the pinned issuer key, the group hash, the commitment, `iat`/`exp` and a single-use `jti`. Nothing
about spend, dates, source or the device key reaches the ledger. `REP_ONCHAIN=verdict` keeps the raw-verdict path below
for tests.

Turn on the raw-verdict path (testnet, after review):

```
scripts/rep-onchain.sh upgrade        # admin: new wasm through upgrade(), storage and contract ID stay
scripts/rep-onchain.sh set-issuer     # admin: pins kid rep-attest-1 from the live JWKS for group 1
fly secrets set --app <backend app> REP_ONCHAIN=verdict REP_RELAYER_SECRET="$(stellar keys show <any funded key>)" > /dev/null
```

The relayer only pays fees and holds no group rights. Leave `REP_ATTESTER_SECRET` set: unset `REP_ONCHAIN` and the
attester path is back.
