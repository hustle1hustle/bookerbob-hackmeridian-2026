// Publishes REP test products to every sales channel the app can see (Online Store, Shop, ...). Needs write_publications.
import { admin } from "../src/shopify.ts"
const pubs = (await admin(`{ publications(first: 20) { nodes { id name } } }`)).publications.nodes
console.log("channels:", pubs.map((p: any) => p.name).join(", "))
const prods = (await admin(`{ products(first: 30, query: "vendor:REP OR title:REP*") { nodes { id title } } }`)).products.nodes
for (const p of prods) {
  const r = await admin(`mutation($id: ID!, $in: [PublicationInput!]!) { publishablePublish(id: $id, input: $in) { userErrors { message } } }`, { id: p.id, in: pubs.map((x: any) => ({ publicationId: x.id })) })
  console.log(p.title, r.publishablePublish.userErrors.length ? r.publishablePublish.userErrors : "published")
}
