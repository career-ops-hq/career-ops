/**
 * The day each tracker row was applied for, kept apart from the day it was
 * evaluated (the tracker's Date column).
 *
 * The rules are the core's, called rather than copied (#3759 review):
 *   - `statusLogAppliedDates()` reads data/status-log.tsv with
 *     funnel-velocity.mjs's ledger rules: state aliases such as `sent`, a later
 *     `correction` that replaces a date, a `to: -` line that retracts one, and
 *     lines with too few columns skipped instead of thrown on.
 *   - `resolveAppliedDate()` reads an `applied YYYY-MM-DD` note through
 *     `parseAppliedDate()`, which drops a date the note cites about another row
 *     (#2607), and rejects impossible calendar dates.
 * The follow-up report makes the same two calls, so a row shows one applied
 * date in both places.
 *
 * One difference is deliberate: when neither source has a date, the core falls
 * back to the evaluation date (labelled `evaluation-date-fallback`) because
 * the cadence needs some day to count from. A column headed "applied" must not
 * show the evaluation date as the application date, so that case is "".
 *
 * Plain .mjs with the core module as a parameter, so `node --test` exercises
 * these rules against the real core without a TypeScript runner.
 *
 * @param {Array<{n: string, date?: string, notes?: string}>} applications
 * @param {string | null | undefined} statusLogText data/status-log.tsv, or null when absent
 * @param {{
 *   statusLogAppliedDates: (text: string) => Map<number, string>,
 *   resolveAppliedDate: (app: any, statusLogDate: string | null) => {appliedDate: string | null, appDateSource: string},
 * }} core followup-cadence.mjs
 * @returns {Map<string, string>} tracker row number to YYYY-MM-DD, or "" when unknown
 */
export function appliedDatesByRow(applications, statusLogText, core) {
  // The ledger keys rows by parsed integer, the tracker by its cell text.
  const ledger = core.statusLogAppliedDates(statusLogText ?? "");
  const dates = new Map();
  for (const app of applications) {
    const num = /^\d+$/.test(String(app.n ?? "")) ? Number(app.n) : NaN;
    const { appliedDate, appDateSource } = core.resolveAppliedDate(app, ledger.get(num) ?? null);
    dates.set(app.n, appDateSource === "evaluation-date-fallback" ? "" : appliedDate ?? "");
  }
  return dates;
}
