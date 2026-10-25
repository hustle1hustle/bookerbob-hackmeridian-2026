// Replay: hand a proof that already paid to a fresh checkout. The contract refuses it (NullifierUsed).
import { readFileSync } from "node:fs"
const NS = "com.bookerbob.patronage"; const B = process.env.UCP_BRIDGE_URL ?? "http://localhost:8787"
const p = JSON.parse(readFileSync("evidence/last-proof.json", "utf8"))
const call = async (name: string, args: any) => { const j: any = await (await fetch(`${B}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json(); return j.result.structuredContent ?? JSON.parse(j.result.content[0].text) }
const co = await call("create_checkout", { checkout: { line_items: [{ item: { id: "gid://shopify/ProductVariant/66012090499463" }, quantity: 1 }], context: { eligibility: [NS] } } })
const r = await call("update_checkout", { id: co.id, checkout: { [NS]: { proof: { payer: p.payer, root: p.root, nullifier: p.nullifier, proof: p.proof } } } })
console.log(`replayed proof (nullifier ${p.nullifier.slice(0, 10)}…) ->`, r[NS]?.status, "|", r.messages?.filter((m: any) => m.code === "eligibility_invalid").map((m: any) => m.content).join(""))
