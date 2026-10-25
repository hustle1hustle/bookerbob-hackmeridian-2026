// Full cycle on testnet through the real SDK and backend, as a new guest would do it in the app:
// new stay -> demo desk checkout -> anonymous review -> double review rejected -> test USDC -> full booking
// -> discounted booking -> discount replay rejected -> disclosure to arbiter -> attest.
// Usage: API=http://localhost:8080 node scripts/e2e.ts
import assert from "node:assert/strict"
import { createSdk, isErr, formatUsdc } from "../packages/sdk/src/index.ts"
import { currentSeason } from "../packages/sdk/src/derive.ts"

const mem = new Map<string, string>()
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
const sdk = createSdk({ mode: "testnet", testnet: { apiUrl: process.env.API ?? "http://localhost:8080", storage } })
const MERCHANT = Number(process.env.MERCHANT ?? 4)
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ok = <T>(label: string, r: any): T => {
  if (isErr(r)) throw new Error(`${label}: ${r.error} ${r.message ?? ""}`)
  log(label, r.txHash ? sdk.chain.explorerTx(r.txHash) : "", JSON.stringify(r, (_, v) => (typeof v === "bigint" ? formatUsdc(v) : v)).slice(0, 160))
  return r as T
}

const places = await sdk.chain.listMerchants()
log("places", places.map((p) => `${p.id}:${p.kind}:${p.name} ${p.ratingCount} reviews`).join(" | "))

const stay = sdk.stays.create(MERCHANT)
ok("checkout (demo desk)", await sdk.chain.checkout(MERCHANT, stay.commitment))
await sdk.stays.sync()
assert.ok(sdk.stays.list()[0].checkedIn)

const stages: string[] = []
let review: any
const fresh = sdk.stays.list()[0]
for await (const ev of sdk.prover.prove({ kind: "review", stay: fresh, rating: 5, text: `e2e review ${new Date().toISOString()}` })) {
  if (ev.stage !== "download" || !stages.includes("download")) stages.push(ev.stage)
  if (ev.stage === "done") review = ev.result
}
log("stages", stages.join(" > "))
ok("review", review)
const again = await sdk.chain.postReview(sdk.stays.list()[0], 4, "second try")
assert.deepEqual(isErr(again) && again.error, "NullifierUsed")
log("double review rejected", "NullifierUsed")

await sdk.wallet.connect("local")
await new Promise((r) => setTimeout(r, 4000)) // friendbot
ok("faucet", await sdk.chain.faucet())
log("balance", formatUsdc((await sdk.chain.balance())!))
ok("book full price", await sdk.chain.book(MERCHANT))
const disc = ok<any>("book with discount", await sdk.chain.bookWithDiscount(sdk.stays.list()[0], currentSeason()))
log("paid", formatUsdc(disc.paid), "saved", formatUsdc(disc.saved))
const replay = await sdk.chain.bookWithDiscount(sdk.stays.list()[0], currentSeason())
assert.deepEqual(isErr(replay) && replay.error, "NullifierUsed")
log("discount replay rejected", "NullifierUsed")

const pkg = await sdk.disclosure.build(sdk.stays.list()[0])
ok("dispute submitted", await sdk.disclosure.submit(pkg))
const check = await sdk.disclosure.checkDispute(pkg.reviewId)
const q = await sdk.disclosure.queue()
assert.ok(q.every((d) => d.pkg === undefined), "queue must not leak packages")
assert.deepEqual(check, { commitmentMatches: true, signatureValid: true, leafInTree: true })
ok("attest (demo arbiter)", await sdk.chain.attest(pkg.reviewId))
const reviews = await sdk.chain.getReviews(MERCHANT)
const mine = reviews.find((r) => r.id === pkg.reviewId)!
assert.ok(mine.verified && mine.text?.startsWith("e2e review"))
// context perks: the stay above was also enrolled in the chain group (its place joined the network),
// so a place this guest never visited prices the network perk; one stacked booking
const OTHER = Number(process.env.OTHER ?? 1)
const perks = await sdk.chain.perks(OTHER)
log("perks at", OTHER, JSON.stringify(perks, (_, v) => (typeof v === "bigint" ? formatUsdc(v) : v)))
if (perks && perks.bps > 0) {
  const ctx = ok<any>("book with perks", await sdk.chain.bookWithPerks(OTHER, currentSeason()))
  log("paid", formatUsdc(ctx.paid), "saved", formatUsdc(ctx.saved), "bps", ctx.bps)
}
log("E2E OK", { reviewId: mine.id, verified: mine.verified })
process.exit(0)
