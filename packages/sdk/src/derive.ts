// Scope, message and identity derivation. Must match contracts/proof_of_stay/src/lib.rs byte for byte.
import { keccak256, sha256 } from "ethers/crypto"
import { concat, toBeHex, toUtf8Bytes } from "ethers/utils"
import { Address } from "@stellar/stellar-sdk"
import { Identity } from "@semaphore-protocol/identity"
import { poseidon1 } from "poseidon-lite"

const be4 = (n: number) => toBeHex(n, 4)
const k = (data: Uint8Array | string) => BigInt(keccak256(data))

/** Semaphore hash(): keccak256 of the 32-byte big-endian value, shifted right by 8. */
export const semaphoreHash = (v: bigint): bigint => k(toBeHex(v, 32)) >> 8n

/** Raw scope for reviews: keccak256("pos/review" || be32(merchant)). */
export const reviewScope = (merchant: number): bigint => k(concat([toUtf8Bytes("pos/review"), be4(merchant)]))

/** Raw scope for discounts: keccak256("pos/discount" || be32(merchant) || be32(season)). */
export const discountScope = (merchant: number, season: number): bigint =>
  k(concat([toUtf8Bytes("pos/discount"), be4(merchant), be4(season)]))

/** Raw review message: keccak256(be32(rating) || content_hash || disclosure_commit). Hex args with 0x. */
export const reviewMessage = (rating: number, contentHash: string, disclosureCommit: string): bigint =>
  k(concat([be4(rating), contentHash, disclosureCommit]))

/** Raw discount message binds the payer: keccak256("pos/guest" || xdr(ScVal(guest))). */
export const discountMessage = (guest: string): bigint =>
  k(concat([toUtf8Bytes("pos/guest"), Address.fromString(guest).toScVal().toXDR()]))

/** sha256 of the review text, 0x hex. The chain stores only this. */
export const contentHash = (text: string): string => sha256(toUtf8Bytes(text))

/** disclosure_commit = Poseidon(dk), 0x hex (32 bytes). */
export const disclosureCommit = (dk: bigint): string => toBeHex(poseidon1([dk]), 32)

/** Per-stay identity: derive(master, merchant, stay_counter). A returning customer never reuses a leaf. */
export const stayIdentity = (master: string, merchant: number, stay: number): Identity =>
  new Identity(keccak256(concat([toUtf8Bytes("pos/stay"), toUtf8Bytes(master), be4(merchant), be4(stay)])))

/** Disclosure secret per stay, derived from the same master so it survives a reload. */
export const stayDisclosureKey = (master: string, merchant: number, stay: number): bigint =>
  semaphoreHash(k(concat([toUtf8Bytes("pos/dk"), toUtf8Bytes(master), be4(merchant), be4(stay)])))
