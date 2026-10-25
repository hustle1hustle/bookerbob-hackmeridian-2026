// Error tracker tests: scrubbing, client reports, token gate, 5xx capture. Run: node --test server/src/ops.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
process.env.OPS_TOKEN = "t".repeat(32)
const { opsApi, opsClient, scrub } = await import("./ops.ts")

test("scrub removes queries, addresses, long numbers, hex and emails", () => {
  const s = scrub("GET /api/x?sid=abc GBDEYOAF4QGIZSIJZWPUDWGZT2IT5Z44MBEU3F2RUVCXVZQBSBLAYVZS 12345678901234567890123 " + "ab".repeat(32) + " me@x.io")
  assert.equal(s, "GET /api/x?… <addr> <num> <hex> <email>")
})

test("client errors are recorded scrubbed and readable only with the token; 5xx is captured", async () => {
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://x").pathname
    if (path === "/boom") return void (res.writeHead(500), res.end())
    if (path === "/ops.js") return opsClient(res)
    return opsApi(req, res, path)
  })
  const base = await new Promise<string>((ok) => server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(server.address() as any).port}`)))
  const r = await fetch(`${base}/api/ops/client-error`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Version/18 Mobile Safari/604.1" }, body: JSON.stringify({ kind: "error", message: "bad GCVPZNWAUPX2ASZYNAGD4LFII4BRXMYUPY2EJI6P347DXKVPP3U62GNK", path: "/x?q=1", release: "index-abc.js" }) })
  assert.equal(r.status, 200)
  await fetch(`${base}/boom?secret=1`)
  assert.equal((await fetch(`${base}/api/ops/errors`)).status, 401)
  const d: any = await (await fetch(`${base}/api/ops/errors?since=0`, { headers: { authorization: `Bearer ${"t".repeat(32)}` } })).json()
  const client = d.errors.find((e: any) => e.source === "client")
  assert.equal(client.message, "bad <addr>")
  assert.equal(client.path, "/x")
  assert.equal(client.ua, "Safari mobile")
  assert.ok(d.errors.some((e: any) => e.kind === "http 500" && e.message === "GET /boom"))
  const post = (origin: string, message: string) => fetch(`${base}/api/ops/client-error`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ message }) })
  assert.equal((await post("http://localhost:5173", "from a dev page")).status, 202)
  assert.equal((await post(base, "same origin")).status, 200)
  const d2: any = await (await fetch(`${base}/api/ops/errors?since=0`, { headers: { authorization: `Bearer ${"t".repeat(32)}` } })).json()
  assert.ok(!d2.errors.some((e: any) => e.message === "from a dev page"))
  assert.ok(d2.errors.some((e: any) => e.message === "same origin"))
  assert.equal((await fetch(`${base}/api/ops/client-error`, { method: "POST", body: "x".repeat(9000) })).status, 413)
  assert.match(await (await fetch(`${base}/ops.js`)).text(), /client-error/)
  server.close()
})
