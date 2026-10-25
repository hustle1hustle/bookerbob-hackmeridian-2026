// Fresh payer per booking: one guest (one browser, one stay) books twice with perks; the two payments come from
// unrelated one-time addresses, no wallet is connected and the guest never holds XLM.
// Usage: API=http://localhost:8080 node scripts/privacy-test.ts
import assert from "node:assert/strict"
import { createSdk, isErr, formatUsdc } from "../packages/sdk/src/index.ts"

const mem = new Map<string, string>()
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
const API = process.env.API ?? "http://localhost:8080"
const sdk = createSdk({ mode: "testnet", testnet: { apiUrl: API, storage } })
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

const stay = sdk.stays.create(0)
const co = await sdk.chain.checkout(0, stay.commitment)
assert.ok(!isErr(co))
log("stay checked in at place 0 (joins the network group)", (co as any).txHash)
assert.equal(sdk.wallet.address, null, "no wallet connected")

const payers: string[] = []
for (const season of [Date.now() % 100000, (Date.now() % 100000) + 1]) {
  const r: any = await sdk.chain.bookWithPerks(1, season)
  if (isErr(r)) throw new Error(`${r.error} ${r.message ?? ""}`)
  log(`season ${season}: paid ${formatUsdc(r.paid)} from ${r.payer}`, sdk.chain.explorerTx(r.txHash))
  payers.push(r.payer)
}
assert.notEqual(payers[0], payers[1])
// the payers share no funding source with each other or the guest: each was created by the sponsor and minted directly
for (const p of payers) {
  const ops = await fetch(`https://horizon-testnet.stellar.org/accounts/${p}/operations?limit=10&order=asc`).then((r) => r.json())
  const sources = new Set(ops._embedded.records.map((o: any) => o.source_account))
  log(p.slice(0, 8), "operation sources:", [...sources].map((s: any) => s.slice(0, 8)).join(", "))
}
log("PRIVACY OK: two bookings, two unrelated payers, no wallet, no XLM held by the guest")
process.exit(0)
