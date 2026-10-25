// Search source adapters (docs/search-sources.md). One file per source, one env flag to enable it.
import type { SearchResult } from "../../../packages/sdk/src/types.ts"
import type { Query } from "../../../agent/src/rank.ts"

/** Proven-review stats for an on-chain merchant, shared by every adapter whose hits map to a merchant. */
export interface ProvenStats {
  score: number | null
  avg: number | null
  proven: number
  verified: number
}

export interface SourceContext {
  /** Bayesian score and counts from the contract, by merchant id. */
  proven(merchantId: number): ProvenStats | undefined
}

export interface SearchAdapter {
  id: string
  enabled: boolean
  search(q: Query, ctx: SourceContext): Promise<Omit<SearchResult, "score" | "reason">[]>
}
