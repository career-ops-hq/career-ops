import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
 * @param {string} [coreRoot] Code checkout, never the separate user data root.
 */
export async function cumulativeTilesWithHistory(applications, content, coreRoot = path.resolve(process.cwd(), '..')) {
  // Turbopack is intentionally confined to web/ for Windows stability. Load
  // the core at runtime, as the other core accessors do; do not widen its root
  // or silently substitute a second engine if the installation is incomplete.
  const file = path.join(coreRoot, 'funnel-stages.mjs');
  const { parseStatusLogStages, recoverFunnelStages } = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
  const statuses = new Map();
  for (const app of applications) {
    // Non-numeric backfill IDs retain snapshot counts but cannot join history.
    const id = /^\d+$/.test(app.n) ? Number(app.n) : Symbol();
    statuses.set(id, app.status);
  }
  const values = [...recoverFunnelStages(statuses, parseStatusLogStages(content)).values()];
  return { interviews: values.filter(n => n >= 3).length, offers: values.filter(n => n >= 4).length };
}
