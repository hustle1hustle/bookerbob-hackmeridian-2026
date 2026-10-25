// Seeds context groups on the upgraded contract: a chain group (BookerBob Lisbon network: hotels + café),
// an attested group (REP verified traveler, its own attester key), discount policies, and one stacked
// booking: guest1 never stayed at Pátio do Vento but gets network + verified traveler, one tx.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { Keypair } from "@stellar/stellar-sdk"
import { getClient, write, views, proofArg, TESTNET } from "../packages/sdk/src/contract.ts"
import { signerOf } from "../server/src/core.ts"
import { contractId } from "../packages/sdk/src/deployment.ts"
import * as d from "../packages/sdk/src/derive.ts"
import { loadArtifacts, proveMembership } from "../packages/sdk/src/prove.ts"

const net = { ...TESTNET, contractId: contractId() }
const key = (a: string) => Keypair.fromSecret(execFileSync("stellar", ["keys", "secret", a], { encoding: "utf8" }).trim())
const as = (a: string) => getClient(net, signerOf(key(a), net.networkPassphrase))
const master = readFileSync(".env", "utf8").match(/^SEED_MASTER=(.+)$/m)![1]
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const must = <T>(label: string, r: any): T => {
  if (!r.ok) throw new Error(`${label}: ${r.error} ${r.message}`)
  log(label, r.txHash)
  return r.value as T
}
const G = (id: number) => ({ tag: "Group", values: [id] })
const M = (id: number) => ({ tag: "Merchant", values: [id] })

const CHAIN_MERCHANTS = [0, 1, 2, 3] // three hotels + the café
const STAYS: Record<number, number> = { 0: 10, 1: 8, 2: 7, 3: 6 }
const ident = (p: number, i: number) => d.stayIdentity(`${master}:${p}:${i}`, p, 0)
const guest = key("guest1")
const guestStay = d.stayIdentity(`${master}:guest1`, 0, 0)

const read = await getClient(net)
if ((await views.merchantCount(read)) < 5) throw new Error("seed the places first")
const admin = await as("deployer")
let chain = 0, att = 1
if (Number((await (await (read as any).group_count()).result)) === 0) {
  chain = Number(must("group chain", await write(admin, "create_group", { kind: "chain", operator: key("chain-admin").publicKey(), name: "BookerBob Lisbon network" })))
  att = Number(must("group attested", await write(admin, "create_group", { kind: "attested", operator: key("rep-attester").publicKey(), name: "REP verified traveler" })))
}

// join_chain needs the chain admin and the merchant admin: sign with both via a multi-signer client
const admins = ["hotel1", "hotel2", "hotel3", "cafe1"]
for (const m of CHAIN_MERCHANTS) {
  const both = key("chain-admin")
  const mk = key(admins[m])
  const c = await getClient(net, signerOf(mk, net.networkPassphrase))
  const tx = await (c as any).join_chain({ group: chain, merchant: m })
  await tx.signAuthEntries({ address: both.publicKey(), signAuthEntry: signerOf(both, net.networkPassphrase).signAuthEntry })
  const sent = await tx.signAndSend()
  log("join_chain", m, sent.sendTransactionResponse?.hash)
}

// backfill the chain group with stays checked in before the merchants joined
const ca = await as("chain-admin")
const backfill = [...CHAIN_MERCHANTS.flatMap((m) => Array.from({ length: STAYS[m] }, (_, i) => ident(m, i).commitment)), guestStay.commitment]
for (const cm of backfill) must("chain member", await write(ca, "add_member", { group: chain, id_commitment: cm }))

// REP verified travelers (attested off chain by the provider; here the demo attester key)
const ra = await as("rep-attester")
for (const cm of [guestStay.commitment, ident(1, 2).commitment, ident(2, 1).commitment, ident(0, 4).commitment])
  must("verified traveler", await write(ra, "add_member", { group: att, id_commitment: cm }))

// policies: returning -10%, network -5%, verified traveler -5%, max -15%
for (const [m, a] of [[0, "hotel1"], [1, "hotel2"], [3, "cafe1"]] as const)
  must(`policy ${m}`, await write(await as(a), "set_policy", { merchant: m, policy: { items: [{ group: M(m), bps: 1000 }, { group: G(chain), bps: 500 }, { group: G(att), bps: 500 }], max_bps: 1500 } }))

// stacked booking at Pátio do Vento (merchant 1): network + verified traveler, no past stay there
const artifacts = await loadArtifacts()
const SEASON = 1
const msg = d.discountMessage(guest.publicKey())
const claims = []
for (const [gid, leaves] of [[chain, await views.groupLeaves(read, chain)], [att, await views.groupLeaves(read, att)]] as const) {
  const p = await proveMembership(guestStay, leaves, msg, d.ctxScope(1, { kind: "group", id: gid }, SEASON), artifacts)
  claims.push({ group: G(gid), proof: proofArg(p.proof), root: p.root, nullifier: p.nullifier })
}
const paid = must("book_with_context", await write(await getClient(net, signerOf(guest, net.networkPassphrase)), "book_with_context", { merchant: 1, guest: guest.publicKey(), season: SEASON, amount: undefined, claims }))
log("paid", paid, "of 95 USDC list price")
process.exit(0)
