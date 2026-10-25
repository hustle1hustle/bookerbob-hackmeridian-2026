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
import { Group } from "@semaphore-protocol/group"

const API = (globalThis as any).POL_API ?? ""
const BRIDGE = (globalThis as any).POL_UCP_BRIDGE ?? "https://bookerbob-ucp-bridge.fly.dev"
// ---- operator fresh-demo mode ----
// /?fresh=1 (demo operator only) starts an ephemeral identity under its own storage namespace "demo-<ts>":
// a new demo key and new stay identities, zero passes. The passkey / Freighter state in the default namespace is
// untouched; "back to my wallet" drops the namespace. The namespace is fixed at load, so a switch reloads the page.
const LS: Storage | null = typeof localStorage !== "undefined" ? localStorage : null
const NS_KEY = "pol.ns"
const nsNow = (() => {
  try {
    return LS?.getItem(NS_KEY) || ""
  } catch {
    return ""
  }
})()
const nsStorage = (ns: string): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined =>
  !LS || !ns ? undefined : { getItem: (k) => LS.getItem(`${ns}:${k}`), setItem: (k, v) => LS.setItem(`${ns}:${k}`, v), removeItem: (k) => LS.removeItem(`${ns}:${k}`) }

const isOperator = () => fetch(`${API}/api/rep/status`, { credentials: "same-origin" }).then((r) => r.json()).then((d) => !!d.demo).catch(() => false)
/** Operator only: clears the REP demo joins on the backend so "verify with REP" works again. Missing endpoint = no-op. */
const repDemoReset = () =>
  fetch(`${API}/api/rep/demo-reset`, { method: "POST", credentials: "same-origin" })
    .then((r) => r.json())
    .then((d) => !!d.ok)
    .catch(() => false)
const reloadClean = () => {
  if (typeof location === "undefined") return
  const u = new URL(location.href)
  u.searchParams.delete("fresh")
  location.replace(u.toString())
}
/** "create a new passkey": a brand-new credential (fresh user handle) in a new storage namespace, so a new
 *  wallet, new stay identities, zero passes and zero memberships. Must run inside the click (WebAuthn gesture).
 *  Returns { fallback: true } when the browser has no passkeys/PRF-capable authenticator, so the UI offers
 *  Freighter or a demo key instead of an error. */
export async function createPasskey(): Promise<{ ok: true; address: string } | { fallback: true; why: string }> {
  const { connectPasskey, isPasskeyAvailable } = await import("../../packages/pass_connect/src/index.ts")
  if (!isPasskeyAvailable()) return { fallback: true, why: "this browser has no passkeys. use Freighter or a demo key." }
  const ns = `pk-${Date.now()}`
  const st = nsStorage(ns)!
  const label = `BookerBob demo ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
  try {
    const { session } = await connectPasskey({ rpName: "BookerBob", friendbotUrl: "https://friendbot.stellar.org", storage: st, displayName: label, create: true })
    passkeyNs.set(session.credentialId, ns)
    st.setItem("pos.wallet", "passkey")
    st.setItem("pos.pass_binding", session.binding)
    LS?.setItem(NS_KEY, ns)
    reloadClean()
    return { ok: true, address: session.address }
  } catch (e: any) {
    const code = e?.code ?? ""
    if (code === "UserCancelled") return { fallback: true, why: "cancelled. you can try again, or use Freighter or a demo key." }
    return { fallback: true, why: "this browser could not create a passkey here. use Freighter or a demo key." }
  }
}

/** Which namespace holds a passkey's history (credential id -> ns, "" = the browser's own). Signing in with a
 *  passkey goes back to its own history instead of mixing two identities in one namespace. */
const PK_NS_KEY = "pol.passkeyNs"
const passkeyNs = {
  all(): Record<string, string> {
    try {
      return JSON.parse(LS?.getItem(PK_NS_KEY) ?? "{}")
    } catch {
      return {}
    }
  },
  set(cred: string, ns: string) {
    const m = passkeyNs.all()
    if (cred in m) return
    m[cred] = ns
    LS?.setItem(PK_NS_KEY, JSON.stringify(m))
  },
  /** The namespace already holding this credential (map, then the stored records), or null. */
  find(cred: string): string | null {
    const m = passkeyNs.all()
    if (cred in m) return m[cred]
    const credOf = (raw: string | null) => {
      try {
        return raw ? JSON.parse(raw).credentialId : null
      } catch {
        return null
      }
    }
    if (credOf(LS?.getItem(PASS_KEY) ?? null) === cred) return ""
    for (let i = 0; LS && i < LS.length; i++) {
      const k = LS.key(i) ?? ""
      // generation namespaces share the credential; its history starts in the base namespace
      if (k.endsWith(`:${PASS_KEY}`) && !/^pk-g\d+-/.test(k) && credOf(LS.getItem(k)) === cred) return k.slice(0, -PASS_KEY.length - 1)
    }
    return null
  },
}
const credHere = (): string | null => {
  try {
    return JSON.parse((nsStorage(nsNow) ?? LS)?.getItem(PASS_KEY) ?? "null")?.credentialId ?? null
  } catch {
    return null
  }
}

/** The active passkey for Connect: its name and generation (0 = original). */
export const passkey = {
  info(): { name: string; gen: number } | null {
    if (sdk.wallet.kind !== "passkey") return null
    let rec: any = null
    try {
      rec = JSON.parse((nsStorage(nsNow) ?? LS)?.getItem(PASS_KEY) ?? "null")
    } catch {}
    if (!rec) return null
    return { name: rec.name ?? `passkey ${String(rec.credentialId).slice(0, 6)}`, gen: Math.max(0, generations.current()) }
  },
  /** "switch passkey": pick any passkey for this site (one prompt, never creates), then open its own history. */
  async switch(): Promise<{ ok: true } | { error: string; noPasskey?: boolean }> {
    const { connectPasskey } = await import("../../packages/pass_connect/src/index.ts")
    const mem = new Map<string, string>()
    const tmp = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
    try {
      const { session } = await connectPasskey({ rpName: "BookerBob", friendbotUrl: "", storage: tmp })
      const found = passkeyNs.find(session.credentialId)
      const ns = found ?? `pk-${Date.now()}`
      const st = nsStorage(ns) ?? LS!
      if (found === null) st.setItem(PASS_KEY, mem.get(PASS_KEY)!)
      st.setItem("pos.wallet", "passkey")
      passkeyNs.set(session.credentialId, ns)
      if (ns) LS?.setItem(NS_KEY, ns)
      else LS?.removeItem(NS_KEY)
      reloadClean()
      return { ok: true }
    } catch (e: any) {
      if (e?.code === "NoPasskey") return { error: "no passkey for this site on this device. create one?", noPasskey: true }
      if (e?.code === "UserCancelled") return { error: "cancelled." }
      return { error: "this passkey could not sign in here." }
    }
  },
}

/** "start over with this passkey": generation n+1 of the same passkey in namespace "<base>-g<n>": a new wallet key
 *  (from the same PRF secret), new stay identities, zero passes. Earlier generations stay reachable via switchTo().
 *  Must run inside the click (one passkey prompt). */
const GENS_KEY = "pol.gens"
const PASS_KEY = "bookerbob.pass_connect.v1"
type Gen = { ns: string; n: number; at: number }
export const generations = {
  note: "your earlier history stays on Stellar. this starts a new, unlinked one.",
  list(): Gen[] {
    let xs: Gen[] = []
    try {
      xs = JSON.parse(LS?.getItem(GENS_KEY) ?? "[]")
    } catch {}
    return [{ ns: "", n: 0, at: 0 }, ...xs]
  },
  current(): number {
    return Number(nsStorage(nsNow)?.getItem("pos.passkeyGen") ?? (nsNow ? -1 : 0))
  },
  async startOver(): Promise<{ ok: true } | { error: string }> {
    const cur = nsStorage(nsNow) ?? LS
    const cred = cur?.getItem(PASS_KEY)
    if (!cred) return { error: "connect your passkey first" }
    if (await isOperator()) await repDemoReset()
    const xs = generations.list()
    const n = Math.max(...xs.map((g) => g.n)) + 1
    const ns = `pk-g${n}-${Date.now()}`
    const st = nsStorage(ns)!
    st.setItem(PASS_KEY, cred)
    st.setItem("pos.wallet", "passkey")
    st.setItem("pos.passkeyGen", String(n))
    // one prompt now (inside the click) to derive and remember this generation's address
    const { connectPasskey } = await import("../../packages/pass_connect/src/index.ts")
    const { passkeyGenSeed } = await import("../../packages/sdk/src/testnet.ts")
    try {
      const { seed } = await connectPasskey({ rpName: "BookerBob", friendbotUrl: "https://friendbot.stellar.org", storage: st })
      const kp = Keypair.fromRawEd25519Seed(await passkeyGenSeed(seed, n))
      st.setItem("pos.passkeyAddress", kp.publicKey())
      await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`).catch(() => null)
    } catch (e: any) {
      return { error: e?.code === "UserCancelled" ? "cancelled" : "the passkey prompt failed" }
    }
    LS?.setItem(GENS_KEY, JSON.stringify([...xs.filter((g) => g.n > 0), { ns, n, at: Date.now() }]))
    LS?.setItem(NS_KEY, ns)
    reloadClean()
    return { ok: true }
  },
  switchTo(ns: string) {
    if (ns) LS?.setItem(NS_KEY, ns)
    else LS?.removeItem(NS_KEY)
    reloadClean()
  },
}

