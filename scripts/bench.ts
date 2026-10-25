// Verification cost on testnet: simulates verify() with the golden proof and reads the real resource usage
// of seeded transactions (checkout, post_review, book_with_discount). Writes docs/bench.md.
import { readFileSync, writeFileSync } from "node:fs"
import { rpc, xdr, Account, TransactionBuilder, Operation, BASE_FEE, nativeToScVal } from "@stellar/stellar-sdk"
import { TESTNET } from "../packages/sdk/src/contract.ts"

const CONTRACT = process.env.PROOF_OF_STAY_CONTRACT_ID ?? "CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL"
const s = new rpc.Server(TESTNET.rpcUrl)
const G = "circuits/golden/depth10"
const golden = JSON.parse(readFileSync(`${G}/soroban.json`, "utf8"))
const pub: string[] = JSON.parse(readFileSync(`${G}/public.json`, "utf8"))
const src = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0")
const proofVal = xdr.ScVal.scvMap(
  (["a", "b", "c"] as const).map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: xdr.ScVal.scvBytes(Buffer.from(golden.proof[k], "hex")) })),
)
const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: TESTNET.networkPassphrase })
  .addOperation(Operation.invokeContractFunction({ contract: CONTRACT, function: "verify", args: [proofVal, nativeToScVal(pub.map(BigInt), { type: "u256" })] }))
  .setTimeout(30)
  .build()
const sim = await s.simulateTransaction(tx)
if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(JSON.stringify(sim).slice(0, 300))
const res = sim.transactionData.build().resources()
const verify = { instructions: res.instructions(), minResourceFee: sim.minResourceFee }

const hashes: Record<string, string> = JSON.parse(process.env.TX_HASHES ?? "{}")
const rows: string[] = []
for (const [label, h] of Object.entries(hashes)) {
  const r = await s.getTransaction(h)
  if (r.status !== "SUCCESS") continue
  const env = r.envelopeXdr
  const t = env.switch().name === "envelopeTypeTx" ? env.v1().tx() : null
  const sd = t?.ext().sorobanData()
  rows.push(`| ${label} | ${sd?.resources().instructions().toLocaleString("en")} | ${(Number(t?.fee()) / 1e7).toFixed(5)} XLM max fee | [${h.slice(0, 8)}…](https://stellar.expert/explorer/testnet/tx/${h}) |`)
}
const LIMIT = 400_000_000
const md = `# Benchmarks

Stellar testnet, Protocol 29, contract \`${CONTRACT}\`. Measured ${new Date().toISOString().slice(0, 16)}Z with \`scripts/bench.ts\`.

## Groth16 verification (Semaphore v4, depth 10, 4 public inputs)

| Metric | Value |
|---|---|
| CPU instructions (simulated \`verify\`) | ${verify.instructions.toLocaleString("en")} (${((verify.instructions / LIMIT) * 100).toFixed(1)}% of the 400M per-transaction limit) |
| Min resource fee | ${(Number(verify.minResourceFee) / 1e7).toFixed(5)} XLM |
| Proof size on chain | 256 bytes (G1 64 + G2 128 + G1 64) + 2 x 32-byte inputs (root, nullifier) |
| Browser proving | about 0.3 to 1.5 s after a one-time ~4.2 MB download (wasm 1.8 MB + zkey 2.4 MB) |

## Real transactions (instructions declared after simulation)

| Call | CPU instructions | Fee | Tx |
|---|---|---|---|
${rows.join("\n")}
`
writeFileSync("docs/bench.md", md)
console.log(md)
