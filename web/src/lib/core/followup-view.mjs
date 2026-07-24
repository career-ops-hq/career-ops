// Shared urgency-selection logic for the DEMAND-loop home dashboard (#86).
//
// followup-cadence.mjs is the single source of truth for cadence: it already
// classifies every actionable application into an `urgency` of 'urgent',
// 'overdue', 'waiting', or 'cold' (see computeUrgency in followup-cadence.mjs,
// and its own --overdue-only filter, which treats 'urgent'/'overdue' as due).
// The web route used to filter on `e.status` (the tracker status —
// applied/responded/interview — never "overdue"/"urgent") instead of
// `e.urgency`, so the filter always matched nothing and silently fell back to
// showing the raw top entries regardless of urgency. This module is the one
// place that decision is made, so the route and any future consumer agree.
//
// Plain .mjs (not .ts) so the root test suite can import it without a build,
// mirroring followup-seed.mjs.

const DUE_URGENCIES = new Set(["urgent", "overdue"]);

/** True when a followup-cadence.mjs entry is actionable right now. */
export function isDue(entry) {
  return DUE_URGENCIES.has(entry?.urgency);
}

/** Due entries only (urgent/overdue), most urgent first, capped at `limit`. */
export function selectDueFollowups(entries, limit = 8) {
  const urgencyOrder = { urgent: 0, overdue: 1 };
  return (Array.isArray(entries) ? entries : [])
    .filter(isDue)
    .sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9))
    .slice(0, limit);
}

/**
 * The single nearest not-yet-due follow-up, for the empty state ("nothing is
 * due, but here's what's next") — never mislabeled as due. Entries with no
 * nextFollowupDate (cold, or no cadence) are excluded. Returns null when
 * there is nothing upcoming.
 */
export function pickNextUpcoming(entries) {
  const upcoming = (Array.isArray(entries) ? entries : [])
    .filter((e) => !isDue(e) && e?.nextFollowupDate)
    .sort((a, b) => (a.daysUntilNext ?? Infinity) - (b.daysUntilNext ?? Infinity));
  return upcoming[0] ?? null;
}
