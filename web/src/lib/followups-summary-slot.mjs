/**
 * Loading and a loaded list with nothing due share one height, so the tabs
 * stay put when the cadence comes back empty.
 * @param {{ pending: boolean, filtering: boolean, hasSummary: boolean, due: number }} state
 * @returns {"hidden" | "reserved" | "narrative"}
 */
export function followupsSummarySlot({ pending, filtering, hasSummary, due }) {
  if (filtering) return "hidden";
  if (pending) return "reserved";
  if (!hasSummary) return "hidden";
  if (due > 0) return "narrative";
  return "reserved";
}
