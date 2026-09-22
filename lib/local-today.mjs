/**
 * local-today.mjs — the calendar day where the user actually is.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day, and using it for
 * "today" is wrong in both directions:
 *
 *   - West of Greenwich, an evening run answers "today" with TOMORROW. That is
 *     the defect #2765 fixed in followup-seed.mjs ("at 20:00 US Eastern this
 *     returned the next calendar day").
 *   - East of Greenwich, the user's own today reads as a FUTURE date for the
 *     first N hours of their local day, so a validity check that rejects
 *     future dates rejects the present one (#2932).
 *
 * Only "what day is it here" belongs here. Date ARITHMETIC elsewhere stays on
 * UTC-midnight parsing — `new Date('2026-06-20T00:00:00Z')` round-tripping
 * through `toISOString()` is internally consistent and deliberate; #2765 drew
 * the same line.
 */

/**
 * Today's date in the host's local timezone, as YYYY-MM-DD.
 *
 * @param {Date} [now] - Instant to resolve; defaults to the current time.
 *   Injectable so tests can pin an instant instead of depending on wall clock.
 * @returns {string} Local calendar day, YYYY-MM-DD.
 */
export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
