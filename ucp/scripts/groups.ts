import { reader, MERCHANT } from "../src/core.ts"
const c: any = await reader()
const g = (await c.list_groups()).result
console.log(JSON.stringify(g, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
for (const m of [0, 1, MERCHANT]) { try { const p = (await c.get_policy?.({ merchant: m }))?.result; console.log("policy", m, JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v))) } catch (e) { console.log("policy", m, "none", String(e).slice(0, 80)) } }
