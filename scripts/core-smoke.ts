import { merchant, leaves, isSpent, currentSeason } from "../src/core.ts"
const m = await merchant(); console.log(m.name, m.kind, m.price, m.discountBps, "leaves", (await leaves()).length, "season", currentSeason(), "spent?", await isSpent(currentSeason(), 1n))
