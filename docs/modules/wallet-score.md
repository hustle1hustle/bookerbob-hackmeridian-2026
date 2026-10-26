# Wallet score → verify → attest → ZK proof

Runs in BookerBob after connect (Freighter or passkey).

## Pipeline

```
wallet address
  → inspect (Horizon READ, optionally Stellar Passport)
  → rating 0–100 + tier 1–5
  → loyalty claim + digest (SHA-256)
  → attest tx on testnet (1 stroop + memo.hash = digest)   ← the "on-chain proof" of the score
  → ZK score proof (Groth16 / Semaphore stack PoS)         ← binding, not anonymity
```

Package: `packages/verify_onchain_zk` · UI: connect panel → **score ↗** / `#pass-connect`.  
API details: [verify_onchain_zk.md](./verify_onchain_zk.md).

---

## 1. Score (how it is computed)

**Not** a score kept in contract storage. We read the wallet and compute the score locally, on the client.

### Horizon (up to 100)

| Signal | Cap |
|---|---|
| Account age (~1 year → full) | 40 |
| `log10(1 + ops)` | 35 |
| `log10(1 + payment ops)` | 25 |

1-stroop attest payments are **excluded**, so a repeated verify does not inflate the score.

### Passport (optional, + up to 20)

Builder profile / points / rank / scf_tier / 30d → bonus, then **clamp 0–100**.  
Without `PASSPORT_API_KEY`: keyless and graceful (0 bonus, the score does not drop).

### Tier

| Tier | Rating |
|---|---|
| 5 | ≥ 85 |
| 4 | ≥ 70 |
| 3 | ≥ 50 |
| 2 | ≥ 30 |
| 1 | below |

Discount hint: `ratingToDiscountBps` (UX only; the stay-proof discount is separate).

---

## 2. Verify / attest (what is "on chain")

| Step | Writes to the network? |
|---|---|
| `inspectWallet` / score | **No**, only Horizon (+ Passport) |
| `verifyOnConnect` (default) | **Yes**, attest |

**Attest:** the relayer sends the guest **1 stroop** with `memo.hash = claimDigest`.  
Explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`.

In the UI: **score ↗** / **proof tx** = this transaction plus the score and tier numbers in the panel.

Season cache: `bookerbob.loyalty.v2.{YYYYMM}.{address}` (localStorage).

API: `POST /api/loyalty/attest`. Off on the live demo: it returns 404 unless the server runs with `LOYALTY_ATTEST=1`, because it links a wallet to its tier in public.

---

## 3. ZK proof

`issueScoreProof` / `verifyOnConnect({ proveScore: true })` (in the app; the site panel currently uses `proveScore: false`, it needs the attest tx).

- Identity: `loyaltyIdentity(address, season)`, deterministic per wallet and season
- Default: **self-membership** (one leaf), a real Groth16 proof on the same Semaphore stack as Proof of Stay
- The message binds `address | rating | tier`, scope ≈ `loyalty,{merchant},{season}`
- Nullifier: one loyalty proof per season per identity

**Honest limit:** a self-proof means "knows the identity + binds the score", **not** "anonymous among N", until the wallet is enrolled in a group (`leaves`).

Artifact or snark failures do **not** break connect: the claim and the attest remain.

---

## 4. Do not confuse

| This | Not this |
|---|---|
| Wallet loyalty score | REP verified traveler / group 1 |
| Attest 1 stroop | `book_with_discount` / stay proof |
| ZK score (self) | Anonymity-set checkout proof |
| Tier 5–1 from Horizon | REP lodging_spend_tier credential |

REP on chain (`add_member_with_tier`) is a **separate** path, enabled with `REP_ONCHAIN=1`; the live contract supports it since the upgrade to wasm `d66cd00f`. See [rep-handoff.md](../rep-handoff.md).

---

## 5. Deploy checklist (score)

- [ ] Backend with `POST /api/loyalty/attest` (`LOYALTY_ATTEST=1`) + relayer funded
- [ ] Site/app with a fresh `pol-real` / PassConnect
- [ ] (Optional) `PASSPORT_API_KEY` for the Passport bonus
- [ ] `REP_ONCHAIN=1` only against a contract with the tier check (wasm `d66cd00f` or later)

Manual check: connect Freighter → panel → score N · tier T · proof tx ↗ opens on testnet.
