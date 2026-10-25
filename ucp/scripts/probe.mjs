// Probe: store UCP manifest, MCP tool list, admin token scopes, products. Prints no secrets.
const env = process.env
const shop = env.SHOPIFY_STORE_DOMAIN
const PROFILE = 'https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json'
const m = await (await fetch(env.SHOPIFY_UCP_MANIFEST)).json()
console.log('manifest services', JSON.stringify(m.ucp?.services).slice(0, 400))
console.log('capabilities', Object.keys(m.ucp?.capabilities || {}).join(', '))
console.log('payment handlers', JSON.stringify(m.ucp?.payment_handlers || m.payment || {}).slice(0, 600))
const rpc = async (method, params) => {
  const r = await fetch(env.SHOPIFY_UCP_MCP_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  let t = await r.text(); const l = t.split(/\r?\n/).find(x => x.startsWith('data:')); if (l) t = l.slice(5)
  return JSON.parse(t)
}
const tools = await rpc('tools/list', {})
console.log('tools', (tools.result?.tools || []).map(t => t.name).join(', '))
const tok = await (await fetch(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }) })).json()
console.log('token ok', !!tok.access_token, 'scopes', tok.scope)
const g = await (await fetch(`https://${shop}/admin/api/${env.SHOPIFY_ADMIN_API_VERSION}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': tok.access_token },
  body: JSON.stringify({ query: '{ shop { currencyCode name } products(first: 20) { nodes { title status variants(first: 5) { nodes { id price } } } } }' }) })).json()
console.log(JSON.stringify(g.data || g.errors, null, 0).slice(0, 2000))
