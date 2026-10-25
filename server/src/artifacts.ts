// Proving files (Semaphore 4.13.0, depth 10) served from our own origin: fetched once from the PSE artifact host
// into DATA_DIR, kept in memory raw and gzipped, served with an immutable cache header.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync, brotliCompressSync, constants } from "node:zlib"
import type { IncomingMessage, ServerResponse } from "node:http"

const VERSION = "4.13.0"
const FILES = ["semaphore-10.wasm", "semaphore-10.zkey"]
const SOURCE = `https://snark-artifacts.pse.dev/semaphore/${VERSION}`
type Entry = { raw: Buffer; gz: Buffer; br: Buffer }
const mem = new Map<string, Entry>()
let warming: Promise<void> | null = null

export function warmArtifacts(dataDir: string) {
  return (warming ??= (async () => {
    const dir = join(dataDir, "artifacts", VERSION)
    mkdirSync(dir, { recursive: true })
    for (const f of FILES) {
      const p = join(dir, f)
      if (!existsSync(p)) {
        const r = await fetch(`${SOURCE}/${f}`)
        if (!r.ok) throw new Error(`artifact ${f} ${r.status}`)
        writeFileSync(p, Buffer.from(await r.arrayBuffer()))
      }
      const raw = readFileSync(p)
      mem.set(f, { raw, gz: gzipSync(raw, { level: 9 }), br: brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) })
    }
  })().catch((e) => {
    warming = null
    throw e
  }))
}

/** GET /artifacts/semaphore/4.13.0/<file> */
export async function serveArtifact(req: IncomingMessage, res: ServerResponse, path: string, dataDir: string) {
  const m = path.match(/^\/artifacts\/semaphore\/4\.13\.0\/(semaphore-10\.(?:wasm|zkey))$/)
  if (!m) return false
  await warmArtifacts(dataDir)
  const e = mem.get(m[1])!
  const ae = String(req.headers["accept-encoding"] ?? "")
  const [body, enc] = /\bbr\b/.test(ae) ? [e.br, "br"] : /\bgzip\b/.test(ae) ? [e.gz, "gzip"] : [e.raw, ""]
  res.writeHead(200, {
    "content-type": m[1].endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
    "access-control-allow-origin": "*",
    "x-uncompressed-length": String(e.raw.length),
    ...(enc ? { "content-encoding": enc, vary: "accept-encoding" } : {}),
    "content-length": String(body.length),
  })
  res.end(body)
  return true
}
