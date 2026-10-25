// The store's UCP surface with the patronage extension. A thin business-side bridge in front of
// the Shopify store's own UCP endpoint: catalog and cart calls pass through, checkout calls gain
// com.bookerbob.patronage and a Stellar USDC payment handler.
//   GET  /.well-known/ucp   business profile
//   POST /mcp               UCP over MCP (JSON-RPC 2.0)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createHash, randomBytes } from "node:crypto"
import { Keypair } from "@stellar/stellar-sdk"
import { SHOP, StoreError, createSingleUseCode, deactivateCode, recordPaidOrder, storeManifest, storeRpc, storeTool, ordersWithCode } from "./shopify.ts"
import { MERCHANT, NET, insertCommitment, isAccount, merchant, readPayment, simulateDiscount, isSpent, contractError, quotePayment, redeem, sendSigned } from "./core.ts"
import { EXT_VERSION, NS, STELLAR_HANDLER_ID, STELLAR_HANDLER_NS, RAW_PER_STORE_MINOR, claims, decorate, openSession, save, session, st, type Session } from "./patronage.ts"

const PORT = Number(process.env.PORT ?? 8787)
const PUBLIC_URL = (process.env.UCP_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "")
const SPEC_URL = process.env.UCP_EXT_SPEC_URL ?? "https://github.com/hustle1hustle/bookerbob-hackmeridian-2026/blob/main/docs/ucp-patronage.md"
const ADMIN = process.env.UCP_SHOP_ADMIN_SECRET ? Keypair.fromSecret(process.env.UCP_SHOP_ADMIN_SECRET) : null
const CODE_LIFE_SEC = 30 * 60

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---- business profile ---------------------------------------------------------------

async function profile() {
  const base = await storeManifest()
  const ucp = base.ucp
  ucp.services["dev.ucp.shopping"] = (ucp.services["dev.ucp.shopping"] ?? [])
    .filter((s: any) => s.transport === "mcp")
    .map((s: any) => ({ ...s, endpoint: `${PUBLIC_URL}/mcp` }))
  const m = await merchant()
  ucp.capabilities[NS] = [
    {
      version: EXT_VERSION,
      spec: SPEC_URL,
      extends: "dev.ucp.shopping.checkout",
      config: { network: "stellar:testnet", contract: NET.contractId, merchant_id: MERCHANT, proof_system: "semaphore-v4 groth16 bn254", tree_depth: 10, discount_bps: m.discountBps },
    },
  ]
  ucp.payment_handlers = {
    ...(ucp.payment_handlers ?? {}),
    [STELLAR_HANDLER_NS]: [
      {
        id: STELLAR_HANDLER_ID,
        version: EXT_VERSION,
        spec: SPEC_URL,
        config: {
          network: "stellar:testnet",
          contract: NET.contractId,
          merchant_id: MERCHANT,
          asset: { code: "USDC", sac: process.env.USDC_SAC_ID, issuer: process.env.USDC_ISSUER, decimals: 7 },
          price_raw: m.price.toString(),
          functions: { full_price: "book(merchant, payer)", returning: "book_with_discount(merchant, payer, season, proof, root, nullifier)" },
          credential: { type: "stellar_tx", tx_hash: "hex" },
        },
      },
    ],
  }
  return base
}

// ---- tools ----------------------------------------------------------------------------

const err = (code: string, content: string) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ code, content }) }] })
const ok = (payload: any) => ({ structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] })

/** Strips our extension from what goes to the store; the store would ignore it anyway. */
function forStore(args: any) {
  const a = structuredClone(args ?? {})
  delete a.meta
  if (a.checkout) {
    delete a.checkout[NS]
    delete a.checkout[STELLAR_HANDLER_NS]
    if (Array.isArray(a.checkout.context?.eligibility)) {
      a.checkout.context.eligibility = a.checkout.context.eligibility.filter((x: string) => x !== NS)
      if (!a.checkout.context.eligibility.length) delete a.checkout.context.eligibility
    }
  }
  return a
}

async function createCheckout(args: any) {
  const co = await storeTool("create_checkout", forStore(args))
  const claimed = claims(args.checkout)
  const s = co?.id ? openSession(co.id, claimed) : undefined
  takeCommitment(s, args.checkout)
  if (s) log(`checkout ${short(s.checkoutId)} created${claimed ? ", patronage claimed" : ""}`)
  return decorate(co, s)
}

