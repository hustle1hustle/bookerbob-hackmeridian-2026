/**
 * verify_onchain_zk unit tests (no live Horizon / no relayer).
 * Run: npm run test:verify
 *   (Node ≥22 strip-types, or: npx tsx --test packages/verify_onchain_zk/src/index.test.ts)
 *
 * Honest split:
 *   inspectWallet / verifyWallet  → Horizon READ only (no write tx)
 *   attestLoyaltyClaim            → POST /api/loyalty/attest → testnet WRITE tx
 *   verifyOnConnect               → score + claim + attest (+ optional ZK prove)
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  MODULE,
  rateWalletSignals,
  ratePassportSignals,
  fetchPassport,
  ratingToDiscountBps,
  clampDiscountBps,
  buildLoyaltyClaim,
  claimDigest,
  explorerTxUrl,
  attestLoyaltyClaim,
  verifyOnConnect,
  inspectWallet,
  PASSPORT_BASE_URL,
  PASSPORT_CAP,
  type WalletInspect,
  type LoyaltyClaim,
  type PassportSignals,
} from "./index.ts"

const ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

const fakeInspect = (over: Partial<WalletInspect> = {}): WalletInspect => ({
  module: MODULE,
  address: ADDR,
  exists: true,
  ageDays: 100,
  txCount: 40,
  paymentCount: 12,
  nativeVolumeStroops: 1_000_000n,
  rating: 55,
  tier: 3,
  passport: null,
  inspectedAt: 1_700_000_000_000,
  horizonUrl: "https://horizon-testnet.stellar.org",
  ...over,
})

/** Horizon stub: one account + a few payment ops. Never hits the network. */
function horizonFetch(): typeof fetch {
  return async (input) => {
    const url = String(input)
    if (url.includes("/operations")) {
      return new Response(
        JSON.stringify({
          _embedded: {
            records: [
              { type: "payment", asset_type: "native", amount: "1.0", created_at: "2025-01-01T00:00:00Z" },
              { type: "payment", asset_type: "native", amount: "0.5", created_at: "2024-06-01T00:00:00Z" },
              { type: "create_account", created_at: "2024-01-01T00:00:00Z" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (url.includes("/accounts/")) {
      return new Response(JSON.stringify({ id: ADDR, last_modified_time: "2025-06-01T00:00:00Z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response("not found", { status: 404 })
  }
}

describe("rateWalletSignals", () => {
  it("returns 0 for empty signals", () => {
    assert.equal(rateWalletSignals({ ageDays: 0, txCount: 0, paymentCount: 0 }), 0)
  })
  it("caps at 100", () => {
    assert.equal(rateWalletSignals({ ageDays: 9999, txCount: 1e9, paymentCount: 1e9 }), 100)
  })
  it("discount helpers", () => {
    assert.equal(ratingToDiscountBps(100), 2500)
    assert.equal(ratingToDiscountBps(0), 0)
    assert.equal(clampDiscountBps(2500, 1000), 1000)
  })
})

describe("isLoyaltyAttestDust", () => {
  it("flags 1-stroop native payments used by /api/loyalty/attest", async () => {
    const { isLoyaltyAttestDust } = await import("./index.ts")
    assert.equal(isLoyaltyAttestDust({ type: "payment", asset_type: "native", amount: "0.0000001" }), true)
    assert.equal(isLoyaltyAttestDust({ type: "payment", asset_type: "native", amount: "1.0" }), false)
    assert.equal(isLoyaltyAttestDust({ type: "create_account" }), false)
  })
})

describe("inspectWallet (Horizon READ — no write tx)", () => {
  it("scores from stubbed Horizon without posting any write", async () => {
    let writes = 0
    const f: typeof fetch = async (input, init) => {
      if (init?.method && init.method !== "GET") writes++
      return horizonFetch()(input, init)
    }
    const insp = await inspectWallet(ADDR, { fetch: f, passport: false })
    assert.equal(insp.exists, true)
    assert.equal(insp.paymentCount, 2)
    assert.equal(insp.txCount, 3)
    assert.ok(insp.rating > 0)
    assert.equal(writes, 0)
  })
  it("ignores loyalty-attest dust so re-verify after attest does not inflate score", async () => {
    const withDust: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes("/operations")) {
        return new Response(
          JSON.stringify({
            _embedded: {
              records: [
                { type: "payment", asset_type: "native", amount: "0.0000001", created_at: "2025-06-02T00:00:00Z" },
                { type: "payment", asset_type: "native", amount: "1.0", created_at: "2025-01-01T00:00:00Z" },
                { type: "create_account", created_at: "2024-01-01T00:00:00Z" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return horizonFetch()(input)
    }
    const insp = await inspectWallet(ADDR, { fetch: withDust, passport: false })
    assert.equal(insp.paymentCount, 1)
    assert.equal(insp.txCount, 2)
  })
  it("missing account → rating 0", async () => {
    const f: typeof fetch = async () => new Response("{}", { status: 404 })
    const insp = await inspectWallet(ADDR, { fetch: f })
    assert.equal(insp.exists, false)
    assert.equal(insp.rating, 0)
    assert.equal(insp.tier, 1)
  })
})

describe("claimDigest", () => {
  it("is stable 64-hex and changes when rating changes", async () => {
    const a = buildLoyaltyClaim(fakeInspect({ rating: 40, tier: 2 }), 0, 202610)
    const b: LoyaltyClaim = { ...a, rating: 41 }
    const da = await claimDigest(a)
    const db = await claimDigest(b)
    assert.match(da, /^[0-9a-f]{64}$/)
    assert.notEqual(da, db)
    assert.equal(await claimDigest(a), da)
  })
})

describe("explorerTxUrl", () => {
  it("builds stellar.expert testnet link", () => {
    assert.equal(explorerTxUrl("abcd".repeat(16)), `https://stellar.expert/explorer/testnet/tx/${"abcd".repeat(16)}`)
  })
})

describe("attestLoyaltyClaim (WRITE path)", () => {
  it("posts digest and returns clickable tx", async () => {
    const claim = buildLoyaltyClaim(fakeInspect(), 0, 202610)
    const digest = await claimDigest(claim)
    const fakeFetch: typeof fetch = async (input, init) => {
      assert.match(String(input), /\/api\/loyalty\/attest$/)
      assert.equal(init?.method, "POST")
      const body = JSON.parse(String(init?.body ?? "{}"))
      assert.equal(body.digest, digest)
      return new Response(JSON.stringify({ txHash: "deadbeef".repeat(8), digest }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    const att = await attestLoyaltyClaim(claim, { apiBase: "https://example.test", fetch: fakeFetch, digest })
    assert.equal(att.txHash, "deadbeef".repeat(8))
    assert.equal(att.explorerUrl, explorerTxUrl(att.txHash))
  })

  it("surfaces API errors", async () => {
    const claim = buildLoyaltyClaim(fakeInspect(), 0, 202610)
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "AttestFailed", message: "relayer down" }), { status: 400 })
    await assert.rejects(() => attestLoyaltyClaim(claim, { fetch: fakeFetch }), /relayer down/)
  })
})

describe("verifyOnConnect", () => {
  it("attest:false → score only, zero write POSTs", async () => {
    let posts = 0
    const f: typeof fetch = async (input, init) => {
      if (init?.method === "POST") posts++
      return horizonFetch()(input, init)
    }
    const r = await verifyOnConnect(ADDR, { fetch: f, attest: false, merchantId: 0, season: 202610 })
    assert.equal(r.inspect.exists, true)
    assert.ok(r.claim.rating >= 0)
    assert.match(r.digest, /^[0-9a-f]{64}$/)
    assert.equal(r.attest, null)
    assert.equal(posts, 0)
  })

  it("attest:true → one POST /api/loyalty/attest with clickable explorer url", async () => {
    let attestPosts = 0
    const f: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes("/api/loyalty/attest")) {
        attestPosts++
        assert.equal(init?.method, "POST")
        return new Response(JSON.stringify({ txHash: "ff".repeat(32) }), { status: 200 })
      }
      return horizonFetch()(input, init)
    }
    const r = await verifyOnConnect(ADDR, { fetch: f, attest: true, apiBase: "", merchantId: 2, season: 202610 })
    assert.equal(attestPosts, 1)
    assert.ok(r.attest)
    assert.equal(r.attest!.txHash, "ff".repeat(32))
    assert.match(r.attest!.explorerUrl, /stellar\.expert\/explorer\/testnet\/tx\//)
    assert.equal(r.claim.merchantId, 2)
  })
})

describe("ratePassportSignals", () => {
  it("returns 0 when not matched", () => {
    assert.equal(ratePassportSignals({ matched: false, source: "keyless", points: 9999, rankName: "Platinum" }), 0)
  })
  it("caps at PASSPORT_CAP", () => {
    const maxed: PassportSignals = {
      matched: true,
      source: "keyed",
      points: 1e9,
      rankName: "Platinum",
      scfTier: "verified",
      totalCommits30d: 1e9,
      activeDays30d: 30,
    }
    assert.equal(ratePassportSignals(maxed), PASSPORT_CAP)
  })
  it("transparent rubric: match 5 + points 5 + rank 1 + scf 3 + commits 2 + days 1 = 17", () => {
    // points 300 → log10(301)*2.5 ≈ 6.2 → cap 5; Bronze → 1; verified → 3;
    // commits 40 → log10(41)*2 ≈ 3.2 → cap 2; 12 days /10 → 1 (cap 1).
    assert.equal(
      ratePassportSignals({
        matched: true,
        source: "keyless",
        points: 300,
        rankName: "Bronze",
        scfTier: "verified",
        totalCommits30d: 40,
        activeDays30d: 12,
      }),
      17,
    )
  })
})

const json200 = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

/** Passport stubs — mirror the real endpoints, never touch the network. */
function passportKeyedFetch(match: boolean): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    assert.match(url, new RegExp(`^${PASSPORT_BASE_URL}/api/v1/profiles(\\?|$)`))
    assert.equal((init?.headers as Record<string, string>)?.authorization, "Bearer pk_test")
    return json200({
      builders: match
        ? [
            { stellar_address: "GOTHER", scf_tier: "member" },
            { stellar_address: ADDR, scf_tier: "verified", points: 5000, stats: { totalCommits30d: 90, activeDays30d: 20 } },
          ]
        : [{ stellar_address: "GOTHER", scf_tier: "member" }],
      has_more: false,
      next_cursor: null,
    })
  }
}

function passportKeylessFetch(match: boolean): typeof fetch {
  return async (input, init) => {
    assert.ok(!init?.headers, "keyless path must not send headers")
    const url = String(input)
    if (url.includes("/api/leaderboard")) {
      assert.match(url, /metric=points&window=all&limit=10/)
      // Live shape (checked 2026-10-25): points → `value`, profileUrl → relative "/builder/<slug>".
      return json200({
        metric: "points",
        window: "all",
        entries: [
          { position: 1, value: 1200, rankName: "Gold", profileUrl: "/builder/alice", name: "A" },
          { position: 2, value: 300, rankName: "Bronze", profileUrl: "/builder/bob", name: "B" },
          { position: 3, value: 10, rankName: "Bronze", profileUrl: "https://github.com/legacy-user", name: "C" },
          { position: 4, value: 5, rankName: "Bronze", profileUrl: "/nowhere/usable", name: "D" },
        ],
      })
    }
    if (url.includes("/api/builder/public/alice")) {
      return json200({ builder: { stellar_address: "GOTHER", scf_tier: "pilot" }, stats: { totalCommits30d: 0, activeDays30d: 0 } })
    }
    if (url.includes("/api/builder/public/bob")) {
      return json200({
        builder: { stellar_address: match ? ADDR : "GOTHER", scf_tier: "verified" },
        stats: { totalCommits30d: 40, activeDays30d: 12 },
      })
    }
    if (url.includes("/api/builder/public/legacy-user")) {
      return json200({ builder: { stellar_address: "GOTHER", scf_tier: "pilot" }, stats: { totalCommits30d: 0, activeDays30d: 0 } })
    }
    return new Response("not found", { status: 404 })
  }
}

describe("fetchPassport (never throws, never writes)", () => {
  it("proxy: prefers /api/passport/lookup when passportProxyBase set", async () => {
    let hit = 0
    const f: typeof fetch = async (input) => {
      hit++
      assert.match(String(input), /\/api\/passport\/lookup\?address=/)
      return json200({
        score: 12,
        matched: true,
        signals: { matched: true, source: "keyed", scfTier: "verified", rankName: "Gold" },
      })
    }
    const p = await fetchPassport(ADDR, { passportProxyBase: "https://bob.example", fetch: f })
    assert.equal(hit, 1)
    assert.equal(p.matched, true)
    assert.equal(p.score, 12)
  })

  it("keyed: matches by stellar_address with Bearer header", async () => {
    const p = await fetchPassport(ADDR, { passportApiKey: "pk_test", fetch: passportKeyedFetch(true) })
    assert.equal(p.matched, true)
    assert.equal(p.signals.source, "keyed")
    assert.equal(p.signals.scfTier, "verified")
    assert.ok(p.score > 0)
  })
  it("keyed: no matching profile → score 0", async () => {
    const p = await fetchPassport(ADDR, { passportApiKey: "pk_test", fetch: passportKeyedFetch(false) })
    assert.equal(p.matched, false)
    assert.equal(p.score, 0)
  })
  it("keyless: leaderboard → builder/public match, no auth header", async () => {
    const p = await fetchPassport(ADDR, { fetch: passportKeylessFetch(true) })
    assert.equal(p.matched, true)
    assert.equal(p.signals.source, "keyless")
    assert.equal(p.signals.points, 300)
    assert.equal(p.signals.rankName, "Bronze")
    assert.equal(p.signals.scfTier, "verified")
    assert.equal(p.signals.profileUrl, `${PASSPORT_BASE_URL}/builder/bob`)
    assert.equal(p.score, 17)
  })
  it("keyless: no builder match → score 0", async () => {
    const p = await fetchPassport(ADDR, { fetch: passportKeylessFetch(false) })
    assert.equal(p.matched, false)
    assert.equal(p.score, 0)
  })
  it("API down (500 / throws) → score 0, never throws", async () => {
    const fail: typeof fetch = async () => new Response("boom", { status: 500 })
    assert.deepEqual(await fetchPassport(ADDR, { fetch: fail }), { score: 0, matched: false, signals: { matched: false, source: "keyless" } })
    const throwing: typeof fetch = async () => {
      throw new Error("network down")
    }
    const p = await fetchPassport(ADDR, { fetch: throwing })
    assert.equal(p.score, 0)
    assert.equal(p.matched, false)
  })
})

/** Horizon + Passport in one stub: Horizon as today, Passport endpoints per `match`. */
function combinedFetch(passport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    if (url.includes("stellarpassport")) return passport(input, init)
    return horizonFetch()(input, init)
  }
}

describe("inspectWallet + passport (graceful degrade)", () => {
  it("default on: keyless bonus adds to the rating, clamped 0–100, zero writes", async () => {
    let writes = 0
    const f: typeof fetch = async (input, init) => {
      if (init?.method && init.method !== "GET") writes++
      return combinedFetch(passportKeylessFetch(true))(input, init)
    }
    const insp = await inspectWallet(ADDR, { fetch: f })
    assert.equal(insp.passport?.matched, true)
    assert.ok(insp.passport!.score > 0)
    assert.ok(insp.rating > rateWalletSignals({ ageDays: insp.ageDays, txCount: insp.txCount, paymentCount: insp.paymentCount }))
    assert.ok(insp.rating <= 100)
    assert.equal(writes, 0)
  })
  it("no match → rating identical to passport:false, passport still reported", async () => {
    const noMatch = await inspectWallet(ADDR, { fetch: combinedFetch(passportKeylessFetch(false)) })
    const off = await inspectWallet(ADDR, { fetch: combinedFetch(passportKeylessFetch(false)), passport: false })
    assert.equal(noMatch.passport?.matched, false)
    assert.equal(noMatch.passport?.score, 0)
    assert.equal(noMatch.rating, off.rating)
    assert.equal(off.passport, null)
  })
  it("passport:false → zero Passport GETs", async () => {
    let passportGets = 0
    const f: typeof fetch = async (input, init) => {
      if (String(input).includes("stellarpassport")) passportGets++
      return horizonFetch()(input, init)
    }
    const insp = await inspectWallet(ADDR, { fetch: f, passport: false })
    assert.equal(insp.passport, null)
    assert.equal(passportGets, 0)
  })
  it("missing account → passport null, rating 0 (unchanged early return)", async () => {
    const f = async () => new Response("{}", { status: 404 })
    const insp = await inspectWallet(ADDR, { fetch: f })
    assert.equal(insp.exists, false)
    assert.equal(insp.passport, null)
    assert.equal(insp.rating, 0)
  })
})

describe("verifyOnConnect + passport", () => {
  it("inspect.passport flows through the connect pipeline", async () => {
    const f: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes("/api/loyalty/attest")) {
        assert.equal(init?.method, "POST")
        return new Response(JSON.stringify({ txHash: "ff".repeat(32) }), { status: 200 })
      }
      return combinedFetch(passportKeylessFetch(true))(input, init)
    }
    const r = await verifyOnConnect(ADDR, { fetch: f, merchantId: 0, season: 202610 })
    assert.equal(r.inspect.passport?.matched, true)
    assert.ok(r.inspect.passport!.score > 0)
    assert.ok(r.claim.rating >= r.inspect.rating - 0) // claim carries the boosted rating
    assert.equal(r.claim.rating, r.inspect.rating)
  })
})

console.log("verify_onchain_zk: inspect=Horizon read; write tx only via /api/loyalty/attest")
