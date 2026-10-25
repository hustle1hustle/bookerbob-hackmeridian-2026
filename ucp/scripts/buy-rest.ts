// "Buy with Bob" as the web app would do it: REST /buy/*, proof made client side, wallet signs the envelope.
import { readFileSync, writeFileSync } from "node:fs"
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk"
import { NET, MERCHANT, discountMessage, discountScope, leaves, loadArtifacts, proveMembership, stayIdentity } from "../src/core.ts"
const B = process.argv[2] ?? "http://localhost:8787"
const post = async (step: string, body: any) => { const r: any = await (await fetch(`${B}/buy/${step}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json(); if (r.error) throw new Error(`${step}: ${r.error}`); return r }
const w = JSON.parse(readFileSync("agent/.buyer.json", "utf8")); const made = w.purchases[String(MERCHANT)]
const pool: string[] = JSON.parse(readFileSync("agent/.payers.json", "utf8")); const payer = Keypair.fromSecret(pool[0])
const tree = await leaves(); const past = stayIdentity(w.master, MERCHANT, made - 1); const next = stayIdentity(w.master, MERCHANT, made)
const s = await post("start", { variantId: "gid://shopify/ProductVariant/66012090499463", qty: 1, claim: true, nextCommitment: next.commitment.toString() })
console.log("start", s.subtotal, s.currency, "provisional", s.provisionalDiscount, "season", s.action.scope.season)
const p = await proveMembership(past, tree, discountMessage(payer.publicKey()), discountScope(MERCHANT, s.action.scope.season), await loadArtifacts())
const v = await post("prove", { checkoutId: s.checkoutId, payer: payer.publicKey(), root: p.root.toString(), nullifier: p.nullifier.toString(), proof: p.proof })
console.log("prove", v)
const q = await post("quote", { checkoutId: s.checkoutId, payer: payer.publicKey() })
console.log("quote", q.quote.function, q.quote.amount_raw, "->", q.quote.pays_raw)
const tx = TransactionBuilder.fromXDR(q.quote.tx_xdr, NET.networkPassphrase); tx.sign(payer)   // = Freighter signTransaction
const sent = await post("send", { signedTxXdr: tx.toXDR() })
console.log("send", sent)
const done = await post("complete", { checkoutId: s.checkoutId, txHash: sent.txHash })
console.log("complete", JSON.stringify(done))
pool.shift(); writeFileSync("agent/.payers.json", JSON.stringify(pool)); w.purchases[String(MERCHANT)] = made + 1; writeFileSync("agent/.buyer.json", JSON.stringify(w))
process.exit(0)
