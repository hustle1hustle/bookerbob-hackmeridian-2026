// Keyless Stellar Passport lookup (leaderboard walk). Server only: loaded at runtime by fetchPassport when no
// window exists, so browser bundles never contain or call /api/leaderboard.
import { passportGet, rowsOf, builderSlug, strOf, numOf, signalsFromProfile, ratePassportSignals } from "./index.ts"
import type { PassportScore } from "./index.ts"

export async function keylessPassport(address: string, base: string, f: typeof fetch, none: PassportScore): Promise<PassportScore> {
  const payload = await passportGet(base, "/api/leaderboard?metric=points&window=all&limit=10", f)
  for (const entry of rowsOf(payload).slice(0, 10)) {
    const slug = builderSlug(strOf(entry.profileUrl))
    if (!slug) continue
    const payloadB = await passportGet(base, `/api/builder/public/${slug}`, f)
    if (!payloadB || typeof payloadB !== "object") continue
    const wrap = payloadB as Record<string, unknown>
    const profile = (wrap.builder && typeof wrap.builder === "object" ? wrap.builder : wrap) as Record<string, unknown>
    if (profile.stellar_address !== address) continue
    const rawUrl = strOf(entry.profileUrl)
    const topStats = (wrap.stats ?? {}) as Record<string, unknown>
    const signals = signalsFromProfile(profile, "keyless", {
      points: numOf(entry.points) ?? numOf(entry.value),
      rankName: strOf(entry.rankName),
      profileUrl: rawUrl ? (rawUrl.startsWith("/") ? `${base}${rawUrl}` : rawUrl) : undefined,
      totalCommits30d: numOf(topStats.totalCommits30d),
      activeDays30d: numOf(topStats.activeDays30d),
    })
    return { score: ratePassportSignals(signals), matched: true, signals }
  }
  return none}
