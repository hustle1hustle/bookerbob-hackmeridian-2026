// The buyer visits a place in the BookerBob Lisbon network (default Café Lento, merchant 3): pays its
// price on chain with a fresh payer, and the place checks a fresh stay identity in, which also enrolls
// it in the network group. Usage: npm run visit -- [merchantId]
import { readFileSync, writeFileSync } from "node:fs"
import { Keypair } from "@stellar/stellar-sdk"
import { clientAs, stayIdentity, reader } from "../src/core.ts"
import { write } from "../.core/packages/sdk/src/contract.ts"
const m = Number(process.argv[2] ?? 3)
const api = (process.env.CORE_API_URL ?? "https://stellarbob2026.xyz").replace(/\/$/, "")
const w = JSON.parse(readFileSync("agent/.buyer.json", "utf8"))
const pool: string[] = JSON.parse(readFileSync("agent/.payers.json", "utf8"))
const payer = Keypair.fromSecret(pool[0])
const c: any = await reader()
const h = (await c.get_merchant({ merchant: m })).result
const chain = (await c.merchant_chain({ merchant: m })).result
const paid = await write<bigint>(await clientAs(payer), "book", { merchant: m, guest: payer.publicKey() })
if (!paid.ok) throw new Error(`book: ${paid.error} ${paid.message}`)
console.log(`paid ${Number(h.price) / 1e7} USDC at ${h.name}, tx ${paid.txHash}`)
const n = w.purchases[String(m)] ?? 0
const id = stayIdentity(w.master, m, n)
const r: any = await (await fetch(`${api}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchant: m, commitment: id.commitment.toString() }) })).json()
if (r.error) throw new Error(`checkout: ${r.error} ${r.message ?? ""}`)
console.log(`checked in at ${h.name}, tx ${r.txHash}${chain !== undefined && chain !== null ? `; enrolled in network group ${chain}` : ""}`)
pool.shift(); writeFileSync("agent/.payers.json", JSON.stringify(pool), { mode: 0o600 })
w.purchases[String(m)] = n + 1; writeFileSync("agent/.buyer.json", JSON.stringify(w), { mode: 0o600 })
process.exit(0)
