import { storeTool } from "../src/shopify.ts"
const co = await storeTool("create_checkout", { checkout: {
  line_items: [{ item: { id: "gid://shopify/ProductVariant/66012090499463" }, quantity: 1 }],
  context: { address_country: "PT", eligibility: ["com.bookerbob.patronage"] } } })
const { ucp, ...rest } = co; console.log(JSON.stringify(ucp.payment_handlers).slice(0,1500)); console.log(JSON.stringify(rest, null, 1).slice(0, 5000))
