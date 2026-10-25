// Moving a group membership to a fresh identity ("start over"), without ever holding two.
// The browser proves it controls the OLD identity: a Semaphore v4 EdDSA-Poseidon signature by that identity
// over "rebind:<group>:<new commitment>:<nonce>", where Poseidon(old public key) == old commitment. The server
// stores only a salted hash of the current commitment per proof or wallet, never the plaintext, so its state
// cannot be joined with the public group trees without the browser's help.
import { createHash } from "node:crypto"
import { Identity } from "@semaphore-protocol/identity"
import { poseidon2 } from "poseidon-lite"
import { Group } from "@semaphore-protocol/group"

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

export interface RebindProof {
  oldCommitment: string
  publicKey: [string, string]
  signature: { R8: [string, string]; S: string }
}

export const rebindChallenge = (group: number, newCommitment: string, nonce: string) => `rebind:${group}:${newCommitment}:${nonce}`
/** The signed message as a field element (Semaphore signs a number). */
export const challengeField = (text: string) => BigInt("0x" + createHash("sha256").update(text, "utf8").digest("hex")) % FR
export const commitmentKey = (salt: string, c: string) => createHash("sha256").update(`${salt}|commitment|${c}`).digest("hex")

const dec = (v: unknown) => typeof v === "string" && /^\d{1,78}$/.test(v)

export function checkRebind(p: unknown, group: number, newCommitment: string, nonce: string): RebindProof | null {
  const r = p as RebindProof
  if (!r || !dec(r.oldCommitment) || r.oldCommitment === newCommitment) return null
  if (!Array.isArray(r.publicKey) || r.publicKey.length !== 2 || !r.publicKey.every(dec)) return null
  if (!r.signature || !Array.isArray(r.signature.R8) || r.signature.R8.length !== 2 || !r.signature.R8.every(dec) || !dec(r.signature.S)) return null
  const pub = r.publicKey.map(BigInt) as [bigint, bigint]
  if (poseidon2(pub) !== BigInt(r.oldCommitment)) return null
  try {
    const ok = Identity.verifySignature(challengeField(rebindChallenge(group, newCommitment, nonce)), { R8: r.signature.R8.map(BigInt) as [bigint, bigint], S: BigInt(r.signature.S) }, pub)
    return ok ? r : null
  } catch {
    return null
  }
}

/** Browser side: sign the rebind with the old identity. */
export function signRebind(old: Identity, group: number, newCommitment: string, nonce: string): RebindProof {
  const sig = old.signMessage(challengeField(rebindChallenge(group, newCommitment, nonce)))
  return {
    oldCommitment: old.commitment.toString(),
    publicKey: [old.publicKey[0].toString(), old.publicKey[1].toString()],
    signature: { R8: [sig.R8[0].toString(), sig.R8[1].toString()], S: sig.S.toString() },
  }
}

/** The OLD leaf's Merkle siblings for replace_member (Semaphore LeanIMT order, as the contract expects). */
export function siblingsFor(leaves: bigint[], old: bigint): bigint[] {
  const g = new Group(leaves)
  const i = g.indexOf(old)
  if (i < 0) throw new Error("NotMember")
  return g.generateMerkleProof(i).siblings
}