export const demo = {
  /** Current fresh-demo namespace, "" for the operator's own wallet. */
  active: () => nsNow,
  isOperator,
  /** Start (or restart) a clean ephemeral identity; operator only. Reloads the page. */
  async reset() {
    if (!(await isOperator())) return false
    await repDemoReset()
    LS?.setItem(NS_KEY, `demo-${Date.now()}`)
    reloadClean()
    return true
  },
  /** Back to the operator's own passkey / Freighter / demo-key state. Reloads the page. */
  exit() {
    LS?.removeItem(NS_KEY)
    reloadClean()
  },
  /** In a fresh namespace: connect its demo key and fund it, so the first booking needs nothing else. */
  async prepare() {
    if (!nsNow) return null
    const addr = sdk.wallet.address ?? (await sdk.wallet.connect("local"))
    for (let i = 0; i < 2; i++) {
      const f: any = await sdk.chain.faucet()
      if (!f.error) break
      await new Promise((r) => setTimeout(r, 4000))
    }
    // tell the page a wallet is ready (it connected after the first render)
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pol:wallet"))
    return addr
  },
}
// ?fresh=1 on load: verified against the operator cookie, then switch namespace (also ?demo=<token> sets the cookie server-side first)
// (deferred: the sdk is created below)
setTimeout(() => {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("fresh") === "1") {
    isOperator().then((ok) => { if (ok) void demo.reset(); else reloadClean() })
  } else if (nsNow) {
    void demo.prepare()
  }
}, 0)
// Proving files from our own origin (brotli, immutable), persisted in the Cache API so a revisit never downloads them
// again, and prefetched at idle after first paint. The SDK keeps its own default URL; we pass ours.
export const ARTIFACTS = `${API}/artifacts/semaphore/4.13.0`
const ARTIFACT_CACHE = "bb-artifacts-4.13.0"
const artProgress = { loaded: 0, total: 0, files: 0 }
const artifactBytes = new Map<string, Promise<Uint8Array>>()
function artifactFile(url: string, low: boolean): Promise<Uint8Array> {
  if (!artifactBytes.has(url))
    artifactBytes.set(
      url,
      (async () => {
        try {
          const c = await caches.open(ARTIFACT_CACHE)
          const hit = await c.match(url)
          if (hit) {
            const b = new Uint8Array(await hit.arrayBuffer())
            artProgress.loaded += b.length
            artProgress.total += b.length
            return b
          }
        } catch {
          /* no Cache API (private mode): network only */
        }
        const res = await nativeFetch(url, { priority: low ? "low" : "auto" } as RequestInit)
        if (!res.ok || !res.body) throw new Error(`artifact ${res.status}`)
        // byte progress over the uncompressed size the server announces (the body stream is already decoded)
        artProgress.total += Number(res.headers.get("x-uncompressed-length") ?? res.headers.get("content-length") ?? 0)
        const reader = res.body.getReader()
        const parts: Uint8Array[] = []
        let n = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          parts.push(value)
          n += value.length
          artProgress.loaded += value.length
        }
        const bytes = new Uint8Array(n)
        let o = 0
        for (const p of parts) (bytes.set(p, o), (o += p.length))
        try {
          await (await caches.open(ARTIFACT_CACHE)).put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } }))
        } catch {
          /* cache full or unavailable: still fine for this page */
        }
        return bytes
      })().catch((e) => {
        artifactBytes.delete(url)
        throw e
      }),
    )
  return artifactBytes.get(url)!
}
// The SDK's loader calls fetch() for these URLs: answer from the cache-backed loader above.
const nativeFetch = globalThis.fetch.bind(globalThis)
let prefetching = false
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const abs = new URL(url, location.href).href
  if (abs.startsWith(new URL(ARTIFACTS, location.href).href + "/")) return new Response(await artifactFile(abs, prefetching))
  return nativeFetch(input as any, init)
}) as typeof fetch

const sdk = createTestnetSdk({ apiUrl: API, artifactsUrl: ARTIFACTS, storage: nsStorage(nsNow) })

/** Warm the proving files without blocking anything; the SDK keeps them in memory once loaded. */
export function warmArtifacts(): Promise<unknown> {
  return loadArtifacts(ARTIFACTS).catch(() => null)
}
if (typeof window !== "undefined") {
  const go = () => {
    prefetching = true
    void warmArtifacts().finally(() => (prefetching = false))
  }
  const ric = (window as any).requestIdleCallback as undefined | ((f: () => void, o?: any) => void)
  if (document.readyState === "complete") ric ? ric(go, { timeout: 3000 }) : setTimeout(go, 800)
  else window.addEventListener("load", () => (ric ? ric(go, { timeout: 3000 }) : setTimeout(go, 800)), { once: true })
}

// ---- constants the design reads ----
export const config: { forceError: string | null; firstProof: boolean; sparse: boolean } = { forceError: null, firstProof: true, sparse: false }
export let LEDGER_NOW = 0
export const LEDGER_SECONDS = 5
export const TREE_CAP = 1024
export const SEASON = { id: "1", label: "2026 · autumn" }
const SEASON_N = d.currentSeason()
export const EXPLORER = "https://stellar.expert/explorer/testnet/tx/"

/** Review text hash, as stored on chain: sha256 of the UTF-8 text. */
export function hashText(s: string): string {
  return sha256(toUtf8Bytes(s))
}

// verbatim from the design mock (pure helpers)
const round2 = (x: number) => Math.round(x * 100) / 100
export function groupLabel(group: string, kind: string) {
  if (group === "returning") return kind === "hotel" ? "returning guest" : "returning customer"
  return ({ network: "BookerBob regular", traveler: "REP verified traveler · from REP", tier: "Stellar wallet tier" } as Record<string, string>)[group] || group
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
  if (g?.kind === "attested" && /stellar wallet tier/i.test(g.name)) return "tier"
  return `g${ref.id}`
}

// ---- cached chain state ----
interface PlaceState { mid: number; m: any; catalog: any; policy: { items: { group: d.GroupRef; bps: number }[]; maxBps: number } | null; leaves: bigint[]; chain: number | null }
let state: { places: PlaceState[]; reviews: Map<number, any[]>; texts: Record<string, string>; groupLeaves: Map<number, bigint[]>; spent: Set<string>; elig: Record<number, any[]> } | null = null
let loading: Promise<void> | null = null
const kindOut = (k: string) => (k === "cafe" ? "café" : k)

// the real store's products from the UCP bridge (title, USDC price, store price, variant)
let storeItems: any[] = []

// The transaction that made a membership true. The backend records demo-desk checkouts and group joins;
// null means it joined before the backend recorded it (shown as "joined earlier", no link).
const txCache = new Map<string, Promise<string | null>>()
export function membershipTx(ref: { kind: "merchant" | "group"; id: number }, commitment: string): Promise<string | null> {
  const key = `${ref.kind}:${ref.id}:${commitment}`
  if (!txCache.has(key)) {
    const url = ref.kind === "merchant" ? `${API}/api/checkout-tx?merchant=${ref.id}&commitment=${commitment}` : `${API}/api/member-tx?group=${ref.id}&commitment=${commitment}`
    txCache.set(key, fetch(url).then((r) => r.json()).then((j) => j?.txHash ?? null).catch(() => null))
  }
  return txCache.get(key)!
}
export const rememberTx = (ref: { kind: "merchant" | "group"; id: number }, commitment: string, txHash: string) => {
  txCache.set(`${ref.kind}:${ref.id}:${commitment}`, Promise.resolve(txHash))
  resolvedTx.set(`${ref.kind}:${ref.id}:${commitment}`, txHash)
}
/** Resolved membership txs for synchronous readers (passes); filled during load. */
const resolvedTx = new Map<string, string | null>()

// One shared /api/config read (the backend computes it per request, so do not ask twice).
let configP: Promise<any> | null = null
const apiConfig = () => (configP ??= fetch(`${API}/api/config`).then((r) => r.json()))

// First paint from the backend's warm snapshot (GET /api/state: one request, ~2 ms warm), then a live chain read in
// the background that replaces it and tells the page ("pol:data"). Falls back to the live read if the snapshot fails.
const big = (v: any) => (typeof v === "bigint" ? v : BigInt(v ?? 0))
async function load() {
  const ledgerP = fetch(`${API}/api/ledger`).then((r) => r.json()).catch(() => ({}))
  // the store's products never hold up first paint: applied whenever they arrive
  fetch(`${BRIDGE}/search?q=tee`)
    .then((r) => r.json())
    .then((st) => {
      if (Array.isArray(st) && st.length) storeItems = st
    })
    .catch(() => null)
  // the page head may already have started this request (window.__polState)
  const early = typeof window !== "undefined" ? (window as any).__polState : null
  const snap: any = await (early ?? fetch(`${API}/api/state`).then((r) => (r.ok ? r.json() : null))).catch(() => null)
  if (!snap || !Array.isArray(snap.merchants)) return loadLive()
  // review ages need the current ledger: estimate it from the newest timed review (5 s per ledger), exact when it lands
  const timed = (snap.reviews ?? []).filter((r: any) => r.time && r.ledger).sort((a: any, b: any) => b.ledger - a.ledger)[0]
  if (timed && !LEDGER_NOW) LEDGER_NOW = timed.ledger + Math.round((Date.now() - timed.time) / 1000 / LEDGER_SECONDS)
  ledgerP.then((l: any) => {
    if (l?.sequence) LEDGER_NOW = l.sequence
  })
  groupsMeta = snap.groups ?? []
  const catalog = snap.catalog ?? {}
  const ms = snap.merchants.map((m: any) => ({ ...m, price: big(m.price), root: String(m.root) }))
  const ucp = ms.find((m: any) => m.kind === "shop" && !catalog[m.id] && /shopify|rep store/i.test(m.name))
  if (ucp) UCP_MERCHANT = ucp.id
  const pol = (id: number) => {
    const p = snap.policies?.[id]
    return p ? { maxBps: p.maxBps, items: (p.items ?? []).map((it: any) => ({ group: it.group, bps: it.bps })) } : null
  }
  const places: PlaceState[] = ms.map((m: any) => ({ mid: m.id, m, catalog: catalog[m.id] ?? null, policy: pol(m.id), leaves: (snap.leaves?.[m.id] ?? []).map(big) }))
  const reviews = new Map<number, any[]>()
  const texts: Record<string, string> = {}
  for (const m of ms) reviews.set(m.id, [])
  for (const r of snap.reviews ?? []) {
    reviews.get(r.merchant)?.push(r)
    if (r.text) texts["0x" + r.contentHash] = r.text
  }
  const groupLeaves = new Map<number, bigint[]>()
  for (const g of groupsMeta) groupLeaves.set(g.id, (snap.groupLeaves?.[g.id] ?? []).map(big))
  state = { places, reviews, texts, groupLeaves, spent: new Set(), elig: {} }
  // the contract client is only needed to check spent proofs of held memberships: build it on first use
  let client: Promise<any> | null = null
  const read = { is_spent: async (a: any) => (await (client ??= getClient({ ...TESTNET, contractId: snap.contractId }))).is_spent(a) }
  await refreshEligibility(read)
  // live read after first paint; the page re-reads when it lands
  if (typeof window !== "undefined")
    setTimeout(() => {
      loadLive()
        .then(() => window.dispatchEvent(new CustomEvent("pol:data")))
        .catch(() => null)
    }, 4000)
}

