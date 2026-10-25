// Builds contract test vectors: one hotel with 3 stays, a review proof and a discount proof.
import { Group } from "@semaphore-protocol/core"
import { maybeGetSnarkArtifacts, Project } from "@zk-kit/artifacts"
import { groth16 } from "snarkjs"
import { writeFileSync } from "node:fs"
import { convertProof } from "./proof_to_soroban.ts"
import * as pos from "./lib/pos.ts"

const DEPTH = 10
const HOTEL = 0
const SEASON = 1
const GUEST = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI"
const MASTER = "fixture-master-secret"

const { wasm, zkey } = await maybeGetSnarkArtifacts(Project.SEMAPHORE, { parameters: [DEPTH], version: "4.13.0" })
const stays = [0, 1, 2].map((s) => pos.stayIdentity(MASTER, HOTEL, s))
const group = new Group(stays.map((i) => i.commitment))

async function prove(idx: number, message: bigint, scope: bigint) {
  const mp = group.generateMerkleProof(idx)
  const siblings = [...mp.siblings]
  while (siblings.length < DEPTH) siblings.push(0n)
  const { proof, publicSignals } = await groth16.fullProve(
    {
      secret: stays[idx].secretScalar,
      merkleProofLength: mp.siblings.length,
      merkleProofIndex: mp.index,
      merkleProofSiblings: siblings,
      scope: pos.semaphoreHash(scope),
      message: pos.semaphoreHash(message),
    },
    wasm,
    zkey,
  )
  return { proof: convertProof(proof), root: publicSignals[0], nullifier: publicSignals[1] }
}

const rating = 5
const content = pos.contentHash("quiet room, honest breakfast")
const dk = 123456789n
const commit = pos.disclosureCommit(dk)
const review = await prove(1, pos.reviewMessage(rating, content, commit), pos.reviewScope(HOTEL))
const discount = await prove(2, pos.discountMessage(GUEST), pos.discountScope(HOTEL, SEASON))

const out = {
  hotel: HOTEL,
  season: SEASON,
  guest: GUEST,
  commitments: stays.map((s) => s.commitment.toString()),
  root: group.root.toString(),
  review: { rating, contentHash: content.slice(2), disclosureCommit: commit.slice(2), dk: dk.toString(), ...review },
  discount,
}
writeFileSync(new URL("../circuits/golden/depth10/fixtures.json", import.meta.url), JSON.stringify(out, null, 2))
console.log("fixtures ok", { root: out.root })
process.exit(0)
