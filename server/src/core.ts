// BookerBob backend operations on testnet: demo merchant desk (checkout), review relayer, demo arbiter, test USDC faucet.
// Keys come from the environment only; nothing here is committed with secrets.
import { Asset, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder, contract, nativeToScVal, rpc, Address } from "@stellar/stellar-sdk"
import { getClient, views, write, proofArg, bytes32Arg, type NetworkConfig, type Signer, type WriteOutcome } from "../../packages/sdk/src/contract.ts"
import { contentHash } from "../../packages/sdk/src/derive.ts"
import type { SorobanProofHex } from "../../packages/sdk/src/convert.ts"

export const signerOf = (kp: Keypair, passphrase: string): Signer => {
  const s = contract.basicNodeSigner(kp, passphrase)
  return { publicKey: kp.publicKey(), signTransaction: s.signTransaction, signAuthEntry: s.signAuthEntry }
}

export interface Keys {
  relayer: Keypair
  arbiter: Keypair
  usdcIssuer?: Keypair
  /** Admin keys of demo merchants, by admin public key. */
  merchantAdmins: Map<string, Keypair>
}

export function keysFromEnv(env = process.env): Keys {
  const kp = (name: string) => {
    const v = env[name]
    if (!v) throw new Error(`missing env ${name}`)
    return Keypair.fromSecret(v)
  }
  const admins = new Map<string, Keypair>()
  for (const s of (env.DEMO_MERCHANT_SECRETS ?? "").split(",").filter(Boolean)) {
    const k = Keypair.fromSecret(s.trim())
    admins.set(k.publicKey(), k)
  }
  return { relayer: kp("RELAYER_SECRET"), arbiter: kp("ARBITER_SECRET"), usdcIssuer: env.USDC_ISSUER_SECRET ? kp("USDC_ISSUER_SECRET") : undefined, merchantAdmins: admins }
}

export class Ops {
  readonly net: NetworkConfig
  readonly keys: Keys
  constructor(net: NetworkConfig, keys: Keys) {
    this.net = net
    this.keys = keys
  }
  private as(kp: Keypair) {
    return getClient(this.net, signerOf(kp, this.net.networkPassphrase))
  }
  read() {
    return getClient(this.net)
  }

  async registerMerchant(admin: Keypair, kind: string, name: string, price: bigint, discountBps: number): Promise<WriteOutcome<number>> {
    return write<number>(await this.as(admin), "register_merchant", { admin: admin.publicKey(), kind, name, price, discount_bps: discountBps })
  }

  /** Demo desk: BookerBob confirms the stay and checks the commitment in, signing as the demo merchant admin. */
  async checkout(merchant: number, commitment: bigint): Promise<WriteOutcome<bigint> | { ok: false; error: "NotDemoMerchant"; message: string }> {
    const m = await views.merchant(await this.read(), merchant)
    const admin = this.keys.merchantAdmins.get(m.admin)
    if (!admin) return { ok: false, error: "NotDemoMerchant", message: "this merchant checks guests in itself" }
    return write<bigint>(await this.as(admin), "checkout", { merchant, id_commitment: commitment })
  }

  /** Relayer: submits the review from a shared account, so the sender address does not link the author. */
  async postReview(p: { merchant: number; rating: number; text: string; disclosureCommit: string; proof: SorobanProofHex; root: bigint; nullifier: bigint }): Promise<WriteOutcome<number>> {
    return write<number>(await this.as(this.keys.relayer), "post_review", {
      merchant: p.merchant,
      rating: p.rating,
      content_hash: bytes32Arg(contentHash(p.text)),
      disclosure_commit: bytes32Arg(p.disclosureCommit),
      proof: proofArg(p.proof),
      root: p.root,
      nullifier: p.nullifier,
    })
  }

  async attest(reviewId: number): Promise<WriteOutcome<null>> {
    return write<null>(await this.as(this.keys.arbiter), "attest_review", { review_id: reviewId })
  }

  /** Guest flows signed with a local key (seed only; the app signs with the guest's wallet). */
  async book(guest: Keypair, merchant: number) {
    return write<bigint>(await this.as(guest), "book", { merchant, guest: guest.publicKey() })
  }
  async bookWithDiscount(guest: Keypair, merchant: number, season: number, proof: SorobanProofHex, root: bigint, nullifier: bigint) {
    return write<bigint>(await this.as(guest), "book_with_discount", { merchant, guest: guest.publicKey(), season, proof: proofArg(proof), root, nullifier })
  }