function takeCommitment(s: Session | undefined, checkout: any) {
  const c = checkout?.[NS]?.next_commitment
  if (s && c && /^\d{1,78}$/.test(String(c)) && !s.paid) {
    s.nextCommitment = String(c)
    save()
  }
}

async function updateCheckout(args: any) {
  const id = String(args.id ?? "")
  let s = session(id)
  if (claims(args.checkout)) s = openSession(id, true)
  takeCommitment(s, args.checkout)
  const proof = args.checkout?.[NS]?.proof
  if (proof) {
    if (!s?.claimed) return err("eligibility_not_claimed", `claim ${NS} in context.eligibility first`)
    const r = await verifyProof(s, proof)
    if (!r.ok) {
      // eligibility_invalid is recoverable: the agent can drop the claim and pay full price.
      const co = await storeTool("get_checkout", { id })
      const out = await decorate(co, s)
      out.messages = [...(out.messages ?? []), { type: "error", code: "eligibility_invalid", path: `$.${NS}.proof`, content: r.error, severity: "recoverable" }]
      return out
    }
  }
  // Only the extensions changed: no store round trip needed beyond a read.
  const rest = forStore(args)
  const touchesStore = rest.checkout && Object.keys(rest.checkout).length > 0
  const co = touchesStore ? await storeTool("update_checkout", rest) : await storeTool("get_checkout", { id })
  const out = await decorate(co, s)
  const ask = args.checkout?.[STELLAR_HANDLER_NS]
  if (ask?.payer) {
    const q = s ? await quote(s, co, String(ask.payer)) : { error: "unknown checkout" }
    out[STELLAR_HANDLER_NS] = q
  }
  return out
}

const orderRefOf = (s: Session) => createHash("sha256").update(`ucp:${SHOP}:${s.checkoutId}`).digest()

/**
 * Stellar rail: the merchant admin co-signs the pre-discount items amount and an order ref for this
 * checkout; the payer signs and sends. The contract applies the discount, so the store's code and the
 * chain cannot disagree on the percentage. Shipping stays off chain in this demo.
 */
async function quote(s: Session, co: any, payer: string) {
  if (!ADMIN) return { error: "merchant admin key not configured" }
  if (!isAccount(payer)) return { error: "payer must be a Stellar address" }
  if (s.claimed && !s.verified) return { error: `resolve the ${NS} claim first` }
  if (s.verified && payer !== s.verified.guest) return { error: "the payer must be the one the proof is bound to" }
  if (s.verified && !(co.discounts?.codes ?? []).map((c: string) => c.toUpperCase()).includes(s.code!.code)) return { error: "apply the returning-customer code first" }
  const itemsMinor = co?.totals?.find((t: any) => t.type === "subtotal")?.amount
  if (!Number.isInteger(itemsMinor) || itemsMinor <= 0) return { error: "empty cart" }
  const amount = BigInt(itemsMinor) * RAW_PER_STORE_MINOR
  const orderRef = orderRefOf(s)
  try {
    const xdr = await quotePayment(ADMIN, {
      guest: payer,
      amount,
      orderRef,
      discount: s.verified ? { season: s.season, proof: s.verified.proof, root: BigInt(s.verified.root), nullifier: BigInt(s.verified.nullifier) } : undefined,
    })
    s.quote = { payer, amount: amount.toString(), orderRef: orderRef.toString("hex"), itemsMinor, at: Date.now() }
    save()
    const bps = s.verified ? (await merchant()).discountBps : 0
    log(`checkout ${short(s.checkoutId)} quote co-signed: ${amount} raw${bps ? `, contract applies ${bps / 100}%` : ""}`)
    return { quote: { tx_xdr: xdr, amount_raw: amount.toString(), pays_raw: ((amount * BigInt(10_000 - bps)) / 10_000n).toString(), order_ref: orderRef.toString("hex"), function: s.verified ? "book_with_discount_amount" : "book_amount" } }
  } catch (e) {
    return { error: `could not co-sign: ${contractError(e)}` }
  }
}

