// Review texts, tx hashes and dispute packages, per contract. Seed file (committed) + runtime file (DATA_DIR).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { DisclosurePackage } from "@bookerbob/pos-sdk"

export interface ReviewMeta { text: string; txHash: string; time: number; demoActivity?: boolean }
export interface Dispute { id: number; merchant: number; pkg: DisclosurePackage; openedAt: number; attestTx?: string }
interface Db { reviews: Record<string, ReviewMeta>; disputes: Dispute[] }

const empty = (): Db => ({ reviews: {}, disputes: [] })
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
  disputes(): Dispute[] {
    const byId = new Map<number, Dispute>()
    for (const d of [...this.seed.disputes, ...this.live.disputes]) byId.set(d.id, { ...d, merchant: d.merchant ?? d.pkg?.merchant })
    return [...byId.values()]
  }
  openDispute(pkg: DisclosurePackage): Dispute {
    const d = { id: pkg.reviewId, merchant: pkg.merchant, pkg, openedAt: Date.now() }
    this.live.disputes = this.live.disputes.filter((x) => x.id !== d.id).concat(d)
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
