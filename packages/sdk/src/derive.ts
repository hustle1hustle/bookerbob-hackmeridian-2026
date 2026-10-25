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

/** Which tree a context claim proves: a merchant's customer tree or a context group (matches GroupRef). */
export type GroupRef = { kind: "merchant"; id: number } | { kind: "group"; id: number }

/** Raw context-claim scope: keccak256("pos/ctx" || be32(merchant) || tag || be32(id) || be32(season)), tag 0 merchant, 1 group.
 *  A claim on the booking merchant's own tree, or on the chain group the booking merchant belongs to (`merchantChain`,
 *  from the contract's `merchant_chain`), uses discountScope instead: one nullifier per stay per merchant per season. */
export const ctxScope = (merchant: number, group: GroupRef, season: number, merchantChain?: number | null): bigint =>
  (group.kind === "merchant" && group.id === merchant) || (group.kind === "group" && merchantChain != null && group.id === merchantChain)
    ? discountScope(merchant, season)
    : k(concat([toUtf8Bytes("pos/ctx"), be4(merchant), new Uint8Array([group.kind === "merchant" ? 0 : 1]), be4(group.id), be4(season)]))

/** Seasons as the contract counts them (`current_season`): season 1 starts 2026-10-01T00:00Z, each lasts 91 days.
 *  The contract refuses any other season, so a past stay earns one discount per merchant per season. */
export const SEASON_EPOCH = 1_790_812_800
export const SEASON_LEN = 91 * 86_400
export const currentSeason = (nowSecs = Math.floor(Date.now() / 1000)): number =>
  1 + Math.floor(Math.max(0, nowSecs - SEASON_EPOCH) / SEASON_LEN)

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
