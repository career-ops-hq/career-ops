/**
 * The pipeline list's ordering, as a pure module.
 *
 * It lives here rather than inline in `pipeline-view.tsx` for the same reason
 * `followup-view.mjs` does: the component can only run under a browser, and the
 * ordering rules are the part worth asserting.
 *
 * Plain .mjs with no npm deps, so `node:test` imports it without a TS runner.
 */

import { compareTrackerNumbers } from '../pipeline-sort.mjs';


/**
 * Parse a row's score. Returns NaN when the cell is absent or not numeric, which
 * the caller treats as "sorts last" rather than as a zero.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function scoreNum(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Order pipeline rows by the active key and direction.
 *
 * A tie on the primary key falls through to the tracker row number `n`,
 * descending with the same direction. Without it, rows sharing a date (which is
 * most of them, since a date is only a day) compare equal and keep whatever
 * order they arrived in, so "sort by newest" never reorders them (#4290).
 *
 * @param {Array<Record<string, any>>} rows
 * @param {{ key: string, dir: 1 | -1 }} sort
 * @param {(row: any) => string} [companyLabel] Resolves a row's displayed company
 *   name, so sorting by company uses the same text the table shows.
 * @returns {Array<Record<string, any>>} A new array; the input is not mutated.
 */
export function sortRows(rows, sort, companyLabel = (row) => String(row.company ?? '')) {
  const dir = sort.dir === 1 ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'tracker') {
      // The tracker column compares row numbers numerically, through the one helper that
      // already did it in the component before the ordering moved here (#3477).
      const primary = compareTrackerNumbers(a, b) * dir;
      if (primary !== 0) return primary;
    } else if (sort.key === 'score') {
      const an = scoreNum(a.score);
      const bn = scoreNum(b.score);
      const av = Number.isNaN(an) ? -Infinity : an;
      const bv = Number.isNaN(bn) ? -Infinity : bn;
      const primary = (av - bv) * dir;
      if (primary !== 0) return primary;
    } else {
      const aValue = sort.key === 'company' ? companyLabel(a) : a[sort.key] || '';
      const bValue = sort.key === 'company' ? companyLabel(b) : b[sort.key] || '';
      const primary = String(aValue).localeCompare(String(bValue)) * dir;
      if (primary !== 0) return primary;
    }

    // Tie-break on the tracker row number, ordered the same way as the primary
    // key so a tie follows the active direction rather than fighting it.
    const an = Number.parseInt(a.n, 10);
    const bn = Number.parseInt(b.n, 10);
    if (Number.isNaN(an) || Number.isNaN(bn)) return 0;
    return (an - bn) * dir;
  });
}
