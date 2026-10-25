// Quick read of the deployed contract through the SDK layer.
import { getClient, views, TESTNET } from "../packages/sdk/src/contract.ts"
const c = await getClient({ ...TESTNET, contractId: process.env.CONTRACT ?? "CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL" })
console.log({ count: await views.merchantCount(c), arbiter: await views.arbiter(c), usdc: await views.usdc(c) })
