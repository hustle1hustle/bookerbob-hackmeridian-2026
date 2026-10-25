// pol-real: the Claude Design deliverable's data module (same exports as design/pol-mock.js), backed by the real
import { Buffer } from "buffer"
;(globalThis as any).Buffer ??= Buffer
// Proof of Loyalty SDK, contract and BookerBob backend. The design HTML imports this instead of the mock and is
// otherwise unchanged. Field-by-field mapping and gaps: docs/design-binding.md.
import { Keypair, TransactionBuilder, contract as sc } from "@stellar/stellar-sdk"
import { sha256 } from "ethers/crypto"
import { toUtf8Bytes, toBeHex } from "ethers/utils"
import { poseidon2 } from "poseidon-lite"
import { createTestnetSdk } from "../../packages/sdk/src/testnet.ts"
import { getClient, views, proofArg, parseContractError, TESTNET, type Signer } from "../../packages/sdk/src/contract.ts"
import * as d from "../../packages/sdk/src/derive.ts"
import { loadArtifacts, proveMembership, artifactsCached } from "../../packages/sdk/src/prove.ts"
import { buildDisclosure } from "../../packages/sdk/src/disclosure.ts"
import type { Stay } from "../../packages/sdk/src/types.ts"

const API = (globalThis as any).POL_API ?? ""
const BRIDGE = (globalThis as any).POL_UCP_BRIDGE ?? "https://bookerbob-ucp-bridge.fly.dev"
const sdk = createTestnetSdk({ apiUrl: API })

// ---- constants the design reads ----
export const config: { forceError: string | null; firstProof: boolean; sparse: boolean } = { forceError: null, firstProof: true, sparse: false }
export let LEDGER_NOW = 0
export const LEDGER_SECONDS = 5
export const TREE_CAP = 1024
export const SEASON = { id: "1", label: "2026 · autumn" }
const SEASON_N = 1
export const EXPLORER = "https://stellar.expert/explorer/testnet/tx/"

/** Review text hash, as stored on chain: sha256 of the UTF-8 text. */
export function hashText(s: string): string {
  return sha256(toUtf8Bytes(s))
}

// verbatim from the design mock (pure helpers)
const round2 = (x: number) => Math.round(x * 100) / 100
export function groupLabel(group: string, kind: string) {
  if (group === "returning") return kind === "hotel" ? "returning guest" : "returning customer"
  return ({ network: "network member", traveler: "verified traveler" } as Record<string, string>)[group] || group
}
export function breakdown(subtotal: number, policy: { group: string; label: string; bps: number }[], max_bps: number, groups: string[]) {
  let used = 0
  const rows: any[] = []
  for (const p of policy) {
    if (!groups.includes(p.group)) continue
    const applied = Math.max(0, Math.min(p.bps, max_bps - used))
    used += applied
    rows.push({ group: p.group, label: p.label, bps: p.bps, applied, capped: applied < p.bps, amount: round2((subtotal * applied) / 10000) })
  }
  const saved = round2(rows.reduce((a, r) => a + r.amount, 0))
  return { rows, used, capped: rows.some((r) => r.capped), saved, total: round2(subtotal - saved) }
}

// ---- id mapping: the design hardcodes 0 (hotel), 1, 3 (café) and 4 (the real shop) ----
let UCP_MERCHANT = 5
const toMerchant = (pid: number) => (pid === 4 ? UCP_MERCHANT : pid === UCP_MERCHANT ? 4 : pid)
const toPlace = (mid: number) => (mid === UCP_MERCHANT ? 4 : mid === 4 ? UCP_MERCHANT : mid)
const err = (error: string, message?: string) => ({ error, message })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hex = (v: bigint | string) => "0x" + BigInt(v).toString(16).padStart(64, "0")

// group keys: returning = the place's own customers, network = chain group, traveler = REP verified traveler,
// any other attested provider = g<id>
let groupsMeta: { id: number; kind: string; name: string; size: number }[] = []
const groupKey = (ref: d.GroupRef, merchant: number) => {
  if (ref.kind === "merchant") return ref.id === merchant ? "returning" : `m${ref.id}`
  const g = groupsMeta.find((x) => x.id === ref.id)
  if (g?.kind === "chain") return "network"
  if (g?.kind === "attested" && /verified traveler/i.test(g.name)) return "traveler"
  return `g${ref.id}`
}

