// Mints test USDC from our testnet issuer: node scripts/mint.ts <amountUSDC> <address>...
import { execFileSync } from "node:child_process"
import { Keypair } from "@stellar/stellar-sdk"
import { Ops } from "../server/src/core.ts"
import { TESTNET } from "../packages/sdk/src/contract.ts"
const [amount, ...addrs] = process.argv.slice(2)
const key = (a: string) => Keypair.fromSecret(execFileSync("stellar", ["keys", "secret", a], { encoding: "utf8" }).trim())
const ops = new Ops({ ...TESTNET, contractId: process.env.PROOF_OF_STAY_CONTRACT_ID ?? "CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL" }, { relayer: key("relayer"), arbiter: key("arbiter"), usdcIssuer: key("usdc-issuer"), merchantAdmins: new Map() })
for (const a of addrs) console.log(a, await ops.mintUsdc(a, BigInt(amount) * 10_000_000n))
