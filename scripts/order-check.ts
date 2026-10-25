import { admin } from "../src/shopify.ts"
const d = await admin(`{ orders(first: 1, query: "name:${process.argv[2]}") { nodes { name note tags displayFinancialStatus discountCodes totalPriceSet { shopMoney { amount currencyCode } } } } }`)
console.log(JSON.stringify(d.orders.nodes[0]))
