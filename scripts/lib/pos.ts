// Scope and message derivation shared by scripts, agent and app. Must match contracts/proof_of_stay/src/lib.rs.
import { keccak256, sha256 } from "ethers/crypto"
import { concat, getBytes, toBeHex, toUtf8Bytes } from "ethers/utils"
import { Address } from "@stellar/stellar-sdk"
import { Identity } from "@semaphore-protocol/core"
import { poseidon1 } from "poseidon-lite"

const be4 = (n: number) => toBeHex(n, 4)
const k = (data: Uint8Array | string) => BigInt(keccak256(data))

/** Semaphore hash(): keccak256 of the 32-byte big-endian value, shifted right by 8. */
export const semaphoreHash = (v: bigint) => k(toBeHex(v, 32)) >> 8n

export const reviewScope = (hotel: number) => k(concat([toUtf8Bytes("pos/review"), be4(hotel)]))
export const discountScope = (hotel: number, season: number) =>
  k(concat([toUtf8Bytes("pos/discount"), be4(hotel), be4(season)]))

export const reviewMessage = (rating: number, contentHash: string, disclosureCommit: string) =>
  k(concat([be4(rating), contentHash, disclosureCommit]))

export const discountMessage = (guest: string) =>
  k(concat([toUtf8Bytes("pos/guest"), Address.fromString(guest).toScVal().toXDR()]))

export const contentHash = (text: string) => sha256(toUtf8Bytes(text))

/** disclosure_commit = Poseidon(dk), as 32 bytes hex. */
export const disclosureCommit = (dk: bigint) => toBeHex(poseidon1([dk]), 32)

/** Per-stay identity: derive(master, hotel, stay_counter), so a returning guest never reuses a leaf. */
export const stayIdentity = (master: string, hotel: number, stay: number) =>
  new Identity(keccak256(concat([toUtf8Bytes("pos/stay"), toUtf8Bytes(master), be4(hotel), be4(stay)])))

export { getBytes }
