// The only file that touches the Proof of Stay core. It consumes the published SDK
// (.core = public repo, pinned commit; see PRIOR_WORK.md) and the deployed contract by id.
import { Keypair, contract, rpc, scValToNative, xdr, Address, StrKey, TransactionBuilder } from "@stellar/stellar-sdk"
import { getClient, views, write, proofArg, type NetworkConfig, type Signer, TESTNET } from "../.core/packages/sdk/src/contract.ts"
import { discountScope, discountMessage, semaphoreHash, stayIdentity, ctxScope, type GroupRef } from "../.core/packages/sdk/src/derive.ts"
import { proveMembership, loadArtifacts } from "../.core/packages/sdk/src/prove.ts"
import type { SorobanProofHex } from "../.core/packages/sdk/src/convert.ts"
import { contractId } from "../.core/packages/sdk/src/deployment.ts"
import { poseidon2 } from "poseidon-lite"

export { discountScope, discountMessage, semaphoreHash, stayIdentity, ctxScope, proveMembership, loadArtifacts, views, proofArg }
export type { GroupRef }
export type { SorobanProofHex }

export const NET: NetworkConfig = {
  ...TESTNET,
  rpcUrl: process.env.STELLAR_RPC_URL ?? TESTNET.rpcUrl,
  // From the core's config/testnet.json (env PROOF_OF_STAY_CONTRACT_ID overrides), never hardcoded.
  contractId: contractId(),
}
export const MERCHANT = Number(process.env.UCP_MERCHANT_ID)

export const signerOf = (kp: Keypair): Signer => {
  const s = contract.basicNodeSigner(kp, NET.networkPassphrase)
  return { publicKey: kp.publicKey(), signTransaction: s.signTransaction, signAuthEntry: s.signAuthEntry }
}

let readerP: Promise<contract.Client> | null = null
export const reader = () => (readerP ??= getClient(NET))
export const clientAs = (kp: Keypair) => getClient(NET, signerOf(kp))

export const merchant = async () => views.merchant(await reader(), MERCHANT)
export const leaves = async () => views.leaves(await reader(), MERCHANT)

// ---- context perks: the merchant's policy over its own tree and context groups ----

export interface PerkItem { group: GroupRef; bps: number; name: string }
export interface Perks { items: PerkItem[]; maxBps: number }
/** One claim as the contract takes it. */
export interface ClaimIn { group: GroupRef; proof: SorobanProofHex; root: bigint; nullifier: bigint }

const groupArg = (g: GroupRef) => ({ tag: g.kind === "merchant" ? "Merchant" : "Group", values: [g.id] })
const fromArg = (a: any): GroupRef => ({ kind: a.tag === "Merchant" ? "merchant" : "group", id: Number(a.values[0]) })
export const groupKey = (g: GroupRef) => `${g.kind}:${g.id}`
export const claimArg = (c: ClaimIn) => ({ group: groupArg(c.group), proof: proofArg(c.proof), root: c.root, nullifier: c.nullifier })

export async function perks(): Promise<Perks | null> {
  const c: any = await reader()
  const p = (await c.get_policy({ merchant: MERCHANT })).result
  if (!p) return null
  const groups = (await c.list_groups()).result as any[]
  const nameOf = (g: GroupRef) => (g.kind === "merchant" ? (g.id === MERCHANT ? "returning customer" : `customer of merchant ${g.id}`) : String(groups.find((x) => Number(x.id) === g.id)?.name ?? `group ${g.id}`))
  return { maxBps: Number(p.max_bps), items: p.items.map((it: any) => { const g = fromArg(it.group); return { group: g, bps: Number(it.bps), name: nameOf(g) } }) }
}

export async function treeOf(g: GroupRef): Promise<{ leaves: bigint[]; root: string; size: number }> {
  const c = await reader()
  if (g.kind === "merchant") {
    const m = await views.merchant(c, g.id)
    return { leaves: await views.leaves(c, g.id), root: m.root, size: m.provenStays }
  }
  const leaves = await views.groupLeaves(c, g.id)
  const grp: any = (await (c as any).get_group({ group: g.id })).result
  return { leaves, root: leaves.length ? String(grp.tree.side_nodes[grp.tree.depth]) : "0", size: leaves.length }
}

