// Testnet implementation of the SDK bind points. Same types as the mock.
// Views read the contract over RPC; reviews and the demo desk / arbiter / relayer go through the BookerBob backend.
import { Account, Address, Asset, BASE_FEE, Keypair, Operation, TransactionBuilder, contract, rpc, scValToNative } from "@stellar/stellar-sdk"

const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
import type { Perk, Chain, Disclosure, Dispute, Merchant, ProofEvent, ProofRequest, Prover, Review, Sdk, Stay, Stays, Wallet, WalletKind, WriteResult, ErrorName, Usdc } from "./types.ts"
import { getClient, views, write, proofArg, TESTNET, type NetworkConfig, type Signer } from "./contract.ts"
import * as d from "./derive.ts"
import { loadArtifacts, proveMembership, artifactsCached, DEFAULT_ARTIFACTS_URL } from "./prove.ts"
import { buildDisclosure, checkDisclosure } from "./disclosure.ts"

export interface TestnetOptions {
  /** BookerBob backend base URL ("" = same origin). */
  apiUrl?: string
  artifactsUrl?: string
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">
}

interface ApiConfig extends NetworkConfig { demoMerchants: number[]; usdc: string; usdcIssuer?: string; arbiter: string }

const memStorage = (): TestnetOptions["storage"] => {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("")

export function createTestnetSdk(opts: TestnetOptions = {}): Sdk {
  const api = opts.apiUrl ?? ""
  const store = opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : memStorage())!
  const artifactsUrl = opts.artifactsUrl ?? DEFAULT_ARTIFACTS_URL

  let cfgP: Promise<ApiConfig> | null = null
  let contractId = ""
  const cfg = () =>
    (cfgP ??= fetch(`${api}/api/config`)
      .then((r) => r.json())
      .then((c) => {
        contractId = c.contractId
        return { ...TESTNET, ...c } as ApiConfig
      }))
  const reader = async () => getClient(await cfg())
  const post = async (path: string, body: unknown): Promise<any> => {
    try {
      const r = await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) })
      return await r.json()
    } catch {
      return { error: "Network" }
    }
  }
  const asResult = <T>(r: any, pick: (r: any) => T = () => ({}) as T): WriteResult<T> =>
    r?.error ? { error: (r.error as ErrorName) ?? "Unknown", message: r.message } : ({ txHash: r.txHash, ...pick(r) } as WriteResult<T>)

  // ---- wallet ----
  let address: string | null = null
  let kind: WalletKind | null = null
  let signer: Signer | null = null
  const listeners = new Set<(a: string | null) => void>()
  const setWallet = (a: string | null, k: WalletKind | null, s: Signer | null) => {
    address = a
    kind = k
    signer = s
    if (a && k) store.setItem("pos.wallet", k)
    else store.removeItem("pos.wallet")
    listeners.forEach((cb) => cb(a))
  }
  const wallet: Wallet = {
    get address() {
      return address
    },
    get kind() {
      return kind
    },
    async connect(k: WalletKind = "freighter") {
      const c = await cfg()
      if (k === "freighter") {
        const fr = await import("@stellar/freighter-api")
        const conn = await fr.isConnected()
        if (!conn.isConnected) throw new Error("Freighter is not installed")
        const acc = await fr.requestAccess()
        if (acc.error) throw new Error(String(acc.error.message ?? acc.error))
        const signTransaction: Signer["signTransaction"] = async (xdr, o) => {
          const r = await fr.signTransaction(xdr, { networkPassphrase: o?.networkPassphrase ?? c.networkPassphrase, address: acc.address })
          if (r.error) throw new Error(String(r.error.message ?? r.error))
          return { signedTxXdr: r.signedTxXdr, signerAddress: r.signerAddress }
        }
        setWallet(acc.address, "freighter", { publicKey: acc.address, signTransaction })
        return acc.address
      }
      if (k === "local") {
        let secret = store.getItem("pos.localKey")
        const fresh = !secret
        if (!secret) {
          secret = Keypair.random().secret()
          store.setItem("pos.localKey", secret)
        }
        const kp = Keypair.fromSecret(secret)
        if (fresh) await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`).catch(() => null)
        const s = contract.basicNodeSigner(kp, c.networkPassphrase)
        setWallet(kp.publicKey(), "local", { publicKey: kp.publicKey(), signTransaction: s.signTransaction, signAuthEntry: s.signAuthEntry })
        return kp.publicKey()
      }
      throw new Error("passkey wallet is not available yet; use Freighter or a demo key")
    },
    disconnect() {
      setWallet(null, null, null)
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  const writer = async () => {
    if (!signer) return null
    return getClient(await cfg(), signer)
  }

  // ---- stays (local) ----
  const master = () => {
    let m = store.getItem("pos.master")
    if (!m) {
      m = randomHex(32)
      store.setItem("pos.master", m)
    }
    return m
  }
  const loadStays = (): Stay[] => JSON.parse(store.getItem("pos.stays") ?? "[]")
  const saveStays = (s: Stay[]) => store.setItem("pos.stays", JSON.stringify(s))
  const identityOf = (s: Stay) => d.stayIdentity(master(), s.merchant, s.stayIndex)
  const updateStay = (s: Stay) => saveStays(loadStays().map((x) => (x.merchant === s.merchant && x.stayIndex === s.stayIndex ? s : x)))
  const stays: Stays = {
    list: loadStays,
    create(merchant) {
      const all = loadStays()
      const idx = all.filter((s) => s.merchant === merchant).length
      const s: Stay = { merchant, stayIndex: idx, commitment: d.stayIdentity(master(), merchant, idx).commitment.toString(), createdAt: Date.now(), checkedIn: false, reviewId: null, discountSeasonsUsed: [] }
      saveStays([...all, s])
      return s
    },
    async sync() {
      const c = await reader()
      const all = loadStays()
      for (const s of all) s.checkedIn = (await views.leafIndex(c, s.merchant, BigInt(s.commitment))) !== null
      saveStays(all)
      return all
    },
  }

  // ---- perks: which policy groups this browser's stays belong to ----
  const groupArg = (g: d.GroupRef) => ({ tag: g.kind === "merchant" ? "Merchant" : "Group", values: [g.id] })
  const planClaims = async (merchant: number) => {
    const c = await reader()
    const pol = await views.policy(c, merchant)
    if (!pol) return null
    const m = await views.merchant(c, merchant)
    const groups = await views.groups(c)
    const mine = loadStays().map((s) => ({ s, id: identityOf(s) }))
    const items: Perk[] = []
    const claims: { group: d.GroupRef; identity: ReturnType<typeof identityOf>; leaves: bigint[] }[] = []
    for (const it of pol.items) {
      const leaves = it.group.kind === "merchant" ? await views.leaves(c, it.group.id) : await views.groupLeaves(c, it.group.id)
      const hit = mine.find((x) => leaves.includes(x.id.commitment))
      const label =
        it.group.kind === "merchant"
          ? it.group.id === merchant
            ? m.kind === "hotel" ? "returning guest" : "returning customer"
            : `customer of place ${it.group.id}`
          : (groups.find((g) => g.id === it.group.id)?.name ?? `group ${it.group.id}`)
      items.push({ group: it.group, label, bps: it.bps, eligible: !!hit })
      if (hit) claims.push({ group: it.group, identity: hit.id, leaves })
    }
    const bps = Math.min(pol.maxBps, items.filter((i) => i.eligible).reduce((a, i) => a + i.bps, 0))
    return { items, claims, maxBps: pol.maxBps, bps, price: m.price }
  }

  // ---- prover ----
  const prover: Prover = {
    ready: artifactsCached,
    async *prove(req: ProofRequest): AsyncIterable<ProofEvent> {
      if (req.kind === "discount" && !address) return yield { stage: "done", result: { error: "WalletNotConnected" } }
      if (!artifactsCached()) {
        const q: ProofEvent[] = []
        let wake: (() => void) | null = null
        let done = false
        const p = loadArtifacts(artifactsUrl, (loaded, total) => {
          q.push({ stage: "download", loaded, total })
          wake?.()
        }).finally(() => {
          done = true
          wake?.()
        })
        while (!done || q.length) {
          if (q.length) yield q.shift()!
          else await new Promise<void>((r) => (wake = r))
        }
        try {
          await p
        } catch {
          return yield { stage: "done", result: { error: "Network", message: "could not download the proving files" } }
        }
      }
      const artifacts = await loadArtifacts(artifactsUrl)
      const c = await reader()
      if (req.kind === "context") {
        if (!address) return yield { stage: "done", result: { error: "WalletNotConnected" } }
        const plan = await planClaims(req.merchant)
        if (!plan || plan.claims.length === 0) return yield { stage: "done", result: { error: "NotInTree" } }
        yield { stage: "proving" }
        const msg = d.discountMessage(address)
        const claims = []
        for (const cl of plan.claims) {
          const mp = await proveMembership(cl.identity, cl.leaves, msg, d.ctxScope(req.merchant, cl.group, req.season), artifacts)
          claims.push({ group: groupArg(cl.group), proof: proofArg(mp.proof), root: mp.root, nullifier: mp.nullifier })
        }
        yield { stage: "verifying" }
        const w = await writer()
        if (!w) return yield { stage: "done", result: { error: "WalletNotConnected" } }
        const r = await write<bigint>(w, "book_with_context", { merchant: req.merchant, guest: address, season: req.season, amount: undefined, claims })
        if (!r.ok) return yield { stage: "done", result: { error: r.error, message: r.message } }
        const paid = BigInt(r.value as any)
        return yield { stage: "done", result: { txHash: r.txHash, paid, saved: plan.price - paid, bps: plan.bps } }
      }
      const leaves = await views.leaves(c, req.stay.merchant)
      const id = identityOf(req.stay)
      if (!leaves.includes(id.commitment)) return yield { stage: "done", result: { error: "NotInTree" } }
      yield { stage: "proving" }
      if (req.kind === "review") {
        const dk = d.stayDisclosureKey(master(), req.stay.merchant, req.stay.stayIndex)
        const commit = d.disclosureCommit(dk)
        const msg = d.reviewMessage(req.rating, d.contentHash(req.text), commit)
        const mp = await proveMembership(id, leaves, msg, d.reviewScope(req.stay.merchant), artifacts)
        yield { stage: "verifying" }
        const r = await post("/api/review", { merchant: req.stay.merchant, rating: req.rating, text: req.text, disclosureCommit: commit, proof: mp.proof, root: mp.root, nullifier: mp.nullifier })
        const res = asResult<{ reviewId: number }>(r, (x) => ({ reviewId: Number(x.reviewId) }))
        if (!("error" in res)) updateStay({ ...req.stay, reviewId: res.reviewId })
        return yield { stage: "done", result: res }
      }
      const mp = await proveMembership(id, leaves, d.discountMessage(address!), d.discountScope(req.stay.merchant, req.season), artifacts)
      yield { stage: "verifying" }
      const w = await writer()
      if (!w) return yield { stage: "done", result: { error: "WalletNotConnected" } }
      const m = await views.merchant(c, req.stay.merchant)
      const r = await write<bigint>(w, "book_with_discount", { merchant: req.stay.merchant, guest: address, season: req.season, proof: proofArg(mp.proof), root: mp.root, nullifier: mp.nullifier })
      if (!r.ok) return yield { stage: "done", result: { error: r.error, message: r.message } }
      updateStay({ ...req.stay, discountSeasonsUsed: [...req.stay.discountSeasonsUsed, req.season] })
      const paid = BigInt(r.value as any)
      return yield { stage: "done", result: { txHash: r.txHash, paid, saved: m.price - paid } }
    },
  }
  const drain = async <T>(req: ProofRequest): Promise<WriteResult<T>> => {
    let last: WriteResult<any> = { error: "Unknown" }
    for await (const ev of prover.prove(req)) if (ev.stage === "done") last = ev.result
    return last
  }

  // ---- chain ----
  const usdcBalance = async (): Promise<Usdc | null> => {
    if (!address) return null
    const c = await cfg()
    const s = new rpc.Server(c.rpcUrl)
    try {
      const src = new Account(NULL_ACCOUNT, "0")
      const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: c.networkPassphrase })
        .addOperation(Operation.invokeContractFunction({ contract: c.usdc, function: "balance", args: [new Address(address).toScVal()] }))
        .setTimeout(30)
        .build()
      const sim = await s.simulateTransaction(tx)
      if (rpc.Api.isSimulationSuccess(sim) && sim.result) return BigInt(scValToNative(sim.result.retval))
    } catch {}
    return 0n
  }
  const chain: Chain = {
    async listMerchants() {
      const c = await reader()
      const conf = await cfg()
      const n = await views.merchantCount(c)
      const ms = await Promise.all(Array.from({ length: n }, (_, i) => views.merchant(c, i)))
      return ms.map((m) => ({ ...m, demo: conf.demoMerchants.includes(m.id) }))
    },
    async getMerchant(id) {
      const conf = await cfg()
      const m = await views.merchant(await reader(), id)
      return { ...m, demo: conf.demoMerchants.includes(id) }
    },
    async getReviews(merchant): Promise<Review[]> {
      const r = await fetch(`${api}/api/reviews/${merchant}`).then((x) => x.json())
      return (r as Review[]).slice().reverse()
    },
    explorerTx: (h) => `https://stellar.expert/explorer/testnet/tx/${h}`,
    explorerContract: () => `https://stellar.expert/explorer/testnet/contract/${contractId}`,
    async checkout(merchant, commitment) {
      const conf = await cfg()
      if (conf.demoMerchants.includes(merchant)) return asResult(await post("/api/checkout", { merchant, commitment }), (r) => ({ root: String(r.root) }))
      const w = await writer()
      if (!w) return { error: "WalletNotConnected" }
      const r = await write<bigint>(w, "checkout", { merchant, id_commitment: BigInt(commitment) })
      return r.ok ? { txHash: r.txHash, root: String(r.value) } : { error: r.error, message: r.message }
    },
    async book(merchant) {
      const w = await writer()
      if (!w) return { error: "WalletNotConnected" }
      const r = await write<bigint>(w, "book", { merchant, guest: address })
      if (!r.ok) return { error: /balance|insufficient|#10\b/i.test(r.message) ? "InsufficientFunds" : r.error, message: r.message }
      return { txHash: r.txHash, paid: BigInt(r.value as any) }
    },
    bookWithDiscount: (stay, season) => drain({ kind: "discount", stay, season }),
    postReview: (stay, rating, text) => drain({ kind: "review", stay, rating, text }),
    async attest(reviewId) {
      return asResult(await post("/api/attest", { reviewId }))
    },
    async listGroups() {
      return views.groups(await reader())
    },
    async perks(merchant) {
      const p = await planClaims(merchant)
      if (!p) return null
      return { merchant, items: p.items, maxBps: p.maxBps, bps: p.bps, price: p.price, finalPrice: (p.price * BigInt(10_000 - p.bps)) / 10_000n }
    },
    async bookWithPerks(merchant, season) {
      let last: any = { error: "Unknown" }
      for await (const ev of prover.prove({ kind: "context", merchant, season })) if (ev.stage === "done") last = ev.result
      return last
    },
    async faucet() {
      if (!address || !signer) return { error: "WalletNotConnected" }
      let r = await post("/api/faucet", { address })
      if (r.error === "NoTrustline") {
        const c = await cfg()
        const s = new rpc.Server(c.rpcUrl)
        const issuer = c.usdcIssuer
        if (!issuer) return { error: "Unknown", message: "no issuer" }
        const acct = await s.getAccount(address)
        const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: c.networkPassphrase }).addOperation(Operation.changeTrust({ asset: new Asset("USDC", issuer) })).setTimeout(60).build()
        const signed = await signer.signTransaction(tx.toXDR(), { networkPassphrase: c.networkPassphrase })
        const sent = await s.sendTransaction(TransactionBuilder.fromXDR(signed.signedTxXdr, c.networkPassphrase))
        for (let i = 0; i < 20; i++) {
          const g = await s.getTransaction(sent.hash)
          if (g.status !== "NOT_FOUND") break
          await new Promise((ok) => setTimeout(ok, 1000))
        }
        r = await post("/api/faucet", { address })
      }
      return asResult(r)
    },
    balance: usdcBalance,
  }

  // ---- disclosure ----
  const disclosure: Disclosure = {
    async build(stay) {
      const c = await reader()
      const idx = await views.leafIndex(c, stay.merchant, BigInt(stay.commitment))
      return buildDisclosure(identityOf(stay), d.stayDisclosureKey(master(), stay.merchant, stay.stayIndex), stay.reviewId ?? -1, stay.merchant, idx ?? -1)
    },
    async submit(pkg) {
      return asResult(await post("/api/disputes", { pkg }), () => ({}))
    },
    async queue(): Promise<Dispute[]> {
      return fetch(`${api}/api/disputes`).then((r) => r.json())
    },
    async checkDispute(reviewId) {
      const r = await fetch(`${api}/api/disputes/${reviewId}/check`).then((x) => x.json())
      return r.check ?? { commitmentMatches: false, signatureValid: false, leafInTree: false }
    },
    async check(pkg) {
      const c = await reader()
      const review = await views.review(c, pkg.reviewId)
      const leaf = await views.leafIndex(c, pkg.merchant, BigInt(pkg.commitment))
      return checkDisclosure(pkg, review.disclosureCommit, review.merchant === pkg.merchant ? leaf : null)
    },
  }

  // restore a remembered demo key silently
  if (store.getItem("pos.wallet") === "local") wallet.connect("local").catch(() => null)

  return { mode: "testnet", chain, prover, wallet, stays, disclosure }
}
