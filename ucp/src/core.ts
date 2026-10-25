// The only file that touches the Proof of Stay core. It consumes the published SDK
// (.core = public repo, pinned commit; see PRIOR_WORK.md) and the deployed contract by id.
import { Keypair, contract, rpc, scValToNative, xdr, Address, StrKey, TransactionBuilder } from "@stellar/stellar-sdk"
import { getClient, views, write, proofArg, type NetworkConfig, type Signer, TESTNET } from "../../packages/sdk/src/contract.ts"
import { discountScope, discountMessage, semaphoreHash, stayIdentity } from "../../packages/sdk/src/derive.ts"
import { proveMembership, loadArtifacts } from "../../packages/sdk/src/prove.ts"
import type { SorobanProofHex } from "../../packages/sdk/src/convert.ts"
import { contractId } from "../../packages/sdk/src/deployment.ts"

export { discountScope, discountMessage, semaphoreHash, stayIdentity, proveMembership, loadArtifacts, views, proofArg }
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

/** Season = calendar quarter, e.g. 20264 for Oct-Dec 2026: one discount per past purchase per quarter. */
export const currentSeason = (d = new Date()) => d.getUTCFullYear() * 10 + Math.floor(d.getUTCMonth() / 3) + 1

/** Merchant admin inserts a buyer's fresh commitment after a paid order. */
export async function insertCommitment(admin: Keypair, commitment: bigint) {
  return write<bigint>(await clientAs(admin), "checkout", { merchant: MERCHANT, id_commitment: commitment })
}

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
  fn: "book_amount" | "book_with_discount_amount"
  merchant: number
  guest: string
  amount: bigint
  season?: number
  nullifier?: bigint
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
  if (fn !== "book_amount" && fn !== "book_with_discount_amount") throw new Error(`unexpected function ${fn}`)
  const args = call.args.map((a: any) => scValToNative(a))
  const amount = BigInt(scValToNative(r.returnValue))
  const out: PaidOnChain = { fn, merchant: Number(args[0]), guest: String(args[1]), amount, ledger: r.ledger, quoted: 0n, orderRef: "" }
  if (fn === "book_with_discount_amount") {
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
export async function quotePayment(admin: Keypair, q: { guest: string; amount: bigint; orderRef: Buffer; discount?: { season: number; proof: SorobanProofHex; root: bigint; nullifier: bigint } }): Promise<string> {
  const c: any = await getClient(NET, { publicKey: q.guest, signTransaction: async () => { throw new Error("payer signs") } })
  const tx = q.discount
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