async function verifyProof(s: Session, p: any): Promise<{ ok: true } | { ok: false; error: string }> {
  if (s.verified && s.code) return { ok: true }
  const payer = String(p.payer ?? "")
  if (!isAccount(payer)) return { ok: false, error: "payer must be a Stellar address" }
  let root: bigint, nullifier: bigint
  try {
    root = BigInt(p.root)
    nullifier = BigInt(p.nullifier)
  } catch {
    return { ok: false, error: "root and nullifier must be decimal integers" }
  }
  const proof = p.proof
  if (![proof?.a, proof?.b, proof?.c].every((x) => typeof x === "string" && /^[0-9a-f]+$/i.test(x)) || proof.a.length !== 128 || proof.b.length !== 256 || proof.c.length !== 128) {
    return { ok: false, error: "proof must be {a: 64-byte hex, b: 128-byte hex, c: 64-byte hex}" }
  }
  const key = nullifier.toString()
  // The contract is the verifier: a dry run of the exact call the payer will sign. It runs first
  // so a replayed or forged proof is refused by Stellar itself, not by bridge bookkeeping.
  const sim = await simulateDiscount(payer, s.season, proof, root, nullifier)
  if (!sim.ok) {
    log(`checkout ${short(s.checkoutId)} proof refused by the contract: ${sim.error}`)
    return { ok: false, error: `contract refused the proof: ${sim.error}` }
  }
  // Not yet spent on chain, but already backing another open checkout's code.
  const holder = st().nullifiers[key]
  if (holder && holder !== s.checkoutId) return { ok: false, error: "this past purchase already backs another open checkout this season" }
  const code = `BB-${randomBytes(6).toString("hex").toUpperCase()}`
  const bps = (await merchant()).discountBps
  const made = await createSingleUseCode(code, bps / 100, CODE_LIFE_SEC, `returning customer, proof checked on Stellar (${bps / 100}%)`)
  s.verified = { guest: payer, nullifier: key, root: root.toString(), proof, at: Date.now() }
  s.code = { code, id: made.id, endsAt: made.endsAt }
  st().nullifiers[key] = s.checkoutId
  save()
  log(`checkout ${short(s.checkoutId)} proof verified by contract simulation, single-use code issued`)
  return { ok: true }
}

async function completeCheckout(args: any) {
  const id = String(args.id ?? "")
  const s = session(id)
  const instruments: any[] = args.checkout?.payment?.instruments ?? []
  const stellar = instruments.find((i) => i?.handler_id === STELLAR_HANDLER_ID)
  if (s?.claimed && !s.verified) {
    return err("eligibility_unresolved", `the ${NS} claim is unresolved: prove it, or update the checkout without the claim`)
  }
  if (!stellar) {
    // Shopify test card path: the store completes; the bridge only records the join.
    const co = await storeTool("complete_checkout", { ...forStore(args), meta: { "idempotency-key": args.meta?.["idempotency-key"] } })
    if (s && co?.status === "completed") {
      await afterPaid(s, { via: "card", order: co.order ? { id: co.order.id, name: co.order.label ?? co.order.id } : null })
      // The card paid; Stellar still burns the discount nullifier, so one discount per purchase per season holds across rails.
      if (s.verified && ADMIN) {
        const v = s.verified
        const r = await redeem(ADMIN, { guest: v.guest, season: s.season, orderRef: orderRefOf(s), proof: v.proof, root: BigInt(v.root), nullifier: BigInt(v.nullifier) })
        if (r.ok) (s.paid!.redeemTx = r.txHash), save(), log(`checkout ${short(s.checkoutId)} nullifier burned on Stellar via redeem, tx ${r.txHash.slice(0, 10)}`)
        else log(`redeem failed: ${r.error}`)
      }
    }
    return decorate(co, s)
  }
  if (!s) return err("unknown_checkout", "this checkout was not created through this business endpoint")
  if (s.paid) return decorate(await storeTool("get_checkout", { id }), s)
  const txHash = String(stellar.credential?.tx_hash ?? "")
  if (!/^[0-9a-f]{64}$/i.test(txHash)) return err("payment_invalid", "credential.tx_hash must be a 64-hex Stellar transaction hash")
  if (st().usedTx[txHash]) return err("payment_invalid", "this transaction already paid another checkout")

  const co = await storeTool("get_checkout", { id })
  let paid
  try {
    paid = await readPayment(txHash)
  } catch (e) {
    return err("payment_invalid", `could not read the payment: ${contractError(e)}`)
  }
  if (paid.merchant !== MERCHANT) return err("payment_invalid", "payment went to another merchant")
  // The tx must be the one co-signed for this checkout: same order ref, amount and payer.
  if (!s.quote || paid.orderRef !== s.quote.orderRef || paid.quoted.toString() !== s.quote.amount || paid.guest !== s.quote.payer) {
    return err("payment_invalid", "payment is not the co-signed quote for this checkout")
  }
  if (s.verified) {
    if (paid.fn !== "book_with_discount_amount" || paid.nullifier?.toString() !== s.verified.nullifier || paid.season !== s.season) {
      return err("payment_invalid", "payment does not match the verified proof (nullifier or season)")
    }
  } else if (paid.fn !== "book_amount") {
    return err("payment_invalid", "a checkout without a verified claim is paid with book_amount()")
  }
  // The cart must not have changed since the quote.
  const subtotal = co?.totals?.find((t: any) => t.type === "subtotal")?.amount
  if (subtotal !== s.quote.itemsMinor) return err("payment_invalid", "the cart changed after the quote")

  st().usedTx[txHash] = s.checkoutId
  save()
  let order: { id: string; name: string } | null = null
  try {
    order = await recordPaidOrder({
      lines: (co.line_items ?? []).map((l: any) => ({ variantId: l.item.id, quantity: l.quantity })),
      code: s.code?.code,
      note: `Paid ${Number(paid.amount) / 1e7} test USDC on Stellar testnet, tx ${txHash}. Discount: ${s.verified ? "returning customer, proof verified on chain" : "none"}.`,
      tags: ["stellar-usdc", s.verified ? "patronage-proof" : "first-purchase"],
    })
  } catch (e) {
    log(`order not recorded in the store: ${(e as Error).message}`)
  }
  await afterPaid(s, { via: "stellar", txHash, order })
  const out = await decorate(co, s)
  out.status = "completed"
  out.order = order ? { id: order.id, label: order.name } : null
  out.payment = { ...(out.payment ?? {}), receipt: { handler_id: STELLAR_HANDLER_ID, tx_hash: txHash, amount_raw: paid.amount.toString(), explorer: `https://stellar.expert/explorer/testnet/tx/${txHash}` } }
  delete out.continue_url
  out.messages = (out.messages ?? []).filter((x: any) => x.type !== "error")
  return out
}

