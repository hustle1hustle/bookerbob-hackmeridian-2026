# Context providers

A context provider vouches that a customer has some context (a verified traveler, a long Stellar wallet history, a booking partner's past stays) by adding the customer's commitment to its own **attested group**. Places reward groups through their discount policy. The customer later proves membership in zero knowledge; the provider never learns where the perk is used, and the place never learns who the customer is.

Contract: `proof_of_stay` on Stellar testnet, ID in [`config/testnet.json`](../config/testnet.json) (also served at `/api/config`).

## 1. Get a group

The contract admin creates one group per provider and names the provider's operator address:

```bash
stellar contract invoke --id <CONTRACT> --source deployer --network testnet -- \
  create_group --kind attested --operator <PROVIDER_ADDRESS> --name "Stellar wallet history"
# returns the group id
```

Each provider owns its own groups. Only its operator can add members. `list_groups()` returns `{ id, kind, name, operator, size }` for the UI and for places writing policies.

Current groups on testnet:

| id | kind | name | operator |
|---|---|---|---|
| 0 | chain | BookerBob Lisbon network | `chain-admin` (filled at checkout by member places) |
| 1 | attested | REP verified traveler | `rep-attester` (REP, Booking-based proofs) |

## 2. Add members

When a customer passes your check, add their commitment:

```ts
import { getClient, write, TESTNET } from "@bookerbob/pos-sdk/src/contract.ts"
const c = await getClient({ ...TESTNET, contractId }, providerSigner)   // your operator key
await write(c, "add_member", { group: GROUP_ID, id_commitment: BigInt(commitment) })
```

- `commitment` is a Semaphore identity commitment the customer's app gives you. In the BookerBob app it is a per-stay identity derived from a secret that never leaves the browser.
- Auth is your operator address (`require_auth`), so only you can grow your group. Leaves are unique, nonzero and below the BN254 field modulus.
- What you check before adding is yours to define and to publish (for example: a REP proof of past Booking stays, or a wallet older than N days with M transactions).

## 3. What the customer gets

A place sets a policy, for example:

| group | discount |
|---|---|
| its own customers (returning) | 10% |
| chain group 0 (network) | 5% |
| attested group 1 (verified traveler) | 5% |
| cap | 15% |

`book_with_context(merchant, guest, season, amount, claims)` takes one claim per group: `{ group: Merchant(id) | Group(id), proof, root, nullifier }`. Per claim the contract checks the root against that group's recent root history (never 0), canonical inputs, an unused nullifier for `scope = keccak("pos/ctx" || merchant || group || season)` and the Groth16 proof bound to the paying address; it sums the discounts, caps them, and makes one USDC transfer. A claim on the place's own customer tree uses the plain discount scope, so it cannot stack with `book_with_discount` in the same season.

In the app, "your perks here" (`sdk.chain.perks(merchant)`) shows which groups the browser qualifies for and the final price; `sdk.chain.bookWithPerks(merchant, season)` proves every eligible claim and books in one transaction.

## 4. Backend hook

`POST /api/context/attest { group, commitment, evidence }` is the backend endpoint a provider service plugs into. It is a stub today (returns `501`): a provider that verifies its own evidence (for example a REP attestation signature) calls `add_member` with its own key, either from its own service or by giving this backend its operator key for that group only.

## Limitations

- In this demo the same per-stay commitment is a leaf in the place tree, the chain group and possibly attested groups. Proofs stay unlinkable (different scopes give different nullifiers), but a production deployment would give each group a separately derived identity so trees cannot be cross-referenced by leaf value.
- Group operators are trusted for membership. The contract makes that trust explicit and per provider; it does not decide what a provider should check.
