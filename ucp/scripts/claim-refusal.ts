// Claim flow without a valid proof: provisional discount + action, then a forged proof is refused.
const B = "http://localhost:8787/mcp"; const NS = "com.bookerbob.patronage"
const call = async (name: string, args: any) => { const j: any = await (await fetch(B, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json(); const r = j.result; return r.isError ? { ERR: r.content[0].text } : r.structuredContent }
const co = await call("create_checkout", { checkout: { line_items: [{ item: { id: "gid://shopify/ProductVariant/66012090499463" }, quantity: 1 }], context: { address_country: "PT", eligibility: [NS] } } })
console.log("status", co.status, "| ext", co[NS]?.status, "| provisional", JSON.stringify(co.discounts.applied), "| msg", co.messages.map((m: any) => m.code).join(","))
console.log("action", JSON.stringify(co[NS].action).slice(0, 400))
const z = "11".repeat(64)
const bad = await call("update_checkout", { id: co.id, checkout: { [NS]: { proof: { payer: "GBJQ7PFI3K4HQRLPAMYLM7AL5SEDT33G3PTBXZ7C3AUIF4Y32WZFHSDR", root: "123", nullifier: "456", proof: { a: z, b: z + z, c: z } } } } })
console.log("forged ->", bad.ERR ?? bad.messages?.filter((m: any) => m.code === "eligibility_invalid").map((m: any) => m.content))
const done = await call("complete_checkout", { meta: { "idempotency-key": crypto.randomUUID() }, id: co.id, checkout: { payment: { instruments: [{ id: "x", handler_id: "stellar.usdc", type: "stellar_tx", credential: { type: "stellar_tx", tx_hash: "00".repeat(32) } }] } } })
console.log("complete with open claim ->", JSON.stringify(done).slice(0,400))
