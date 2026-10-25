// The store side, as an external service: Shopify's own UCP MCP endpoint and the Admin API.
// Tokens and client secrets come from .env and are never logged.

const env = process.env
export const SHOP = env.SHOPIFY_STORE_DOMAIN ?? ""
const UCP_ENDPOINT = env.SHOPIFY_UCP_MCP_ENDPOINT ?? `https://${SHOP}/api/ucp/mcp`
const ADMIN_VERSION = env.SHOPIFY_ADMIN_API_VERSION ?? "2026-07"
// The store fetches and validates the calling agent's profile. Ours is not public yet, so the
// bridge names Shopify's published example profile, which the store is known to accept.
export const AGENT_PROFILE = env.UCP_AGENT_PROFILE ?? "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json"

export class StoreError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message)
  }
}

let rpcId = 0

// Agent-tier auth (Dev Dashboard catalog credentials): higher limits than anonymous calls.
let agentTok: { token: string; until: number } | null = null
async function agentToken(): Promise<string | null> {
  if (!env.SHOPIFY_AGENT_CLIENT_ID || !env.SHOPIFY_AGENT_CLIENT_SECRET) return null
  if (agentTok && Date.now() < agentTok.until) return agentTok.token
  try {
    const r = await fetch("https://api.shopify.com/auth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ client_id: env.SHOPIFY_AGENT_CLIENT_ID, client_secret: env.SHOPIFY_AGENT_CLIENT_SECRET, grant_type: "client_credentials" }),
    })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok || typeof j.access_token !== "string") return null
    agentTok = { token: j.access_token, until: Date.now() + 50 * 60_000 }
    return agentTok.token
  } catch {
    return null
  }
}

/** One raw JSON-RPC call to the store's UCP MCP endpoint; returns the JSON-RPC `result`. */
export async function storeRpc(method: string, params: unknown, buyerIp = "127.0.0.1"): Promise<any> {
  const tok = await agentToken()
  const res = await fetch(UCP_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(tok ? { authorization: `Bearer ${tok}`, "shopify-buyer-ip": buyerIp } : {}) },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  })
  let text = await res.text()
  const line = text.split(/\r?\n/).find((l) => l.startsWith("data:"))
  if (line) text = line.slice(5).trim()
  let j: any
  try {
    j = JSON.parse(text)
  } catch {
    throw new StoreError(`store returned non-JSON (HTTP ${res.status})`)
  }
  if (j.error) throw new StoreError(`store error: ${String(j.error.message ?? j.error.code).slice(0, 200)}`, j.error)
  return j.result
}

/** tools/call against the store with the bridge's agent profile; returns the structured payload. */
export async function storeTool(name: string, args: Record<string, unknown>): Promise<any> {
  const meta = { ...((args.meta as object) ?? {}), "ucp-agent": { profile: AGENT_PROFILE } }
  const result = await storeRpc("tools/call", { name, arguments: { ...args, meta } })
  if (result?.isError) throw new StoreError(`store refused ${name}: ${String(result.content?.[0]?.text ?? "").slice(0, 300)}`, result)
  if (result?.structuredContent) return result.structuredContent
  try {
    return JSON.parse(result?.content?.[0]?.text ?? "{}")
  } catch {
    return {}
  }
}

export const storeManifest = async (): Promise<any> =>
  (await fetch(env.SHOPIFY_UCP_MANIFEST ?? `https://${SHOP}/.well-known/ucp`, { signal: AbortSignal.timeout(15_000) })).json()

// ---- Admin API ----------------------------------------------------------------------

let minted: { token: string; until: number } | null = null

async function adminToken(fresh = false): Promise<string> {
  if (!fresh && minted && Date.now() < minted.until) return minted.token
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.SHOPIFY_CLIENT_ID ?? "", client_secret: env.SHOPIFY_CLIENT_SECRET ?? "" }),
  })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || typeof j.access_token !== "string") throw new StoreError(`admin token grant refused: HTTP ${res.status}`)
  minted = { token: j.access_token, until: Date.now() + Math.max(60, (Number(j.expires_in) || 3600) - 300) * 1000 }
  return minted.token
}

export async function admin<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const call = async (t: string) =>
    fetch(`https://${SHOP}/admin/api/${ADMIN_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": t },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ query, variables }),
    })
  let res = await call(await adminToken())
  if (res.status === 401) res = await call(await adminToken(true))
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || j.errors) {
    const msg = Array.isArray(j.errors) ? j.errors.map((e: any) => e?.message).join("; ") : String(j.errors ?? `HTTP ${res.status}`)
    throw new StoreError(`admin: ${msg.slice(0, 300)}`)
  }
  return j.data as T
}

/** A single-use percentage code, live for `lifeSec`. The store does not know who it is for. */
export async function createSingleUseCode(code: string, percent: number, lifeSec: number, title: string): Promise<{ id: string; endsAt: string }> {
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + lifeSec * 1000)
  const d = await admin(
    `mutation($d: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } }
    }`,
    {
      d: {
        title,
        code,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        usageLimit: 1,
        appliesOncePerCustomer: true,
        context: { all: "ALL" },
        customerGets: { value: { percentage: percent / 100 }, items: { all: true } },
      },
    },
  )
  const made = d.discountCodeBasicCreate
  if (made.userErrors?.length || !made.codeDiscountNode?.id) throw new StoreError(`code refused: ${made.userErrors.map((e: any) => e.message).join("; ")}`)
  return { id: made.codeDiscountNode.id, endsAt: endsAt.toISOString() }
}

export async function deactivateCode(id: string): Promise<void> {
  await admin(`mutation($id: ID!) { discountCodeDeactivate(id: $id) { userErrors { message } } }`, { id })
}

/**
 * Records a checkout paid outside Shopify (test USDC on Stellar) as a paid order:
 * draft order with the same lines and code, completed as paid. Needs write_draft_orders.
 */
export async function recordPaidOrder(input: {
  lines: { variantId: string; quantity: number }[]
  code?: string
  note: string
  tags: string[]
}): Promise<{ id: string; name: string }> {
  const d = await admin(
    `mutation($i: DraftOrderInput!) { draftOrderCreate(input: $i) { draftOrder { id } userErrors { field message } } }`,
    {
      i: {
        lineItems: input.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        discountCodes: input.code ? [input.code] : [],
        note: input.note,
        tags: input.tags,
      },
    },
  )
  const draft = d.draftOrderCreate
  if (draft.userErrors?.length || !draft.draftOrder?.id) throw new StoreError(`draft refused: ${draft.userErrors.map((e: any) => e.message).join("; ")}`)
  const c = await admin(
    `mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: false) { draftOrder { order { id name } } userErrors { message } } }`,
    { id: draft.draftOrder.id },
  )
  const done = c.draftOrderComplete
  if (done.userErrors?.length || !done.draftOrder?.order) throw new StoreError(`draft complete refused: ${done.userErrors.map((e: any) => e.message).join("; ")}`)
  return { id: done.draftOrder.order.id, name: done.draftOrder.order.name }
}

/** Paid orders that used `code` (the Shopify test card fallback path). */
export async function ordersWithCode(code: string): Promise<{ id: string; name: string; paid: boolean }[]> {
  const d = await admin(`query($q: String!) { orders(first: 5, query: $q) { nodes { id name displayFinancialStatus } } }`, { q: `discount_code:${code}` })
  return d.orders.nodes.map((o: any) => ({ id: o.id, name: o.name, paid: o.displayFinancialStatus === "PAID" }))
}