// ---- cached chain state ----
interface PlaceState { mid: number; m: any; catalog: any; policy: { items: { group: d.GroupRef; bps: number }[]; maxBps: number } | null; leaves: bigint[] }
let state: { places: PlaceState[]; reviews: Map<number, any[]>; texts: Record<string, string>; groupLeaves: Map<number, bigint[]>; spent: Set<string>; elig: Record<number, any[]> } | null = null
let loading: Promise<void> | null = null
const kindOut = (k: string) => (k === "cafe" ? "café" : k)

// the real store's products from the UCP bridge (title, USDC price, store price, variant)
let storeItems: any[] = []

// One shared /api/config read (the backend computes it per request, so do not ask twice).
let configP: Promise<any> | null = null
const apiConfig = () => (configP ??= fetch(`${API}/api/config`).then((r) => r.json()))

async function load() {
  // everything that does not need the contract id starts now, in parallel with /api/config
  const catalogP = fetch(`${API}/api/catalog`).then((r) => r.json())
  const ledgerP = fetch(`${API}/api/ledger`).then((r) => r.json()).catch(() => ({}))
  // the real store's products (UCP bridge); the first one is what Bob buys in ucp.run
  const storeP = fetch(`${BRIDGE}/search?q=tee`).then((r) => r.json()).catch(() => [])
  const read = await getClient({ ...TESTNET, contractId: (await apiConfig()).contractId })
  const [n, groups] = await Promise.all([views.merchantCount(read), views.groups(read)])
  groupsMeta = groups
  const ids = Array.from({ length: n }, (_, i) => i)
  // one wave: merchants, policies, leaves, group leaves and backend reviews all at once
  const [ms, policies, leaves, gLeaves, rlists, catalog, ledger, store] = await Promise.all([
    Promise.all(ids.map((i) => views.merchant(read, i))),
    Promise.all(ids.map((i) => views.policy(read, i))),
    Promise.all(ids.map((i) => views.leaves(read, i))),
    Promise.all(groups.map((g) => views.groupLeaves(read, g.id))),
    Promise.all(ids.map((i) => fetch(`${API}/api/reviews/${i}`).then((r) => r.json()))),
    catalogP,
    ledgerP,
    storeP,
  ])
  storeItems = Array.isArray(store) ? store : []
  LEDGER_NOW = ledger.sequence ?? LEDGER_NOW
  const ucp = ms.find((m) => m.kind === "shop" && !catalog[m.id] && /shopify|rep store/i.test(m.name))
  if (ucp) UCP_MERCHANT = ucp.id
  const places: PlaceState[] = ms.map((m, i) => ({ mid: m.id, m, catalog: catalog[m.id] ?? null, policy: policies[i], leaves: leaves[i] }))
  const reviews = new Map<number, any[]>()
  const texts: Record<string, string> = {}
  ids.forEach((i) => {
    reviews.set(i, rlists[i])
    for (const r of rlists[i]) if (r.text) texts["0x" + r.contentHash] = r.text
  })
  const groupLeaves = new Map<number, bigint[]>()
  groups.forEach((g, k) => groupLeaves.set(g.id, gLeaves[k]))
  state = { places, reviews, texts, groupLeaves, spent: new Set(), elig: {} }
  await refreshEligibility(read)
}

