// The only file that touches the Proof of Stay core. It consumes the published SDK
// (.core = public repo, pinned commit; see PRIOR_WORK.md) and the deployed contract by id.
import { Keypair, contract, rpc, scValToNative, xdr, Address, StrKey } from "@stellar/stellar-sdk"
import { getClient, views, write, proofArg, type NetworkConfig, type Signer, TESTNET } from "../.core/packages/sdk/src/contract.ts"
import { discountScope, discountMessage, semaphoreHash, stayIdentity } from "../.core/packages/sdk/src/derive.ts"
import { proveMembership, loadArtifacts } from "../.core/packages/sdk/src/prove.ts"
import type { SorobanProofHex } from "../.core/packages/sdk/src/convert.ts"

export { discountScope, discountMessage, semaphoreHash, stayIdentity, proveMembership, loadArtifacts, views, proofArg }
export type { SorobanProofHex }

export const NET: NetworkConfig = {
  ...TESTNET,
  rpcUrl: process.env.STELLAR_RPC_URL ?? TESTNET.rpcUrl,
  contractId: process.env.PROOF_OF_STAY_CONTRACT_ID ?? "CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL",
}
export const MERCHANT = Number(process.env.UCP_MERCHANT_ID ?? 5)

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
    const t = await c.book_with_discount({ merchant: MERCHANT, guest, season, proof: proofArg(proof), root, nullifier })
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
  return m ? ERRORS[Number(m[1])] ?? `Contract#${m[1]}` : String((e as any)?.message ?? e).slice(0, 200)
}

/** What a paid booking on chain says, read back from the tx itself (not from the buyer). */
export interface PaidOnChain {
  fn: "book" | "book_with_discount"
  merchant: number
  guest: string
  amount: bigint
  season?: number
  nullifier?: bigint
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
  const op = r.envelopeXdr.v1().tx().operations()[0].body()
  if (op.switch().name !== "invokeHostFunction") throw new Error("not a contract call")
  const call = op.invokeHostFunctionOp().hostFunction().invokeContract()
  const target = Address.fromScAddress(call.contractAddress()).toString()
  if (target !== NET.contractId) throw new Error("not the core contract")
  const fn = call.functionName().toString()
  if (fn !== "book" && fn !== "book_with_discount") throw new Error(`unexpected function ${fn}`)
  const args = call.args().map((a: xdr.ScVal) => scValToNative(a))
  const amount = BigInt(scValToNative(r.returnValue))
  const out: PaidOnChain = { fn, merchant: Number(args[0]), guest: String(args[1]), amount, ledger: r.ledger }
  if (fn === "book_with_discount") {
    out.season = Number(args[2])
    out.nullifier = BigInt(args[5])
  }
  return out
}

export const isAccount = (a: string) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a)

/** Book on chain as the guest key (full price or discount). Returns tx hash and amount. */
export async function book(guest: Keypair): Promise<{ txHash: string; amount: bigint }> {
  const r = await write<bigint>(await clientAs(guest), "book", { merchant: MERCHANT, guest: guest.publicKey() })
  if (!r.ok) throw new Error(r.error)
  return { txHash: r.txHash, amount: BigInt(r.value as any) }
}

export async function bookWithDiscount(guest: Keypair, season: number, proof: SorobanProofHex, root: bigint, nullifier: bigint): Promise<{ txHash: string; amount: bigint }> {
  const r = await write<bigint>(await clientAs(guest), "book_with_discount", { merchant: MERCHANT, guest: guest.publicKey(), season, proof: proofArg(proof), root, nullifier })
  if (!r.ok) throw new Error(r.error)
  return { txHash: r.txHash, amount: BigInt(r.value as any) }
}