async function loadLive() {
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
  const [ms, policies, leaves, gLeaves, rlists, catalog, ledger, store, chains] = await Promise.all([
    Promise.all(ids.map((i) => views.merchant(read, i))),
    Promise.all(ids.map((i) => views.policy(read, i))),
    Promise.all(ids.map((i) => views.leaves(read, i))),
    Promise.all(groups.map((g) => views.groupLeaves(read, g.id))),
    Promise.all(ids.map((i) => fetch(`${API}/api/reviews/${i}`).then((r) => r.json()))),
    catalogP,
    ledgerP,
    storeP,
    // the chain group each place belongs to: a chain claim there shares the place's own discount nullifier
    // shared chain scope only on the upgraded contract (views.sharedChainScope); otherwise chain claims keep their own scope
    Promise.all(ids.map((i) => (views.sharedChainScope(read) ? (read as any).merchant_chain({ merchant: i }).then((t: any) => (t.result ?? null) as number | null).catch(() => null) : Promise.resolve(null)))),
  ])
  storeItems = Array.isArray(store) ? store : []
  LEDGER_NOW = ledger.sequence ?? LEDGER_NOW
  const ucp = ms.find((m) => m.kind === "shop" && !catalog[m.id] && /shopify|rep store/i.test(m.name))
  if (ucp) UCP_MERCHANT = ucp.id
  const places: PlaceState[] = ms.map((m, i) => ({ mid: m.id, m, catalog: catalog[m.id] ?? null, policy: policies[i], leaves: leaves[i], chain: chains[i] }))
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
  await Promise.all(
    stays.map((st) => membershipTx({ kind: "merchant", id: st.merchant }, st.commitment).then((t) => resolvedTx.set(`merchant:${st.merchant}:${st.commitment}`, t))),
  )
  for (const p of state.places) {
    const items = p.policy?.items ?? (p.m.discountBps ? [{ group: { kind: "merchant" as const, id: p.mid }, bps: p.m.discountBps }] : [])
    const out: any[] = []
    // the own-tree claim and this place's chain claim share one nullifier, so they need different stays
    const shared = (g: d.GroupRef) => (g.kind === "merchant" && g.id === p.mid) || (g.kind === "group" && g.id === p.chain)
    const taken = new Set<string>()
    const ordered = [...items].sort((a, b) => Number(b.group.kind === "merchant" && b.group.id === p.mid) - Number(a.group.kind === "merchant" && a.group.id === p.mid))
    for (const it of ordered) {
      const key = groupKey(it.group, p.mid)
      const leaves = it.group.kind === "merchant" ? (state.places.find((x) => x.mid === it.group.id)?.leaves ?? []) : (state.groupLeaves.get(it.group.id) ?? [])
      const holder = stays.find((s) => leaves.includes(BigInt(s.commitment)) && !(shared(it.group) && taken.has(s.commitment)))
      if (holder && shared(it.group)) taken.add(holder.commitment)
      let used = false
      if (holder) {
        const scope = d.semaphoreHash(d.ctxScope(p.mid, it.group, SEASON_N, p.chain))
        const nf = poseidon2([scope, master(holder).secretScalar])
        used = await read.is_spent({ scope_hash: scope, nullifier: nf }).then((t: any) => !!t.result).catch(() => false)
      }
      const kind = p.m.kind
      let reason = ""
      if (key === "returning") reason = !holder ? (kind === "hotel" ? "no stay here in this browser" : "no purchase here in this browser") : used ? "used this season. renews next season." : kind === "hotel" ? "you stayed here before. not which time." : "you bought here before. not what, not when."
      else if (key === "network") reason = !holder ? "no proven stay or purchase in the network yet" : used ? "used here this season" : "you're a proven customer somewhere in the BookerBob network"
      else if (key === "traveler") reason = !holder ? "no attestation in this browser" : used ? "used here this season" : "an attester vouched for you. not who."
      else if (key === "tier") reason = !holder ? stellarTier.reason() || "join with your wallet in connect" : used ? "used here this season" : "your wallet's tier counts. places never see the wallet."
      else reason = !holder ? "not a member in this browser" : used ? "used here this season" : "a provider vouched for you. not who."
      const txHash = holder ? await membershipTx(it.group, holder.commitment) : null
      const atPlaces = state.places.filter((q) => (q.policy?.items ?? []).some((x) => x.group.kind === it.group.kind && x.group.id === it.group.id)).length
      out.push({ group: key, label: groupLabel(key, kind) === key ? (groupsMeta.find((g) => `g${g.id}` === key)?.name ?? key) : groupLabel(key, kind), bps: it.bps, eligible: !!holder && !used, held: !!holder, reason, explain: EXPLAIN[key] ?? "", txHash, atPlaces, _ref: it.group, _holder: holder })
    }
    state.elig[toPlace(p.mid)] = out
  }
}

