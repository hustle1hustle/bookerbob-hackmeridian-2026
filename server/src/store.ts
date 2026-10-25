// Review texts, tx hashes and dispute packages, per contract. Seed file (committed) + runtime file (DATA_DIR).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { DisclosurePackage } from "@bookerbob/pos-sdk"

export interface ReviewMeta { text: string; txHash: string; time: number; demoActivity?: boolean }
export interface Dispute { id: number; merchant: number; pkg?: DisclosurePackage; openedAt: number; attestTx?: string; openedBy?: "merchant" | "guest" }
interface Db { reviews: Record<string, ReviewMeta>; disputes: Dispute[]; checkouts?: Record<string, string> }

const empty = (): Db => ({ reviews: {}, disputes: [], checkouts: {} })
const load = (path: string): Db => (existsSync(path) ? { ...empty(), ...JSON.parse(readFileSync(path, "utf8")) } : empty())

export class Store {
  private seed: Db
  private live: Db
  private livePath: string
  constructor(contractId: string, seedDir: string, dataDir: string) {
    this.seed = load(join(seedDir, `seed-${contractId}.json`))
    mkdirSync(dataDir, { recursive: true })
    this.livePath = join(dataDir, `live-${contractId}.json`)
    this.live = load(this.livePath)
  }
  private save() {
    writeFileSync(this.livePath, JSON.stringify(this.live, null, 2))
  }
  review(id: number): ReviewMeta | undefined {
    return this.live.reviews[id] ?? this.seed.reviews[id]
  }
  putReview(id: number, m: ReviewMeta) {
    this.live.reviews[id] = m
    this.save()
  }
  /** Checkout tx per (merchant, commitment), so a pass can link its transaction. */
  checkoutTx(merchant: number, commitment: string): string | undefined {
    const k = `${merchant}:${commitment}`
    return this.live.checkouts?.[k] ?? this.seed.checkouts?.[k]
  }
  putCheckout(merchant: number, commitment: string, txHash: string) {
    this.live.checkouts = { ...(this.live.checkouts ?? {}), [`${merchant}:${commitment}`]: txHash }
    this.save()
  }
  disputes(): Dispute[] {
    const byId = new Map<number, Dispute>()
    for (const d of [...this.seed.disputes, ...this.live.disputes]) byId.set(d.id, { ...d, merchant: d.merchant ?? d.pkg?.merchant })
    return [...byId.values()]
  }
  openDispute(pkg: DisclosurePackage): Dispute {
    const prev = this.disputes().find((x) => x.id === pkg.reviewId)
    const d: Dispute = { id: pkg.reviewId, merchant: pkg.merchant, pkg, openedAt: prev?.openedAt ?? Date.now(), openedBy: prev?.openedBy ?? "guest" }
    this.live.disputes = this.live.disputes.filter((x) => x.id !== d.id).concat(d)
    this.save()
    return d
  }
  /** A merchant disputes a review; it waits for the guest's disclosure. */
  openAwaiting(id: number, merchant: number): Dispute {
    const prev = this.disputes().find((x) => x.id === id)
    if (prev) return prev
    const d: Dispute = { id, merchant, openedAt: Date.now(), openedBy: "merchant" }
    this.live.disputes = this.live.disputes.concat(d)
    this.save()
    return d
  }
  closeDispute(id: number, attestTx: string) {
    const d = this.disputes().find((x) => x.id === id)
    if (!d) return
    this.live.disputes = this.live.disputes.filter((x) => x.id !== id).concat({ ...d, attestTx })
    this.save()
  }
}

/** Writes a seed DB (used by scripts/seed.ts). */
export function writeSeed(contractId: string, seedDir: string, db: Db) {
  mkdirSync(seedDir, { recursive: true })
  writeFileSync(join(seedDir, `seed-${contractId}.json`), JSON.stringify(db, null, 2))
}
