// snarkjs Groth16 (bn128) JSON -> byte layouts of the Soroban BN254 host functions.
// G1: be32(x) || be32(y). G2: be32(x.c1) || be32(x.c0) || be32(y.c1) || be32(y.c0) (snarkjs stores [c0, c1]).
export type SnarkG1 = string[]
export type SnarkG2 = string[][]
export interface SnarkProof { pi_a: SnarkG1; pi_b: SnarkG2; pi_c: SnarkG1 }
export interface SorobanProofHex { a: string; b: string; c: string }

export const be32 = (v: string | bigint): string => {
  const n = BigInt(v)
  if (n < 0n || n >= 1n << 256n) throw new Error(`out of range: ${v}`)
  return n.toString(16).padStart(64, "0")
}
export const g1 = (p: SnarkG1): string => {
  if (p[2] !== undefined && p[2] !== "1") throw new Error("G1 not affine")
  return be32(p[0]) + be32(p[1])
}
export const g2 = (p: SnarkG2): string => {
  if (p[2] !== undefined && (p[2][0] !== "1" || p[2][1] !== "0")) throw new Error("G2 not affine")
  return be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0])
}
export const convertProof = (p: SnarkProof): SorobanProofHex => ({ a: g1(p.pi_a), b: g2(p.pi_b), c: g1(p.pi_c) })
export const convertVk = (vk: any) => ({
  alpha: g1(vk.vk_alpha_1),
  beta: g2(vk.vk_beta_2),
  gamma: g2(vk.vk_gamma_2),
  delta: g2(vk.vk_delta_2),
  ic: (vk.IC as SnarkG1[]).map(g1),
})
export const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