/** One line per source, wherever it appears. */
export const EXPLAIN: Record<string, string> = {
  returning: "you were a customer here before. not which time.",
  network: "you're a proven customer somewhere in the BookerBob network. places never see where.",
  traveler: "REP proves from your own Airbnb or Booking account that you travel. BookerBob only learns yes. nobody sees your trips.",
  tier: "your Stellar wallet history earns a tier. places see the tier, never the wallet.",
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
let pending: { place: number; groups: string[]; payer: Keypair; claims: any[]; dropped?: string[] } | null = null

async function freshPayer(kp: Keypair, amountRaw: bigint) {
  const c = await apiConfig()
  const post = (path: string, body: any) => fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) }).then((r) => r.json())
  const o = await post("/api/payer/open", { publicKey: kp.publicKey() })
  if (o.error) throw new Error(o.message ?? o.error)
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
    // only the claims actually proven count; a dropped one ("isn't available in this session") recomputes the price
    const provenGroups = pending && pending.place === place ? pending.groups : []
    const droppedGroups = pending && pending.place === place ? (pending.dropped ?? []) : []
    const bd = breakdown(subtotal, pol.policy, pol.max_bps, groups.filter((g) => provenGroups.includes(g)))
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
            if (r.error) throw new Error(r.message ?? r.error)
            return { signedAuthEntry: r.signature, signerAddress: p.m.admin }
          },
        })
        // re-simulate with the signed auth: the first simulation (recording-mode auth) declares a resource fee
        // hundreds of times too high, which the fee-bump cap refuses
        await tx.simulate()
      }
      await tx.sign()
      const sent = await post("/api/payer/feebump", { xdr: tx.signed.toXDR() })
      if (sent.error) {
        const m = String(sent.error).match(/^Contract(\d+)$/)
        return err(m ? (parseContractError(`Error(Contract, #${m[1]})`) ?? "BadParams") : sent.error, sent.message)
      }
      // the paying browser joins the place's customer tree through the demo desk (a new stay for this purchase)
      const stay = sdk.stays.create(p.mid)
      const co: any = await sdk.chain.checkout(p.mid, stay.commitment, sent.txHash)
      const passTx = co && !co.error ? co.txHash : null
      if (passTx) rememberTx({ kind: "merchant", id: p.mid }, stay.commitment, passTx)
      loading = null
      const paid = Number(BigInt(sent.value)) / 1e7
      // the contract verified every claim inside this tx (a failed check reverts it): mark them, remember the spend
      for (const h of hoods) if (h.status === "proved") {
        h.status = "verified"
        h.tx = sent.txHash
        rememberSpent(h.nullifier, sent.txHash)
      }
      return { txHash: sent.txHash, passTx, subtotal, discounts: bd.rows.filter((r: any) => r.applied), total: round2(paid), saved: round2(subtotal - paid), dropped: droppedGroups.map((g) => ({ group: g, why: "this proof isn't available in this session" })) }
    } catch (e: any) {
      return err(parseContractError(e) ?? "BadParams", String(e?.message ?? e))
    }
  },
  async postReview(place: number, rating: number, text: string, membershipId: string) {
    if (config.forceError) return err(config.forceError)
    if (!(rating >= 1 && rating <= 5)) return err("BadRating")
    const stay = stayOf(membershipId)
    if (!stay || stay.merchant !== toMerchant(place)) return err("InvalidProof")
    const pr = state!.places.find((x) => x.mid === stay.merchant)
    const leaves0 = [...(pr?.leaves ?? [])], root0 = pr?.m.root ?? null
    const ident = sdk.stays.identity(stay)
    const scope = d.reviewScope(stay.merchant)
    hoods = []
    // the message binds the review text and its disclosure commit; known only once the review is stored, so 0 until then
    const h = beginProof({ label: "one stay, one review", scopeText: `review · ${pr?.m.name ?? ""} · once per stay`, treeName: `${pr?.m.name ?? ""} customers`, leaves: leaves0, commitment: ident.commitment, message: 0n, scope, onChainRoot: root0, payment: false, combined: true })
    h.messageHash = ""
    const r: any = await sdk.chain.postReview(stay, rating as any, text || "")
    if (r.error) {
      hoods = []
      return err(r.error, r.message)
    }
    loading = null
    try {
      finishProof(h, root0 ?? new Group(leaves0).root, poseidon2([d.semaphoreHash(scope), ident.secretScalar]))
      // the stored review (content hash, disclosure commit) gives the message; read it from the chain-backed API
      let rv: any = null
      for (let i = 0; i < 6 && !rv; i++) {
        const xs: any[] = await fetch(`${API}/api/reviews/${stay.merchant}`).then((x) => x.json()).catch(() => [])
        rv = (Array.isArray(xs) ? xs : []).find((x: any) => Number(x.id) === Number(r.reviewId)) ?? null
        if (!rv) await sleep(1500)
      }
      if (rv) h.messageHash = hex(d.semaphoreHash(d.reviewMessage(rating, "0x" + rv.contentHash, "0x" + rv.disclosureCommit)))
      h.status = "verified"
      h.tx = r.txHash
      rememberSpent(h.nullifier, r.txHash)
    } catch {}
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
const dateLine = (s: Stay, kind: string) => {
  const day = new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toLowerCase()
  return kind === "hotel" ? `stayed · checked in ${day}` : `bought ${day}`
}

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
          txHash: resolvedTx.get(`merchant:${s.merchant}:${s.commitment}`) ?? null,
          placeName: p.m.name,
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
// The store's catalog over UCP (bridge /search): what Bob can buy, and which one the next run buys.
let storeCatalogP: Promise<any[]> | null = null
let chosenVariant: string | null = null
/** Ask Bob: the backend search (GET /api/search), places mapped to this site's place ids. */
export async function search(q: string) {
  const r: any = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`).then((x) => x.json())
  const results = (r?.results ?? []).map((x: any) => ({
    source: String(x.source), placeId: typeof x.merchantId === "number" ? toPlace(x.merchantId) : null,
    title: String(x.title ?? ""), kind: kindOut(String(x.kind ?? "")), price: Number(x.price ?? 0), currency: String(x.currency ?? "USDC"),
    provenRating: typeof x.provenRating === "number" ? x.provenRating : null, reviewCount: Number(x.reviewCount ?? 0), verifiedCount: Number(x.verifiedCount ?? 0),
    url: x.url ?? null, variantId: x.extra?.variantId ?? x.variantId ?? null,
    area: x.extra?.area ? String(x.extra.area) : null,
  }))
  return { query: q, kind: r?.parsed?.kind ? kindOut(String(r.parsed.kind)) : null, results }
}

export const store = {
  async orders() {
    return []
  },
  /** The products REP Store offers (title, USDC price, store price, image when the store has one, product page). */
  items(): Promise<any[]> {
    return (storeCatalogP ??= fetch(`${BRIDGE}/search?q=rep`)
      .then((r) => r.json())
      .then((xs) =>
        (Array.isArray(xs) ? xs : []).map((x: any) => ({ variantId: x.variantId, title: String(x.title), price: Number(x.price), storePrice: x.storePrice ?? null, storeCurrency: x.storeCurrency ?? null, imageUrl: x.imageUrl ?? null, url: x.url ?? null })),
      )
      .catch(() => {
        storeCatalogP = null
        return []
      }))
  },
  /** Pick the product the next ucp.run() buys (null: the store's first tee). */
  choose(variantId: string | null) {
    chosenVariant = variantId
  },
  chosen: () => chosenVariant,
}

export const UCP_STEPS = [
  { label: "find the store", detail: "ucp discovery found rep store. it speaks checkout and cart, plus one extension: proof_of_loyalty." },
  { label: "add the t-shirt to the cart", detail: "" },
  { label: "claim returning customer", detail: "proof_of_loyalty extension · group: returning customer. no name, no email sent." },
  { label: "store offers 10% off, pending", detail: "" },
  { label: "make the proof, locally", detail: "made on this device. your secret never leaves it." },
  { label: "stellar checks the proof, once", detail: "proof valid. it works once, so this discount cannot be reused. the store learns nothing about who." },
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
      const f: any = await sdk.chain.faucet().catch((e: any) => ({ error: String(e?.message ?? e) }))
      if (!f.error) break
      await sleep(4000)
    }
  }
  return sdk.wallet.address!
}
// the payment's failure in plain words: USDC contract #13 is a missing USDC trustline on the paying wallet, #10 too little USDC
const payFailure = (e: string) =>
  /#13\b|trustline/i.test(e) ? "your wallet wasn't set up for test USDC yet. run bob again: it sets that up first." : /#10\b|balance/i.test(e) ? "not enough test USDC in your wallet. run bob again: it tops up first." : `the payment didn't go through: ${e}`

async function* ucpRun(reuse: boolean, noClaim = false): AsyncGenerator<any> {
  const cart: any = { items: [], discounts: [], total: 0, currency: "USDC", paid: false, tx: null }
  const snap = () => ({ type: "cart", cart: JSON.parse(JSON.stringify(cart)) })
  const step = (i: number, status: string, extra: any = {}) => ({ type: "step", i, status, detail: extra.detail ?? (status === "done" ? UCP_STEPS[i].detail : ""), ...extra })
  hoods = []
  yield step(0, "running")
  const items = await fetch(`${BRIDGE}/search?q=${chosenVariant ? "rep" : "tee"}`).then((r) => r.json()).catch(() => [])
  const item = (chosenVariant && items.find((x: any) => x.variantId === chosenVariant)) || items[0]
  if (!item) return yield step(0, "failed", { error: "Network", detail: "the store did not answer." })
  yield step(0, "done", { detail: "found REP Store on Shopify. it speaks UCP: checkout, cart and proof of loyalty.", link: { url: item.ucp ?? `${BRIDGE}/.well-known/ucp`, label: "UCP profile" } })
  yield step(1, "running")
  cart.nextBps = Number(item.returningDiscountBps ?? 0)
  cart.items.push({ title: String(item.title).toLowerCase(), price: Number(item.price), imageUrl: item.imageUrl ?? null, url: item.url ?? null, storePrice: item.storePrice ?? null, storeCurrency: item.storeCurrency ?? null })
  cart.total = Number(item.price)
  yield snap()
  yield step(1, "done", { detail: `1 × ${String(item.title).toLowerCase()} · ${Number(item.price).toFixed(2)} usdc${item.storePrice ? ` (${Number(item.storePrice).toFixed(2)} ${String(item.storeCurrency ?? "").toLowerCase()} in the store)` : ""} · shopify variant ${String(item.variantId ?? "").split("/").pop()}`, ...(item.url ? { link: { url: item.url, label: "product page on Shopify" } } : {}) })
  const payer = await ensureWallet()
  await ready()
  // the store's customer tree read live: the bridge adds a buyer's leaf itself, so the 15 s snapshot can lag a fresh purchase
  const shopLeaves = await views.leaves(await getClient({ ...TESTNET, contractId: (await apiConfig()).contractId }), UCP_MERCHANT).catch(() => null)
  const shopStay = shopLeaves ? sdk.stays.list().find((s) => s.merchant === UCP_MERCHANT && shopLeaves.includes(BigInt(s.commitment))) : pastShopStay()
  // the replay demo resends the exact proof of the last proven purchase (same nullifier); without one there is nothing to replay
  const lastProof = reuse ? readLastUcpProof(payer) : null
  if (reuse && !shopStay && !lastProof) {
    const headline = "you need a past purchase first."
    yield step(2, "failed", { error: "NoPastPurchase", headline, detail: "a reused proof replays the proof from your last purchase at this store. this browser has none yet: run bob once, then try it." })
    return yield { type: "headline", text: headline, reason: "no past purchase in this browser", error: "NoPastPurchase" }
  }
  let claim = (!!shopStay || reuse) && !noClaim
  const next = sdk.stays.create(UCP_MERCHANT)
  let keep: LastUcpProof | null = null
  yield step(2, "running")
  let st = await bpost("/buy/start", { variantId: item.variantId, qty: 1, claim, nextCommitment: next.commitment })
  if (st.error) return yield step(2, "failed", { error: st.error, detail: String(st.error) })
  let claimNote = ""
  // normal path only (never the replay demo): an already-spent discount is not offered, so a refusal never headlines
  if (claim && !reuse && st.action && shopStay) {
    try {
      const scopeH = d.semaphoreHash(d.discountScope(UCP_MERCHANT, st.action.scope.season))
      const nf = poseidon2([scopeH, sdk.stays.identity(shopStay).secretScalar])
      const read = await getClient({ ...TESTNET, contractId: (await apiConfig()).contractId })
      const spent = await (read as any).is_spent({ scope_hash: scopeH, nullifier: nf }).then((t: any) => !!t.result)
      if (spent) {
        claim = false
        claimNote = "returning customer: already used this season. it renews next season. full price this time."
        st = await bpost("/buy/start", { variantId: item.variantId, qty: 1, claim: false, nextCommitment: next.commitment })
        if (st.error) return yield step(2, "failed", { error: st.error, detail: String(st.error) })
      }
    } catch {
      /* if the check cannot run, the contract still refuses a reused proof; the reason is shown in plain words */
    }
  }
  yield step(2, "done", { detail: claimNote || (claim ? (reuse ? "replaying the proof from your last purchase, on purpose. it should be refused." : "you bought here before, so bob claims returning customer. no name, no email sent.") : noClaim ? "paying full price, no claim." : "no past purchase from this store in this browser, so no claim. full price this time.") })
  if (claim && st.action) {
    yield step(3, "running")
    const off = round2(Number(item.price) * (st.action.discount_bps / 10000))
    cart.discounts.push({ label: `returning customer −${st.action.discount_bps / 100}%`, amount: off, proven: false })
    cart.total = round2(Number(item.price) - off)
    yield snap()
    yield step(3, "done", { detail: `provisional ${off.toFixed(2)} usdc off, held until the proof checks out.` })
    yield step(4, "running")
    const artifacts = await loadArtifacts(ARTIFACTS)
    const leaves = await views.leaves(await getClient({ ...TESTNET, contractId: (await apiConfig()).contractId }), UCP_MERCHANT)
    const holder = shopStay ?? next
    const ident = sdk.stays.identity(holder)
    // the identity must already be one of the store's customers; a new visitor has nothing to prove (or replay) yet
    if (!(reuse && lastProof) && !leaves.includes(ident.commitment)) {
      const why = "you need a past purchase from this store first"
      yield step(4, "failed", { error: "NotInTree", headline: `${why}. buy once, then the discount (and the replay demo) work.`, reason: why, detail: `${why}. this purchase can continue at full price.` })
      yield { type: "headline", text: `${why}. buy once, then the discount works.`, reason: why, error: "NotInTree" }
      return
    }
    const t0 = performance.now()
    let mp
    const replay = reuse && lastProof && lastProof.season === st.action.scope.season ? lastProof : null
    if (replay) {
      // the very proof that was spent: no new proving, the same nullifier goes back to Stellar
      const msg = d.discountMessage(payer), scope = d.discountScope(UCP_MERCHANT, st.action.scope.season)
      const h = beginProof({ label: "returning customer", scopeText: `discount · ${placeName(UCP_MERCHANT)} · season ${st.action.scope.season}`, treeName: `${placeName(UCP_MERCHANT)} customers`, leaves, commitment: BigInt(replay.commitment), message: msg, scope, onChainRoot: state?.places.find((x) => x.mid === UCP_MERCHANT)?.m.root ?? null, payment: true })
      mp = { root: BigInt(replay.root), nullifier: BigInt(replay.nullifier), proof: replay.proof }
      finishProof(h, mp.root, mp.nullifier)
    } else try {
      const msg = d.discountMessage(payer), scope = d.discountScope(UCP_MERCHANT, st.action.scope.season)
      const h = beginProof({ label: "returning customer", scopeText: `discount · ${placeName(UCP_MERCHANT)} · season ${st.action.scope.season}`, treeName: `${placeName(UCP_MERCHANT)} customers`, leaves, commitment: ident.commitment, message: msg, scope, onChainRoot: state?.places.find((x) => x.mid === UCP_MERCHANT)?.m.root ?? null, payment: true })
      mp = await proveMembership(ident, leaves, msg, scope, artifacts)
      keep = { commitment: ident.commitment.toString(), root: mp.root.toString(), nullifier: mp.nullifier.toString(), proof: mp.proof, payer, season: st.action.scope.season }
      finishProof(h, mp.root, mp.nullifier)
    } catch (e) {
      const why = "the proof could not be made on this device"
      yield step(4, "failed", { error: "ProveFailed", headline: `${why}. you can still pay full price.`, reason: why, detail: why })
      return
    }
    yield step(4, "done", { detail: replay ? "the stored proof from your last purchase, sent again unchanged. nothing new was proven." : `made on this device in ${Math.round(performance.now() - t0)} ms. your secret never leaves it.` })
    yield step(5, "running")
    const pr = await bpost("/buy/prove", { checkoutId: st.checkoutId, payer, root: mp.root.toString(), nullifier: mp.nullifier.toString(), proof: mp.proof })
    if (pr.error || !pr.verified) {
      const error = String(pr.code ?? pr.error ?? "InvalidProof")
      const used = /Nullifier|#6/.test(error)
      const why = used ? "this discount was already used this season" : /UnknownRoot|#5/.test(error) ? "the store's customer list changed while proving. try again" : /NonCanonical|#7/.test(error) ? "the proof was malformed" : "the proof didn't check out"
      const headline = reuse ? "same proof again: refused. it only works once." : `discount refused: ${why}. you can still pay full price.`
      const h = hoods[hoods.length - 1]
      if (h) {
        h.status = "refused"
        if (used) {
          h.spentTx = spentTxOf(h.nullifier)
          try {
            const read = await getClient({ ...TESTNET, contractId: (await apiConfig()).contractId })
            h.spentOnChain = await (read as any).is_spent({ scope_hash: BigInt(h.scopeHash), nullifier: BigInt(h.nullifier) }).then((x: any) => !!x.result)
          } catch {}
        }
      }
      yield step(5, "failed", { error, headline, reason: why, tx: pr.txHash ?? null, detail: used ? "refused by Stellar: this proof was already used, so it cannot count twice." : `refused by Stellar: ${why}.` })
      yield { type: "headline", text: headline, reason: why, error }
      cart.discounts[0].removed = true
      cart.total = Number(item.price)
      yield snap()
      return yield step(6, "failed", { detail: UCP_STEPS[6].failDetail })
    }
    yield step(5, "done", pr.txHash ? { tx: pr.txHash, detail: "stellar checked the proof. it works once, so this discount cannot be reused." } : { detail: "the proof checks out. stellar verifies it once, inside the payment." })
    yield step(6, "running")
    cart.discounts[0].proven = true
    yield snap()
    yield step(6, "done", { detail: `−${cart.discounts[0].amount.toFixed(2)} usdc · total ${cart.total.toFixed(2)} usdc` })
  } else {
    for (const i of [3, 4, 5, 6]) yield step(i, "done", { detail: "skipped: no claim." })
  }
  yield step(7, "running")
  const q = await bpost("/buy/quote", { checkoutId: st.checkoutId, payer })
  if (q.error) {
    const why = payFailure(String(q.error))
    yield step(7, "failed", { error: q.error, headline: why, reason: why, detail: why })
    return yield { type: "headline", text: why, reason: why, error: String(q.error) }
  }
  const signed = await sdk.wallet.signTransaction(q.quote.tx_xdr)
  const sent = await bpost("/buy/send", { signedTxXdr: signed })
  if (sent.error) {
    const why = payFailure(String(sent.error))
    yield step(7, "failed", { error: sent.error, headline: why, reason: why, detail: why })
    return yield { type: "headline", text: why, reason: why, error: String(sent.error) }
  }
  cart.paid = true
  cart.tx = sent.txHash
  cart.total = Number(BigInt(q.quote.pays_raw)) / 1e7
  yield snap()
  yield step(7, "done", { tx: sent.txHash, detail: `${cart.total.toFixed(2)} usdc on stellar.` })
  // with a claim, the proof is verified and spent inside the payment itself: same transaction
  if (cart.discounts.length && cart.discounts[0].proven) {
    for (const h of hoods) if (h.status === "proved") {
      h.status = "verified"
      h.tx = sent.txHash
      rememberSpent(h.nullifier, sent.txHash)
    }
    if (keep) writeLastUcpProof(keep)
    yield step(5, "done", { tx: sent.txHash, detail: "stellar checked the proof in the same transaction as the payment. it works once, so it cannot be reused." })
    yield step(6, "done", { tx: sent.txHash, detail: `−${cart.discounts[0].amount.toFixed(2)} usdc, confirmed in the same transaction as the payment.` })
  }
  yield step(8, "running")
  const done = await bpost("/buy/complete", { checkoutId: st.checkoutId, txHash: sent.txHash })
  // Shopify returns a gid (gid://shopify/Order/123); show the order number, never the raw id
  const rawOrder = done?.order?.name ?? done?.order?.id ?? null
  const orderId = rawOrder ? (String(rawOrder).startsWith("gid://") ? `#${String(rawOrder).split("/").pop()}` : String(rawOrder)) : null
  yield step(8, "done", { tx: sent.txHash, detail: orderId ? `order ${orderId} · recorded in REP Store on Shopify` : "paid. the store records the order once draft orders are enabled." })
  yield step(9, "running")
  loading = null
  const joinTx = (typeof done?.joined === "string" ? done.joined : null) ?? (await membershipTx({ kind: "merchant", id: UCP_MERCHANT }, next.commitment))
  if (joinTx) rememberTx({ kind: "merchant", id: UCP_MERCHANT }, next.commitment, joinTx)
  yield step(9, "done", joinTx ? { tx: joinTx, detail: "you joined the store's proven customers. this purchase can be reviewed once, and it earns returning customer next time." } : {})
  if (orderId) yield { type: "store", storeView: { orderId, amount: cart.total, badges: cart.discounts.length ? ["verified returning customer"] : [], tx: sent.txHash } }
}

// The last proven purchase's proof, kept so "try a reused proof" resends exactly it (same nullifier, refused on chain).
type LastUcpProof = { commitment: string; root: string; nullifier: string; proof: any; payer: string; season: number }
const LAST_UCP_PROOF = "pol.ucpLastProof"
function readLastUcpProof(payer: string): LastUcpProof | null {
  try {
    const x = JSON.parse((nsStorage(nsNow) ?? LS)?.getItem(LAST_UCP_PROOF) ?? "null")
    return x && x.payer === payer ? x : null
  } catch {
    return null
  }
}
function writeLastUcpProof(x: LastUcpProof) {
  try {
    ;(nsStorage(nsNow) ?? LS)?.setItem(LAST_UCP_PROOF, JSON.stringify(x))
  } catch {}
}

/** Wraps the agent run so it never rejects: an unexpected error ends the run with a plain headline. */
async function* safeRun(g: AsyncGenerator<any>): AsyncGenerator<any> {
  try {
    yield* g
  } catch (e) {
    console.warn("agent run failed", String((e as any)?.message ?? e))
    yield { type: "headline", text: "something went wrong on our side. nothing was charged twice; try again.", reason: "unexpected error", error: "Unknown" }
  }
}

async function payUcp(cart: { items: { title: string; price: number }[] }, groups: string[]) {
  let last: any = null
  for await (const ev of safeRun(ucpRun(groups.includes("returning")))) if (ev.type === "step") last = ev
  if (last?.status === "failed") return err(last.error ?? "BadParams")
  const tx = last?.tx
  const subtotal = round2(cart.items.reduce((a, i) => a + i.price, 0))
  return { txHash: tx ?? null, subtotal, discounts: [], total: subtotal, saved: 0 }
}

/** This browser's purchase at the UCP store that is in its customer group (the basis of the returning-customer discount). */
function pastShopStay() {
  if (!state) return undefined
  const leaves = (state.places.find((p) => p.mid === UCP_MERCHANT)?.leaves ?? []) as bigint[]
  return sdk.stays.list().find((s) => s.merchant === UCP_MERCHANT && leaves.includes(BigInt(s.commitment)))
}

export const ucp = {
  /** true when this visitor already bought at the store, so bob can claim the returning-customer discount */
  returning: () => !!pastShopStay(),
  /** the store's returning-customer discount on chain, in basis points */
  discountBps: () => Number(state?.places.find((p) => p.mid === UCP_MERCHANT)?.m.discountBps ?? 0),
  /** reuse: replay the last proof on purpose (the refusal demo). noClaim: pay full price (after a refusal). */
  run: ({ reuse = false, noClaim = false } = {}) => safeRun(ucpRun(reuse, noClaim)),
  reset() {},
}

export const prover = {
  get cached() {
    return artifactsCached()
  },
  /** Real bytes of the proving files received so far (uncompressed), for the download step. */
  progress() {
    return { ...artProgress }
  },
  resetCache() {},
  // Real stages: the proving files download once; for pay, one membership proof per group is made here, bound to a
  // fresh one-time payer address; review proofs are made in postReview (they bind the rating and text).
  // never rejects: a failure ends the stages and pay() then reports a clean error (no unhandled rejection)
  async *prove(kind: string, place: number, args: { groups?: string[] } = {}) {
    try {
      yield* prover.proveInner(kind, place, args)
    } catch (e) {
      console.warn("prove stage failed", String((e as any)?.message ?? e))
      pending = null
      yield "verifying"
      yield "done"
    }
  },
  async *proveInner(kind: string, place: number, args: { groups?: string[] } = {}): AsyncGenerator<string> {
    await ready()
    const groups = args.groups || []
    const n = kind === "review" ? 1 : groups.length
    hoods = []
    if (n && !artifactsCached()) {
      yield "download"
      await loadArtifacts(ARTIFACTS)
    }
    if (kind === "review") {
      yield "proving"
    } else if (n) {
      const p = findP(place)!
      const elig = state!.elig[place] ?? []
      const payer = Keypair.random()
      const claims: any[] = []
      const dropped: string[] = []
      for (const g of groups) {
        yield "proving"
        const e = elig.find((x: any) => x.group === g)
        if (!e?._holder) continue
        const leaves = e._ref.kind === "merchant" ? (state!.places.find((x) => x.mid === e._ref.id)?.leaves ?? []) : (state!.groupLeaves.get(e._ref.id) ?? [])
        // the identity must be a leaf of THIS tree right now; a claim that cannot be proven is dropped, never thrown
        const ident = sdk.stays.identity(e._holder)
        if (!leaves.includes(ident.commitment)) {
          dropped.push(g)
          continue
        }
        try {
          const msg = d.discountMessage(payer.publicKey()), scope = d.ctxScope(p.mid, e._ref, SEASON_N, p.chain)
          const h = beginProof({ label: e.label, scopeText: `discount · ${p.m.name} · season ${SEASON_N}`, treeName: treeNameOf(e._ref, p.mid), leaves, commitment: ident.commitment, message: msg, scope, onChainRoot: e._ref.kind === "merchant" ? (state!.places.find((x) => x.mid === e._ref.id)?.m.root ?? null) : null, payment: true })
          const arts = await loadArtifacts(ARTIFACTS)
          h.t0 = performance.now()
          const mp = await proveMembership(ident, leaves, msg, scope, arts)
          finishProof(h, mp.root, mp.nullifier)
          claims.push({ key: g, arg: { group: { tag: e._ref.kind === "merchant" ? "Merchant" : "Group", values: [e._ref.id] }, proof: proofArg(mp.proof), root: mp.root, nullifier: mp.nullifier } })
        } catch {
          dropped.push(g)
        }
      }
      pending = { place, groups: claims.map((c) => c.key), payer, claims, dropped }
    }
    yield "verifying"
    yield "done"
  },
}

// ---- under the hood: the real Semaphore v4 values behind each proof (prover output, on-chain roots, the tx) ----
export interface HoodProof {
  label: string
  /** the scope in plain words, e.g. "discount · Casa Azulejo Nove · season 1" */
  scopeText: string
  treeName: string
  size: number
  leafIndex: number
  /** the LeanIMT path length actually used (ceil(log2(size))); the circuit's max depth is 10 */
  pathLen: number
  maxDepth: number
  root: string
  /** the root this proof used equals the tree's root on chain */
  rootOnChain: boolean
  nullifier: string
  messageHash: string
  scopeHash: string
  /** the tx that verified it (status verified), or the earlier tx that spent this nullifier (status refused) */
  tx: string | null
  payment: boolean
  /** witness: building the witness and proving (tree known); proved: public signals out; verified / refused: the tx said so */
  status: "witness" | "proved" | "verified" | "refused"
  spentTx: string | null
  spentOnChain: boolean | null
  /** when proving started (performance.now) and how long it took, measured */
  t0: number
  provedMs: number | null
  /** review: proving and posting happen in one SDK call, so the time covers both */
  combined: boolean
}
let hoods: HoodProof[] = []
const SPENT_KEY = (nf: string) => `bookerbob.spent.${nf}`
const rememberSpent = (nf: string, tx: string) => {
  try {
    LS?.setItem(SPENT_KEY(nf), tx)
  } catch {}
}
const spentTxOf = (nf: string) => {
  try {
    return LS?.getItem(SPENT_KEY(nf)) ?? null
  } catch {
    return null
  }
}
const pathLenOf = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))))
function beginProof(o: { label: string; scopeText: string; treeName: string; leaves: bigint[]; commitment: bigint; message: bigint; scope: bigint; onChainRoot: bigint | null; payment: boolean; combined?: boolean }): HoodProof {
  const h: HoodProof = {
    label: o.label,
    scopeText: o.scopeText,
    treeName: o.treeName,
    size: o.leaves.length,
    leafIndex: o.leaves.findIndex((l) => l === o.commitment),
    pathLen: pathLenOf(o.leaves.length),
    maxDepth: 10,
    root: "",
    rootOnChain: false,
    nullifier: "",
    messageHash: hex(d.semaphoreHash(o.message)),
    scopeHash: hex(d.semaphoreHash(o.scope)),
    tx: null,
    payment: o.payment,
    status: "witness",
    spentTx: null,
    spentOnChain: null,
    t0: performance.now(),
    provedMs: null,
    combined: !!o.combined,
  }
  ;(h as any)._onChainRoot = o.onChainRoot
  ;(h as any)._leaves = o.leaves
  hoods.push(h)
  return h
}
function finishProof(h: HoodProof, root: bigint, nullifier: bigint) {
  const oc = (h as any)._onChainRoot as bigint | null
  h.root = hex(root)
  h.rootOnChain = oc !== null && oc !== undefined ? oc === root : new Group((h as any)._leaves).root === root
  h.nullifier = hex(nullifier)
  h.provedMs = Math.round(performance.now() - h.t0)
  h.status = "proved"
}
const placeName = (mid: number) => state?.places.find((x) => x.mid === mid)?.m.name ?? `place ${mid}`
const treeNameOf = (ref: d.GroupRef, mid: number) =>
  ref.kind === "merchant" ? `${placeName(ref.id)} customers` : (groupsMeta.find((g) => g.id === ref.id)?.name ?? `group ${ref.id}`)
