// Proof of Stay SDK entry. The app imports only from here.
//   import { createSdk } from "@bookerbob/pos-sdk"
//   const sdk = createSdk({ mode: "mock" })      // today
//   const sdk = createSdk({ mode: "testnet" })   // same types, real chain
export * from "./types.ts"
export { createMockSdk } from "./mock.ts"
export type { MockOptions } from "./mock.ts"
export { fixtureMerchants, fixtureReviews } from "./fixtures.ts"

import type { Sdk } from "./types.ts"
import { createMockSdk, type MockOptions } from "./mock.ts"

export interface SdkConfig {
  mode: "mock" | "testnet"
  mock?: MockOptions
  /** testnet only */
  rpcUrl?: string
  contractId?: string
}

export function createSdk(cfg: SdkConfig): Sdk {
  if (cfg.mode === "mock") return createMockSdk(cfg.mock)
  throw new Error("testnet SDK lands at the 22:00 sync point; use mode: 'mock' until then")
}
