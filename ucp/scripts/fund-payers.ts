// Funds every pre-made payer through the core backend's test USDC faucet.
import { readFileSync } from "node:fs"
import { Keypair } from "@stellar/stellar-sdk"
const api = (process.env.CORE_API_URL ?? "").replace(/\/$/, "")
for (const s of JSON.parse(readFileSync("agent/.payers.json", "utf8")) as string[]) {
  const a = Keypair.fromSecret(s).publicKey()
  const r: any = await (await fetch(`${api}/api/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: a }) })).json()
  console.log(a.slice(0, 8), r.txHash ? `ok ${r.txHash.slice(0, 10)}` : JSON.stringify(r))
}
