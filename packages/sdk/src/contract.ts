// Thin typed layer over the deployed proof_of_stay contract (stellar-sdk contract.Client, spec read from chain).
// Shared by the browser SDK, the BookerBob backend and the seed script.
import { contract } from "@stellar/stellar-sdk"
import type { ContractError, Merchant, Review } from "./types.ts"
import { hexToBytes, type SorobanProofHex } from "./convert.ts"

export interface NetworkConfig {
  rpcUrl: string
  networkPassphrase: string
  contractId: string
}

export const TESTNET: Omit<NetworkConfig, "contractId"> = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
}

export interface Signer {
  publicKey: string
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string }>
  signAuthEntry?: contract.ClientOptions["signAuthEntry"]
}

// Order must match `Error` in contracts/proof_of_stay/src/lib.rs.
const CONTRACT_ERRORS: Record<number, ContractError> = {
  1: "MerchantNotFound",
  2: "TreeFull",
  3: "BadLeaf",
  4: "DuplicateLeaf",
  5: "UnknownRoot",
  6: "NullifierUsed",
  7: "NonCanonical",
  8: "InvalidProof",
  9: "BadRating",
  10: "ReviewNotFound",
  11: "BadParams",
}

export const parseContractError = (e: unknown): ContractError | null => {
  const m = String((e as any)?.message ?? e).match(/Error\(Contract, #(\d+)\)/)
  return m ? CONTRACT_ERRORS[Number(m[1])] ?? null : null
}

const clientCache = new Map<string, Promise<contract.Client>>()

export function getClient(net: NetworkConfig, signer?: Signer): Promise<contract.Client> {
  const key = `${net.contractId}:${signer?.publicKey ?? "-"}`
  let c = clientCache.get(key)
  if (!c) {
    c = contract.Client.from({
      contractId: net.contractId,
      rpcUrl: net.rpcUrl,
      networkPassphrase: net.networkPassphrase,
      publicKey: signer?.publicKey,
      signTransaction: signer?.signTransaction as contract.ClientOptions["signTransaction"],
      signAuthEntry: signer?.signAuthEntry,
    })
    clientCache.set(key, c)
    c.catch(() => clientCache.delete(key))
  }
  return c
}

type Raw = Record<string, any>
const call = async (c: contract.Client, method: string, args: Raw = {}): Promise<any> => {
  const tx = await (c as any)[method](args)
  return tx.result
}

export const toMerchant = (id: number, h: Raw): Merchant => ({
  id,
  admin: String(h.admin),
  kind: String(h.kind),
  name: String(h.name),
  demo: true,
  price: BigInt(h.price),
  discountBps: Number(h.discount_bps),
  provenStays: Number(h.tree.size),
  root: (h.tree.size > 0 ? BigInt(h.tree.side_nodes[h.tree.depth]) : 0n).toString(),
  ratingSum: Number(h.rating_sum),
  ratingCount: Number(h.rating_count),
  verifiedCount: Number(h.verified_count),
})

const hex32 = (b: any) => Buffer.from(b).toString("hex")

export const toReview = (r: Raw): Omit<Review, "text" | "txHash" | "time"> => ({
  id: Number(r.id),
  merchant: Number(r.merchant),
  rating: Number(r.rating) as Review["rating"],
  contentHash: hex32(r.content_hash),
  disclosureCommit: hex32(r.disclosure_commit),
  nullifier: BigInt(r.nullifier).toString(),
  verified: Boolean(r.verified),
  ledger: Number(r.ledger),
})

export const views = {
  merchantCount: async (c: contract.Client): Promise<number> => Number(await call(c, "merchant_count")),
  merchant: async (c: contract.Client, id: number): Promise<Merchant> => toMerchant(id, await call(c, "get_merchant", { merchant: id })),
  reviews: async (c: contract.Client, merchant: number) => ((await call(c, "get_reviews", { merchant })) as Raw[]).map(toReview),
  review: async (c: contract.Client, id: number) => toReview(await call(c, "get_review", { review_id: id })),
  leaves: async (c: contract.Client, merchant: number): Promise<bigint[]> => ((await call(c, "get_leaves", { merchant })) as any[]).map(BigInt),
  leafIndex: async (c: contract.Client, merchant: number, commitment: bigint): Promise<number | null> => {
    const v = await call(c, "leaf_index", { merchant, id_commitment: commitment })
    return v === undefined || v === null ? null : Number(v)
  },
  arbiter: async (c: contract.Client): Promise<string> => String(await call(c, "arbiter")),
  usdc: async (c: contract.Client): Promise<string> => String(await call(c, "usdc")),
}

export type WriteOutcome<T> = { ok: true; txHash: string; value: T } | { ok: false; error: ContractError | "Unknown"; message: string }

/** Simulates, signs with the client's signer, submits and waits. Contract errors come back typed. */
export async function write<T = unknown>(c: contract.Client, method: string, args: Raw): Promise<WriteOutcome<T>> {
  try {
    const tx = await (c as any)[method](args)
    const sent = await tx.signAndSend()
    const txHash: string = sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash ?? ""
    return { ok: true, txHash, value: sent.result as T }
  } catch (e) {
    return { ok: false, error: parseContractError(e) ?? "Unknown", message: String((e as any)?.message ?? e).slice(0, 400) }
  }
}

export const proofArg = (p: SorobanProofHex) => ({
  a: Buffer.from(hexToBytes(p.a)),
  b: Buffer.from(hexToBytes(p.b)),
  c: Buffer.from(hexToBytes(p.c)),
})
export const bytes32Arg = (hex: string) => Buffer.from(hexToBytes(hex))
