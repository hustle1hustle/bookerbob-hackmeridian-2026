// Places adapter: merchants registered in the proof_of_stay contract (hotels, cafés, restaurants, shops).
// Shops that sell through UCP are listed by the ucp adapter, so they are skipped here.
import type { SearchAdapter } from "./types.ts"
import type { Merchant } from "../../../packages/sdk/src/types.ts"

export function placesAdapter(load: () => Promise<Merchant[]>, ucpMerchants: Set<number>): SearchAdapter {
  return {
    id: "places",
    enabled: true,
    async search(q, ctx) {
      const all = await load()
      return all
        .filter((m) => !ucpMerchants.has(m.id))
        .filter((m) => (q.kind ? m.kind === q.kind : true))
        .filter((m) => (q.maxPrice !== undefined ? Number(m.price) / 1e7 <= q.maxPrice : true))
        .map((m) => {
          const p = ctx.proven(m.id)
          return {
            source: "places",
            merchantId: m.id,
            title: m.name,
            kind: m.kind,
            price: Number(m.price) / 1e7,
            currency: "USDC" as const,
            url: null,
            imageUrl: null,
            provenRating: p?.avg ?? null,
            reviewCount: p?.proven ?? 0,
            verifiedCount: p?.verified ?? 0,
          }
        })
    },
  }
}