// Which of this browser's stays can claim each policy group at each place, and whether the nullifier is spent.
async function refreshEligibility(read: any) {
  if (!state) return
  const stays = sdk.stays.list()
  const master = (s: Stay) => sdk.stays.identity(s)
  for (const p of state.places) {
    const items = p.policy?.items ?? (p.m.discountBps ? [{ group: { kind: "merchant" as const, id: p.mid }, bps: p.m.discountBps }] : [])
    const out: any[] = []
    for (const it of items) {
      const key = groupKey(it.group, p.mid)
      const leaves = it.group.kind === "merchant" ? (state.places.find((x) => x.mid === it.group.id)?.leaves ?? []) : (state.groupLeaves.get(it.group.id) ?? [])
      const holder = stays.find((s) => leaves.includes(BigInt(s.commitment)))
      let used = false
      if (holder) {
        const scope = d.semaphoreHash(d.ctxScope(p.mid, it.group, SEASON_N))
        const nf = poseidon2([scope, master(holder).secretScalar])
        used = await read.is_spent({ scope_hash: scope, nullifier: nf }).then((t: any) => !!t.result).catch(() => false)
      }
      const kind = p.m.kind
      let reason = ""
      if (key === "returning") reason = !holder ? (kind === "hotel" ? "no stay here in this browser" : "no purchase here in this browser") : used ? "used this season. renews next season." : kind === "hotel" ? "you stayed here before. not which time." : "you bought here before. not what, not when."
      else if (key === "network") reason = !holder ? "no proven visit anywhere yet" : used ? "used here this season" : "you are a proven guest somewhere in the network. not where."
      else if (key === "traveler") reason = !holder ? "no attestation in this browser" : used ? "used here this season" : "an attester vouched for you. not who."
      else reason = !holder ? "not a member in this browser" : used ? "used here this season" : "a provider vouched for you. not who."
      out.push({ group: key, label: groupLabel(key, kind) === key ? (groupsMeta.find((g) => `g${g.id}` === key)?.name ?? key) : groupLabel(key, kind), bps: it.bps, eligible: !!holder && !used, reason, _ref: it.group, _holder: holder })
    }
    state.elig[toPlace(p.mid)] = out
  }
}

const ready = () => (loading ??= load())
const findP = (pid: number) => state?.places.find((p) => p.mid === toMerchant(pid))

export function reset(opts: { sparse?: boolean } = {}) {
  if ("sparse" in opts) config.sparse = !!opts.sparse
  loading = null
  void ready()
}

const pub = (p: PlaceState) => {
  const rs = state!.reviews.get(p.mid) ?? []
  const sum = rs.reduce((a: number, r: any) => a + r.rating, 0)
  const item = p.mid === UCP_MERCHANT ? storeItems[0] : null
  const offers =
    p.catalog?.offers ??
    (item
      ? [{ title: String(item.title).toLowerCase(), sub: item.storePrice ? `${Number(item.storePrice).toFixed(2)} ${String(item.storeCurrency ?? "").toLowerCase()} in the store` : "", price: Number(item.price) }]
      : [{ title: p.m.name, sub: "", price: Number(p.m.price) / 1e7 }])
  return {
    id: toPlace(p.mid),
    name: p.m.name,
    kind: kindOut(p.m.kind),
    area: p.catalog?.area ?? (p.mid === UCP_MERCHANT ? "online · shopify" : "lisbon"),
    note: p.catalog?.note ?? (p.mid === UCP_MERCHANT ? "A real test store on Shopify. Real purchases only, no seeded reviews." : ""),
    real: p.mid === UCP_MERCHANT,
    admin: p.m.admin,
    price: Number(p.m.price),
    discount_bps: p.m.discountBps,
    rating: rs.length ? sum / rs.length : null,
    rating_sum: sum,
    review_count: rs.length,
    verified_count: rs.filter((r: any) => r.verified).length,
    group_size: p.m.provenStays,
    roots: [hex(p.m.root)],
    offers: offers.map((o: any) => ({ ...o })),
  }
}

// prepared proofs for the next pay(): built during prover.prove('pay', ...)
let pending: { place: number; groups: string[]; payer: Keypair; claims: any[] } | null = null

async function freshPayer(kp: Keypair, amountRaw: bigint) {
  const c = await apiConfig()
  const post = (path: string, body: any) => fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) }).then((r) => r.json())
  const o = await post("/api/payer/open", { publicKey: kp.publicKey() })
  if (o.error) throw new Error(o.error)
  const tx = TransactionBuilder.fromXDR(o.xdr, c.networkPassphrase)
  tx.sign(kp)
  const a = await post("/api/payer/activate", { xdr: tx.toXDR(), amount: amountRaw })
  if (a.error) throw new Error(a.message ?? a.error)
  const s = sc.basicNodeSigner(kp, c.networkPassphrase)
  return { signer: { publicKey: kp.publicKey(), signTransaction: s.signTransaction, signAuthEntry: s.signAuthEntry } as Signer, net: { ...TESTNET, contractId: c.contractId }, post }
}

