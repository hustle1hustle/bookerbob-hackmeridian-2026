// Converts snarkjs Groth16 (bn128) JSON into the byte layouts the Soroban BN254 host functions expect.
// G1: be32(x) || be32(y). G2: be32(x.c1) || be32(x.c0) || be32(y.c1) || be32(y.c0) (Ethereum order).
// snarkjs stores Fp2 as [c0, c1], so the pair is swapped here. Fr: be32.
import { readFileSync, writeFileSync } from "node:fs"

type G1 = string[]
type G2 = string[][]

export const be32 = (v: string | bigint): string => {
  const n = BigInt(v)
  if (n < 0n || n >= 1n << 256n) throw new Error(`out of range: ${v}`)
  return n.toString(16).padStart(64, "0")
}

export const g1 = (p: G1): string => {
  if (p[2] !== undefined && p[2] !== "1") throw new Error("G1 not affine")
  return be32(p[0]) + be32(p[1])
}

export const g2 = (p: G2): string => {
  if (p[2] !== undefined && (p[2][0] !== "1" || p[2][1] !== "0")) throw new Error("G2 not affine")
  return be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0])
}

export const convertVk = (vk: any) => ({
  alpha: g1(vk.vk_alpha_1),
  beta: g2(vk.vk_beta_2),
  gamma: g2(vk.vk_gamma_2),
  delta: g2(vk.vk_delta_2),
  ic: (vk.IC as G1[]).map(g1),
})

export const convertProof = (p: any) => ({ a: g1(p.pi_a), b: g2(p.pi_b), c: g1(p.pi_c) })

export const convertPublic = (pub: string[]) => pub.map(be32)

// CLI: node scripts/proof_to_soroban.ts <dir with vkey.json proof.json public.json> [out.json]
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]
  if (!dir) throw new Error("usage: proof_to_soroban.ts <dir> [out.json]")
  const read = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))
  const out = { vk: convertVk(read("vkey.json")), proof: convertProof(read("proof.json")), public: convertPublic(read("public.json")) }
  const json = JSON.stringify(out, null, 2)
  if (process.argv[3]) writeFileSync(process.argv[3], json)
  else console.log(json)
}
