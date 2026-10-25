// Builds server/data/jmpr-lisbon.json: Lisbon hotels from JMPR, fetched ONCE on a Mac with the team's JMPR
// token, so the public site searches a static snapshot and never spends JMPR calls.
// Run: node scripts/jmpr-snapshot.ts   (token from ~/.rep-secrets/jmpr.token or JMPR_TOKEN; never printed)
// Kept per hotel: JMPR hotel_id, name, area (address), stars, lowest "from" nightly price seen (pre-tax USD),
// Elite Rate perks, image URL, coordinates. No personal data: searches carry no traveler requirements.
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"

const URL_ = process.env.JMPR_MCP_URL ?? "https://elite.jmpr.world/mcp/"
const TOKEN = (process.env.JMPR_TOKEN ?? readFileSync(`${homedir()}/.rep-secrets/jmpr.token`, "utf8")).trim()
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` }
let id = 0
let session: string | null = null
async function rpc(method: string, params: unknown) {
  const r = await fetch(URL_, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) })
  session ??= r.headers.get("mcp-session-id")
  let t = await r.text()
  const line = t.split(/\r?\n/).find((l) => l.startsWith("data:"))
  if (line) t = line.slice(5)
  const j = JSON.parse(t)
  if (j.error) throw new Error(`${method}: ${j.error.message}`)
  return j.result
}
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bookerbob-snapshot", version: "1" } })
await fetch(URL_, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) })

const windows = [["2026-11-13", "2026-11-15"], ["2026-11-27", "2026-11-29"], ["2026-12-11", "2026-12-13"], ["2027-01-15", "2027-01-17"]]
const asks = ["", "good value, under 200 USD a night"]
const hotels = new Map<string, any>()
let calls = 0
for (const [ci, co] of windows) {
  for (const ask of asks) {
    const res = await rpc("tools/call", { name: "hotel_search", arguments: { city: "Lisbon", checkin_date: ci, checkout_date: co, user_requirements: ask, user_preferences: "", page_size: 20 } })
    calls++
    const d = res.structuredContent ?? JSON.parse(res.content?.[0]?.text ?? "{}")
    for (const h of d.records ?? []) {
      const price = Number(h.price_from)
      if (!h.hotel_id || !Number.isFinite(price) || price <= 0) continue
      const prev = hotels.get(h.hotel_id)
      const perks = h.elite_rate?.benefits ?? []
      if (!prev || price < prev.priceFrom) {
        hotels.set(h.hotel_id, {
          hotelId: h.hotel_id,
          name: String(h.name),
          area: String(h.address ?? ""),
          stars: h.star_rating ?? null,
          priceFrom: price,
          currency: h.currency ?? "USD",
          elitePerks: perks.length ? perks : prev?.elitePerks ?? [],
          imageUrl: h.image ?? null,
          lat: h.latitude ?? null,
          lon: h.longitude ?? null,
          seen: `${ci}..${co}`,
        })
      }
    }
  }
}
const out = {
  source: "JMPR (jmpr.world) hotel_search, Lisbon",
  fetchedAt: new Date().toISOString(),
  note: "Pre-tax nightly 'from' prices for comparison, lowest seen across the windows; never a quote. Bookable rates come from JMPR hotel_rooms.",
  windows: windows.map(([a, b]) => `${a}..${b}`),
  hotels: [...hotels.values()].sort((a, b) => a.priceFrom - b.priceFrom),
}
writeFileSync(new URL("../server/data/jmpr-lisbon.json", import.meta.url), JSON.stringify(out, null, 1) + "\n")
console.log(`${out.hotels.length} hotels from ${calls} JMPR calls -> server/data/jmpr-lisbon.json`)
