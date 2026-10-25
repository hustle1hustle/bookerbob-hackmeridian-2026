import { storeTool } from "../src/shopify.ts"
try { const c = await storeTool("get_checkout", { id: process.argv[2] }); console.log(c.status, c.totals?.map((t: any) => t.type + ":" + t.amount).join(" ")) } catch (e) { console.log("ERR", (e as Error).message) }
