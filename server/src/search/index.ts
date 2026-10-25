// Federated search: every enabled adapter answers in parallel, results are ranked by proven reviews only
// (the same Bayesian score as the agent), never by paid placement. Sources without proofs rank last.
import { parseQuery, PRIOR_MEAN, PRIOR_WEIGHT, VERIFIED_WEIGHT } from "../../../agent/src/rank.ts"
import type { Merchant, Review, SearchResponse, SearchResult } from "../../../packages/sdk/src/types.ts"
import type { ProvenStats, SearchAdapter } from "./types.ts"

export function provenStats(reviews: Review[]): Map<number, ProvenStats> {
  const by = new Map<number, Review[]>()
  for (const r of reviews) by.set(r.merchant, [...(by.get(r.merchant) ?? []), r])
  const out = new Map<number, ProvenStats>()
  for (const [m, rs] of by) {
    const verified = rs.filter((r) => r.verified).length
    const w = rs.reduce((a, r) => a + (r.verified ? VERIFIED_WEIGHT : 1), 0)
    const wr = rs.reduce((a, r) => a + (r.verified ? VERIFIED_WEIGHT : 1) * r.rating, 0)
    out.set(m, { score: (PRIOR_WEIGHT * PRIOR_MEAN + wr) / (PRIOR_WEIGHT + w), avg: rs.reduce((a, r) => a + r.rating, 0) / rs.length, proven: rs.length, verified })
  }
  return out
}

const noun = (kind: string, n: number) => (kind === "hotel" ? "proven stay" : kind === "shop" ? "proven purchase" : "proven visit") + (n === 1 ? "" : "s")

export async function federatedSearch(text: string, adapters: SearchAdapter[], merchants: Merchant[], reviews: Review[]): Promise<SearchResponse> {
  const q = parseQuery(text)
  const stats = provenStats(reviews)
  const ctx = { proven: (id: number) => stats.get(id) }
  const sources: SearchResponse["sources"] = []
  const hits: Omit<SearchResult, "score" | "reason">[] = []
  await Promise.all(
    adapters.map(async (a) => {
      if (!a.enabled) return void sources.push({ id: a.id, status: "disabled", count: 0 })
      try {
        const r = await a.search(q, ctx)
        hits.push(...r)
        sources.push({ id: a.id, status: "ok", count: r.length })
      } catch {
        sources.push({ id: a.id, status: "error", count: 0 })
      }
    }),
  )
  void merchants
  const results: SearchResult[] = hits.map((h) => {
    const s = h.merchantId !== null ? stats.get(h.merchantId) : undefined
    const reason = s ? `${s.avg!.toFixed(1)} from ${s.proven} ${noun(h.kind, s.proven)}${s.verified ? `, ${s.verified} verified` : ""}` : "no proven reviews yet"
    return { ...h, score: s?.score ?? 0, reason }
  })
  results.sort((a, b) => {
    const ar = a.reviewCount > 0, br = b.reviewCount > 0
    if (ar !== br) return ar ? -1 : 1
    return b.score - a.score || b.reviewCount - a.reviewCount || a.price - b.price
  })
  return { query: text, parsed: { kind: q.kind ?? null, maxPrice: q.maxPrice ?? null, terms: text.toLowerCase().split(/\s+/).filter(Boolean) }, results, sources: sources.sort((a, b) => a.id.localeCompare(b.id)) }
}