/** Paid: the buyer's fresh commitment joins the merchant tree, enabling a later review or discount. */
async function afterPaid(s: Session, paid: { via: "stellar" | "card"; txHash?: string; order?: { id: string; name: string } | null }) {
  s.paid = { ...paid, at: Date.now() }
  save()
  log(`checkout ${short(s.checkoutId)} paid via ${paid.via}${paid.order ? `, store order ${paid.order.name}` : ""}`)
  if (s.nextCommitment && ADMIN) {
    const r = await insertCommitment(ADMIN, BigInt(s.nextCommitment))
    if (r.ok) {
      s.paid.joinTx = r.txHash
      log(`checkout ${short(s.checkoutId)} buyer commitment joined the merchant tree, tx ${r.txHash.slice(0, 10)}`)
    } else log(`commitment insert failed: ${r.error} ${r.message}`)
    save()
  }
}

const short = (id: string) => id.split("/").pop()!.slice(0, 8)

const handlers: Record<string, (args: any) => Promise<any>> = {
  create_checkout: createCheckout,
  update_checkout: updateCheckout,
  complete_checkout: completeCheckout,
  get_checkout: async (args) => decorate(await storeTool("get_checkout", forStore(args)), session(String(args.id ?? ""))),
}

async function toolsList() {
  const r = await storeRpc("tools/list", {})
  for (const t of r.tools ?? []) {
    if (["create_checkout", "update_checkout", "get_checkout"].includes(t.name)) {
      t.description = `${t.description ?? ""}\n\nExtension ${NS}: claim "${NS}" in checkout.context.eligibility to ask for the returning-customer discount. The response carries checkout["${NS}"] with a verification action; answer it with update_checkout checkout["${NS}"].proof = {payer, root, nullifier, proof}. Optional checkout["${NS}"].next_commitment (decimal) joins the merchant's customer tree once paid.`
      t.inputSchema.properties.checkout.additionalProperties = true
    }
    if (t.name === "complete_checkout") {
      t.description = `${t.description ?? ""}\n\nPayment handler ${STELLAR_HANDLER_ID} (${STELLAR_HANDLER_NS}): pay on Stellar testnet with the core contract (book or book_with_discount), then pass {id, handler_id: "${STELLAR_HANDLER_ID}", type: "stellar_tx", credential: {type: "stellar_tx", tx_hash}}.`
    }
  }
  return r
}

