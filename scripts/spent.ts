import { isSpent } from "../src/core.ts"
console.log("run-2 nullifier spent on chain:", await isSpent(20264, BigInt(process.argv[2])))
