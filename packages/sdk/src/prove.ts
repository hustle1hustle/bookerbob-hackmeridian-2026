// Semaphore v4 membership proof against a merchant's on-chain leaves, in browser or Node.
import { Group } from "@semaphore-protocol/group"
import type { Identity } from "@semaphore-protocol/identity"
// @ts-ignore snarkjs ships no types
import { groth16 } from "snarkjs"
import { semaphoreHash } from "./derive.ts"
import { convertProof, type SorobanProofHex } from "./convert.ts"

/** Pinned: one verifying key per depth, the contract holds the depth-10 key. */
export const TREE_DEPTH = 10
export const ARTIFACTS_VERSION = "4.13.0"
export const DEFAULT_ARTIFACTS_URL = `https://snark-artifacts.pse.dev/semaphore/${ARTIFACTS_VERSION}`

export interface Artifacts { wasm: Uint8Array; zkey: Uint8Array }
let cached: Artifacts | null = null
export const artifactsCached = () => cached !== null

async function fetchWithProgress(url: string, onChunk: (n: number) => void): Promise<{ bytes: Uint8Array; total: number }> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`artifact fetch failed: ${url} ${res.status}`)
  const total = Number(res.headers.get("content-length") ?? 0)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    n += value.length
    onChunk(value.length)
  }
  const bytes = new Uint8Array(n)
  let o = 0
  for (const p of parts) (bytes.set(p, o), (o += p.length))
  return { bytes, total: total || n }
}

/** Downloads wasm + zkey once (about 4 MB at depth 10). Progress reports cumulative bytes. */
export async function loadArtifacts(baseUrl = DEFAULT_ARTIFACTS_URL, onProgress?: (loaded: number, total: number) => void): Promise<Artifacts> {
  if (cached) return cached
  const APPROX_TOTAL = 4_300_000
  let loaded = 0
  const tick = (n: number) => onProgress?.((loaded += n), Math.max(APPROX_TOTAL, loaded))
  const [w, z] = await Promise.all([
    fetchWithProgress(`${baseUrl}/semaphore-${TREE_DEPTH}.wasm`, tick),
    fetchWithProgress(`${baseUrl}/semaphore-${TREE_DEPTH}.zkey`, tick),
  ])
  onProgress?.(loaded, loaded)
  cached = { wasm: w.bytes, zkey: z.bytes }
  return cached
}

export interface MembershipProof {
  proof: SorobanProofHex
  root: bigint
  nullifier: bigint
  publicSignals: string[]
}

/** Proves `identity` is a leaf of the tree built from `leaves` (on-chain order), bound to message and scope (raw, pre-hash). */
export async function proveMembership(identity: Identity, leaves: bigint[], message: bigint, scope: bigint, artifacts: Artifacts): Promise<MembershipProof> {
  const group = new Group(leaves)
  const index = group.indexOf(identity.commitment)
  if (index < 0) throw new Error("NotInTree")
  const mp = group.generateMerkleProof(index)
  const siblings = [...mp.siblings]
  while (siblings.length < TREE_DEPTH) siblings.push(0n)
  const { proof, publicSignals } = await groth16.fullProve(
    {
      secret: identity.secretScalar,
      merkleProofLength: mp.siblings.length,
      merkleProofIndex: mp.index,
      merkleProofSiblings: siblings,
      scope: semaphoreHash(scope),
      message: semaphoreHash(message),
    },
    { type: "mem", data: artifacts.wasm } as any,
    { type: "mem", data: artifacts.zkey } as any,
  )
  return { proof: convertProof(proof), root: BigInt(publicSignals[0]), nullifier: BigInt(publicSignals[1]), publicSignals }
}
