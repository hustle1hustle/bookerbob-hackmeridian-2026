// Second wave of fictional places so every demo query (docs/demo-queries.md) returns 3+ results.
// Same real cycle as scripts/seed.ts: register, check stays in, prove and post reviews through the relayer,
// join the BookerBob network and set perks. Admin keys reuse the demo desk keys (hotel1..3, cafe1, shop1),
// so the deployed demo desk can check guests in without new secrets. Texts go into the seed file.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { Keypair } from "@stellar/stellar-sdk"
import { Ops, signerOf } from "../server/src/core.ts"
import { getClient, write, views, TESTNET } from "../packages/sdk/src/contract.ts"
import { contractId } from "../packages/sdk/src/deployment.ts"
import * as d from "../packages/sdk/src/derive.ts"
import { loadArtifacts, proveMembership } from "../packages/sdk/src/prove.ts"

const net = { ...TESTNET, contractId: contractId() }
const key = (a: string) => Keypair.fromSecret(execFileSync("stellar", ["keys", "secret", a], { encoding: "utf8" }).trim())
const master = readFileSync(".env", "utf8").match(/^SEED_MASTER=(.+)$/m)![1]
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const must = <T>(label: string, r: any): T => {
  if (!r.ok) throw new Error(`${label}: ${r.error} ${r.message}`)
  log(label, r.txHash)
  return r.value as T
}
const U = 10_000_000n
type R = [1 | 2 | 3 | 4 | 5, string, boolean?]
const places: { kind: string; name: string; admin: string; price: bigint; bps: number; stays: number; reviews: R[]; network: boolean }[] = [
  { kind: "hotel", name: "Alfama Sleep Rooms", admin: "hotel1", price: 70n * U, bps: 1000, stays: 6, network: true, reviews: [[4, "simple, spotless, and the window opens onto the river"], [5, "best value in Alfama, quiet at night"], [3, "small room, thin walls on the street side"], [4, "friendly night porter, kept my bag after checkout"]] },
  { kind: "hotel", name: "Graça Hill Hostel", admin: "hotel2", price: 45n * U, bps: 1000, stays: 6, network: true, reviews: [[4, "private room with a view of the castle for hostel money"], [4, "clean shared kitchen, good wifi"], [3, "steep climb from the metro, worth it for the view"]] },
  { kind: "hotel", name: "Belém Garden Inn", admin: "hotel3", price: 120n * U, bps: 1500, stays: 5, network: true, reviews: [[5, "garden breakfast, five minutes from the monastery"], [4, "calm part of town, tram to the centre is easy"], [5, "they lent us bikes for the riverside path", true]] },
  { kind: "hotel", name: "Chiado Townhouse", admin: "hotel1", price: 180n * U, bps: 1000, stays: 4, network: true, reviews: [[5, "high ceilings, real books, perfect location"], [4, "pricey but every detail is thought through"]] },
  { kind: "cafe", name: "Torra Coffee Lab", admin: "cafe1", price: 5n * U, bps: 2000, stays: 6, network: true, reviews: [[5, "they weigh every shot, the filter is excellent"], [4, "great beans to take home, few seats"], [5, "the barista explained three origins without a hint of snobbery"]] },
  { kind: "cafe", name: "Pastelaria Nove", admin: "cafe1", price: 3n * U, bps: 2500, stays: 5, network: true, reviews: [[4, "custard tarts still warm at 8am"], [3, "busy and loud, the coffee is fine"], [4, "cheap, fast, exactly what a pastelaria should be"]] },
  { kind: "restaurant", name: "Tasca do Rio", admin: "cafe1", price: 25n * U, bps: 1000, stays: 6, network: true, reviews: [[5, "grilled sardines and a jug of house wine, perfect"], [4, "no menu, the owner tells you what is good today"], [4, "small and loud in the best way"]] },
  { kind: "restaurant", name: "Mesa Atlântica", admin: "cafe1", price: 45n * U, bps: 1000, stays: 5, network: true, reviews: [[5, "the octopus rice is worth the wait", true], [4, "attentive service, a bit slow on a full night"]] },
  { kind: "restaurant", name: "Peixe & Brasa", admin: "cafe1", price: 35n * U, bps: 1000, stays: 4, network: false, reviews: [[4, "fresh fish, you pick it from the counter"], [3, "good food, plastic chairs, long queue"]] },
  { kind: "shop", name: "Azul Print Studio", admin: "shop1", price: 28n * U, bps: 1000, stays: 4, network: false, reviews: [[5, "screen-printed tee, the ink has survived ten washes"], [4, "nice prints of the city, sizes run small"]] },
]

const ops = new Ops(net, { relayer: key("relayer"), arbiter: key("arbiter"), usdcIssuer: key("usdc-issuer"), merchantAdmins: new Map() })
const read = await getClient(net)
const artifacts = await loadArtifacts()
const seedFile = `server/data/seed-${net.contractId}.json`
const db = existsSync(seedFile) ? JSON.parse(readFileSync(seedFile, "utf8")) : { reviews: {}, disputes: [] }
const chainGroup = 0, attGroup = 1
const G = (id: number) => ({ tag: "Group", values: [id] })
const M = (id: number) => ({ tag: "Merchant", values: [id] })

for (const p of places) {
  const admin = key(p.admin)
  const ac = await getClient(net, signerOf(admin, net.networkPassphrase))
  const mid = Number(must(`register ${p.name}`, await write(ac, "register_merchant", { admin: admin.publicKey(), kind: p.kind, name: p.name, price: p.price, discount_bps: p.bps })))
  if (p.network) {
    const chainAdmin = key("chain-admin")
    const tx = await (ac as any).join_chain({ group: chainGroup, merchant: mid })
    await tx.signAuthEntries({ address: chainAdmin.publicKey(), signAuthEntry: signerOf(chainAdmin, net.networkPassphrase).signAuthEntry })
    log("join_chain", mid, (await tx.signAndSend()).sendTransactionResponse?.hash)
    must(`policy ${mid}`, await write(ac, "set_policy", { merchant: mid, policy: { items: [{ group: M(mid), bps: 1000 }, { group: G(chainGroup), bps: 500 }, { group: G(attGroup), bps: 500 }], max_bps: 1500 } }))
  }
  const ident = (i: number) => d.stayIdentity(`${master}:m${mid}:${i}`, mid, 0)
  for (let i = 0; i < p.stays; i++) must(`checkout ${mid}`, await write(ac, "checkout", { merchant: mid, id_commitment: ident(i).commitment }))
  const leaves = await views.leaves(read, mid)
  for (const [i, [rating, text, attest]] of p.reviews.entries()) {
    const commit = d.disclosureCommit(d.stayDisclosureKey(`${master}:m${mid}:${i}`, mid, 0))
    const mp = await proveMembership(ident(i), leaves, d.reviewMessage(rating, d.contentHash(text), commit), d.reviewScope(mid), artifacts)
    const r: any = await ops.postReview({ merchant: mid, rating, text, disclosureCommit: commit, proof: mp.proof, root: mp.root, nullifier: mp.nullifier })
    const id = Number(must(`review ${mid}`, r))
    db.reviews[id] = { text, txHash: r.txHash, time: Date.now() }
    if (attest) {
      const a: any = await ops.attest(id)
      must(`attest ${id}`, a)
      db.disputes.push({ id, merchant: mid, openedAt: Date.now(), attestTx: a.txHash })
    }
  }
  writeFileSync(seedFile, JSON.stringify(db, null, 2))
}
log("done", await views.merchantCount(read), "places")
process.exit(0)
