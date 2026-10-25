// JMPR adapter (stub): real hotels and sandbox bookings from the JMPR travel API. Disabled until JMPR_ENABLED=1
// and a server-side JMPR key are configured; then implement search() against the JMPR hotel search.
import type { SearchAdapter } from "./types.ts"

export function jmprAdapter(enabled: boolean): SearchAdapter {
  return {
    id: "jmpr",
    enabled,
    async search() {
      throw new Error("jmpr adapter not implemented yet")
    },
  }
}
