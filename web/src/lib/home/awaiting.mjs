import { canonStatus } from "../status-alias.mjs";

// states.yml forbids a date in the status cell, but real trackers carry one
// anyway ("Evaluated 2026-08-21") and /^evaluat/i tolerated that. canonStatus()
// is an exact-match alias table, so the date comes off before folding —
// otherwise this narrows the very case the existing suite already pins.
const baseStatus = (s) => String(s ?? "").replace(/\s+\d{4}-\d{2}-\d{2}\s*$/, "").trim();

/**
 * Which scored-but-undecided applications the Today page shows, and in what
 * order.
 *
 * WHY THIS IS NOT INLINE IN today-dashboard.tsx: the card list used to be
 * `applications.filter(isEvaluated).slice(0, 6)` with no sort at all, so which
 * six you saw was a property of the ORDER OF ROWS IN data/applications.md
 * rather than of the queue. That was always fragile and #3529 made it live:
 * merge-tracker now re-sorts the tracker by # on every write, which would have
 * quietly changed the card set with no code change anywhere near this file.
 *
 * Newest first is what a "Today" queue means. The score breaks ties so that on
 * a day with several evaluations the better opportunity leads.
 *
 * Plain .mjs (same pattern as tracker-table.mjs and cv-selection.mjs) so the
 * test suite imports it with no build step and no `@/` alias loader — the whole
 * reason to extract it is that the ordering is testable and a TSX component is
 * not.
 *
 * `scoreOf` is injected rather than imported: the one parser for a score cell
 * lives in lib/format.ts (`scoreNum`) and this module must not grow a second
 * definition of what "4.1/5" means.
 *
 * Generic in the row type so the caller keeps its own (`Application`) rather
 * than being narrowed to the three fields this function reads.
 *
 * @template {{date?: string, score?: string, status?: string}} T
 * @param {T[]} applications
 * @param {(score: string) => number} scoreOf  parser returning NaN when absent
 * @param {number} [limit]  how many cards the caller renders
 * @returns {T[]}
 */
export function pickAwaitingDecision(applications, scoreOf, limit = 6) {
  // -1, not -Infinity: two unscored rows would subtract to NaN, and a NaN
  // comparator leaves the sort order undefined rather than merely arbitrary.
  const rank = (s) => {
    const n = scoreOf(s ?? "");
    return Number.isNaN(n) ? -1 : n;
  };
  return applications
    // canonStatus(), not /^evaluat/i: "evaluated" has nine alias forms here
    // (states.yml plus the web-only `evaluado`) and the prefix test caught
    // only evaluated/evaluada/evaluar. A Turkish tracker using
    // `değerlendirildi`, or a Spanish one using `condicional`/`verificar`,
    // rendered an EMPTY queue — the same silent-hiding failure this module
    // exists to fix. status-alias.mjs is the single alias table and its test
    // loads states.yml, so this cannot drift as a literal regex does.
    .filter((a) => canonStatus(baseStatus(a.status)) === "EVALUATED")
    // A row with no date sorts LAST rather than jumping the queue. "" compares
    // LESS than any real date, and the comparison is descending (b before a),
    // so "least" lands at the end — which is where an undated row belongs in a
    // recency queue. Covered by a test, because that is two negations deep and
    // the wrong one is silent.
    .sort((a, b) => {
      const byDate = (b.date || "").localeCompare(a.date || "");
      if (byDate !== 0) return byDate;
      return rank(b.score) - rank(a.score);
    })
    .slice(0, limit);
}
