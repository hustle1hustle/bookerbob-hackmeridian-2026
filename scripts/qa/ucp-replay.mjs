// Usage: node scripts/qa/ucp-replay.mjs [base-url]   (needs Chrome; spends testnet USDC from a fresh demo key)
// One tab: bob run #1 (full), run #2 (proven discount), then "try a reused proof". Drives pol-real's ucp.run directly.
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
const S = process.env.TMPDIR ?? "/tmp"
const prof = S + "/ucp3-" + Date.now(); mkdirSync(prof, { recursive: true })
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--remote-debugging-port=9399", `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, seq = 0; const pend = new Map(); const errs = []
for (let i = 0; i < 50 && !ws; i++) { try { const l = await (await fetch("http://127.0.0.1:9399/json")).json(); const p = l.find((t) => t.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)) } } catch {} await sleep(200) }
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } else if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)) }
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true, timeout: 280000 }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description }
try {
  await send("Runtime.enable"); await send("Page.enable")
  await send("Page.navigate", { url: (process.argv[2] ?? "http://localhost:8080") + "/" })
  for (let i = 0; i < 60; i++) { if (/proven/i.test((await ev("document.body.innerText")) ?? "")) break; await sleep(500) }
  const run = (opts) => ev(`(async () => { const m = await import('./pol-real.js'); const out = []; for await (const e of m.ucp.run(${JSON.stringify(opts)})) { if (e.type === 'step' && (e.status === 'failed' || e.i === 2 || e.i === 4 || e.i === 5 || e.i === 7)) out.push(e.i + ':' + e.status + (e.error ? ' ' + e.error : '') + (e.tx ? ' tx ' + String(e.tx).slice(0, 8) : '') + (e.status === 'done' && e.detail ? ' | ' + String(e.detail).slice(0, 70) : '')); if (e.type === 'headline') out.push('HEADLINE ' + e.text); if (e.type === 'cart' && e.cart.paid) out.push('PAID ' + e.cart.total) } return out.join('\\n') })()`)
  console.log("RUN 1\n" + (await run({})))
  console.log("RUN 2\n" + (await run({})))
  console.log("REPLAY\n" + (await run({ reuse: true })))
  console.log("hood spentTx:", await ev(`(async () => { const m = await import('./pol-real.js'); return JSON.stringify((m.zk?.hoods?.() ?? []).slice(-1).map(h => ({ nf: String(h.nullifier).slice(0, 10), spentTx: h.spentTx && String(h.spentTx).slice(0, 8), status: h.status }))) })()`))
} catch (e) { console.log("FAILED", e.message) } finally { console.log("errors:", errs); chrome.kill() }
