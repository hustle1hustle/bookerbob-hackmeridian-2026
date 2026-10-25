// One-off: a checkout paid on Stellar whose completion call failed (bridge bug, fixed). The payment
// is real, so the buyer's commitment joins the tree as it would have. Usage: <bare checkout gid> <tx>
import { readFileSync, writeFileSync } from "node:fs"
import { Keypair } from "@stellar/stellar-sdk"
import { readPayment, insertCommitment, MERCHANT } from "../src/core.ts"
const [id, tx] = process.argv.slice(2)
const st = JSON.parse(readFileSync("data/state.json", "utf8"))
const s = st.sessions[id]
const p = await readPayment(tx)
if (!s || s.paid || p.merchant !== MERCHANT || st.usedTx[tx]) throw new Error("nothing to recover")
const r = await insertCommitment(Keypair.fromSecret(process.env.UCP_SHOP_ADMIN_SECRET!), BigInt(s.nextCommitment))
if (!r.ok) throw new Error(r.error)
s.paid = { via: "stellar", txHash: tx, order: null, joinTx: r.txHash, at: Date.now() }
st.usedTx[tx] = id
writeFileSync("data/state.json", JSON.stringify(st, null, 1))
const w = JSON.parse(readFileSync("agent/.buyer.json", "utf8")); w.purchases[String(MERCHANT)] = (w.purchases[String(MERCHANT)] ?? 0) + 1
writeFileSync("agent/.buyer.json", JSON.stringify(w), { mode: 0o600 })
console.log("joined, tx", r.txHash)
