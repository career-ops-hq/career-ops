// What the Today hero is allowed to claim, and when.
//
// Pure JS (no TS types) so the dashboard can import it and `node --test` can
// unit-test it, matching awaiting.mjs / funnel-tiles.mjs / clean-chips.mjs.
//
// ── The bug this exists to prevent ──────────────────────────────────────────
//
// The hero headline had one condition:
//
//     const allClear = newThisWeek === 0 && overdue === 0 && awaiting.length === 0;
//
// `newThisWeek` and `overdue` are client state seeded at 0 and filled by two
// fetches (/api/whats-new, /api/followups). So on first paint — before either
// response lands — the counters are 0 and the page renders:
//
//     "You're all caught up."
//     "I'll keep scanning the market in the background…"
//
// to a user with follow-ups overdue, then flips to "3 follow-ups due" when the
// data arrives. Zero-because-not-loaded-yet and zero-because-nothing-is-due are
// different facts, and the headline is the one place that must not confuse them:
// the demand loop's whole premise is that a nudge beats silence, so an
// all-clear the user believes is worse than a spinner they don't.
//
// Both fetches also ended `.catch(() => {})`, which leaves the counters at 0
// permanently. A failed request therefore produced a PERMANENT false all-clear
// — the one outcome that cannot be corrected by waiting.
//
// So the hero reads a state, not a count comparison. "All clear" is a claim
// about resolved data and is reachable only from `settled`.

/** @typedef {"loading"|"all-clear"|"queue"|"unavailable"} HeroState */

/**
 * Resolve what the hero may say.
 *
 * @param {object} input
 * @param {"pending"|"settled"|"failed"} input.loops - Status of the two client loops.
 * @param {number} [input.newThisWeek] - Fresh scan matches (supply loop).
 * @param {number} [input.overdue] - Follow-ups due now (demand loop).
 * @param {number} [input.awaitingCount] - Scored rows awaiting a decision (server prop).
 * @returns {HeroState}
 *   `loading`     — counters not resolved yet; claim nothing either way.
 *   `unavailable` — a loop failed; there may be work we cannot see.
 *   `queue`       — there is something to do.
 *   `all-clear`   — resolved, and genuinely nothing to do.
 */
export function resolveHeroState({ loops, newThisWeek = 0, overdue = 0, awaitingCount = 0 }) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
  const work = n(newThisWeek) + n(overdue) + n(awaitingCount);

  // Work we already know about outranks every other state: `awaitingCount` is a
  // server prop, so it is trustworthy on first paint, and a row awaiting a
  // decision is worth showing immediately rather than behind a spinner.
  if (work > 0) return "queue";
  if (loops === "failed") return "unavailable";
  if (loops === "pending") return "loading";
  return "all-clear";
}

/**
 * Whether the hero may render the "You're all caught up." headline.
 *
 * A named predicate rather than `=== "all-clear"` at the call site, so the rule
 * lives in one place: adding a state later cannot accidentally become an
 * all-clear by omission.
 *
 * @param {HeroState} state
 * @returns {boolean}
 */
export function mayClaimAllClear(state) {
  return state === "all-clear";
}