export const hood = {
  /** the proofs of the latest flow (booking, review, or a bob run), newest last */
  list: () => hoods.map(({ _onChainRoot, _leaves, ...h }: any) => ({ ...h })),
  clear() {
    hoods = []
  },
  explainer: "a Semaphore v4 zero-knowledge proof: you know a secret whose commitment is a leaf in this tree. the nullifier makes it single-use and can't be linked to you.",
}

// Passkey first, Freighter as fallback; a demo key in this browser when neither is available.
export const wallet = {
  address: null as string | null,
  method: null as string | null,
  async connect(method = "passkey", _instant = false) {
    let used = method
    const prev = this.address ?? sdk.wallet.address
    try {
      if (method === "demo key") this.address = await sdk.wallet.connect("local")
      else this.address = await sdk.wallet.connect(method === "freighter" ? "freighter" : "passkey")
    } catch (e: any) {
      // a passkey sign-in that finds nothing says so (the UI offers "create one?"); it never makes a key behind your back
      if (method !== "freighter" && method !== "demo key") {
        const noPasskey = /NoPasskey/.test(String(e?.message ?? e))
        throw Object.assign(new Error(noPasskey ? "no passkey for this site on this device. create one?" : /UserRejected/.test(String(e?.message)) ? "cancelled." : "this passkey could not sign in here."), { noPasskey })
      }
      used = "demo key"
      this.address = await sdk.wallet.connect("local")
    }
    if (used === "passkey") {
      const cred = credHere()
      const home = cred ? passkeyNs.find(cred) : null
      if (cred && home !== null && home !== nsNow && !/^pk-g\d+-/.test(nsNow)) {
        // this passkey's history lives in another namespace: open it there (restored without a prompt)
        const st = nsStorage(home) ?? LS!
        st.setItem("pos.wallet", "passkey")
        if (home) LS?.setItem(NS_KEY, home)
        else LS?.removeItem(NS_KEY)
        reloadClean()
      } else if (cred) passkeyNs.set(cred, nsNow)
    }
    this.method = used
    // Freighter after demo (or any address change): drop the old claim or sources() paints "none" and hides score.
    if (this.address && this.address !== prev) loyalty.clear()
    if (this.address) await loyalty.ensure(this.address)
    return { address: this.address, method: used }
  },
  disconnect() {
    sdk.wallet.disconnect()
    this.address = null
    this.method = null
    loyalty.clear()
  },
  /** The wallet this browser already holds (the SDK restores a remembered demo key on load), or null. */
  current() {
    const a = this.address ?? sdk.wallet.address
    if (!a) return null
    if (!this.address) {
      this.address = a
      this.method = sdk.wallet.kind === "local" ? "demo key" : sdk.wallet.kind
    }
    return { address: a, method: this.method }
  },
  get signer() {
    return this.address ? { sign: async (x: string) => sdk.wallet.signTransaction(x) } : null
  },
}