/** Dry run of book_with_context for this payer: the contract checks every claim (roots, nullifiers, proofs). */
export async function simulateContext(guest: string, season: number, claims: ClaimIn[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const c: any = await getClient(NET, { publicKey: guest, signTransaction: async () => { throw new Error("simulation only") } })
  try {
    const t = await c.book_with_context({ merchant: MERCHANT, guest, season, amount: 1n, claims: claims.map(claimArg) })
    if (t.simulation && "error" in t.simulation) return { ok: false, error: contractError(t.simulation.error) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: contractError(e) }
  }
}

/** Season = calendar quarter, e.g. 20264 for Oct-Dec 2026: one discount per past purchase per quarter. */
export const currentSeason = (d = new Date()) => d.getUTCFullYear() * 10 + Math.floor(d.getUTCMonth() / 3) + 1

/** Merchant admin inserts a buyer's fresh commitment after a paid order. */
export async function insertCommitment(admin: Keypair, commitment: bigint) {
  return write<bigint>(await clientAs(admin), "checkout", { merchant: MERCHANT, id_commitment: commitment })
}

/** Spent on chain for this raw scope? nullifier = Poseidon(hash(scope), secret), computable before proving. */
export async function isSpentScope(scopeRaw: bigint, nullifier: bigint): Promise<boolean> {
  const c: any = await reader()
  return Boolean((await c.is_spent({ scope_hash: semaphoreHash(scopeRaw), nullifier })).result)
}
export const nullifierOf = (secretScalar: bigint, scopeRaw: bigint): bigint => poseidon2([semaphoreHash(scopeRaw), secretScalar])

export async function isSpent(season: number, nullifier: bigint): Promise<boolean> {
  const c: any = await reader()
  const t = await c.is_spent({ scope_hash: semaphoreHash(discountScope(MERCHANT, season)), nullifier })
  return Boolean(t.result)
}

/**
 * Dry run of book_with_discount for this payer: the contract itself checks the root, the
 * nullifier and the Groth16 proof (simulation, nothing is spent, no signature needed).
 */
export async function simulateDiscount(guest: string, season: number, proof: SorobanProofHex, root: bigint, nullifier: bigint): Promise<{ ok: true; amount: bigint } | { ok: false; error: string }> {
  const c: any = await getClient(NET, { publicKey: guest, signTransaction: async () => { throw new Error("simulation only") } })
  try {
    const t = await c.book_with_discount_amount({ merchant: MERCHANT, guest, season, amount: 1n, order_ref: Buffer.alloc(32), proof: proofArg(proof), root, nullifier })
    // A thrown host error surfaces either here or as a simulation error on the assembled tx.
    if (t.simulation && "error" in t.simulation) return { ok: false, error: contractError(t.simulation.error) }
    return { ok: true, amount: BigInt(t.result) }
  } catch (e) {
    return { ok: false, error: contractError(e) }
  }
}

const ERRORS = ["", "MerchantNotFound", "TreeFull", "BadLeaf", "DuplicateLeaf", "UnknownRoot", "NullifierUsed", "NonCanonical", "InvalidProof", "BadRating", "ReviewNotFound", "BadParams"]
export const contractError = (e: unknown): string => {
  const m = String((e as any)?.message ?? e).match(/Error\(Contract, #(\d+)\)/)
  if (m) return ERRORS[Number(m[1])] ?? `Contract#${m[1]}`
  // Bytes that are not curve points fail inside the host before the pairing check.
  if (/Error\((WasmVm|Crypto), /.test(String((e as any)?.message ?? e))) return "InvalidProof (malformed curve points)"
  return String((e as any)?.message ?? e).slice(0, 200)
}

/** What a paid booking on chain says, read back from the tx itself (not from the buyer). */
export interface PaidOnChain {
  fn: "book_amount" | "book_with_discount_amount" | "book_with_context"
  merchant: number
  guest: string
  amount: bigint
  season?: number
  nullifier?: bigint
  /** book_with_context: every claim's nullifier, keyed by group. */
  nullifiers?: Record<string, string>
  /** Pre-discount amount the merchant admin co-signed; `amount` is what was paid. */
  quoted: bigint
  orderRef: string
  ledger: number
}

export async function readPayment(txHash: string): Promise<PaidOnChain> {
  const server = new rpc.Server(NET.rpcUrl)
  let r: any
  for (let i = 0; i < 20; i++) {
    r = await server.getTransaction(txHash)
    if (r.status !== "NOT_FOUND") break
    await new Promise((ok) => setTimeout(ok, 1000))
  }
  if (r.status !== "SUCCESS") throw new Error(`tx ${r.status}`)
  // stellar-sdk 17 decodes XDR to plain objects (unions as {type, <arm>}), not accessor classes.
  const raw = (v: any) => (typeof v === "string" ? v : v.toXDR("base64"))
  const env: any = xdr.TransactionEnvelope.fromXDR(raw(r.envelopeXdr), "base64")
  const body = env.v1?.tx?.operations?.[0]?.body
  if (body?.type !== "invokeHostFunction") throw new Error("not a contract call")
  const call = body.invokeHostFunctionOp.hostFunction.invokeContract
  if (!call) throw new Error("not a contract call")
  const target = Address.fromScAddress(call.contractAddress).toString()
  if (target !== NET.contractId) throw new Error("not the core contract")
  const fn = String(call.functionName)
  if (fn !== "book_amount" && fn !== "book_with_discount_amount" && fn !== "book_with_context") throw new Error(`unexpected function ${fn}`)
  const args = call.args.map((a: any) => scValToNative(a))
  const amount = BigInt(scValToNative(r.returnValue))
  const out: PaidOnChain = { fn, merchant: Number(args[0]), guest: String(args[1]), amount, ledger: r.ledger, quoted: 0n, orderRef: "" }
  if (fn === "book_with_context") {
    out.season = Number(args[2])
    out.quoted = args[3] === null || args[3] === undefined ? 0n : BigInt(args[3])
    out.nullifiers = {}
    for (const cl of args[4] as any[]) {
      const g: any = cl.group
      // scValToNative renders an enum variant as [tag, value]
      const key = Array.isArray(g) ? `${g[0] === "Merchant" ? "merchant" : "group"}:${Number(g[1])}` : groupKey(fromArg(g))
      out.nullifiers[key] = BigInt(cl.nullifier).toString()
    }
  } else if (fn === "book_with_discount_amount") {
    out.season = Number(args[2])
    out.quoted = BigInt(args[3])
    out.orderRef = Buffer.from(args[4]).toString("hex")
    out.nullifier = BigInt(args[7])
  } else {
    out.quoted = BigInt(args[2])
    out.orderRef = Buffer.from(args[3]).toString("hex")
  }
  return out
}

export const isAccount = (a: string) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a)

/**
 * The merchant admin co-signs a payment for one order: amount (pre-discount, raw USDC) and order_ref.
 * Returns a tx the payer signs and submits; the contract applies the discount itself.
 */
export async function quotePayment(admin: Keypair, q: { guest: string; amount: bigint; orderRef: Buffer; discount?: { season: number; proof: SorobanProofHex; root: bigint; nullifier: bigint }; context?: { season: number; claims: ClaimIn[] } }): Promise<string> {
  const c: any = await getClient(NET, { publicKey: q.guest, signTransaction: async () => { throw new Error("payer signs") } })
  const tx = q.context
    ? await c.book_with_context({ merchant: MERCHANT, guest: q.guest, season: q.context.season, amount: q.amount, claims: q.context.claims.map(claimArg) })
    : q.discount
    ? await c.book_with_discount_amount({ merchant: MERCHANT, guest: q.guest, season: q.discount.season, amount: q.amount, order_ref: q.orderRef, proof: proofArg(q.discount.proof), root: q.discount.root, nullifier: q.discount.nullifier })
    : await c.book_amount({ merchant: MERCHANT, guest: q.guest, amount: q.amount, order_ref: q.orderRef })
  if (tx.simulation && "error" in tx.simulation) throw new Error(contractError(tx.simulation.error))
  await tx.signAuthEntries({ address: admin.publicKey(), signAuthEntry: signerOf(admin).signAuthEntry })
  // Re-simulate with the signed auth entry in place so footprint and fees cover its check; the payer
  // then only signs the envelope (any wallet, e.g. Freighter signTransaction) and sends it.
  await tx.simulate()
  return tx.toXDR()
}

/** Payer side: sign the prepared tx envelope and send it. */
export async function payQuote(payer: Keypair, txXdr: string): Promise<{ txHash: string; amount: bigint }> {
  const tx = TransactionBuilder.fromXDR(txXdr, NET.networkPassphrase)
  tx.sign(payer)
  return sendSigned(tx.toXDR())
}

/** Sends a payer-signed tx and waits for it; returns hash and the amount the contract charged. */
export async function sendSigned(signedXdr: string): Promise<{ txHash: string; amount: bigint }> {
  const server = new rpc.Server(NET.rpcUrl)
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, NET.networkPassphrase))
  if (sent.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(sent.errorResult).slice(0, 200)}`)
  for (let i = 0; i < 40; i++) {
    const r: any = await server.getTransaction(sent.hash)
    if (r.status === "SUCCESS") return { txHash: sent.hash, amount: BigInt(scValToNative(r.returnValue)) }
    if (r.status === "FAILED") throw new Error(`tx failed ${sent.hash}`)
    await new Promise((ok) => setTimeout(ok, 1000))
  }
  throw new Error(`tx timeout ${sent.hash}`)
}

/** Card rail: burn the discount nullifier on chain without moving USDC (merchant admin only). */
export async function redeem(admin: Keypair, r: { guest: string; season: number; orderRef: Buffer; proof: SorobanProofHex; root: bigint; nullifier: bigint }) {
  return write(await clientAs(admin), "redeem", { merchant: MERCHANT, guest: r.guest, season: r.season, order_ref: r.orderRef, proof: proofArg(r.proof), root: r.root, nullifier: r.nullifier })
}
