import { readPayment } from "../src/core.ts"
console.log(await readPayment(process.argv[2]))
