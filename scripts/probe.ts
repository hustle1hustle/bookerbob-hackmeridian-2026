// Quick read of the deployed contract through the SDK layer.
import { getClient, views, TESTNET } from "../packages/sdk/src/contract.ts"
const c = await getClient({ ...TESTNET, contractId: process.env.CONTRACT ?? (await import("../packages/sdk/src/deployment.ts")).contractId() })
console.log({ count: await views.merchantCount(c), arbiter: await views.arbiter(c), usdc: await views.usdc(c) })
