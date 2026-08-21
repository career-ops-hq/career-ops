// Cumulative "how far has this search actually got?" counters for the analytics
// headline tiles. Pure JS (no TS types) so it can be imported by the analytics
// page and unit-tested under `node --test`, matching clean-chips.mjs /
// stream-parse.mjs / act-envelope.mjs.
//
// The "Pipeline by stage" BARS below the tiles are deliberately a current-state
// snapshot — Hired, Rejected and Discarded are each their own bar, and an
// application sits in exactly one. The two headline tiles are a different
// question: they are achievement counters ("interviews", "offers") whose
// zero-state shows a coaching nudge. Reading a snapshot count there means a
// candidate who ADVANCED past a stage reads zero for it and gets told to try
// harder to reach the stage they already cleared.
//
// The cumulative math is the core's, not a new invention: computeFunnel() in
// stats.mjs is the canonical definition —
//   everInterview = Interview + Offer + Hired
//   everOffer     = Offer + Hired
// — on the reasoning that a landed job proves the offer and everything before
// it. Rejected is deliberately NOT folded in: a status is a snapshot, so a
// rejection never reveals which stage it came from (stats.mjs calls the middle
// stages lower bounds for exactly this reason).

/**
 * Count applications whose canonical status is any of `keys`.
 *
 * @param {string[]} canonStatuses - Already-canonicalized (uppercase) statuses.
 * @param {string[]} keys - Canonical stage keys to count.
 * @returns {number}
 */
function countOf(canonStatuses, keys) {
  return canonStatuses.filter((s) => keys.some((k) => s.includes(k))).length;
}

/**
 * Cumulative interview/offer counters for the analytics headline tiles.
 *
 * @param {string[]} canonStatuses - Canonicalized statuses, one per application.
 * @returns {{interviews: number, offers: number}}
 */
export function cumulativeTiles(canonStatuses) {
  const list = Array.isArray(canonStatuses) ? canonStatuses : [];
  return {
    interviews: countOf(list, ["INTERVIEW", "OFFER", "HIRED"]),
    offers: countOf(list, ["OFFER", "HIRED"]),
  };
}
