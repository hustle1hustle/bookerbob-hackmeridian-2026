// node packages/sdk/src/smoke.test.ts : walks the whole mock cycle, every bind point once.
import assert from "node:assert/strict"
import { createSdk, isErr, averageRating, formatUsdc } from "./index.ts"

const sdk = createSdk({ mode: "mock", mock: { speed: 0 } })
const hotels = await sdk.chain.listHotels()
assert.equal(hotels.length, 4)
assert.equal(averageRating(hotels[3]), null)

assert.deepEqual(await sdk.chain.book(0), { error: "WalletNotConnected" })
await sdk.wallet.connect()

const stay = sdk.stays.create(2)
const co = await sdk.chain.checkout(2, stay.commitment)
assert.ok(!isErr(co))
assert.deepEqual(await sdk.chain.checkout(2, stay.commitment), { error: "DuplicateLeaf" })
await sdk.stays.sync()
assert.ok(stay.checkedIn)

const stages: string[] = []
for await (const ev of sdk.prover.prove({ kind: "review", stay, rating: 5, text: "test" })) stages.push(ev.stage)
assert.deepEqual([...new Set(stages)], ["download", "proving", "verifying", "done"])
assert.deepEqual(await sdk.chain.postReview(stay, 4, "again"), { error: "NullifierUsed" })

const d = await sdk.chain.bookWithDiscount(stay, 1)
assert.ok(!isErr(d) && formatUsdc(d.paid) === "126.00")
assert.deepEqual(await sdk.chain.bookWithDiscount(stay, 1), { error: "NullifierUsed" })

const pkg = await sdk.disclosure.build(stay)
assert.deepEqual(await sdk.disclosure.check(pkg), { commitmentMatches: true, signatureValid: true, leafInTree: true })
assert.ok(!isErr(await sdk.chain.attest(pkg.reviewId)))
console.log("sdk mock smoke ok")
