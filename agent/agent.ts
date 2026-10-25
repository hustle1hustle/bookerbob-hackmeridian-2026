// The buyer's agent. It knows only the store's domain-level UCP endpoint, the buyer's local
// master secret, and Stellar testnet. Per purchase it uses a fresh payer account and a fresh
// customer identity, so the store cannot link this purchase to an earlier one.
//   npm run agent -- [--bridge http://localhost:8787] [--query tee] [--fresh]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
mkdirSync("evidence", { recursive: true })
import { randomBytes, randomUUID } from "node:crypto"
import { Asset, BASE_FEE, Keypair, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk"
import { NET, MERCHANT, bookWithDiscount, book, discountMessage, discountScope, leaves, loadArtifacts, proveMembership, stayIdentity } from "../src/core.ts"

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const BRIDGE = arg("bridge", process.env.UCP_BRIDGE_URL ?? "http://localhost:8787")!
const QUERY = arg("query", "tee")!
const FAUCET = process.env.CORE_API_URL ? `${process.env.CORE_API_URL.replace(/\/$/, "")}/api/faucet` : null
const NS = "com.bookerbob.patronage"
const WALLET = "agent/.buyer.json"
const PAYERS = "agent/.payers.json"

const t0 = Date.now()
const say = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${s}`)

// ---- buyer's local wallet: a master secret and how many purchases it made per merchant ----
interface Wallet { master: string; purchases: Record<string, number> }
function wallet(): Wallet {
  if (existsSync(WALLET) && !process.argv.includes("--fresh")) return JSON.parse(readFileSync(WALLET, "utf8"))
  const w = { master: randomBytes(32).toString("hex"), purchases: {} }
  mkdirSync("agent", { recursive: true })
  writeFileSync(WALLET, JSON.stringify(w), { mode: 0o600 })
  return w
}

// ---- UCP over MCP ----
let rpcId = 0
async function ucp(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${BRIDGE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: { meta: { "ucp-agent": { profile: "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json" } }, ...args } } }),
  })
  const j: any = await res.json()
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  const r = j.result
  if (r?.isError) throw new Error(`${name}: ${r.content?.[0]?.text}`)
  return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}")
}

// ---- Stellar payer: fresh account, test USDC from the core faucet ----
async function freshPayer(usdcIssuer: string): Promise<Keypair> {
  // Without a faucet API: take one of the pre-made, pre-funded payers (scripts/make-payers.ts).
  if (!FAUCET) {
    const pool: string[] = existsSync(PAYERS) ? JSON.parse(readFileSync(PAYERS, "utf8")) : []
    const secret = pool.shift()
    if (!secret) throw new Error("no faucet (CORE_API_URL) and no pre-made payers left: run scripts/make-payers.ts and fund them")
    writeFileSync(PAYERS, JSON.stringify(pool), { mode: 0o600 })
    return Keypair.fromSecret(secret)
  }
  const kp = Keypair.random()
  await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`)
  const s = new rpc.Server(NET.rpcUrl)
  const acct = await s.getAccount(kp.publicKey())
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NET.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", usdcIssuer) }))
    .setTimeout(60)
    .build()
  tx.sign(kp)
  const sent = await s.sendTransaction(tx)
  for (let i = 0; i < 30; i++) {
    const g = await s.getTransaction(sent.hash)
    if (g.status === "SUCCESS") break
    if (g.status === "FAILED") throw new Error("trustline failed")
    await new Promise((ok) => setTimeout(ok, 1000))
  }
  if (!FAUCET) throw new Error("set CORE_API_URL (core backend with /api/faucet) to fund the payer with test USDC")
  const f: any = await (await fetch(FAUCET, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: kp.publicKey() }) })).json()
  if (f.error) throw new Error(`faucet: ${f.error}`)
  return kp
}

const money = (minor: number, cur = "AED") => `${(minor / 100).toFixed(2)} ${cur}`
const usdc = (raw: bigint | string) => `${(Number(raw) / 1e7).toFixed(2)} USDC`

