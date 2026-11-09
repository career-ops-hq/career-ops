import { canonStatus } from "../status-alias.mjs";
import { applyLineLabel } from "../report-sections.mjs";

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
 * Best score first, because a power user with dozens of scored rows needs the
 * strongest match on top, not the newest one. The date breaks ties so a fresh
 * evaluation leads among equal scores.
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
    // An unscored row ranks -1 and an undated row compares "" (least), and both
    // comparisons are descending, so either one lands at the end.
    .sort((a, b) => rank(b.score) - rank(a.score) || (b.date || "").localeCompare(a.date || ""))
    .slice(0, limit);
}

// "Check the posting first" is what applyLineLabel returns for a flagged
// posting at or above the line (#5300). It has to be a group here too: a label
// that is not in this list matches no group, and the row would drop off Today.
const AWAITING_GROUPS = ["Recommended", "Check the posting first", "Below the apply line", "Not scored yet"];

/**
 * Splits the ranked queue into the groups the Today page renders, keeping the
 * order inside each group. A row with no score has not been judged against the
 * apply line, so it gets its own group instead of "Below the apply line".
 *
 * `legitimacyOf` is injected for the same reason as `scoreOf` above: the
 * legitimacy lives in the report file, which the page reads and this module
 * does not. With it, a flagged posting above the line is grouped the way the
 * report page labels it (#5300).
 *
 * @template {{score?: string}} T
 * @param {T[]} awaiting  output of pickAwaitingDecision
 * @param {(row: T) => string | null | undefined} [legitimacyOf]
 * @returns {[string, T[]][]}  only the non-empty groups, in display order
 */
export function groupAwaiting(awaiting, legitimacyOf = () => undefined) {
  const labelOf = (a) => applyLineLabel(a.score, legitimacyOf(a)) ?? "Not scored yet";
  return AWAITING_GROUPS
    .map((label) => /** @type {[string, T[]]} */ ([label, awaiting.filter((a) => labelOf(a) === label)]))
    .filter(([, group]) => group.length > 0);
}
