// Dispute disclosure without a new circuit (PLAN 3.5): dk opens disclosure_commit, the stay identity signs the review id.
import { Identity } from "@semaphore-protocol/identity"
import { poseidon1 } from "poseidon-lite"
import type { DisclosureCheck, DisclosurePackage } from "./types.ts"

export function buildDisclosure(identity: Identity, dk: bigint, reviewId: number, merchant: number, leafIndex: number): DisclosurePackage {
  const sig = identity.signMessage(BigInt(reviewId))
  return {
    reviewId,
    merchant,
    commitment: identity.commitment.toString(),
    leafIndex,
    dk: dk.toString(),
    signature: { r8: [sig.R8[0].toString(), sig.R8[1].toString()], s: sig.S.toString() },
    publicKey: [identity.publicKey[0].toString(), identity.publicKey[1].toString()],
  }
}

/** Arbiter check. `disclosureCommitHex` from the on-chain review, `leafOnChain` from leaf_index(merchant, commitment). */
export function checkDisclosure(pkg: DisclosurePackage, disclosureCommitHex: string, leafOnChain: number | null): DisclosureCheck {
  const pk: [bigint, bigint] = [BigInt(pkg.publicKey[0]), BigInt(pkg.publicKey[1])]
  const commitOk = poseidon1([BigInt(pkg.dk)]) === BigInt("0x" + disclosureCommitHex.replace(/^0x/, ""))
  let sigOk = false
  try {
    sigOk =
      Identity.generateCommitment(pk) === BigInt(pkg.commitment) &&
      Identity.verifySignature(BigInt(pkg.reviewId), { R8: [BigInt(pkg.signature.r8[0]), BigInt(pkg.signature.r8[1])], S: BigInt(pkg.signature.s) }, pk)
  } catch {
    sigOk = false
  }
  return { commitmentMatches: commitOk, signatureValid: sigOk, leafInTree: leafOnChain !== null && leafOnChain === pkg.leafIndex }
}