async function rpcCall(body: any) {
  const { id, method, params } = body ?? {}
  const reply = (result: any) => ({ jsonrpc: "2.0", id, result })
  try {
    if (method === "initialize") return reply({ protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: `ucp-bridge ${SHOP}`, version: "0.1.0" } })
    if (method === "notifications/initialized") return null
    if (method === "tools/list") return reply(await toolsList())
    if (method === "tools/call") {
      const name = params?.name
      const h = handlers[name]
      if (!h) return reply(await storeRpc("tools/call", { name, arguments: params?.arguments ?? {} }))
      const out = await h(params?.arguments ?? {})
      return reply(out?.isError ? out : ok(out))
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } }
  } catch (e) {
    const msg = e instanceof StoreError ? e.message : `bridge error: ${(e as Error).message}`
    log(`${params?.name ?? method} failed: ${msg}`)
    return reply(err("bridge_error", msg))
  }
}

// Store-passthrough tools still need the agent profile; storeRpc does not add it.
handlers.search_catalog = (a) => storeTool("search_catalog", forStore(a))
handlers.lookup_catalog = (a) => storeTool("lookup_catalog", forStore(a))
handlers.get_product = (a) => storeTool("get_product", forStore(a))
for (const n of ["get_cart", "create_cart", "update_cart", "cancel_cart", "cancel_checkout", "get_order"]) handlers[n] = (a) => storeTool(n, forStore(a))

// ---- public search for the BookerBob site ("Ask Bob" federated search) ------------------
// GET /search?q=&max_price=   max_price and price are in test USDC (the chain's unit); the store's
// own price and currency ride along. Backed by the store's UCP catalog search.
const searchCache = new Map<string, { at: number; found: any }>()
async function search(q: string, maxPrice: number | null) {
  const key = (q || "rep").toLowerCase()
  let hit = searchCache.get(key)
  if (!hit || Date.now() - hit.at > 60_000) {
    hit = { at: Date.now(), found: await storeTool("search_catalog", { catalog: { query: key } }) }
    if (searchCache.size > 200) searchCache.clear()
    searchCache.set(key, hit)
  }
  const found = hit.found
  const m = await merchant()
  // Store-level ratings from proven buyers only (on chain); no scripted reviews on this real store.
  const proven = { provenRating: m.ratingCount ? Math.round((m.ratingSum / m.ratingCount) * 10) / 10 : null, reviewCount: m.ratingCount, verifiedCount: m.verifiedCount, provenCustomers: m.provenStays }
  const out = []
  for (const p of found.products ?? []) {
    const v = (p.variants ?? []).find((x: any) => x.availability?.available !== false) ?? p.variants?.[0]
    if (!v?.price) continue
    const price = Number(BigInt(v.price.amount) * RAW_PER_STORE_MINOR) / 1e7
    if (maxPrice !== null && price > maxPrice) continue
    out.push({
      source: "ucp",
      title: p.title,
      kind: "shop",
      price: Math.round(price * 100) / 100,
      currency: "USDC",
      storePrice: v.price.amount / 100,
      storeCurrency: v.price.currency,
      productId: p.id,
      variantId: v.id,
      merchantId: MERCHANT,
      imageUrl: v.media?.[0]?.url ?? p.media?.[0]?.url ?? null,
      url: p.url ?? null,
      ucp: `${PUBLIC_URL}/.well-known/ucp`,
      returningDiscountBps: m.discountBps,
      ...proven,
    })
  }
  return out
}

// ---- "Buy with Bob": REST over the same UCP steps, for the BookerBob web app -------------
// The browser's wallet only signs a prepared tx; everything else is the UCP checkout above.
const lines = (co: any) => co.line_items.map((l: any) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity }))
const total = (co: any, type: string) => co?.totals?.find((t: any) => t.type === type)?.amount ?? null
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