void toBeHex
void sleep

// ---- connect sources (header control): what each source proves and its status, from real state only ----
export type SourceStatus = "none" | "pending" | "connected" | "failed" | "soon"
export interface Source {
  id: "wallet" | "rep" | "passport" | "network"
  label: string
  /** One line on what it proves. */
  proves: string
  status: SourceStatus
  /** REP row, operator only: the REP account already joined in an earlier demo; offer "reset REP demo". */
  canReset?: boolean
  detail: string
  /** Where to go instead of an in-page action (REP app while REP verify is demo-only). */
  link?: string
  /** The transaction that made it true, when known. */
  txHash?: string | null
  /** What it unlocks at this place, or across the network. */
  perk?: string
  /** stellar.expert page of the connected account. */
  accountUrl?: string
  /** Wallet loyalty score (Horizon + optional Passport), when scored. */
  score?: number
  tier?: number
  /** Attest tx on testnet (memo.hash = claim digest) — clickable proof. */
  scoreUrl?: string
  /** REP: this membership was moved from an earlier generation ("start over"). */
  moved?: boolean
  /** Stellar wallet tier: explainer, held + join tx, or why it cannot join yet. */
  stellarTier?: Awaited<ReturnType<typeof stellarTier.view>>
}

// Wallet loyalty score (verify_onchain_zk): Horizon rating → claim → 1-stroop attest tx.
const loyaltySeason = () => new Date().getUTCFullYear() * 100 + (new Date().getUTCMonth() + 1)
const loyaltyCacheKey = (addr: string) => `bookerbob.loyalty.v2.${loyaltySeason()}.${addr}`
type LoyaltyView = {
  status: "none" | "pending" | "ready" | "failed" | "skipped"
  rating?: number
  tier?: number
  txHash?: string | null
  explorerUrl?: string | null
  address?: string
  why?: string
}
let loyaltyState: LoyaltyView = { status: "none" }
/** In-flight ensure — callers must share this promise (wallet.connect + UI both call ensure). */
let loyaltyInflight: { addr: string; p: Promise<LoyaltyView> } | null = null
function readLoyaltyCache(addr: string): Omit<LoyaltyView, "status" | "address" | "why"> | null {
  try {
    const raw = LS?.getItem(loyaltyCacheKey(addr))
    if (!raw) return null
    const j = JSON.parse(raw) as { rating?: number; tier?: number; txHash?: string | null; explorerUrl?: string | null }
    if (typeof j.rating !== "number" || typeof j.tier !== "number") return null
    return { rating: j.rating, tier: j.tier, txHash: j.txHash ?? null, explorerUrl: j.explorerUrl ?? null }
  } catch {
    return null
  }
}
function writeLoyaltyCache(addr: string, v: { rating: number; tier: number; txHash: string | null; explorerUrl: string | null }) {
  try {
    LS?.setItem(loyaltyCacheKey(addr), JSON.stringify(v))
  } catch {
    /* quota */
  }
}
export const loyalty = {
  get state() {
    return { ...loyaltyState }
  },
  clear() {
    loyaltyState = { status: "none" }
    loyaltyInflight = null
  },
  /** Score + attest once per season (cached). `proveScore: false` — panel needs the attest tx, not the Groth16 artifact. */
  async ensure(address?: string | null) {
    const addr = address ?? wallet.address ?? sdk.wallet.address
    if (!addr) return (loyaltyState = { status: "none" })
    // the demo key is a fresh, history-less account: nothing to score, and no error to show
    if (sdk.wallet.kind === "local" && sdk.wallet.address === addr) return (loyaltyState = { status: "skipped", address: addr, why: "wallet score: connect a Stellar wallet with history (Freighter) to earn a tier" })
    const cached = readLoyaltyCache(addr)
    // Cache hit on rating alone (attest may have failed last time — still show score).
    if (cached && (cached.explorerUrl || cached.txHash)) {
      const explorerUrl = cached.explorerUrl || (cached.txHash ? `https://stellar.expert/explorer/testnet/tx/${cached.txHash}` : null)
      return (loyaltyState = { status: "ready", address: addr, ...cached, explorerUrl })
    }
    if (loyaltyInflight?.addr === addr) return loyaltyInflight.p
    // Keep a cached rating visible while we (re)score / attest — never blank the Freighter row.
    if (cached) {
      loyaltyState = { status: "ready", address: addr, ...cached, explorerUrl: cached.explorerUrl || null }
    } else {
      loyaltyState = { status: "pending", address: addr }
    }
    const p = (async (): Promise<LoyaltyView> => {
      try {
        // Score first (Horizon + same-origin Passport proxy). Never hit demo.stellarpassport.xyz from the
        // browser — CORS hangs and the Freighter panel never gets a score link.
        const { verifyWallet, claimDigest, attestLoyaltyClaim } = await import("../../packages/verify_onchain_zk/src/index.ts")
        const season = loyaltySeason()
        const { claim } = await verifyWallet(addr, 0, season, {
          passport: true,
          // "" = same origin. With proxy set, verify_onchain_zk never calls demo.stellarpassport.xyz.
          passportProxyBase: API,
        })
        let view = {
          rating: claim.rating,
          tier: claim.tier,
          txHash: null as string | null,
          explorerUrl: null as string | null,
        }
        // Publish score immediately so the connections panel can render "score" before attest returns.
        loyaltyState = { status: "ready", address: addr, ...view }
        writeLoyaltyCache(addr, view)
        try {
          // the public attest is off unless the backend enables it (privacy; it also raced the booking sponsor)
          if (!(await apiConfig()).loyaltyAttest) return loyaltyState
          const digest = await claimDigest(claim)
          const attest = await attestLoyaltyClaim(claim, { apiBase: API, digest })
          view = {
            rating: claim.rating,
            tier: claim.tier,
            txHash: attest.txHash,
            explorerUrl: attest.explorerUrl || `https://stellar.expert/explorer/testnet/tx/${attest.txHash}`,
          }
          writeLoyaltyCache(addr, view)
        } catch {
          /* attest optional for showing the score; proof tx may stay unavailable */
        }
        return (loyaltyState = { status: "ready", address: addr, ...view })
      } catch {
        if (cached) {
          return (loyaltyState = {
            status: "ready",
            address: addr,
            ...cached,
            explorerUrl: cached.explorerUrl || null,
          })
        }
        return (loyaltyState = {
          status: "failed",
          address: addr,
          why: "wallet score: not available for this wallet right now",
        })
      } finally {
        if (loyaltyInflight?.addr === addr) loyaltyInflight = null
      }
    })()
    loyaltyInflight = { addr, p }
    return p
  },
}

