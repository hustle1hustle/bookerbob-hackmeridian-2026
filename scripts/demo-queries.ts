// Runs every demo query against the API and checks each returns at least MIN results. Writes docs/demo-queries.md.
import { writeFileSync } from "node:fs"
const API = process.env.API ?? "http://localhost:8080"
const MIN = 3
const queries = ["hotel in lisbon under 120", "hotel under 100", "best hotel", "coffee nearby", "restaurant dinner", "t-shirt under 50 usdc", "hoodie"]
let md = `# Demo queries\n\nAsk Bob queries for the demo and the video, checked against \`${API.replace(/localhost:\\d+/, "localhost")}\` on ${new Date().toISOString().slice(0, 16)}Z with \`scripts/demo-queries.ts\`. Ranking is by proven reviews only.\n`
let failed = 0
for (const q of queries) {
  const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`).then((x) => x.json())
  const ok = r.results.length >= MIN
  if (!ok) failed++
  md += `\n## "${q}" ${ok ? "" : `(only ${r.results.length})`}\n\nparsed: kind ${r.parsed.kind ?? "any"}, max ${r.parsed.maxPrice ?? "none"}; sources: ${r.sources.map((s: any) => `${s.id} ${s.status}`).join(", ")}\n\n| # | result | source | price | why |\n|---|---|---|---|---|\n`
  r.results.slice(0, 6).forEach((x: any, i: number) => (md += `| ${i + 1} | ${x.title} (${x.kind}) | ${x.source} | ${x.price} USDC | ${x.reason} |\n`))
  console.log(ok ? "ok  " : "FAIL", q, r.results.length)
}
writeFileSync("docs/demo-queries.md", md)
process.exit(failed ? 1 : 0)
