// Single source of the deployed contract ID for servers and scripts (config/testnet.json).
// The browser app never hardcodes it: it reads /api/config from the backend.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const file = fileURLToPath(new URL("../../../config/testnet.json", import.meta.url))
export const deployment: { network: string; contractId: string; usdcSac: string } = JSON.parse(readFileSync(file, "utf8"))
export const contractId = (): string => process.env.PROOF_OF_STAY_CONTRACT_ID || deployment.contractId
