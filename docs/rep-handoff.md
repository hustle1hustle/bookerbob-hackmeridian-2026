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
