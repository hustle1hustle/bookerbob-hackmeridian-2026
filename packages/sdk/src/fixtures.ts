// Mock fixture data matching the seed reality: 3 fictional Lisbon hotels (the hero), a café and a shop,
// 5 to 12 reviews per hotel, 1 to 3 arbiter-verified, and one place with 0 reviews to exercise empty states.
import type { Merchant, Review } from "./types.ts"

const U = 10_000_000n
const hex = (seed: number, len = 64) => {
  let s = ""
  let x = seed * 2654435761
  while (s.length < len) {
    x = (x * 1103515245 + 12345) >>> 0
    s += x.toString(16).padStart(8, "0")
  }
  return s.slice(0, len)
}
const dec = (seed: number) => BigInt("0x" + hex(seed, 62)).toString()

export const fixtureMerchants: Merchant[] = [
  { id: 0, kind: "hotel", admin: "GBNGYFWKDGSH6JFWKH4ADSVPTN4F6YWUOEQSJHE2NVPTPU4RVJ2YX4LK", name: "Casa Azulejo Nove", demo: true, price: 110n * U, discountBps: 1500, provenStays: 14, root: dec(1), ratingSum: 0, ratingCount: 0, verifiedCount: 0 },
  { id: 1, kind: "hotel", admin: "GA2MOCKHOTEL2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", name: "Pátio do Vento", demo: true, price: 95n * U, discountBps: 2000, provenStays: 9, root: dec(2), ratingSum: 0, ratingCount: 0, verifiedCount: 0 },
  { id: 2, kind: "hotel", admin: "GA3MOCKHOTEL3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", name: "Ribeira Slow House", demo: true, price: 140n * U, discountBps: 1000, provenStays: 6, root: dec(3), ratingSum: 0, ratingCount: 0, verifiedCount: 0 },
  { id: 3, kind: "cafe", admin: "GA4MOCKCAFE4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", name: "Café Lento", demo: true, price: 4n * U, discountBps: 2500, provenStays: 11, root: dec(4), ratingSum: 0, ratingCount: 0, verifiedCount: 0 },
  { id: 4, kind: "shop", admin: "GA5MOCKSHOP5XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", name: "Fio de Linho", demo: true, price: 38n * U, discountBps: 1000, provenStays: 2, root: dec(5), ratingSum: 0, ratingCount: 0, verifiedCount: 0 },
]

const texts: [number, 1 | 2 | 3 | 4 | 5, string | null, boolean][] = [
  [0, 5, "quiet room on the courtyard, breakfast was simple and honest", true],
  [0, 4, "great location, the tram is loud before 8", false],
  [0, 5, "staff remembered how I take my coffee by day two", true],
  [0, 3, "clean, but the wifi dropped every evening", false],
  [0, 4, "tiles everywhere, exactly what the photos promised", false],
  [0, 5, null, false],
  [0, 4, "good value for Alfama, small bathroom", false],
  [1, 4, "rooftop at sunset is the reason to stay", true],
  [1, 2, "street noise until 2am on Friday", false],
  [1, 4, "friendly, flexible checkout", false],
  [1, 5, "the seagull wake-up call is real and charming", true],
  [1, 3, "fine for two nights, beds are firm", false],
  [2, 5, "slow is the right word, in the best way", true],
  [2, 4, "river view room is worth the extra", false],
  [2, 4, "breakfast until noon, perfect after fado", false],
  [2, 3, "stairs only, heavy bags were a workout", false],
  [2, 5, "best sleep I had in Lisbon", false],
  [3, 5, "the pastel de nata comes out warm at 9", false],
  [3, 4, "good flat white, tiny tables", true],
  [3, 4, "quiet enough to work for an hour", false],
]

export const fixtureReviews: Review[] = texts.map(([merchant, rating, text, verified], i) => ({
  id: i,
  merchant,
  rating,
  contentHash: hex(100 + i),
  text,
  disclosureCommit: hex(200 + i),
  nullifier: dec(300 + i),
  verified,
  ledger: 1_200_000 + i * 731,
  time: Date.now() - (texts.length - i) * 3_600_000 * 5,
  txHash: hex(400 + i),
}))

// Derive aggregates from the reviews so the numbers are consistent.
for (const h of fixtureMerchants) {
  const rs = fixtureReviews.filter((r) => r.merchant === h.id)
  h.ratingSum = rs.reduce((a, r) => a + r.rating, 0)
  h.ratingCount = rs.length
  h.verifiedCount = rs.filter((r) => r.verified).length
}

export const mockHex = hex
export const mockDec = dec
