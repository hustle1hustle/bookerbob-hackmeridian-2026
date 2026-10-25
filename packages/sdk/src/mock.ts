// In-memory mock of all SDK bind points. Same types as the testnet implementation; timings mimic the real flow.
import type { Chain, Disclosure, Merchant, ProofEvent, ProofRequest, Prover, Review, Sdk, Stay, Stays, Wallet, WalletKind, WriteResult } from "./types.ts"
import { isErr } from "./types.ts"
import { fixtureMerchants, fixtureReviews, mockDec, mockHex } from "./fixtures.ts"

export interface MockOptions {
  /** Multiplies all delays; 0 makes the mock instant (tests, screenshots). */
  speed?: number
  /** Force the next write to fail with this error (to screenshot error states). */
  failNext?: () => import("./types.ts").ErrorName | null
}

export function createMockSdk(opts: MockOptions = {}): Sdk {
  const speed = opts.speed ?? 1
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * speed))
  const merchants: Merchant[] = structuredClone(fixtureMerchants)
  const reviews: Review[] = structuredClone(fixtureReviews)
  const spent = new Set<string>()
  const leaves = new Set<string>()
  let filesCached = false
  let txSeed = 1000
  const tx = () => mockHex(txSeed++)
  const forced = () => opts.failNext?.() ?? null

  // ---- wallet ----
  let address: string | null = null
  let kind: WalletKind | null = null
  const listeners = new Set<(a: string | null) => void>()
  const wallet: Wallet = {
    get address() {
      return address
    },
    get kind() {
      return kind
    },
    async connect(k: WalletKind = "passkey") {
      await sleep(400)
      address = "GD7BGIJFPGQROLTO3TNWZG4Q4H4EDDSL6XZ2ENPKVGMBYEUJA6FDPWG4"
      kind = k
      listeners.forEach((cb) => cb(address))
      return address
    },
    disconnect() {
      address = null
      kind = null
      listeners.forEach((cb) => cb(null))
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }

  // ---- stays (local) ----
  const myStays: Stay[] = [
    { merchant: 0, stayIndex: 0, commitment: mockDec(900), createdAt: Date.now() - 86_400_000 * 40, checkedIn: true, reviewId: null, discountSeasonsUsed: [] },
    { merchant: 1, stayIndex: 0, commitment: mockDec(901), createdAt: Date.now() - 86_400_000 * 10, checkedIn: true, reviewId: 10, discountSeasonsUsed: [] },
  ]
  myStays.forEach((s) => leaves.add(`${s.merchant}:${s.commitment}`))
  const stays: Stays = {
    list: () => myStays,
    create(merchant) {
      const idx = myStays.filter((s) => s.merchant === merchant).length
      const s: Stay = { merchant, stayIndex: idx, commitment: mockDec(1000 + myStays.length), createdAt: Date.now(), checkedIn: false, reviewId: null, discountSeasonsUsed: [] }
      myStays.push(s)
      return s
    },
    async sync() {
      await sleep(200)
      for (const s of myStays) s.checkedIn = leaves.has(`${s.merchant}:${s.commitment}`)
      return myStays
    },
  }

  const need = <T>(): WriteResult<T> | null => (address ? null : { error: "WalletNotConnected" })
  const merchantOr = (id: number) => merchants.find((h) => h.id === id)

  // ---- prover ----
  const prover: Prover = {
    ready: () => filesCached,
    async *prove(req: ProofRequest): AsyncIterable<ProofEvent> {
      const nw = need<never>()
      if (nw) return yield { stage: "done", result: nw }
      if (!filesCached) {
        const total = 4_200_000
        for (let loaded = 0; loaded < total; loaded += 700_000) {
          yield { stage: "download", loaded, total }
          await sleep(150)
        }
        yield { stage: "download", loaded: total, total }
        filesCached = true
      }
      yield { stage: "proving" }
      await sleep(700)
      yield { stage: "verifying" }
      await sleep(1500)
      const h = merchantOr(req.stay.merchant)
      const f = forced()
      if (f) return yield { stage: "done", result: { error: f } }
      if (!h) return yield { stage: "done", result: { error: "MerchantNotFound" } }
      if (!req.stay.checkedIn) return yield { stage: "done", result: { error: "UnknownRoot" } }
      if (req.kind === "review") {
        const key = `review:${h.id}:${req.stay.commitment}`
        if (spent.has(key) || req.stay.reviewId !== null) return yield { stage: "done", result: { error: "NullifierUsed" } }
        spent.add(key)
        const r: Review = {
          id: reviews.length,
          merchant: h.id,
          rating: req.rating,
          contentHash: mockHex(5000 + reviews.length),
          text: req.text,
          disclosureCommit: mockHex(6000 + reviews.length),
          nullifier: mockDec(7000 + reviews.length),
          verified: false,
          ledger: 1_300_000 + reviews.length,
          time: Date.now(),
          txHash: tx(),
        }
        reviews.push(r)
        h.ratingSum += r.rating
        h.ratingCount += 1
        req.stay.reviewId = r.id
        return yield { stage: "done", result: { txHash: r.txHash!, reviewId: r.id } }
      }
      const key = `discount:${h.id}:${req.season}:${req.stay.commitment}`
      if (spent.has(key) || req.stay.discountSeasonsUsed.includes(req.season)) return yield { stage: "done", result: { error: "NullifierUsed" } }
      spent.add(key)
      req.stay.discountSeasonsUsed.push(req.season)
      const paid = (h.price * BigInt(10_000 - h.discountBps)) / 10_000n
      return yield { stage: "done", result: { txHash: tx(), paid, saved: h.price - paid } }
    },
  }

  const drain = async <T>(req: ProofRequest): Promise<WriteResult<T>> => {
    let last: WriteResult<any> = { error: "Unknown" }
    for await (const ev of prover.prove(req)) if (ev.stage === "done") last = ev.result
    return last
  }

  // ---- chain ----
  const chain: Chain = {
    async listMerchants() {
      await sleep(250)
      return structuredClone(merchants)
    },
    async getMerchant(id) {
      await sleep(150)
      const h = merchantOr(id)
      if (!h) throw new Error("MerchantNotFound")
      return structuredClone(h)
    },
    async getReviews(merchant) {
      await sleep(200)
      return structuredClone(reviews.filter((r) => r.merchant === merchant).reverse())
    },
    explorerTx: (h) => `https://stellar.expert/explorer/testnet/tx/${h}`,
    explorerContract: () => "https://stellar.expert/explorer/testnet/contract/CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL",
    async checkout(merchant, commitment) {
      const nw = need<{ root: string }>()
      if (nw) return nw
      await sleep(1200)
      const f = forced()
      if (f) return { error: f }
      const h = merchantOr(merchant)
      if (!h) return { error: "MerchantNotFound" }
      if (!/^\d+$/.test(commitment) || commitment === "0") return { error: "BadLeaf" }
      const key = `${merchant}:${commitment}`
      if (leaves.has(key)) return { error: "DuplicateLeaf" }
      leaves.add(key)
      h.provenStays += 1
      h.root = mockDec(8000 + h.provenStays)
      return { txHash: tx(), root: h.root }
    },
    async book(merchant) {
      const nw = need<{ paid: bigint }>()
      if (nw) return nw
      await sleep(1200)
      const f = forced()
      if (f) return { error: f }
      const h = merchantOr(merchant)
      if (!h) return { error: "MerchantNotFound" }
      return { txHash: tx(), paid: h.price }
    },
    bookWithDiscount: (stay, season) => drain({ kind: "discount", stay, season }),
    postReview: (stay, rating, text) => drain({ kind: "review", stay, rating, text }),
    async attest(reviewId) {
      const nw = need()
      if (nw) return nw
      await sleep(1200)
      const r = reviews.find((x) => x.id === reviewId)
      if (!r) return { error: "ReviewNotFound" }
      if (!r.verified) {
        r.verified = true
        merchantOr(r.merchant)!.verifiedCount += 1
      }
      return { txHash: tx() }
    },
  }

  // ---- disclosure ----
  const disclosure: Disclosure = {
    async build(stay) {
      await sleep(300)
      return {
        reviewId: stay.reviewId ?? -1,
        merchant: stay.merchant,
        commitment: stay.commitment,
        leafIndex: 3,
        dk: mockDec(9100 + stay.stayIndex),
        signature: { r8: [mockDec(9200), mockDec(9201)], s: mockDec(9202) },
        publicKey: [mockDec(9300), mockDec(9301)],
      }
    },
    async check(pkg) {
      await sleep(900)
      const ok = pkg.reviewId >= 0
      return { commitmentMatches: ok, signatureValid: ok, leafInTree: ok }
    },
  }

  return { mode: "mock", chain, prover, wallet, stays, disclosure }
}

export { isErr }
