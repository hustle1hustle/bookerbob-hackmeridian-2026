// Pre-makes fresh payer accounts (friendbot XLM + USDC trustline) for when no faucet API is up.
// Secrets go to agent/.payers.json (gitignored); prints addresses only.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { Asset, BASE_FEE, Keypair, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk"
import { NET } from "../src/core.ts"
const N = Number(process.argv[2] ?? 4)
const FILE = "agent/.payers.json"
const pool: string[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []
const s = new rpc.Server(NET.rpcUrl)
for (let i = 0; i < N; i++) {
  const kp = Keypair.random()
  await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`)
  const acct = await s.getAccount(kp.publicKey())
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NET.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", process.env.USDC_ISSUER!) })).setTimeout(60).build()
  tx.sign(kp)
  const sent = await s.sendTransaction(tx)
  for (let j = 0; j < 30 && (await s.getTransaction(sent.hash)).status === "NOT_FOUND"; j++) await new Promise((ok) => setTimeout(ok, 1000))
  pool.push(kp.secret())
  console.log(kp.publicKey())
}
writeFileSync(FILE, JSON.stringify(pool), { mode: 0o600 })
