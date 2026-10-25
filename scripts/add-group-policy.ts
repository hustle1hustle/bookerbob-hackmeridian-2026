// Adds a context group to some places' discount policies, signed by each place's admin key (stellar-cli keystore).
// Usage: GROUP=2 BPS=500 PLACES=0:hotel1,1:hotel2,3:cafe1 node scripts/add-group-policy.ts
import { execFileSync } from "node:child_process"
import { Keypair } from "@stellar/stellar-sdk"
import { getClient, write, views, TESTNET } from "../packages/sdk/src/contract.ts"
import { signerOf } from "../server/src/core.ts"
import { contractId } from "../packages/sdk/src/deployment.ts"

const GROUP = Number(process.env.GROUP), BPS = Number(process.env.BPS ?? 500)
const places = (process.env.PLACES ?? "").split(",").filter(Boolean).map((p) => p.split(":") as [string, string])
const net = { ...TESTNET, contractId: contractId() }
const key = (a: string) => Keypair.fromSecret(execFileSync("stellar", ["keys", "secret", a], { encoding: "utf8" }).trim())
const ref = (g: { kind: string; id: number }) => ({ tag: g.kind === "merchant" ? "Merchant" : "Group", values: [g.id] })
const read = await getClient(net)
for (const [mid, alias] of places) {
  const m = Number(mid)
  const pol = await views.policy(read, m)
  if (!pol) throw new Error(`place ${m} has no policy`)
  if (pol.items.some((i) => i.group.kind === "group" && i.group.id === GROUP)) { console.log(m, "already has group", GROUP); continue }
  const items = [...pol.items.map((i) => ({ group: ref(i.group), bps: i.bps })), { group: { tag: "Group", values: [GROUP] }, bps: BPS }]
  const r = await write(await getClient(net, signerOf(key(alias), net.networkPassphrase)), "set_policy", { merchant: m, policy: { items, max_bps: pol.maxBps } })
  console.log(m, r.ok ? r.txHash : (r as any).error)
}
process.exit(0)