const buy: Record<string, (b: any) => Promise<any>> = {
  async start(b) {
    if (typeof b.variantId !== "string") return { error: "variantId required" }
    const co = await createCheckout({
      checkout: {
        line_items: [{ item: { id: b.variantId }, quantity: Math.max(1, Math.min(10, Number(b.qty) || 1)) }],
        buyer: { email: typeof b.email === "string" ? b.email : "buyer@example.com" },
        context: { address_country: "PT", ...(b.claim ? { eligibility: [NS] } : {}) },
        ...(b.nextCommitment ? { [NS]: { next_commitment: String(b.nextCommitment) } } : {}),
      },
    })
    return { checkoutId: co.id, currency: co.currency, subtotal: total(co, "subtotal"), provisionalDiscount: co.discounts?.applied?.find((d: any) => d.provisional)?.amount ?? 0, action: co[NS]?.action ?? null }
  },
  async prove(b) {
    let co = await updateCheckout({ id: b.checkoutId, checkout: { [NS]: { proof: { payer: b.payer, root: b.root, nullifier: b.nullifier, proof: b.proof } } } })
    if (co?.isError) return { error: JSON.parse(co.content[0].text).content }
    const v = co[NS]
    if (v?.status !== "verified") return { verified: false, error: co.messages?.find((m: any) => m.code === "eligibility_invalid")?.content ?? "not verified" }
    // A new Shopify code takes a few seconds to go live; the bridge applies it for the browser.
    for (let i = 0; i < 10; i++) {
      co = await updateCheckout({ id: b.checkoutId, checkout: { line_items: lines(co), discounts: { codes: [v.code] } } })
      if ((co.discounts?.applied ?? []).some((d: any) => !d.provisional && d.amount > 0)) break
      await sleep(3000)
    }
    const applied = (co.discounts?.applied ?? []).find((d: any) => !d.provisional)
    return { verified: true, code: v.code, discount: applied?.amount ?? 0, applied: !!applied, subtotal: total(co, "subtotal") }
  },
  async quote(b) {
    const co = await updateCheckout({ id: b.checkoutId, checkout: { [STELLAR_HANDLER_NS]: { payer: b.payer } } })
    return co?.[STELLAR_HANDLER_NS] ?? { error: "no quote" }
  },
  async send(b) {
    const r = await sendSigned(String(b.signedTxXdr ?? ""))
    return { txHash: r.txHash, paid: r.amount.toString() }
  },
  async complete(b) {
    const co = await completeCheckout({ meta: { "idempotency-key": randomBytes(16).toString("hex") }, id: b.checkoutId, checkout: { payment: { instruments: [{ id: `pi_${randomBytes(6).toString("hex")}`, handler_id: STELLAR_HANDLER_ID, type: "stellar_tx", credential: { type: "stellar_tx", tx_hash: b.txHash } }] } } })
    if (co?.isError) return { error: JSON.parse(co.content[0].text).content }
    return { status: co.status, order: co.order, receipt: co.payment?.receipt, joined: co[NS]?.paid?.joinTx ?? null }
  },
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((ok, no) => {
    let b = ""
    req.on("data", (c) => {
      b += c
      if (b.length > 1_000_000) no(new Error("too large"))
    })
    req.on("end", () => ok(b))
    req.on("error", no)
  })

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" })
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/.well-known/ucp") return send(res, 200, await profile())
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" })
      return void res.end()
    }
    const step = req.method === "POST" && req.url?.match(/^\/buy\/(start|prove|quote|send|complete)$/)?.[1]
    if (step) {
      try {
        return send(res, 200, await buy[step](JSON.parse(await readBody(req))))
      } catch (e) {
        return send(res, 200, { error: (e as Error).message.slice(0, 300) })
      }
    }
    if (req.method === "GET" && req.url?.startsWith("/search")) {
      const u = new URL(req.url, PUBLIC_URL)
      const mp = u.searchParams.get("max_price")
      const max = mp !== null && mp !== "" && Number.isFinite(Number(mp)) ? Number(mp) : null
      return send(res, 200, await search((u.searchParams.get("q") ?? "").slice(0, 100), max))
    }
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, shop: SHOP, merchant: MERCHANT })
    if (req.method === "POST" && req.url === "/mcp") {
      const out = await rpcCall(JSON.parse(await readBody(req)))
      if (out === null) return void (res.writeHead(202), res.end())
      return send(res, 200, out)
    }
    send(res, 404, { error: "not found" })
  } catch (e) {
    send(res, 400, { error: (e as Error).message })
  }
}).listen(PORT, () => log(`ucp bridge for ${SHOP} on ${PUBLIC_URL} (merchant ${MERCHANT}, admin ${ADMIN ? "set" : "missing"})`))

export { isSpent, ordersWithCode, deactivateCode }
