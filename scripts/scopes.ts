import { admin } from "../src/shopify.ts"
const d = await admin(`{ currentAppInstallation { accessScopes { handle } } }`).catch((e) => ({ err: e.message }))
console.log(JSON.stringify(d))
