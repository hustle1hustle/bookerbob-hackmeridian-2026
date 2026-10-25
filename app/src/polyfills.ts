// Browser polyfills the testnet SDK needs. Imported first in main.tsx.
// packages/sdk/src/contract.ts uses Node's Buffer (proof args, bytes32 args, hex views); browsers have none.
import { Buffer } from "buffer"

const g = globalThis as unknown as { Buffer?: typeof Buffer }
g.Buffer ??= Buffer