/** The REP app, one config value (may move to r3p.xyz). */
export const REP_APP_URL = "https://r3p.app"
// REP verify opens sessions only for the demo operator's browser (GET /api/rep/status, cookie travels same-origin)
let repDemoP: Promise<boolean> | null = null
export const repDemo = () => (repDemoP ??= fetch(`${API}/api/rep/status`, { credentials: "same-origin" }).then((r) => r.json()).then((d) => !!d.demo).catch(() => false))

// ---- rebind: "start over" MOVES a membership held by an earlier generation instead of being refused ----
// The browser proves it controls the OLD identity with a Semaphore v4 signature over "rebind:<group>:<new>:<nonce>"
// (server/src/rebind.ts checks it, then replace_member(group, old, new) on chain). Same field mapping as the server.
const FR_MOD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const rebindChallenge = (group: number, newCommitment: string, nonce: string) => `rebind:${group}:${newCommitment}:${nonce}`
export const challengeField = (text: string) => BigInt(sha256(toUtf8Bytes(text))) % FR_MOD
export function signRebind(old: { commitment: bigint; publicKey: [bigint, bigint] | bigint[]; signMessage: (m: bigint) => { R8: bigint[]; S: bigint } }, group: number, newCommitment: string, nonce: string) {
  const sig = old.signMessage(challengeField(rebindChallenge(group, newCommitment, nonce)))
  return {
    oldCommitment: old.commitment.toString(),
    publicKey: [old.publicKey[0].toString(), old.publicKey[1].toString()] as [string, string],
    signature: { R8: [sig.R8[0].toString(), sig.R8[1].toString()] as [string, string], S: sig.S.toString() },
  }
}
/** The stay identity an EARLIER generation of this browser used for a group membership, or null. It reads that
 *  generation's namespace (its master secret and stays) and derives the identity the same way the SDK does. */
export function oldIdentityFor(groupId: number) {
  // only a passkey generation ("start over") moves a membership; a fresh demo or a new passkey never does
  if (!/^pk-g\d+-/.test(nsNow)) return null
  const leaves = state?.groupLeaves.get(groupId) ?? []
  if (!leaves.length) return null
  const cur = new Set(sdk.stays.list().map((s) => s.commitment))
  const cred = credHere()
  const home = cred ? passkeyNs.find(cred) : null
  const nss = [...generations.list().sort((a, b) => b.n - a.n).map((g) => g.ns), ...(home !== null ? [home] : [])]
  const seen = new Set<string>()
  for (const ns of nss) {
    if (ns === nsNow || seen.has(ns)) continue
    seen.add(ns)
    const st = ns ? nsStorage(ns) : LS
    const master = st?.getItem("pos.master")
    if (!master) continue
    let stays: Stay[] = []
    try {
      stays = JSON.parse(st!.getItem("pos.stays") ?? "[]")
    } catch {}
    const s = stays.find((x) => !cur.has(x.commitment) && leaves.includes(BigInt(x.commitment)))
    if (s) return d.stayIdentity(master, s.merchant, s.stayIndex)
  }
  return null
}
const repGroupId = async (): Promise<number | null> => {
  const st = await fetch(`${API}/api/rep/status`, { credentials: "same-origin" }).then((r) => r.json()).catch(() => null)
  if (st && typeof st.group === "number") return st.group
  return groupsMeta.find((g) => g.kind === "attested" && /verified traveler/i.test(g.name))?.id ?? null
}

// REP verified traveler: the guest approves in the REP Bob app; the backend checks the REP-signed verdict and adds a
// fresh identity of this browser to the attested group. The identity is a new stay at the store that is never checked
// in, so the group tree cannot be linked to any place's customer tree.
let repState: { status: SourceStatus; sid?: string; until?: number; tx?: string | null; why?: string; canReset?: boolean; moving?: boolean; moved?: boolean } = { status: "none" }
const travelerHeld = () => local.credentials().some((c: any) => c.group === "traveler" && c.held)

