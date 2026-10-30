/**
 * The pipeline list's ordering, as a pure module.
 *
 * It lives here rather than inline in `pipeline-view.tsx` for the same reason
 * `followup-view.mjs` does: the component can only run under a browser, and the
 * ordering rules are the part worth asserting.
 *
 * Plain .mjs with no npm deps, so `node:test` imports it without a TS runner.
 * That is also why the score parser arrives as a parameter: the one parser for
 * a score cell lives in `lib/format.ts`, and a second copy here drifted the
 * moment a real tracker cell (`4.2/5`) met its `Number()` (#4333).
 */

import { compareTrackerNumbers } from '../pipeline-sort.mjs';

/**
 * Order pipeline rows by the active key and direction.
 *
 * A tie on the primary key falls through to the tracker row number `n`,
 * descending with the same direction. Without it, rows sharing a date (which is
 * most of them, since a date is only a day) compare equal and keep whatever
 * order they arrived in, so "sort by newest" never reorders them (#4290).
 *
 * `scoreOf` is injected rather than imported, the same pattern as
 * `lib/home/awaiting.mjs`: the tracker stores scores as `X.X/5`, and what that
 * means is defined once, in `lib/format.ts`'s `scoreNum`. A copy using
 * `Number()` read every real cell as NaN, so sorting by score went dead on the
 * user's actual data (#4333).
 *
 * @param {Array<Record<string, any>>} rows
 * @param {{ key: string, dir: 1 | -1 }} sort
 * @param {(score: string) => number} scoreOf Parses a row's score cell, NaN for
 *   a cell it cannot read. `lib/format.ts`'s `scoreNum` is the real one.
 * @param {(row: any) => string} [companyLabel] Resolves a row's displayed company
 *   name, so sorting by company uses the same text the table shows.
 * @returns {Array<Record<string, any>>} A new array; the input is not mutated.
 */
export function sortRows(rows, sort, scoreOf, companyLabel = (row) => String(row.company ?? '')) {
  const dir = sort.dir === 1 ? 1 : -1;

  /** A row's tracker number as an integer, or NaN when the row has none. */
  const numberOf = (row) => Number.parseInt(row.n, 10);

  /** A row's score, with an unusable cell ranked below every real score so it
   *  sorts last rather than as a zero. */
  const scoreKey = (row) => {
    const value = scoreOf(row.score ?? '');
    return Number.isNaN(value) ? -Infinity : value;
  };

  /** The primary-key comparison, direction-signed. Equal keys return 0, and a
   *  row with no usable n compares equal to every other row under the tracker
   *  key, which is what keeps it out of the ordering below. */
  const byKey = (a, b) => {
    if (sort.key === 'tracker') {
      // The tracker column compares row numbers numerically, through the one helper that
      // already did it in the component before the ordering moved here (#3477).
      const delta = compareTrackerNumbers(a, b);
      return Number.isNaN(delta) ? 0 : delta * dir;
    }
    if (sort.key === 'score') {
      const av = scoreKey(a);
      const bv = scoreKey(b);
      // Compared before subtracting: -Infinity minus -Infinity is NaN, and a NaN
      // comparator result is not a "less than", so two unusable scores would
      // never reach the row-number tie-break below.
      return av === bv ? 0 : (av - bv) * dir;
    }
    const aValue = sort.key === 'company' ? companyLabel(a) : a[sort.key] || '';
    const bValue = sort.key === 'company' ? companyLabel(b) : b[sort.key] || '';
    return String(aValue).localeCompare(String(bValue)) * dir;
  };

  // Pass one orders by the primary key alone. Stable, so rows with equal keys
  // stay in input order for now, and deterministic, so the row-number pass below
  // works from one fixed arrangement rather than from a comparator that returns
  // 0 for reasons of its own.
  const out = [...rows].sort(byKey);

  // Pass two breaks equal-key runs on the row number. This cannot live in the
  // comparator: a run like [n=2, n='', n=3] ties blank against both neighbours,
  // and a comparator that returns 0 for those pairs never gets asked about 2
  // against 3, so a descending sort can leave [2, '', 3]. Within each run the
  // numbered rows are sorted and written back into the numbered slots they
  // already occupy, so the unnumbered row keeps its position while the rows
  // around it order among themselves (#4333).
  for (let start = 0; start < out.length; ) {
    let end = start + 1;
    while (end < out.length && byKey(out[start], out[end]) === 0) end++;
    const numbered = [];
    for (let i = start; i < end; i++) {
      if (!Number.isNaN(numberOf(out[i]))) numbered.push(out[i]);
    }
    if (numbered.length > 1) {
      numbered.sort((a, b) => (numberOf(a) - numberOf(b)) * dir);
      let next = 0;
      for (let i = start; i < end; i++) {
        if (!Number.isNaN(numberOf(out[i]))) out[i] = numbered[next++];
      }
    }
    start = end;
  }

  return out;
}
