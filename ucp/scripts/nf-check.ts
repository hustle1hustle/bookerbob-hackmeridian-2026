// The SDK prover's nullifier must equal nullifierOf(); otherwise the agent's spent-check is wrong.
import { stayIdentity, nullifierOf, ctxScope, proveMembership, loadArtifacts, discountMessage } from "../src/core.ts"
const id = stayIdentity("ab".repeat(32), 5, 0); const scope = ctxScope(5, { kind: "merchant", id: 5 }, 20264)
const p = await proveMembership(id, [id.commitment, 7n], discountMessage("GBDEYOAF4QGIZSIJZWPUDWGZT2IT5Z44MBEU3F2RUVCXVZQBSBLAYVZS"), scope, await loadArtifacts())
console.log("match", p.nullifier === nullifierOf(id.secretScalar, scope)); process.exit(0)
