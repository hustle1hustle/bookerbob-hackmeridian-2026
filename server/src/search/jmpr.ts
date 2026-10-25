// JMPR adapter: real Lisbon hotels from JMPR (jmpr.world), served from a static snapshot
// (server/data/jmpr-lisbon.json, built on a Mac by scripts/jmpr-snapshot.ts). The public site never calls
// JMPR: searching costs zero JMPR calls and no JMPR token lives on the server. Prices are JMPR's pre-tax
// nightly "from" prices in USD, shown 1:1 as USDC for comparison only, never a quote.
// A JMPR hotel that is also one of our merchants would carry proven reviews; none is today, so every hit
// shows "no proven reviews yet".
import { readFileSync } from "node:fs"
import type { SearchAdapter } from "./types.ts"

interface Snap { fetchedAt: string; hotels: { hotelId: string; name: string; area: string; stars: number | null; priceFrom: number; elitePerks: string[]; imageUrl: string | null; lat: number | null; lon: number | null }[] }

let snap: Snap | null = null
const load = (): Snap => (snap ??= JSON.parse(readFileSync(new URL("../../data/jmpr-lisbon.json", import.meta.url), "utf8")))

// words that say nothing about which hotel: the kind, the city, price phrases, filler
const STOP = /\b(a|an|the|in|at|for|me|some|nearby|near|cheap|find|book|hotel|hotels|stay|room|rooms|night|nights|lisbon|lisboa|please|under|below|max|usdc|usd|eur)\b/gi

export function jmprAdapter(enabled: boolean): SearchAdapter {
  return {
    id: "partners",
    enabled,
    async search(q) {
      if (q.kind && q.kind !== "hotel") return []
      const words = q.text.toLowerCase().replace(/\$?\d+(?:[.,]\d+)?/g, " ").replace(STOP, " ").split(/\s+/).filter((w) => w.length > 2)
      const s = load()
      return s.hotels
        .filter((h) => (q.maxPrice !== undefined ? h.priceFrom <= q.maxPrice : true))
        // free words narrow by name or area only when they match something; "hotel in lisbon" lists them all
        .filter((h, _, all) => {
          if (!words.length) return true
          const hit = (x: typeof h) => words.some((w) => `${x.name} ${x.area}`.toLowerCase().includes(w))
          return all.some(hit) ? hit(h) : true
        })
        .slice(0, 12)
        .map((h) => ({
          source: "partner hotels",
          merchantId: null,
          title: h.name,
          kind: "hotel",
          price: Math.round(h.priceFrom),
          currency: "USDC" as const,
          url: null,
          imageUrl: h.imageUrl,
          provenRating: null,
          reviewCount: 0,
          verifiedCount: 0,
          extra: { hotelId: h.hotelId, area: h.area.replace(/\s+/g, " ").trim(), stars: h.stars || null, elitePerks: h.elitePerks, priceNote: "from, per night, pre-tax (partner snapshot)", snapshotAt: s.fetchedAt, lat: h.lat, lon: h.lon },
        }))
    },
  }
}
