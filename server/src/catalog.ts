// Demo catalog (area, note, offers) for fictional places, and server-computed cart totals the demo desk co-signs.
// The server never co-signs a client-supplied amount: the total is computed here from offer indexes and quantities.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { xdr, Address, Keypair, scValToNative } from "@stellar/stellar-sdk"

export interface Offer { title: string; sub: string; price: number }
export interface CatalogEntry { area: string; note: string; offers: Offer[] }

export function loadCatalog(dir: string): Record<string, CatalogEntry> {
  const j = JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8"))
  delete j._note
  return j
}

const COSIGN_FNS = new Set(["book_with_context", "book_with_discount_amount", "book_amount"])
interface Quote { merchant: number; total: bigint; orderRef: string; at: number; used: boolean }

export class Quotes {
  private quotes = new Map<string, Quote>()
  networkId: string
  constructor(networkPassphrase: string) {
    this.networkId = createHash("sha256").update(networkPassphrase).digest("hex")
  }
  /** items: [{ offer: index, qty }] against the merchant's catalog entry. Returns raw USDC (7 decimals). */
  create(merchant: number, entry: CatalogEntry, items: { offer: number; qty: number }[]) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 20) throw new Error("BadParams")
    let cents = 0
    const lines: string[] = []
    for (const it of items) {
      const o = entry.offers[it.offer]
      const q = Number(it.qty)
      if (!o || !Number.isInteger(q) || q < 1 || q > 20) throw new Error("BadParams")
      cents += Math.round(o.price * 100) * q
      lines.push(`${q}x${it.offer}`)
    }
    const total = BigInt(cents) * 100_000n // cents -> 7 decimals
    const id = randomBytes(12).toString("hex")
    const orderRef = createHash("sha256").update(`${merchant}|${lines.join(",")}|${id}`).digest("hex")
    this.quotes.set(id, { merchant, total, orderRef, at: Date.now(), used: false })
    for (const [k, v] of this.quotes) if (Date.now() - v.at > 15 * 60_000) this.quotes.delete(k)
    return { quoteId: id, total, orderRef }
  }

  /** Signs a Soroban auth preimage for the merchant admin, only if it invokes our contract's booking function for
   *  this quote's merchant with exactly the quoted amount. Returns the base64 signature (what signAuthEntry returns). */
  cosign(quoteId: string, preimageB64: string, contractId: string, adminOf: (merchant: number) => Keypair | undefined): string {
    const q = this.quotes.get(quoteId)
    if (!q || q.used || Date.now() - q.at > 15 * 60_000) throw new Error("UnknownQuote")
    const pre: any = xdr.HashIdPreimage.fromXDR(preimageB64, "base64")
    const plain = JSON.parse(JSON.stringify(pre, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
    const auth = plain.soroban_authorization ?? plain.sorobanAuthorization ?? plain.soroban_authorization_with_address ?? plain.sorobanAuthorizationWithAddress
    const fn = auth?.invocation?.function?.contract_fn ?? auth?.invocation?.function?.contractFn
    if (!fn) throw new Error("BadParams")
    if ((auth.network_id ?? auth.networkId) !== this.networkId) throw new Error("BadParams")
    const target = fn.contract_address ?? fn.contractAddress
    const name = fn.function_name ?? fn.functionName
    if (target !== contractId || !COSIGN_FNS.has(name)) throw new Error("BadParams")
    const args: any[] = fn.args
    const merchant = Number(args[0]?.u32)
    // amount position: book_with_context(merchant, guest, season, amount: Option<i128>, ...), book_amount(merchant, guest, amount, ...),
    // book_with_discount_amount(merchant, guest, season, amount, ...)
    const amountArg = name === "book_amount" ? args[2] : args[3]
    const amount = BigInt(amountArg?.i128 ?? amountArg?.vec?.[0]?.i128 ?? -1)
    if (merchant !== q.merchant || amount !== q.total) throw new Error("AmountMismatch")
    const admin = adminOf(merchant)
    if (!admin) throw new Error("NotDemoMerchant")
    q.used = true
    void Address
    void scValToNative
    return Buffer.from(admin.sign(createHash("sha256").update(Buffer.from(preimageB64, "base64")).digest())).toString("base64")
  }
}
