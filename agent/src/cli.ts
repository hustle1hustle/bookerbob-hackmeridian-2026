#!/usr/bin/env node
// Bob, the BookerBob agent: ranks places by proven reviews only and, with --book, books the top pick.
//   node agent/src/cli.ts "hotel in lisbon under 120"
//   node agent/src/cli.ts "hotel under 120" --book        (demo key wallet, kept in agent/.data/)
//   API=http://localhost:8080 node agent/src/cli.ts "cafe"
// Reads through the testnet SDK from the BookerBob backend (default: the live deployment).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createTestnetSdk, formatUsdc, isErr, errorCopy, nullifierCopy, type Review } from "../../packages/sdk/src/index.ts"
import { DEMO_SEASON, parseQuery, pickHeadline, rank } from "./rank.ts"

const args = process.argv.slice(2)
const book = args.includes("--book")
const apiIdx = args.indexOf("--api")
const api = (apiIdx >= 0 ? args[apiIdx + 1] : process.env.API) ?? "https://stellarbob2026.xyz"
const text = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--api").join(" ").trim()
if (!text) {
  console.log('usage: node agent/src/cli.ts "hotel in lisbon under 120" [--book] [--api URL]')
  process.exit(1)
}

// Local state (demo key, stay identities) in a small JSON file, never committed.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../.data")
const file = join(dataDir, "state.json")
const load = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return {}
  }
}
const storage = {
  getItem: (k: string) => load()[k] ?? null,
  setItem: (k: string, v: string) => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, JSON.stringify({ ...load(), [k]: v }, null, 2))
  },
  removeItem: (k: string) => {
    const s = load()
    delete s[k]
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, JSON.stringify(s, null, 2))
  },
}

const sdk = createTestnetSdk({ apiUrl: api, storage })
const q = parseQuery(text)

const places = await sdk.chain.listMerchants()
const reviews: Review[] = (await Promise.all(places.map((p) => sdk.chain.getReviews(p.id)))).flat()
const ranked = rank(places, reviews, q)

console.log(`bob> "${text}"  (kind: ${q.kind ?? "any"}, max: ${q.maxPrice !== undefined ? q.maxPrice + " USDC" : "none"})`)
console.log(`bob> ranking by proven reviews only, ${reviews.length} on-chain reviews across ${places.length} places\n`)
if (ranked.length === 0) {
  console.log("bob> nothing matches. try a higher price or another kind.")
  process.exit(0)
}
ranked.forEach((r, i) => {
  const score = r.score === null ? "  -  " : r.score.toFixed(2)
  console.log(`${i === 0 ? "*" : " "} ${String(i + 1).padStart(2)}. ${r.place.name.padEnd(22)} ${r.place.kind.padEnd(6)} score ${score}  ${r.reason}`)
})
const top = ranked[0]
console.log(`\nbob> picked ${top.place.name}: ${pickHeadline(q)}. ${top.reason}.`)

if (!book) process.exit(0)

// ---- book the top pick ----
const address = await sdk.wallet.connect("local")
console.log(`bob> wallet ${address.slice(0, 6)}…${address.slice(-4)} (demo key in agent/.data)`)
const bal = (await sdk.chain.balance()) ?? 0n
if (bal < top.place.price) {
  const f = await sdk.chain.faucet()
  console.log(isErr(f) ? `bob> faucet failed: ${errorCopy[f.error]}` : `bob> got test USDC: ${sdk.chain.explorerTx(f.txHash)}`)
}
const stays = await sdk.stays.sync()
const past = stays.find((s) => s.merchant === top.place.id && s.checkedIn && !s.discountSeasonsUsed.includes(DEMO_SEASON))
if (past) {
  console.log(`bob> you have a proven past stay here: proving it for the returning-guest discount`)
  for await (const ev of sdk.prover.prove({ kind: "discount", stay: past, season: DEMO_SEASON })) {
    if (ev.stage === "download") continue
    if (ev.stage !== "done") console.log(`bob>   ${ev.stage}`)
    else if (isErr(ev.result)) console.log(`bob> ${ev.result.error === "NullifierUsed" ? nullifierCopy.discount : errorCopy[ev.result.error]}`)
    else {
      const r = ev.result as { txHash: string; paid: bigint; saved: bigint }
      console.log(`bob> proof verified, price dropped: paid ${formatUsdc(r.paid)} USDC, saved ${formatUsdc(r.saved)}. ${sdk.chain.explorerTx(r.txHash)}`)
    }
  }
} else {
  const r = await sdk.chain.book(top.place.id)
  console.log(isErr(r) ? `bob> booking failed: ${errorCopy[r.error]}` : `bob> booked at full price, paid ${formatUsdc(r.paid)} USDC. ${sdk.chain.explorerTx(r.txHash)}`)
}
process.exit(0)
