// Contract test vectors for context groups: merchant 0 with 3 stays, chain group 0 = same 3 commitments
// (enrolled at checkout), attested group 1 = stay 2 only. Claims for stay 2, guest = fixture contract address.
import { Group } from "@semaphore-protocol/group"
import { writeFileSync } from "node:fs"
import * as d from "../packages/sdk/src/derive.ts"
import { loadArtifacts, proveMembership } from "../packages/sdk/src/prove.ts"

const MERCHANT = 0
const SEASON = 1
const GUEST = "CCLOMGDT63BV3OZDW5GYZBHG3QWOZNMEBPF62BLIKXNE7UBXT5BZQX6S"
const stays = [0, 1, 2].map((s) => d.stayIdentity("fixture-master-secret", MERCHANT, s))
const all = stays.map((s) => s.commitment)
const artifacts = await loadArtifacts()
const msg = d.discountMessage(GUEST)
const claim = async (leaves: bigint[], group: d.GroupRef) => {
  const p = await proveMembership(stays[2], leaves, msg, d.ctxScope(MERCHANT, group, SEASON), artifacts)
  return { proof: p.proof, root: p.root.toString(), nullifier: p.nullifier.toString() }
}
const out = {
  merchant: MERCHANT,
  season: SEASON,
  guest: GUEST,
  commitments: all.map(String),
  attested: [all[2].toString()],
  roots: { merchant: new Group(all).root.toString(), chain: new Group(all).root.toString(), attested: new Group([all[2]]).root.toString() },
  claims: {
    self: await claim(all, { kind: "merchant", id: MERCHANT }),
    chain: await claim(all, { kind: "group", id: 0 }),
    attested: await claim([all[2]], { kind: "group", id: 1 }),
  },
}
writeFileSync(new URL("../circuits/golden/depth10/fixtures-groups.json", import.meta.url), JSON.stringify(out, null, 2))
console.log("group fixtures ok")
process.exit(0)
