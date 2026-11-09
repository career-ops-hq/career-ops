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
 * Sortable timestamp for an entry's nextFollowupDate, or Infinity when the
 * date is missing/unparseable — never NaN, so it always sorts after every
 * real date instead of corrupting comparator results. Ranking by the parsed
 * date itself (rather than the precomputed daysUntilNext) means the order is
 * correct even when daysUntilNext wasn't populated on some entries — with
 * daysUntilNext, every such entry ties at Infinity and a stable sort just
 * preserves input order instead of the nearer date.
 */
function nextDateValue(entry) {
  const t = entry?.nextFollowupDate ? Date.parse(entry.nextFollowupDate) : NaN;
  return Number.isNaN(t) ? Infinity : t;
}

/**
 * Not-yet-due follow-ups that already have a next date, soonest first.
 *
 * These are the entries selectDueFollowups drops. The home card and
 * /followups show them in an Upcoming section instead of omitting them.
 * `limit` defaults to no cap so a page can list every one; pass a number
 * to keep a card short.
 */
export function selectUpcomingFollowups(entries, limit) {
  const upcoming = (Array.isArray(entries) ? entries : [])
    .filter((e) => !isDue(e) && e?.nextFollowupDate)
    .sort((a, b) => nextDateValue(a) - nextDateValue(b));
  if (limit == null) return upcoming;
  return upcoming.slice(0, limit);
}

export function pickNextUpcoming(entries) {
  return selectUpcomingFollowups(entries)[0] ?? null;
}
