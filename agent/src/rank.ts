// Bob's ranking: places ordered by PROVEN reviews only. Pure, no I/O, no SDK runtime: the CLI and the web app share it.
//
// Score = Bayesian average of on-chain ratings:
//   score = (C * m + sum(w_i * r_i)) / (C + sum(w_i))
// where r_i is a proven review's rating (1-5), w_i = VERIFIED_WEIGHT for an arbiter-verified stay, else 1,
// m = PRIOR_MEAN, a fixed, deliberately modest prior, and C the prior weight. A place with few reviews is pulled toward m, so 5.0 from one review does not beat 4.6 from twenty.
// Places with 0 proven reviews have no score and always rank last (cheapest first among them).
import type { Merchant, Review } from "../../packages/sdk/src/types.ts"

export const PRIOR_WEIGHT = 3
export const PRIOR_MEAN = 3.5
export const VERIFIED_WEIGHT = 2
/** Returning-guest discount season used by the demo (the seed used 1). */
export const DEMO_SEASON = 1

export type Kind = "hotel" | "cafe" | "shop" | "restaurant"

export interface Query {
  text: string
  kind?: Kind
  /** USDC, whole units. */
  maxPrice?: number
}

export interface Ranked {
  place: Merchant
  /** Bayesian score, null when there are no proven reviews. */
  score: number | null
  /** Plain average of proven ratings (what people read), null at 0 reviews. */
  avg: number | null
  proven: number
  verified: number
  priceUsdc: number
  reason: string
}

const kindWords: [RegExp, Kind][] = [
  [/\b(hotels?|stays?|rooms?|hostels?|nights?)\b/i, "hotel"],
  [/\b(caf[eé]s?|coffee|espresso|brunch)\b/i, "cafe"],
  [/\b(restaurants?|dinner|lunch|food|eat)\b/i, "restaurant"],
  [/\b(shops?|stores?|boutiques?|buy|gifts?|t-?shirts?|tees?|shirts?|hoodies?|merch|clothes|linen)\b/i, "shop"],
]

/** Simple query parsing: a kind word and a max price ("under 120", "below 90 usdc", "max 50", "< 40", "120 usdc"). */
export function parseQuery(text: string): Query {
  const q: Query = { text }
  for (const [re, k] of kindWords) if (re.test(text)) {
    q.kind = k
    break
  }
  const m =
    text.match(/(?:under|below|max(?:imum)?|less than|up to|cheaper than|<=?)\s*\$?\s*(\d+(?:[.,]\d+)?)/i) ?? text.match(/(\d+(?:[.,]\d+)?)\s*(?:usdc|usd|\$|eur|€)/i)
  if (m) q.maxPrice = Number(m[1].replace(",", "."))
  return q
}

const USDC = 10_000_000
export const priceUsdc = (p: Merchant) => Number(p.price) / USDC
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
// the count here is reviews; "proven stays" means checked-in leaves of the tree everywhere else
const noun = (_kind: string, n: number) => (n === 1 ? "proven review" : "proven reviews")

/** Rank places for a query. Places that miss the kind or price filter are left out. */
export function rank(places: Merchant[], reviews: Review[], query: Query | string): Ranked[] {
  const q = typeof query === "string" ? parseQuery(query) : query
  const proven = reviews.filter((r) => r.rating >= 1 && r.rating <= 5)
  const m = PRIOR_MEAN

  const ranked = places
    .filter((p) => (q.kind ? p.kind === q.kind : true))
    .filter((p) => (q.maxPrice !== undefined ? priceUsdc(p) <= q.maxPrice : true))
    .map((p): Ranked => {
      const rs = proven.filter((r) => r.merchant === p.id)
      const verified = rs.filter((r) => r.verified).length
      const price = priceUsdc(p)
      const pricePart = q.maxPrice !== undefined ? `under ${fmt(q.maxPrice)} USDC` : `${fmt(price)} USDC`
      if (rs.length === 0) return { place: p, score: null, avg: null, proven: 0, verified: 0, priceUsdc: price, reason: `no proven reviews yet, ${pricePart}` }
      const wSum = rs.reduce((a, r) => a + (r.verified ? VERIFIED_WEIGHT : 1), 0)
      const wr = rs.reduce((a, r) => a + (r.verified ? VERIFIED_WEIGHT : 1) * r.rating, 0)
      const score = (PRIOR_WEIGHT * m + wr) / (PRIOR_WEIGHT + wSum)
      const avg = rs.reduce((a, r) => a + r.rating, 0) / rs.length
      const reason = `${avg.toFixed(1)} from ${rs.length} ${noun(p.kind, rs.length)}${verified ? `, ${verified} verified` : ""}, ${pricePart}`
      return { place: p, score, avg, proven: rs.length, verified, priceUsdc: price, reason }
    })

  return ranked.sort((a, b) => {
    if (a.score === null && b.score === null) return a.priceUsdc - b.priceUsdc
    if (a.score === null) return 1
    if (b.score === null) return -1
    return b.score - a.score || b.proven - a.proven || a.priceUsdc - b.priceUsdc
  })
}

/** Headline for the pick, e.g. "best proven rating under 120 USDC". */
export function pickHeadline(q: Query): string {
  const kind = q.kind === "cafe" ? " café" : q.kind ? ` ${q.kind}` : ""
  return `best proven${kind} rating${q.maxPrice !== undefined ? ` under ${fmt(q.maxPrice)} USDC` : ""}`
}
