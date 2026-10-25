// node --test agent/src/rank.test.ts   (no network)
import { test } from "node:test"
import assert from "node:assert/strict"
import type { Merchant, Review } from "../../packages/sdk/src/types.ts"
import { fixtureMerchants, fixtureReviews } from "../../packages/sdk/src/fixtures.ts"
import { PRIOR_WEIGHT, parseQuery, pickHeadline, rank } from "./rank.ts"

const U = 10_000_000n
const place = (id: number, kind: string, price: number, name = `p${id}`): Merchant => ({
  id, kind, name, admin: "G", demo: true, price: BigInt(price) * U, discountBps: 1000, provenStays: 0, root: "1", ratingSum: 0, ratingCount: 0, verifiedCount: 0,
})
let rid = 0
const review = (merchant: number, rating: 1 | 2 | 3 | 4 | 5, verified = false): Review => ({
  id: rid++, merchant, rating, verified, contentHash: "", text: null, disclosureCommit: "", nullifier: String(rid), ledger: 1, time: null, txHash: null,
})

test("parseQuery reads kind and max price", () => {
  assert.deepEqual(parseQuery("hotel in lisbon under 120"), { text: "hotel in lisbon under 120", kind: "hotel", maxPrice: 120 })
  assert.equal(parseQuery("coffee below 5 usdc").kind, "cafe")
  assert.equal(parseQuery("coffee below 5 usdc").maxPrice, 5)
  assert.equal(parseQuery("a shop, 40 USDC max").maxPrice, 40)
  assert.equal(parseQuery("somewhere nice").kind, undefined)
  assert.equal(parseQuery("somewhere nice").maxPrice, undefined)
})

test("a single 5 star review does not beat many strong reviews (Bayesian prior)", () => {
  const ps = [place(0, "hotel", 100), place(1, "hotel", 100)]
  const rs = [review(0, 5), ...Array.from({ length: 10 }, () => review(1, 5)), ...Array.from({ length: 2 }, () => review(1, 4))]
  const r = rank(ps, rs, "hotel")
  assert.equal(r[0].place.id, 1)
  assert.ok(PRIOR_WEIGHT > 0)
})

test("verified stays weigh more", () => {
  const ps = [place(0, "hotel", 100), place(1, "hotel", 100)]
  // same ratings, place 1's 5-star reviews are arbiter-verified
  const rs = [review(0, 5), review(0, 5), review(0, 3), review(1, 5, true), review(1, 5, true), review(1, 3)]
  const r = rank(ps, rs, "hotel")
  assert.equal(r[0].place.id, 1)
  assert.match(r[0].reason, /2 verified/)
})

test("places with 0 proven reviews rank last, cheapest first among them", () => {
  const ps = [place(0, "hotel", 90), place(1, "hotel", 150), place(2, "hotel", 80), place(3, "hotel", 200)]
  const rs = [review(1, 2), review(3, 3)]
  const ids = rank(ps, rs, "hotel").map((x) => x.place.id)
  assert.deepEqual(ids.slice(2), [2, 0])
  assert.equal(rank(ps, rs, "hotel")[3].reason, "no proven reviews yet, 90 USDC")
})

test("kind and price filters leave places out", () => {
  const ps = [place(0, "hotel", 110), place(1, "hotel", 140), place(2, "cafe", 4)]
  const r = rank(ps, [], "hotel under 120")
  assert.deepEqual(r.map((x) => x.place.id), [0])
  assert.equal(rank(ps, [], "cafe").length, 1)
  assert.equal(rank(ps, [], "anything").length, 3)
})

test("reason line reads like the handoff", () => {
  const ps = [place(0, "hotel", 110)]
  const rs = [review(0, 5, true), review(0, 4, true), review(0, 5)]
  assert.equal(rank(ps, rs, "hotel under 120")[0].reason, "4.7 from 3 proven reviews, 2 verified, under 120 USDC")
  assert.equal(pickHeadline(parseQuery("hotel under 120")), "best proven hotel rating under 120 USDC")
})

test("seed fixtures: the hero pick under 120 is a hotel within budget", () => {
  const r = rank(fixtureMerchants, fixtureReviews, "hotel under 120")
  assert.ok(r.length > 0)
  assert.ok(r.every((x) => x.place.kind === "hotel" && x.priceUsdc <= 120))
  assert.ok(r[0].score !== null)
})
