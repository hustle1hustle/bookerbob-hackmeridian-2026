# Wallet score → verify → attest → ZK proof

После connect (Freighter / passkey) в BookerBob.

## Pipeline

```
wallet address
  → inspect (Horizon READ, опционально Stellar Passport)
  → rating 0–100 + tier 1–5
  → loyalty claim + digest (SHA-256)
  → attest tx на testnet (1 stroop + memo.hash = digest)   ← «ончейн пруф» скора
  → ZK score proof (Groth16 / Semaphore stack PoS)         ← биндинг, не анонимность
```

Пакет: `packages/verify_onchain_zk` · UI: connect panel → **score ↗** / `#pass-connect`.  
Детали API: [verify_onchain_zk.md](./verify_onchain_zk.md).

---

## 1. Score (как считаем)

**Не** контрактный storage score. Читаем кошелёк и считаем локально / на клиенте.

### Horizon (до 100)

| Сигнал | Cap |
|---|---|
| Возраст аккаунта (~1 год → full) | 40 |
| `log10(1 + ops)` | 35 |
| `log10(1 + payment ops)` | 25 |

1-stroop attest-платежи **исключены**, чтобы повторный verify не накручивал скор.

### Passport (опционально, + до 20)

Builder profile / points / rank / scf_tier / 30d → бонус, потом **clamp 0–100**.  
Без `PASSPORT_API_KEY` — keyless/graceful (0 бонуса, скор не падает).

### Tier

| Tier | Rating |
|---|---|
| 5 | ≥ 85 |
| 4 | ≥ 70 |
| 3 | ≥ 50 |
| 2 | ≥ 30 |
| 1 | ниже |

Hint скидки: `ratingToDiscountBps` (UX; stay-proof discount отдельно).

---

## 2. Verify / attest (что «ончейн»)

| Шаг | Пишет в сеть? |
|---|---|
| `inspectWallet` / score | **Нет** — только Horizon (+ Passport) |
| `verifyOnConnect` (default) | **Да** — attest |

**Attest:** relayer → гостю **1 stroop**, `memo.hash = claimDigest`.  
Explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`.

В UI: **score ↗** / **proof tx** = эта транзакция + числа score/tier в панели.

Кэш сезона: `bookerbob.loyalty.v2.{YYYYMM}.{address}` (localStorage).

API: `POST /api/loyalty/attest`.

---

## 3. ZK proof

`issueScoreProof` / `verifyOnConnect({ proveScore: true })` (в app; site panel сейчас `proveScore: false` — нужен attest tx).

- Identity: `loyaltyIdentity(address, season)` — детерминированно на кошелёк·сезон
- Default: **self-membership** (один leaf) — настоящий Groth16 на том же Semaphore stack, что Proof of Stay
- Message биндит `address | rating | tier`, scope ≈ `loyalty,{merchant},{season}`
- Nullifier — один loyalty-proof на сезон на identity

**Честный лимит:** self-proof = «знаю identity + биндинг скора», **не** «анонимен среди N», пока нет enroll в группу (`leaves`).

Артефакты/snark fail **не** ломают connect: claim + attest остаются.

---

## 4. Что не путать

| Это | Не это |
|---|---|
| Wallet loyalty score | REP verified traveler / group 1 |
| Attest 1 stroop | `book_with_discount` / stay proof |
| ZK score (self) | Anonymity set checkout proof |
| Tier 5–1 по Horizon | REP lodging_spend_tier credential |

REP on-chain (`add_member_with_tier`) — **отдельный** путь, флаг `REP_ONCHAIN=1` только после upgrade контракта. См. [rep-handoff.md](../rep-handoff.md).

---

## 5. Deploy checklist (score)

- [ ] Backend с `POST /api/loyalty/attest` + relayer funded
- [ ] Site/app с свежим `pol-real` / PassConnect
- [ ] (Опц.) `PASSPORT_API_KEY` для Passport-бонуса
- [ ] Не включать `REP_ONCHAIN=1` без wasm upgrade

Ручной чек: connect Freighter → панель → score N · tier T · proof tx ↗ открывается на testnet.