  // ---- test USDC (our issuer's SAC) ----
  private server() {
    return new rpc.Server(this.net.rpcUrl)
  }
  async usdcAsset(): Promise<{ sac: string; asset: Asset }> {
    if (!this.keys.usdcIssuer) throw new Error("no USDC issuer key")
    return { sac: await views.usdc(await this.read()), asset: new Asset("USDC", this.keys.usdcIssuer.publicKey()) }
  }
  private async submitClassic(source: Keypair, op: any): Promise<string> {
    const s = this.server()
    const acct = await s.getAccount(source.publicKey())
    let tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: this.net.networkPassphrase }).addOperation(op).setTimeout(60).build()
    if (op.type === "invokeHostFunction" || (op as any).body?.switch?.().name === "invokeHostFunction") tx = await s.prepareTransaction(tx)
    tx.sign(source)
    const sent = await s.sendTransaction(tx)
    if (sent.status === "ERROR") throw new Error(`send failed ${JSON.stringify(sent.errorResult)}`)
    for (let i = 0; i < 60; i++) {
      const r = await s.getTransaction(sent.hash)
      if (r.status === "SUCCESS") return sent.hash
      if (r.status === "FAILED") throw new Error(`tx failed ${sent.hash}`)
      await new Promise((ok) => setTimeout(ok, 1000))
    }
    throw new Error(`tx timeout ${sent.hash}`)
  }
  /** Classic trustline so a G-account can hold the test USDC. */
  async trustUsdc(holder: Keypair): Promise<string> {
    const { asset } = await this.usdcAsset()
    return this.submitClassic(holder, Operation.changeTrust({ asset }))
  }
  /**
   * Loyalty attest (verify_onchain_zk): relayer pays 1 stroop to `address` with memo.hash = claim digest.
   * Creates a clickable testnet tx linked to the guest account. Classic payment — not a Soroban invoke.
   */
  async attestLoyalty(address: string, digestHex: string): Promise<string> {
    const hex = digestHex.replace(/^0x/, "").toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("digest must be 32-byte hex")
    if (!/^[GC][A-Z2-7]{55}$/.test(address)) throw new Error("bad address")
    const s = this.server()
    const source = this.keys.relayer
    const acct = await s.getAccount(source.publicKey())
    const digest = Buffer.from(hex, "hex")
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: this.net.networkPassphrase })
      .addOperation(Operation.payment({ destination: address, asset: Asset.native(), amount: "0.0000001" }))
      .addMemo(Memo.hash(digest))
      .setTimeout(60)
      .build()
    tx.sign(source)
    const sent = await s.sendTransaction(tx)
    if (sent.status === "ERROR") throw new Error(`loyalty attest send failed ${JSON.stringify(sent.errorResult)}`)
    for (let i = 0; i < 60; i++) {
      const r = await s.getTransaction(sent.hash)
      if (r.status === "SUCCESS") return sent.hash
      if (r.status === "FAILED") throw new Error(`loyalty attest failed ${sent.hash}`)
      await new Promise((ok) => setTimeout(ok, 1000))
    }
    throw new Error(`loyalty attest timeout ${sent.hash}`)
  }

  /** Faucet: issuer mints test USDC to `to` (G-address needs a trustline first; C-address does not). */
  async mintUsdc(to: string, amount: bigint): Promise<string> {
    const { sac } = await this.usdcAsset()
    const s = this.server()
    const issuer = this.keys.usdcIssuer!
    const acct = await s.getAccount(issuer.publicKey())
    const op = Operation.invokeContractFunction({ contract: sac, function: "mint", args: [new Address(to).toScVal(), nativeToScVal(amount, { type: "i128" })] })
    let tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: this.net.networkPassphrase }).addOperation(op).setTimeout(60).build()
    tx = await s.prepareTransaction(tx)
    tx.sign(issuer)
    const sent = await s.sendTransaction(tx)
    if (sent.status === "ERROR") throw new Error(`mint send failed`)
    for (let i = 0; i < 60; i++) {
      const r = await s.getTransaction(sent.hash)
      if (r.status === "SUCCESS") return sent.hash
      if (r.status === "FAILED") throw new Error(`mint failed ${sent.hash}`)
      await new Promise((ok) => setTimeout(ok, 1000))
    }
    throw new Error(`mint timeout ${sent.hash}`)
  }
}
