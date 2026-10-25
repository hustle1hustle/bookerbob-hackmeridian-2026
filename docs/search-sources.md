# Search sources (Ask Bob)

Ask Bob is one search box over several sources. Each source is an adapter in `server/src/search/`, behind one interface, enabled by config. Results are ranked by **proven reviews only** (Bayesian average of on-chain ratings, arbiter-verified stays weigh double); a source without proofs shows "no proven reviews yet" and ranks after proven results. There is no paid placement.

## Endpoint

`GET /api/search?q=<free text>` returns `SearchResponse` (`packages/sdk/src/types.ts`):

```ts
{ query, parsed: { kind, maxPrice, terms }, results: SearchResult[], sources: [{ id, status: "ok" | "error" | "disabled", count }] }
SearchResult = { source, merchantId, title, kind, price, currency: "USDC", url, imageUrl,
                 provenRating, reviewCount, verifiedCount, score, reason, extra? }
```

Parsing is deliberately simple (no LLM): a kind word (hotel, café/coffee, restaurant/dinner, shop/t-shirt) and a price cap ("under 120", "50 usdc").

## Adapter interface

```ts
interface SearchAdapter {
  id: string
  enabled: boolean
  search(q: Query, ctx: SourceContext): Promise<Omit<SearchResult, "score" | "reason">[]>
}
// ctx.proven(merchantId) -> { score, avg, proven, verified } from the contract
```

An adapter returns hits; if a hit maps to a merchant in the contract (`merchantId`), its proven rating and perks come from the chain, whatever the source.

## Sources

| id | file | enabled by | what it returns |
|---|---|---|---|
| `places` | `places.ts` | always | merchants in the contract (hotels, cafés, restaurants, shops), minus those served by UCP |
| `ucp` | `ucp.ts` | `UCP_BRIDGE_URL` (default the BookerBob UCP bridge) | products from merchants selling over UCP; `extra` carries productId, variantId, store price |
| `jmpr` | `jmpr.ts` | `JMPR_ENABLED=1` | stub today: real hotels and sandbox bookings from JMPR; implementing it is this one file |

Adding a source: one file exporting a `SearchAdapter`, one line in `server/src/index.ts`, one env flag.
