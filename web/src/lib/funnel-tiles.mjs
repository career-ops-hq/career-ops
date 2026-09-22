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
// it. A rejection proves a response, but not an interview or offer. The
// ledger-aware variant below recovers those stages from actual transitions.

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

/** Recover interview/offer achievements by tracker identity, not row position.
 * Malformed transitions and history for deleted tracker rows are ignored.
 * @param {{n: string, status: string}[]} applications
 * @param {string|null} content
 */
export function cumulativeTilesWithHistory(applications, content) {
  const rank = (s) => ({ APPLIED: 1, RESPONDED: 2, REJECTED: 2, INTERVIEW: 3, OFFER: 4, HIRED: 5 })[String(s).trim().toUpperCase()] || 0;
  const reached = new Map();
  for (const app of applications) {
    // Non-numeric backfill IDs retain snapshot counts but cannot join history.
    const id = /^\d+$/.test(app.n) ? Number(app.n) : Symbol();
    reached.set(id, Math.max(reached.get(id) || 0, rank(app.status)));
  }
  for (const line of String(content ?? '').replace(/\r/g, '').split('\n')) {
    const [id, date, from, to] = line.split('\t').map(s => s.trim());
    if (!/^\d+$/.test(id || '') || !date || !from || !to || !reached.has(Number(id))) continue;
    reached.set(Number(id), Math.max(reached.get(Number(id)), rank(from), rank(to)));
  }
  const values = [...reached.values()];
  return { interviews: values.filter(n => n >= 3).length, offers: values.filter(n => n >= 4).length };
}
