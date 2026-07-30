// Selection logic for the home dashboard's "Awaiting your decision" panel.
//
// The panel used to take the first N Evaluated rows in tracker order. Tracker
// rows are appended chronologically, so that surfaced the most recently
// SCANNED roles rather than the highest-SCORING ones — on a real tracker a 1.9
// was shown while thirteen 4.6s never appeared at all. The panel exists to
// present what is most worth acting on, so it ranks by score.
//
// Plain .mjs (not .ts) so the root test suite can import it with no build step
// and no `@/` alias loader, mirroring tracker-table.mjs.

/** First number in a score string ("4.1/5", "3.0") → numeric, or NaN. */
function scoreValue(score) {
  const m = String(score ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
}

const DEFAULT_LIMIT = 6;

/**
 * A usable row cap: a finite number truncated to an integer >= 0.
 *
 * Anything else (NaN, ±Infinity, a numeric string, null, an object) is a
 * caller bug, and falls back to the default rather than to 0 — quietly
 * emptying the panel is the same class of silent hiding this module exists to
 * fix. A negative cap must NOT reach `slice`, where -1 means "all but the
 * last" instead of "none".
 */
function rowCap(limit) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(0, Math.trunc(limit));
}

/**
 * Evaluated rows still awaiting a decision, strongest first, capped at `limit`.
 *
 * A placeholder score ("n/a", "—") is ranked last rather than dropped: the row
 * is still awaiting a decision, and silently hiding it would repeat the bug
 * this function exists to fix in a different form.
 *
 * Generic so the caller's own row type flows through to the result — a
 * concrete `Array<object>` here would erase it at the TS boundary.
 *
 * @template {{status?: string, score?: string, date?: string}} T
 * @param {T[]} applications
 * @param {number} [limit=6] Truncated to an integer >= 0; a non-finite or
 *   non-numeric value falls back to the default.
 * @returns {T[]} A new array; the input is never mutated.
 */
export function selectAwaitingDecision(applications, limit = DEFAULT_LIMIT) {
  const cap = rowCap(limit);
  const rows = (Array.isArray(applications) ? applications : [])
    .filter((a) => /^evaluat/i.test(a?.status ?? ''));

  return [...rows]
    .sort((a, b) => {
      const av = scoreValue(a?.score);
      const bv = scoreValue(b?.score);
      const an = Number.isNaN(av) ? -Infinity : av;
      const bn = Number.isNaN(bv) ? -Infinity : bv;
      if (an !== bn) return bn - an;                       // score, strongest first
      return String(b?.date ?? '').localeCompare(String(a?.date ?? '')); // newest first
    })
    .slice(0, cap);
}
