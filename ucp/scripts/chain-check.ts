import { reader } from "../src/core.ts"
const c: any = await reader()
for (const m of [0, 1, 2, 3, 4, 5, 6]) { const ch = (await c.merchant_chain({ merchant: m })).result; const h = (await c.get_merchant({ merchant: m })).result; console.log(m, String(h.name), String(h.kind), h.price.toString(), "chain", ch) }