export const chain = {
  async placeCount() {
    await ready()
    return state!.places.length
  },
  async listPlaces() {
    await ready()
    // the design's place 4 is the real shop; keep the design's order (0..4 first)
    return state!.places.map(pub).sort((a, b) => a.id - b.id)
  },
  async getPlace(id: number) {
    await ready()
    const p = findP(id)
    return p ? pub(p) : err("HotelNotFound")
  },
  async getPolicy(id: number) {
    await ready()
    const e = state!.elig[id]
    const p = findP(id)
    if (!p) return err("HotelNotFound")
    return { policy: (e ?? []).map((x: any) => ({ group: x.group, label: x.label, bps: x.bps })), max_bps: p.policy?.maxBps ?? p.m.discountBps }
  },
  async getReviews(id: number) {
    await ready()
    const p = findP(id)
    const rs = (p && state!.reviews.get(p.mid)) || []
    return rs
      .map((r: any) => ({ id: `r-${r.id}`, hotel: id, rating: r.rating, content_hash: "0x" + r.contentHash, disclosure_commit: "0x" + r.disclosureCommit, nullifier: hex(r.nullifier), verified: r.verified, ledger: r.ledger, txHash: r.txHash ?? null, demoActivity: !!r.demoActivity }))
      .sort((a: any, b: any) => b.ledger - a.ledger)
  },
  async getDisputes() {
    const ds = await fetch(`${API}/api/disputes`).then((r) => r.json())
    return ds.map((x: any) => ({
      id: `d-${x.id}`,
      hotel: toPlace(x.merchant),
      reviewId: `r-${x.id}`,
      status: x.attestTx ? "attested" : x.disclosed ? "disclosed" : "awaiting",
      openedLedger: LEDGER_NOW - Math.round((Date.now() - x.openedAt) / 1000 / LEDGER_SECONDS),
      // the package is held by the arbiter's backend, never sent to browsers: show that it exists, not its contents
      package: x.disclosed ? { secret: "held by the arbiter", signature: "held by the arbiter", leafIndex: "·", commitment: "held by the arbiter" } : null,
    }))
  },
  async checkout(place: number, commitment: string) {
    if (config.forceError) return err(config.forceError)
    const c = String(commitment || "").trim().toLowerCase()
    if (!/^0x[0-9a-f]{16,64}$/.test(c)) return err("BadParams")
    const mid = toMerchant(place)
    const before = findP(place)?.m.root
    const r: any = await sdk.chain.checkout(mid, BigInt(c).toString())
    if (r.error) return err(r.error, r.message)
    loading = null
    await ready()
    const p = findP(place)!
    return { txHash: r.txHash, prevRoot: hex(before ?? 0), root: hex(r.root), leafIndex: p.leaves.findIndex((l) => l === BigInt(c)) }
  },
  // cart: { items: [{ title, price }] }; groups: proofs prepared by prover.prove('pay', place, { groups })
  async pay(place: number, cart: { items: { title: string; price: number }[] }, groups: string[] = []) {
    if (config.forceError) return err(config.forceError)
    await ready()
    const p = findP(place)
    if (!p) return err("HotelNotFound")
    if (p.mid === UCP_MERCHANT) return payUcp(cart, groups)
    const subtotal = round2((cart.items || []).reduce((a, i) => a + i.price, 0))
    if (!(subtotal > 0)) return err("BadParams")
    const listPrice = Number(p.m.price) / 1e7
    const single = cart.items.length === 1 && Math.abs(cart.items[0].price - listPrice) < 1e-9
    const pol = (await chain.getPolicy(place)) as any
    const bd = breakdown(subtotal, pol.policy, pol.max_bps, groups)
    try {
      const kp = pending && pending.place === place ? pending.payer : Keypair.random()
      let quote: any = null
      if (!single) {
        // the server prices the cart from its catalog and co-signs exactly that total
        const offers = p.catalog?.offers ?? []
        const counts = new Map<number, number>()
        for (const it of cart.items) {
          const idx = offers.findIndex((o: any) => it.title.startsWith(o.title) && Math.abs(o.price - it.price) < 1e-9)
          const per = offers.findIndex((o: any) => it.title.startsWith(o.title))
          const i = idx >= 0 ? idx : per
          if (i < 0) return err("BadParams")
          const qty = idx >= 0 ? 1 : Math.max(1, Math.round(it.price / offers[i].price))
          counts.set(i, (counts.get(i) ?? 0) + qty)
        }
        const q = await fetch(`${API}/api/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchant: p.mid, items: [...counts].map(([offer, qty]) => ({ offer, qty })) }) }).then((r) => r.json())
        if (q.error) return err(q.error)
        quote = q
      }
      const totalRaw = quote ? BigInt(quote.total) : p.m.price
      const { signer, net, post } = await freshPayer(kp, totalRaw)
      const client = await getClient(net, signer)
      const claims = pending && pending.place === place ? pending.claims.filter((c) => groups.includes(c.key)) : []
      pending = null
      let tx: any
      if (claims.length) tx = await (client as any).book_with_context({ merchant: p.mid, guest: kp.publicKey(), season: SEASON_N, amount: quote ? totalRaw : undefined, claims: claims.map((c) => c.arg) })
      else if (quote) tx = await (client as any).book_amount({ merchant: p.mid, guest: kp.publicKey(), amount: totalRaw, order_ref: Buffer.from(quote.orderRef, "hex") })
      else tx = await (client as any).book({ merchant: p.mid, guest: kp.publicKey() })
      if (quote) {
        await tx.signAuthEntries({
          address: p.m.admin,
          signAuthEntry: async (preimage: string) => {
            const r = await post("/api/cosign", { quoteId: quote.quoteId, preimage })
            if (r.error) throw new Error(r.error)
            return { signedAuthEntry: r.signature, signerAddress: p.m.admin }
          },
        })
      }
      await tx.sign()
      const sent = await post("/api/payer/feebump", { xdr: tx.signed.toXDR() })
      if (sent.error) {
        const m = String(sent.error).match(/^Contract(\d+)$/)
        return err(m ? (parseContractError(`Error(Contract, #${m[1]})`) ?? "BadParams") : sent.error, sent.message)
      }
      // the paying browser joins the place's customer tree through the demo desk (a new stay for this purchase)
      const stay = sdk.stays.create(p.mid)
      await sdk.chain.checkout(p.mid, stay.commitment)
      loading = null
      const paid = Number(BigInt(sent.value)) / 1e7
      return { txHash: sent.txHash, subtotal, discounts: bd.rows.filter((r: any) => r.applied), total: round2(paid), saved: round2(subtotal - paid) }
    } catch (e: any) {
      return err(parseContractError(e) ?? "BadParams", String(e?.message ?? e))
    }
  },
  async postReview(place: number, rating: number, text: string, membershipId: string) {
    if (config.forceError) return err(config.forceError)
    if (!(rating >= 1 && rating <= 5)) return err("BadRating")
    const stay = stayOf(membershipId)
    if (!stay || stay.merchant !== toMerchant(place)) return err("InvalidProof")
    const r: any = await sdk.chain.postReview(stay, rating as any, text || "")
    if (r.error) return err(r.error, r.message)
    loading = null
    return { txHash: r.txHash, reviewId: `r-${r.reviewId}` }
  },
  async openDispute(reviewId: string) {
    if (config.forceError) return err(config.forceError)
    const id = Number(String(reviewId).replace(/^r-/, ""))
    const r = await fetch(`${API}/api/disputes/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId: id }) }).then((x) => x.json())
    return r.error ? err(r.error) : { txHash: null }
  },
  async attest(reviewId: string) {
    if (config.forceError) return err(config.forceError)
    const r: any = await sdk.chain.attest(Number(String(reviewId).replace(/^r-/, "")))
    loading = null
    return r.error ? err(r.error, r.message) : { txHash: r.txHash }
  },
}

// ---- browser-only state ----
const stayId = (s: Stay) => `m-${s.merchant}-${s.stayIndex}`
const stayOf = (id: string) => sdk.stays.list().find((s) => stayId(s) === id)
const dateLine = (s: Stay, kind: string) => `${kind === "hotel" ? "stayed" : "bought"} · checked in ${new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toLowerCase()}`

export const local = {
  memberships() {
    if (!state) return []
    return sdk.stays
      .list()
      .map((s) => {
        const p = state!.places.find((x) => x.mid === s.merchant)
        const leaf = p ? p.leaves.findIndex((l) => l === BigInt(s.commitment)) : -1
        if (!p || leaf < 0) return null
        const ident = sdk.stays.identity(s)
        const nfReview = poseidon2([d.semaphoreHash(d.reviewScope(s.merchant)), ident.secretScalar])
        return {
          id: stayId(s),
          place: toPlace(s.merchant),
          what: p.m.kind === "hotel" ? "stay" : "purchase",
          when: dateLine(s, p.m.kind),
          leaf,
          season: SEASON.id,
          seasonLabel: SEASON.label,
          secret: "kept in this browser",
          commitment: hex(s.commitment),
          nullifierReview: hex(nfReview),
          reviewed: s.reviewId !== null,
          reviewId: s.reviewId !== null ? `r-${s.reviewId}` : null,
        }
      })
      .filter(Boolean)
  },
  credentials() {
    const att = groupsMeta.filter((g) => g.kind === "attested")
    return att.map((g) => {
      const leaves = state?.groupLeaves.get(g.id) ?? []
      const held = sdk.stays.list().some((s) => leaves.includes(BigInt(s.commitment)))
      const key = groupKey({ kind: "group", id: g.id }, -1)
      return { group: key, label: key === "traveler" ? "verified traveler" : g.name, from: key === "traveler" ? "issued by an attester. later, from a booking history proof." : `issued by ${g.name}.`, held }
    })
  },
  eligibility(placeId: number) {
    return (state?.elig[placeId] ?? []).map(({ _ref, _holder, ...x }: any) => x)
  },
}

export const disclosure = {
  async send(membershipId: string) {
    const s = stayOf(membershipId)
    if (!s || s.reviewId === null) return err("ReviewNotFound")
    const pkg = await sdk.disclosure.build(s)
    const r: any = await sdk.disclosure.submit(pkg)
    return r.error ? err(r.error) : { ok: true }
  },
}

const checks = new Map<string, Promise<any>>()
export const arbiter = {
  async check(disputeId: string, step: string) {
    const id = Number(String(disputeId).replace(/^d-/, ""))
    if (!checks.has(disputeId)) checks.set(disputeId, sdk.disclosure.checkDispute(id))
    const c = await checks.get(disputeId)
    // design step keys: commitment, signature, tree
    return !!({ commitment: c.commitmentMatches, signature: c.signatureValid, tree: c.leafInTree } as Record<string, boolean>)[step]
  },
}

export const backend = {
  async getText(hash: string) {
    await ready()
    return state!.texts[hash] ?? null
  },
}

/** Store orders from the UCP bridge's admin view: not available yet, the card drops (docs/design-binding.md). */
export const store = {
  async orders() {
    return []
  },
}

export const UCP_STEPS = [
  { label: "find the store", detail: "ucp discovery found rep store. it speaks checkout and cart, plus one extension: proof_of_loyalty." },
  { label: "add the t-shirt to the cart", detail: "" },
  { label: "claim returning customer", detail: "proof_of_loyalty extension · group: returning customer. no name, no email sent." },
  { label: "store offers 10% off, pending", detail: "" },
  { label: "make the proof, locally", detail: "semaphore v4, made on this device. your secret never leaves it." },
  { label: "stellar verifies, spends the nullifier", detail: "proof valid. the one-time nullifier is spent, so this discount cannot be reused. the store learns nothing about who." },
  { label: "discount confirmed", detail: "", failDetail: "discount removed. checkout cannot complete with this claim." },
  { label: "pay in usdc on stellar", detail: "" },
  { label: "order paid in the shopify admin", detail: "" },
  { label: "join the customer group", detail: "this purchase can now be reviewed, once. nobody knows who." },
]

// ---- UCP over the bridge (/buy/*) ----
const bpost = (path: string, body: any) => fetch(`${BRIDGE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) }).then((r) => r.json())

async function ensureWallet() {
  if (!sdk.wallet.address) await sdk.wallet.connect("local")
  if (((await sdk.chain.balance()) ?? 0n) < 100n * 10_000_000n) {
    for (let i = 0; i < 2; i++) {
      const f: any = await sdk.chain.faucet()
      if (!f.error) break
      await sleep(4000)
    }
  }
  return sdk.wallet.address!
}

async function* ucpRun(reuse: boolean): AsyncGenerator<any> {
  const cart: any = { items: [], discounts: [], total: 0, currency: "USDC", paid: false, tx: null }
  const snap = () => ({ type: "cart", cart: JSON.parse(JSON.stringify(cart)) })
  const step = (i: number, status: string, extra: any = {}) => ({ type: "step", i, status, detail: extra.detail ?? (status === "done" ? UCP_STEPS[i].detail : ""), ...extra })
  yield step(0, "running")
  const items = await fetch(`${BRIDGE}/search?q=tee`).then((r) => r.json()).catch(() => [])
  const item = items[0]
  if (!item) return yield step(0, "failed", { error: "Network", detail: "the store did not answer." })
  yield step(0, "done")
  yield step(1, "running")
  cart.items.push({ title: String(item.title).toLowerCase(), price: Number(item.price) })
  cart.total = Number(item.price)
  yield snap()
  yield step(1, "done", { detail: `1 × ${String(item.title).toLowerCase()} · ${Number(item.price).toFixed(2)} usdc` })
  const payer = await ensureWallet()
  await ready()
  const shopStay = sdk.stays.list().find((s) => s.merchant === UCP_MERCHANT && (findP(4)?.leaves ?? []).includes(BigInt(s.commitment)))
  const claim = !!shopStay || reuse
  const next = sdk.stays.create(UCP_MERCHANT)
  yield step(2, "running")
  const st = await bpost("/buy/start", { variantId: item.variantId, qty: 1, claim, nextCommitment: next.commitment })
  if (st.error) return yield step(2, "failed", { error: st.error, detail: String(st.error) })
  yield step(2, "done", { detail: claim ? UCP_STEPS[2].detail : "no past purchase in this browser, so no claim. full price." })
  if (claim && st.action) {
    yield step(3, "running")
    const off = round2(Number(item.price) * (st.action.discount_bps / 10000))
    cart.discounts.push({ label: `returning customer −${st.action.discount_bps / 100}%`, amount: off, proven: false })
    cart.total = round2(Number(item.price) - off)
    yield snap()
    yield step(3, "done", { detail: `provisional ${off.toFixed(2)} usdc off, held until the proof checks out.` })
    yield step(4, "running")
    const artifacts = await loadArtifacts()
    const leaves = await views.leaves(await getClient({ ...TESTNET, contractId: (await apiConfig()).contractId }), UCP_MERCHANT)
    const holder = shopStay ?? next
    const mp = await proveMembership(sdk.stays.identity(holder), leaves, d.discountMessage(payer), d.discountScope(UCP_MERCHANT, st.action.scope.season), artifacts)
    yield step(4, "done")
    yield step(5, "running")
    const pr = await bpost("/buy/prove", { checkoutId: st.checkoutId, payer, root: mp.root.toString(), nullifier: mp.nullifier.toString(), proof: mp.proof })
    if (pr.error || !pr.verified) {
      const error = String(pr.code ?? pr.error ?? "InvalidProof")
      yield step(5, "failed", { error, detail: /Nullifier|#6/.test(error) ? "refused. this proof was spent before, so the nullifier check failed." : "refused. the proof did not check out, so the discount was never real." })
      cart.discounts[0].removed = true
      cart.total = Number(item.price)
      yield snap()
      return yield step(6, "failed", { detail: UCP_STEPS[6].failDetail })
    }
    yield step(5, "done")
    yield step(6, "running")
    cart.discounts[0].proven = true
    yield snap()
    yield step(6, "done", { detail: `−${cart.discounts[0].amount.toFixed(2)} usdc · total ${cart.total.toFixed(2)} usdc` })
  } else {
    for (const i of [3, 4, 5, 6]) yield step(i, "done", { detail: "skipped: no claim." })
  }
  yield step(7, "running")
  const q = await bpost("/buy/quote", { checkoutId: st.checkoutId, payer })
  if (q.error) return yield step(7, "failed", { error: q.error, detail: String(q.error) })
  const signed = await sdk.wallet.signTransaction(q.quote.tx_xdr)
  const sent = await bpost("/buy/send", { signedTxXdr: signed })
  if (sent.error) return yield step(7, "failed", { error: sent.error, detail: String(sent.error) })
  cart.paid = true
  cart.tx = sent.txHash
  cart.total = Number(BigInt(q.quote.pays_raw)) / 1e7
  yield snap()
  yield step(7, "done", { tx: sent.txHash, detail: `${cart.total.toFixed(2)} usdc on stellar.` })
  yield step(8, "running")
  const done = await bpost("/buy/complete", { checkoutId: st.checkoutId, txHash: sent.txHash })
  const orderId = done?.order?.name ?? done?.order?.id ?? null
  yield step(8, "done", { detail: orderId ? `order ${orderId} · paid · tx attached` : "paid · tx attached. the store records the order once draft orders are enabled." })
  yield step(9, "running")
  loading = null
  yield step(9, "done")
  if (orderId) yield { type: "store", storeView: { orderId, amount: cart.total, badges: cart.discounts.length ? ["verified returning customer"] : [], tx: sent.txHash } }
}

async function payUcp(cart: { items: { title: string; price: number }[] }, groups: string[]) {
  let last: any = null
  for await (const ev of ucpRun(groups.includes("returning"))) if (ev.type === "step") last = ev
  if (last?.status === "failed") return err(last.error ?? "BadParams")
  const tx = last?.tx
  const subtotal = round2(cart.items.reduce((a, i) => a + i.price, 0))
  return { txHash: tx ?? null, subtotal, discounts: [], total: subtotal, saved: 0 }
}

export const ucp = {
  run: ({ reuse = false } = {}) => ucpRun(reuse),
  reset() {},
}

export const prover = {
  get cached() {
    return artifactsCached()
  },
  resetCache() {},
  // Real stages: the proving files download once; for pay, one membership proof per group is made here, bound to a
  // fresh one-time payer address; review proofs are made in postReview (they bind the rating and text).
  async *prove(kind: string, place: number, args: { groups?: string[] } = {}) {
    await ready()
    const groups = args.groups || []
    const n = kind === "review" ? 1 : groups.length
    if (n && !artifactsCached()) {
      yield "download"
      await loadArtifacts()
    }
    if (kind === "review") {
      yield "proving"
    } else if (n) {
      const p = findP(place)!
      const elig = state!.elig[place] ?? []
      const payer = Keypair.random()
      const claims: any[] = []
      for (const g of groups) {
        yield "proving"
        const e = elig.find((x: any) => x.group === g)
        if (!e?._holder) continue
        const leaves = e._ref.kind === "merchant" ? (state!.places.find((x) => x.mid === e._ref.id)?.leaves ?? []) : (state!.groupLeaves.get(e._ref.id) ?? [])
        const mp = await proveMembership(sdk.stays.identity(e._holder), leaves, d.discountMessage(payer.publicKey()), d.ctxScope(p.mid, e._ref, SEASON_N), await loadArtifacts())
        claims.push({ key: g, arg: { group: { tag: e._ref.kind === "merchant" ? "Merchant" : "Group", values: [e._ref.id] }, proof: proofArg(mp.proof), root: mp.root, nullifier: mp.nullifier } })
      }
      pending = { place, groups, payer, claims }
    }
    yield "verifying"
    yield "done"
  },
}

// Passkey first, Freighter as fallback; a demo key in this browser when neither is available.
export const wallet = {
  address: null as string | null,
  method: null as string | null,
  async connect(method = "passkey", _instant = false) {
    let used = method
    try {
      this.address = await sdk.wallet.connect(method === "freighter" ? "freighter" : "passkey")
    } catch {
      used = "demo key"
      this.address = await sdk.wallet.connect("local")
    }
    this.method = used
    return { address: this.address, method: used }
  },
  disconnect() {
    sdk.wallet.disconnect()
    this.address = null
    this.method = null
  },
  get signer() {
    return this.address ? { sign: async (x: string) => sdk.wallet.signTransaction(x) } : null
  },
}

void toBeHex
void sleep
