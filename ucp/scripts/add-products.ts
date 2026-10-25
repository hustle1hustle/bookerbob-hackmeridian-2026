// Adds test products to the Shopify test store (write_products). Prints ids and whether search sees them.
import { admin } from "../src/shopify.ts"
const items = [
  { title: "REP ship of theseus tee, bone", price: "150.00", type: "T-Shirt", img: "https://cdn.shopify.com/s/files/1/1100/1046/6695/files/theseus-front.png?v=1790250510" },
  { title: "REP ship of theseus tee, white", price: "150.00", type: "T-Shirt", img: "https://cdn.shopify.com/s/files/1/1100/1046/6695/files/theseus-front.png?v=1790250510" },
  { title: "REP hoodie, terminal black", price: "280.00", type: "Hoodie" },
  { title: "REP hoodie, fog grey", price: "280.00", type: "Hoodie" },
]
for (const it of items) {
  const d = await admin(`mutation($p: ProductCreateInput!, $m: [CreateMediaInput!]) { productCreate(product: $p, media: $m) { product { id variants(first: 1) { nodes { id } } } userErrors { field message } } }`, {
    p: { title: it.title, status: "ACTIVE", productType: it.type, vendor: "REP", tags: ["test-store", "rep-merch"], descriptionHtml: "<p>REP merch on a Shopify test store. Test payments only.</p>" },
    m: it.img ? [{ originalSource: it.img, mediaContentType: "IMAGE", alt: it.title }] : null,
  })
  const pc = d.productCreate
  if (pc.userErrors.length) { console.log(it.title, "ERR", pc.userErrors); continue }
  const vid = pc.product.variants.nodes[0].id
  const u = await admin(`mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $pid, variants: $v) { userErrors { message } } }`, { pid: pc.product.id, v: [{ id: vid, price: it.price, inventoryPolicy: "CONTINUE" }] })
  console.log(it.title, pc.product.id, vid, u.productVariantsBulkUpdate.userErrors)
}
