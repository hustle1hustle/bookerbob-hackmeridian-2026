// Join transactions for a pass, from the contract's own events: "checkout" (merchant tree; a chain member is
// enrolled by the same tx) and "member" (attested/chain group add_member). Used when the browser has no saved tx.
import { rpc, scValToNative, xdr, nativeToScVal } from "@stellar/stellar-sdk"

type Hit = { txHash: string; ledger: number }
const cache = new Map<string, Hit | null>()

export async function findJoinTx(rpcUrl: string, contractId: string, kind: "checkout" | "member", id: number, commitment: string, fromLedger: number): Promise<Hit | null> {
  const key = `${kind}:${id}:${commitment}`
  if (cache.has(key)) return cache.get(key)!
  const s = new rpc.Server(rpcUrl)
  // scan from the contract's deploy ledger (config/testnet.json), bounded in time
  const startLedger = fromLedger
  const deadline = Date.now() + 8000
  const topic = [xdr.ScVal.scvSymbol(kind).toXDR("base64"), nativeToScVal(id, { type: "u32" }).toXDR("base64")]
  let cursor: string | undefined
  for (let page = 0; page < 40 && Date.now() < deadline; page++) {
    const r: any = await s.getEvents(
      cursor
        ? { filters: [{ type: "contract", contractIds: [contractId], topics: [topic] }], cursor, limit: 200 }
        : { filters: [{ type: "contract", contractIds: [contractId], topics: [topic] }], startLedger, limit: 200 },
    )
    for (const ev of r.events ?? []) {
      const data = scValToNative(ev.value)
      const cm = Array.isArray(data) ? String(data[0]) : String(data)
      if (cm === commitment) {
        const hit = { txHash: ev.txHash, ledger: ev.ledger }
        cache.set(key, hit)
        return hit
      }
    }
    if (!r.cursor || (r.events ?? []).length < 200) break
    cursor = r.cursor
  }
  if (Date.now() < deadline) cache.set(key, null) // only remember a definite miss
  return null
}
