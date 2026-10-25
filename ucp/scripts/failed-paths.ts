// Failure paths on a bridge, for the video: a forged proof and a reused (already paid) proof.
import { readFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
const NS = "com.bookerbob.patronage"; const B = process.argv[2] ?? "http://localhost:8787"
const call = async (name: string, args: any) => { const j: any = await (await fetch(`${B}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json(); return j.result.structuredContent ?? JSON.parse(j.result.content[0].text) }
const fresh = () => call("create_checkout", { checkout: { line_items: [{ item: { id: "gid://shopify/ProductVariant/66012090499463" }, quantity: 1 }], context: { eligibility: [NS] } } })
const why = (r: any) => r.messages?.filter((m: any) => m.code === "eligibility_invalid").map((m: any) => m.content).join("") || r[NS]?.status
const used = JSON.parse(readFileSync("evidence/last-proof.json", "utf8"))
console.log(`bridge ${B}`)
// 1. forged: genuine proof bytes from a real purchase, but a made-up nullifier (a claim nobody proved)
let co = await fresh()
const fake = BigInt("0x" + randomBytes(30).toString("hex")).toString()
let r = await call("update_checkout", { id: co.id, checkout: { [NS]: { proof: { payer: used.payer, root: used.root, nullifier: fake, proof: used.proof } } } })
console.log(`forged claim (real proof bytes, invented nullifier) -> ${r[NS]?.status} | ${why(r)}`)
// 2. reused: a proof that already paid an order
co = await fresh()
r = await call("update_checkout", { id: co.id, checkout: { [NS]: { proof: { payer: used.payer, root: used.root, nullifier: used.nullifier, proof: used.proof } } } })
console.log(`reused proof (nullifier ${used.nullifier.slice(0, 10)}…, already paid) -> ${r[NS]?.status} | ${why(r)}`)
// 3. completing with the claim still unproven
const done = await call("complete_checkout", { meta: { "idempotency-key": crypto.randomUUID() }, id: co.id, checkout: { payment: { instruments: [{ id: "x", handler_id: "stellar.usdc", type: "stellar_tx", credential: { type: "stellar_tx", tx_hash: "00".repeat(32) } }] } } })
console.log(`complete with the claim unproven -> ${done.code ?? done.status}`)
