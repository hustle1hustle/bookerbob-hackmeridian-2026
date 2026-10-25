// UCP adapter: merchants selling over the Universal Commerce Protocol through the BookerBob UCP bridge.
// Enabled when UCP_BRIDGE_URL is set. Proven ratings come from the merchant's tree in our contract.
import type { SearchAdapter } from "./types.ts"

export function ucpAdapter(bridge: string | undefined): SearchAdapter {
  return {
    id: "ucp",
    enabled: !!bridge,
    async search(q, ctx) {
      const url = new URL("/search", bridge)
      // the bridge matches product words, so drop price phrases and filler
      const words = q.text
        .replace(/(?:under|below|max(?:imum)?|less than|up to|cheaper than|<=?)\s*\$?\s*\d+(?:[.,]\d+)?\s*(?:usdc|usd|\$|eur|€)?/gi, " ")
        .replace(/\d+(?:[.,]\d+)?\s*(?:usdc|usd|\$|eur|€)/gi, " ")
        .replace(/\b(a|an|the|in|for|me|some|nearby|near|cheap|buy|find|lisbon|please)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
      url.searchParams.set("q", words)
      if (q.maxPrice !== undefined) url.searchParams.set("max_price", String(q.maxPrice))
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (!r.ok) throw new Error(`ucp bridge ${r.status}`)
      const items = (await r.json()) as any[]
      return items
        .filter((it) => (q.kind ? (it.kind ?? "shop") === q.kind : true))
        .filter((it) => (q.maxPrice !== undefined ? Number(it.price) <= q.maxPrice : true))
        .map((it) => {
          const p = typeof it.merchantId === "number" ? ctx.proven(it.merchantId) : undefined
          const { source: _s, merchantId, title, kind, price, currency: _c, url: link, imageUrl, provenRating: _p, reviewCount: _r, verifiedCount: _v, ...extra } = it
          return {
            source: "ucp",
            merchantId: typeof merchantId === "number" ? merchantId : null,
            title: String(title),
            kind: String(kind ?? "shop"),
            price: Number(price),
            currency: "USDC" as const,
            url: link ?? null,
            imageUrl: imageUrl ?? null,
            provenRating: p?.avg ?? null,
            reviewCount: p?.proven ?? 0,
            verifiedCount: p?.verified ?? 0,
            extra,
          }
        })
    },
  }
}
