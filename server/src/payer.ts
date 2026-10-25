// Fresh payer per booking (PLAN 10, README limitations): the guest's browser makes a one-time key per booking;
// BookerBob sponsors its account reserve and USDC trustline, funds it, and fee-bumps its booking transaction,
// so the guest never holds XLM and two bookings by one guest come from unrelated addresses.
import { Asset, BASE_FEE, Keypair, Operation, TransactionBuilder, FeeBumpTransaction, Transaction, rpc, scValToNative } from "@stellar/stellar-sdk"
import type { Ops } from "./core.ts"

const BOOKING_FNS = new Set(["book", "book_with_discount", "book_with_context", "book_amount", "book_with_discount_amount"])
// Fee cap per sponsored transaction: a base plus a per-proof allowance (each Groth16 check + nullifier write and its
// rent costs a few XLM on testnet), bounded overall. The refundable part comes back to the relayer.
const BASE_FEE_CAP = 100_000_000n // 10 XLM
const PER_PROOF_CAP = 60_000_000n // 6 XLM per proof
const ABS_FEE_CAP = 400_000_000n // 40 XLM

const wait = async (s: rpc.Server, hash: string) => {
  for (let i = 0; i < 40; i++) {
    const r = await s.getTransaction(hash)
    if (r.status === "SUCCESS") return r
    if (r.status === "FAILED") throw new Error(`tx failed ${hash}`)
    await new Promise((ok) => setTimeout(ok, 1000))
  }
  throw new Error(`tx timeout ${hash}`)
}

export class PayerService {
  ops: Ops
  sponsor: Keypair
  constructor(ops: Ops) {
    this.ops = ops
    this.sponsor = ops.keys.relayer
  }
  private server() {
    return new rpc.Server(this.ops.net.rpcUrl)
  }

  /** Step 1: unsigned envelope that creates `fresh` with a sponsored reserve and a USDC trustline. The fresh key signs it. */
  async open(fresh: string): Promise<string> {
    const s = this.server()
    const { asset } = await this.ops.usdcAsset()
    const acct = await s.getAccount(this.sponsor.publicKey())
    const tx = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: this.ops.net.networkPassphrase })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: fresh }))
      .addOperation(Operation.createAccount({ destination: fresh, startingBalance: "0" }))
      .addOperation(Operation.changeTrust({ asset, source: fresh }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: fresh }))
      .setTimeout(120)
      .build()
    return tx.toXDR()
  }

  /** Step 2: checks the signed envelope is exactly the open() shape, co-signs as sponsor, submits, then funds `amount` USDC. */
  async activate(signedXdr: string, amount: bigint): Promise<{ openTx: string; fundTx: string; payer: string }> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.ops.net.networkPassphrase) as Transaction
    const ops = tx.operations
    const fresh = (ops[1] as any)?.destination as string
    const ok =
      tx.source === this.sponsor.publicKey() &&
      ops.length === 4 &&
      ops[0].type === "beginSponsoringFutureReserves" &&
      (ops[0] as any).sponsoredId === fresh &&
      ops[1].type === "createAccount" &&
      (ops[1] as any).startingBalance === "0.0000000" &&
      ops[2].type === "changeTrust" &&
      ops[2].source === fresh &&
      ops[3].type === "endSponsoringFutureReserves" &&
      ops[3].source === fresh
    if (!ok) throw new Error("BadParams")
    if (amount <= 0n || amount > 2_000n * 10_000_000n) throw new Error("BadParams")
    tx.sign(this.sponsor)
    const s = this.server()
    const sent = await s.sendTransaction(tx)
    if (sent.status === "ERROR") throw new Error("open failed")
    await wait(s, sent.hash)
    const fundTx = await this.ops.mintUsdc(fresh, amount)
    return { openTx: sent.hash, fundTx, payer: fresh }
  }

  /** Step 3: fee-bumps a signed booking transaction from a fresh payer: one invoke of our contract's booking functions only. */
  async feeBump(innerXdr: string): Promise<{ txHash: string; value: unknown }> {
    const inner = TransactionBuilder.fromXDR(innerXdr, this.ops.net.networkPassphrase)
    if (inner instanceof FeeBumpTransaction) throw new Error("BadParams")
    const op: any = inner.operations[0]
    if (inner.operations.length !== 1 || op?.type !== "invokeHostFunction") throw new Error("BadParams")
    // plain-object view works across XDR library versions
    const call = JSON.parse(JSON.stringify(op.func, (_, v) => (typeof v === "bigint" ? v.toString() : v)))?.invoke_contract
    if (!call || call.contract_address !== this.ops.net.contractId || !BOOKING_FNS.has(call.function_name)) throw new Error("BadParams")
    // proofs in this call: book_with_context carries a vec of claims (arg 4); the discount calls carry one proof
    const claims = call.function_name === "book_with_context" ? (Array.isArray(call.args?.[4]?.vec) ? call.args[4].vec.length : 1) : /discount/.test(call.function_name) ? 1 : 0
    const cap = BASE_FEE_CAP + PER_PROOF_CAP * BigInt(claims)
    if (BigInt(inner.fee) > (cap > ABS_FEE_CAP ? ABS_FEE_CAP : cap)) throw new Error(`FeeTooHigh ${inner.fee} > ${cap}`)
    const bump = TransactionBuilder.buildFeeBumpTransaction(this.sponsor, String(BigInt(inner.fee) * 2n), inner, this.ops.net.networkPassphrase)
    bump.sign(this.sponsor)
    const s = this.server()
    const sent = await s.sendTransaction(bump)
    if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") throw new Error(`send ${sent.status} ${JSON.stringify(sent.errorResult ?? "").slice(0, 300)}`)
    const r: any = await wait(s, sent.hash)
    return { txHash: sent.hash, value: r.returnValue ? scValToNative(r.returnValue) : null }
  }
}