async function main() {
  const w = wallet()
  const key = String(MERCHANT)

  // 1. discover the store's UCP surface
  const profile: any = await (await fetch(`${BRIDGE}/.well-known/ucp`)).json()
  const ext = profile.ucp.capabilities[NS]?.[0]
  const handler = profile.ucp.payment_handlers?.["com.bookerbob.stellar_usdc"]?.[0]
  say(`store profile: ${Object.keys(profile.ucp.capabilities).length} capabilities, patronage ${ext ? "yes" : "no"}, Stellar USDC ${handler ? "yes" : "no"}`)
  if (!ext || !handler) throw new Error("this store does not take patronage proofs or Stellar USDC")

  // 2. find the item
  const found: any = await ucp("search_catalog", { catalog: { query: QUERY } })
  const product = (found.products ?? found.offers ?? [])[0]
  const variant = product?.variants?.[0]
  if (!variant) throw new Error(`no product for "${QUERY}": ${JSON.stringify(found).slice(0, 300)}`)
  say(`found "${product.title}" ${variant.price ? money(variant.price.amount ?? variant.price) : ""}`)

  // 3. does the buyer have a past purchase here? Check its local identities against the chain.
  const tree = await leaves()
  const made = w.purchases[key] ?? 0
  const past = [...Array(made).keys()].map((i) => stayIdentity(w.master, MERCHANT, i)).filter((id) => tree.includes(id.commitment))
  const returning = past.length > 0
  const next = stayIdentity(w.master, MERCHANT, made)
  say(returning ? `buyer has ${past.length} past purchase(s) here, will claim the returning-customer discount` : "no past purchase here, full price; this purchase joins the store's customer tree")

  // 4. fresh payer for this purchase only
  const payer = await freshPayer(handler.config.asset.issuer)
  say(`fresh payer ${payer.publicKey().slice(0, 6)}… funded with test USDC`)

  // 5. checkout, with the claim
  const line_items = [{ item: { id: variant.id }, quantity: 1 }]
  let co = await ucp("create_checkout", {
    checkout: { line_items, buyer: { email: "buyer@example.com" }, context: { address_country: "PT", ...(returning ? { eligibility: [NS] } : {}) }, [NS]: { next_commitment: next.commitment.toString() } },
  })
  say(`checkout ${co.id.split("/").pop().slice(0, 8)} subtotal ${money(co.totals.find((t: any) => t.type === "subtotal").amount)}${returning ? `, provisional discount ${money(co.discounts.applied.find((d: any) => d.provisional)?.amount ?? 0)}` : ""}`)

  let paid: { txHash: string; amount: bigint }
  if (returning) {
    const action = co[NS]?.action
    if (co[NS]?.status !== "verification_required" || !action) throw new Error(`no verification action: ${JSON.stringify(co[NS])}`)
    say(`store asks: Semaphore membership in merchant ${action.merchant_id} tree (${action.tree_size} customers), scope discount/season ${action.scope.season}, message binds the payer`)

    // 6. prove, locally: which past purchase stays secret
    const arts = await loadArtifacts()
    const scope = discountScope(MERCHANT, action.scope.season)
    const message = discountMessage(payer.publicKey())
    const tProve = Date.now()
    const p = await proveMembership(past[past.length - 1], tree, message, scope, arts)
    say(`proof generated in ${Date.now() - tProve} ms, nullifier ${p.nullifier.toString().slice(0, 10)}…`)

    co = await ucp("update_checkout", { id: co.id, checkout: { [NS]: { proof: { payer: payer.publicKey(), root: p.root.toString(), nullifier: p.nullifier.toString(), proof: p.proof } } } })
    const verdict = co[NS]
    if (verdict?.status !== "verified") throw new Error(`proof refused: ${JSON.stringify(co.messages?.filter((m: any) => m.type === "error"))}`)
    // Public data only (what the store and the chain see anyway), kept for the replay demo.
    writeFileSync("evidence/last-proof.json", JSON.stringify({ payer: payer.publicKey(), season: action.scope.season, root: p.root.toString(), nullifier: p.nullifier.toString(), proof: p.proof }))
    say(`store verified the proof against the Stellar contract, single-use code ${verdict.code}`)

    // 7. apply the code through UCP discounts (a new Shopify code can take a few seconds to go live)
    for (let i = 0; i < 10; i++) {
      co = await ucp("update_checkout", { id: co.id, checkout: { line_items: co.line_items.map((l: any) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })), discounts: { codes: [verdict.code] } } })
      if ((co.discounts?.applied ?? []).some((d: any) => !d.provisional && d.amount > 0)) break
      await new Promise((ok) => setTimeout(ok, 3000))
    }
    const applied = (co.discounts?.applied ?? []).find((d: any) => !d.provisional)
    if (!applied) throw new Error(`code not applied: ${JSON.stringify(co.messages)}`)
    say(`code applied by the store: -${money(applied.amount)}`)

    // 8. pay: one Stellar tx re-verifies the proof, burns the nullifier and moves test USDC
    paid = await bookWithDiscount(payer, action.scope.season, p.proof, p.root, p.nullifier)
  } else {
    paid = await book(payer)
  }
  say(`paid ${usdc(paid.amount)} on Stellar, tx ${paid.txHash}`)

  // 9. complete with the Stellar payment as the credential
  const done = await ucp("complete_checkout", {
    meta: { "idempotency-key": randomUUID() },
    id: co.id,
    checkout: { payment: { instruments: [{ id: `pi_${randomUUID()}`, handler_id: handler.id, type: "stellar_tx", credential: { type: "stellar_tx", tx_hash: paid.txHash } }] } },
  })
  if (done.status !== "completed") throw new Error(`not completed: ${JSON.stringify(done.messages ?? done)}`)
  w.purchases[key] = made + 1
  writeFileSync(WALLET, JSON.stringify(w), { mode: 0o600 })
  say(`order ${done.order?.label ?? "(not recorded in the store)"} completed. ${done.payment?.receipt?.explorer ?? ""}`)
  say(`store saw: a valid proof, a fresh payer, a fresh customer code. Not who the buyer is, nor which past order.`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`agent stopped: ${e.message}`)
  process.exit(1)
})
