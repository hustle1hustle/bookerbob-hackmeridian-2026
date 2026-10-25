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
import { createTestnetSdk, type TestnetOptions } from "./testnet.ts"
export { createTestnetSdk } from "./testnet.ts"
export type { TestnetOptions } from "./testnet.ts"

export interface SdkConfig {
  mode: "mock" | "testnet"
  mock?: MockOptions
  /** testnet only */
  testnet?: TestnetOptions
}

export function createSdk(cfg: SdkConfig): Sdk {
  if (cfg.mode === "mock") return createMockSdk(cfg.mock)
  return createTestnetSdk(cfg.testnet)
}
