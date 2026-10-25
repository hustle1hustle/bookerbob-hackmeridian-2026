// Golden Semaphore v4 test vector: raw snarkjs proof.json / public.json / vkey.json for the Soroban verifier tests.
import { Identity, Group } from "@semaphore-protocol/core"
import { maybeGetSnarkArtifacts, Project } from "@zk-kit/artifacts"
import { groth16, zKey } from "snarkjs"
import { keccak256 } from "ethers/crypto"
import { toBeHex } from "ethers/utils"
import { writeFileSync, mkdirSync } from "node:fs"

const DEPTH = Number(process.env.DEPTH ?? 10)
const OUT = new URL(`../circuits/golden/depth${DEPTH}/`, import.meta.url)
mkdirSync(OUT, { recursive: true })

// Same as Semaphore's hash(): keccak256 of the 32-byte big-endian value, shifted right by 8 bits.
const hash = (v) => BigInt(keccak256(toBeHex(v, 32))) >> 8n

const seeds = ["golden-guest-0", "golden-guest-1", "golden-guest-2"]
const ids = seeds.map((s) => new Identity(s))
const group = new Group(ids.map((i) => i.commitment))
const message = 1n
const scope = 42n

const { wasm, zkey } = await maybeGetSnarkArtifacts(Project.SEMAPHORE, { parameters: [DEPTH], version: "4.13.0" })
const mp = group.generateMerkleProof(1)
const siblings = [...mp.siblings]
while (siblings.length < DEPTH) siblings.push(0n)

const t0 = Date.now()
const { proof, publicSignals } = await groth16.fullProve(
  { secret: ids[1].secretScalar, merkleProofLength: mp.siblings.length, merkleProofIndex: mp.index, merkleProofSiblings: siblings, scope: hash(scope), message: hash(message) },
  wasm,
  zkey,
)
const provingMs = Date.now() - t0
const vkey = await zKey.exportVerificationKey(zkey)
const ok = await groth16.verify(vkey, publicSignals, proof)

writeFileSync(new URL("proof.json", OUT), JSON.stringify(proof, null, 2))
writeFileSync(new URL("public.json", OUT), JSON.stringify(publicSignals, null, 2))
writeFileSync(new URL("vkey.json", OUT), JSON.stringify(vkey, null, 2))
writeFileSync(
  new URL("meta.json", OUT),
  JSON.stringify(
    {
      depth: DEPTH,
      identitySeeds: seeds,
      prover: "golden-guest-1 (leaf index 1)",
      commitments: ids.map((i) => i.commitment.toString()),
      root: group.root.toString(),
      message: message.toString(),
      scope: scope.toString(),
      messageHash: hash(message).toString(),
      scopeHash: hash(scope).toString(),
      publicSignalOrder: ["merkleTreeRoot", "nullifier", "hash(message)", "hash(scope)"],
      artifacts: { project: "semaphore", version: "4.13.0", wasm: `https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-${DEPTH}.wasm`, zkey: `https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-${DEPTH}.zkey` },
    },
    null,
    2,
  ),
)
console.log({ depth: DEPTH, ok, provingMs, publicSignals, root: group.root.toString(), mh: hash(message).toString(), sh: hash(scope).toString() })
process.exit(ok ? 0 : 1)