export const rep = {
  get state() {
    return { ...repState }
  },
  async start() {
    if (!(await repDemo())) return (repState = { status: "soon", why: "live with the REP app · shown in the demo video" })
    const stay = sdk.stays.create(UCP_MERCHANT)
    const r = await fetch(`${API}/api/rep/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commitment: stay.commitment }) })
      .then((x) => x.json())
      .catch(() => ({ error: "Network" }))
    repState = r.error ? { status: "failed", why: "bookerbob could not open a request. try again." } : { status: "pending", sid: r.sid, until: r.expiresAt }
    // an earlier generation held the traveler membership: sign the move with that identity BEFORE the phone shares
    if (!r.error && r.nonce) {
      try {
        const gid = await repGroupId()
        const old = gid !== null ? oldIdentityFor(gid) : null
        if (old && gid !== null) {
          const rb = await fetch(`${API}/api/rep/rebind`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid: r.sid, rebind: signRebind(old as any, gid, stay.commitment, r.nonce) }) })
            .then((x) => x.json())
            .catch(() => null)
          if (rb && !rb.error) repState.moving = true
        }
      } catch {
        /* no old identity or no rebind endpoint: the normal join runs, with its honest refusal */
      }
    }
    return { ...repState }
  },
  /** One poll; call every ~2 s while pending. Only an explicit verdict or the deadline ends the wait. */
  async poll() {
    if (repState.status !== "pending" || !repState.sid) return { ...repState }
    const r = await fetch(`${API}/api/rep/result?sid=${repState.sid}`).then((x) => x.json()).catch(() => null)
    if (r?.status === "passed") {
      repState = { status: "connected", tx: r.txHash || null, moved: !!r.moved }
      loading = null // the traveler group changed: re-read it so perks count it
      await ready()
    } else if (r?.status === "failed") {
      const joined = /already joined/i.test(String(r.reason ?? ""))
      // the operator rehearses with the same REP account: offer a reset instead of a dead end
      const operator = await repDemo()
      const op = joined && operator
      // the operator sees the server's own reason under the plain line (rehearsal diagnosis); visitors never do
      const raw = operator && r.reason && r.reason !== "expired" && !joined ? ` (${String(r.reason).slice(0, 140)})` : ""
      repState = {
        status: "failed",
        why: r.reason === "expired" ? "the request expired. try again." : op ? "this REP account already joined in an earlier demo." : joined ? "a new generation needs a new proof in REP Bob." : `REP could not confirm it.${raw}`,
        ...(op ? { canReset: true } : {}),
      }
    }
    else if (repState.until && Date.now() > repState.until + 5000) repState = { status: "failed", why: "the request expired. try again." }
    return { ...repState }
  },
  /** Operator only: reset the REP demo, then "verify with REP" can run again. */
  async resetDemo() {
    const ok = await repDemoReset()
    repState = ok ? { status: "none" } : { ...repState, why: "could not reset the REP demo. try again." }
    return ok
  },
}

// Stellar wallet tier: the wallet's tier comes from the loyalty score above (Horizon read, no public attest). At or above
// /api/stellar-tier/info minTier, a dedicated identity of this browser (a stay at the store that is never checked in, so it
// links to no customer tree) joins the attested group: challenge -> SEP-53 signature by the wallet -> join (add_member).
// G accounts only: a passkey wallet is a contract account (C...) and cannot sign a SEP-53 message.
let tierMin = 3
let tierInfoP: Promise<{ minTier: number; explainer: string }> | null = null
const tierInfo = () =>
  (tierInfoP ??= fetch(`${API}/api/stellar-tier/info`)
    .then((r) => r.json())
    .then((x) => ((tierMin = Number(x.minTier ?? 3)), { minTier: tierMin, explainer: String(x.explainer ?? EXPLAIN.tier) }))
    .catch(() => ((tierInfoP = null), { minTier: tierMin, explainer: EXPLAIN.tier })))
let tierState: { status: "none" | "pending" | "failed"; why?: string } = { status: "none" }
const TIER_KEY = (c: string) => `bookerbob.tier.${c}`
const tierGroupId = () => groupsMeta.find((g) => g.kind === "attested" && /stellar wallet tier/i.test(g.name))?.id ?? null
const tierHolder = () => {
  const gid = tierGroupId()
  if (gid === null || !state) return null
  const leaves = state.groupLeaves.get(gid) ?? []
  return sdk.stays.list().find((s) => leaves.includes(BigInt(s.commitment))) ?? null
}

export const stellarTier = {
  info: tierInfo,
  /** Why this browser cannot join right now ("" = it can). Synchronous, from the wallet and its loyalty score. */
  reason(): string {
    const addr = wallet.address ?? sdk.wallet.address
    if (!addr) return `connect a Freighter wallet with tier ${tierMin}+ to join`
    if (!addr.startsWith("G")) return "a passkey wallet is a contract account. connect Freighter for the tier."
    const ly = loyaltyState.address === addr ? loyaltyState : ({ status: "none" } as LoyaltyView)
    if (sdk.wallet.kind === "local" && ly.status !== "ready") return `a demo key is brand new, so it has no tier. connect Freighter with tier ${tierMin}+`
    if (ly.status === "pending") return "scoring your wallet…"
    if (ly.status !== "ready" || typeof ly.tier !== "number") return `connect a Stellar wallet with tier ${tierMin}+`
    if (ly.tier < tierMin) return `your wallet scores tier ${ly.tier}, needs ${tierMin}`
    return ""
  },
  async view() {
    await ready()
    await tierInfo()
    const h = tierHolder()
    const gid = tierGroupId()
    let tx: string | null = null
    let tier: number | null = null
    let moved = false
    if (h) {
      try {
        const saved = JSON.parse(LS?.getItem(TIER_KEY(h.commitment)) ?? "null")
        tx = saved?.tx ?? null
        tier = saved?.tier ?? null
        moved = !!saved?.moved
      } catch {}
      if (!tx && gid !== null) tx = await membershipTx({ kind: "group", id: gid }, h.commitment)
    }
    const why = this.reason()
    return { minTier: tierMin, explainer: EXPLAIN.tier, perk: perkFor("tier"), moved, held: !!h, tx, tier: tier ?? (loyaltyState.tier ?? null), canJoin: !h && !why && tierState.status !== "pending", pending: tierState.status === "pending", reason: h ? "" : tierState.status === "failed" ? (tierState.why ?? why) : why }
  },
  async join() {
    await tierInfo()
    const why = this.reason()
    if (why) return (tierState = { status: "failed", why })
    const addr = (wallet.address ?? sdk.wallet.address)!
    tierState = { status: "pending" }
    try {
      const stay = sdk.stays.create(UCP_MERCHANT)
      const commitment = BigInt(stay.commitment).toString()
      const ch: any = await fetch(`${API}/api/stellar-tier/challenge?address=${addr}&commitment=${commitment}`).then((r) => r.json())
      if (!ch?.message) return (tierState = { status: "failed", why: "bookerbob could not open a request. try again." })
      const signature = await sdk.wallet.signMessage(ch.message)
      // an earlier generation held the tier: move it (signed by that generation's identity) instead of a refused join
      let rebind: any = undefined
      try {
        const info: any = await fetch(`${API}/api/stellar-tier/info`).then((x) => x.json()).catch(() => ({}))
        const gid = typeof info.groupId === "number" ? info.groupId : tierGroupId()
        const old = gid !== null ? oldIdentityFor(gid) : null
        if (old && gid !== null) rebind = signRebind(old as any, gid, commitment, ch.nonce)
      } catch {}
      const r: any = await fetch(`${API}/api/stellar-tier/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, commitment, nonce: ch.nonce, signature, ...(rebind ? { rebind } : {}) }) })
        .then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) }))
      if (r.ok) {
        LS?.setItem(TIER_KEY(stay.commitment), JSON.stringify({ tx: r.txHash || null, tier: r.tier ?? null, moved: !!r.moved }))
        tierState = { status: "none" }
        loading = null // the tier group changed: re-read it so perks count it
        await ready()
        return { ...tierState }
      }
      const msg =
        r.status === 403 ? `your wallet scores tier ${r.tier}, needs ${r.minTier}` : r.status === 409 ? "this wallet already joined. one identity per wallet." : r.status === 401 ? "the wallet signature did not check out. try again." : r.status === 410 ? "the request expired. try again." : "the join did not go through. try again."
      return (tierState = { status: "failed", why: msg })
    } catch (e: any) {
      return (tierState = { status: "failed", why: /reject|denied|cancel/i.test(String(e?.message ?? e)) ? "you declined in the wallet. nothing was sent." : "the wallet could not sign. try again." })
    }
  },
}

// Stellar Passport (verify_onchain_zk): a read-only lookup of the connected wallet's builder profile.
let passportState: { status: SourceStatus; detail: string; address?: string } = { status: "none", detail: "" }
export const passport = {
  async check() {
    const address = wallet.address ?? sdk.wallet.address
    if (!address) return (passportState = { status: "none", detail: "connect a wallet first" })
    passportState = { status: "pending", detail: "looking up your builder profile", address }
    const r = await fetch(`${API}/api/passport/lookup?address=${address}`).then((x) => x.json()).catch(() => null)
    if (!r || r.error) passportState = { status: "failed", detail: "the lookup did not answer. try again.", address }
    else if (r.matched) passportState = { status: "connected", detail: `builder profile found${typeof r.score === "number" ? `, score ${r.score}` : ""}`, address }
    else passportState = { status: "none", detail: "no builder profile for this wallet", address }
    return { ...passportState }
  },
}

/** What a source unlocks at a place (from its on-chain policy), or across the network. */
function perkFor(groupKey: string, placeId?: number): string {
  if (!state) return ""
  const rows = Object.entries(state.elig).flatMap(([pid, xs]) => (xs as any[]).filter((x) => x.group === groupKey).map((x) => ({ pid: Number(pid), bps: x.bps })))
  if (placeId !== undefined && placeId !== null) {
    const here = rows.find((r) => r.pid === placeId)
    return here ? `+${here.bps / 100}% here` : "no perk at this place"
  }
  if (!rows.length) return ""
  const bps = Math.max(...rows.map((r) => r.bps))
  return `+${bps / 100}% at ${rows.length} ${rows.length === 1 ? "place" : "places"}`
}
async function heldTx(groupKey: string): Promise<string | null> {
  for (const xs of Object.values(state?.elig ?? {})) for (const x of xs as any[]) if (x.group === groupKey && x.txHash) return x.txHash
  return null
}

export async function sources(placeId?: number): Promise<Source[]> {
  await ready()
  const addr = wallet.address ?? sdk.wallet.address
  const ms = local.memberships() as any[]
  const placesProven = new Set(ms.map((m) => m.place)).size
  const held = travelerHeld()
  const demo = await repDemo()
  const pp = passportState.address && passportState.address !== addr ? { status: "none" as SourceStatus, detail: "" } : passportState
  const ly = loyaltyState.address && loyaltyState.address !== addr ? ({ status: "none" } as LoyaltyView) : loyaltyState
  const walletDetail = !addr
    ? "face id. no seed phrase. your proofs come back on any of your devices."
    : ly.status === "ready" && typeof ly.rating === "number"
      ? `${addr.slice(0, 4)}…${addr.slice(-4)} · score ${ly.rating} · tier ${ly.tier}`
      : ly.status === "pending"
        ? `${addr.slice(0, 4)}…${addr.slice(-4)} · scoring…`
        : ly.status === "failed"
          ? `${addr.slice(0, 4)}…${addr.slice(-4)} · score failed`
          : `${addr.slice(0, 4)}…${addr.slice(-4)}`
  return [
    {
      id: "wallet",
      label: addr ? (wallet.method ?? (sdk.wallet.kind === "local" ? "demo key" : "wallet")) : "wallet",
      proves: "pays for you. a fresh address for every payment, so purchases do not link.",
      status: addr ? "connected" : "none",
      detail: walletDetail,
      ...(addr ? { accountUrl: `https://stellar.expert/explorer/testnet/account/${addr}` } : {}),
      stellarTier: await stellarTier.view(),
      ...(ly.status === "ready" && typeof ly.rating === "number"
        ? {
            score: ly.rating,
            tier: ly.tier,
            scoreUrl: ly.explorerUrl || undefined,
            txHash: ly.txHash ?? null,
          }
        : {}),
    },
    {
      id: "rep",
      label: "REP verified traveler · from REP",
      proves: EXPLAIN.traveler,
      status: held ? "connected" : demo ? repState.status : "soon",
      canReset: !held && demo && !!repState.canReset,
      moved: held && !!repState.moved,
      txHash: held ? ((await heldTx("traveler")) ?? repState.tx ?? null) : null,
      perk: perkFor("traveler", placeId),
      detail: held
        ? repState.moved
          ? "moved your REP verified traveler to this fresh start"
          : "verified traveler counts in your perks"
        : !demo
          ? "live with the REP app · shown in the demo video"
          : repState.status === "pending"
            ? repState.moving
              ? "approve in REP Bob on your phone. your earlier start's membership moves here."
              : "approve in REP Bob on your phone"
            : repState.status === "failed"
              ? (repState.why ?? "")
              : "+5% where places honor it",
      ...(held || demo ? {} : { link: REP_APP_URL }),
    },
    {
      id: "network",
      label: "BookerBob regular",
      proves: EXPLAIN.network,
      status: ms.length ? "connected" : "none",
      txHash: ms.length ? ((await heldTx("network")) ?? ms[0].txHash ?? null) : null,
      perk: perkFor("network", placeId),
      detail: ms.length ? `proven in ${placesProven} ${placesProven === 1 ? "place" : "places"}` : "comes with your first stay or purchase",
    },
  ]
}
