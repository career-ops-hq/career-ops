// What the Today headline is allowed to claim.
//
// main already tracks loading, rejects `available:false`, and drops stale
// responses, so the headline no longer says "You're all caught up" before its
// data lands. What it still does is collapse ANY failure into one state:
//
//   const dataError = followupsError || freshError;
//   dataError ? "Some updates are unavailable." : ...
//
// So a follow-ups outage replaces the headline even when the discovery loop
// answered fine and found seven matches. The user is told nothing is knowable,
// while seven real items sit in the sections below — the mirror image of the
// overclaim: work the app HAS is hidden because something unrelated broke.
//
// `queue-partial` is that case. It shows the counts from whichever source
// answered and names the gap, instead of suppressing both.
//
// The decision lives here rather than inline because it is the part worth
// testing: which of five states a given combination of loading flags, error
// flags and counts deserves. The component renders the answer.

/**
 * @typedef {'loading'|'unavailable'|'queue-partial'|'queue'|'all-clear'} HeroState
 *
 * @typedef {object} HeroInput
 * @property {boolean} followupsLoading
 * @property {boolean} freshLoading
 * @property {boolean} followupsError
 * @property {boolean} freshError
 * @property {number} overdue       - follow-ups due; MEANINGLESS when followupsError
 * @property {number} newThisWeek   - fresh matches; MEANINGLESS when freshError
 * @property {number} awaitingCount - from the server snapshot, so always known
 */

/** A count that is only a number when the source that produces it answered. */
const known = (ok, n) => (ok && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);

/**
 * Work the app can actually vouch for right now.
 *
 * A failed source contributes 0 — not because there is none, but because its
 * count is unknown, and an unknown must never be added as a zero to something
 * the headline then presents as a total. `awaitingCount` comes from the server
 * snapshot rather than a fetch, so it is always known and always counts.
 *
 * @param {HeroInput} input
 * @returns {number}
 */
export function knownWork(input) {
  const overdue = known(!input.followupsError, input.overdue);
  const fresh = known(!input.freshError, input.newThisWeek);
  const awaiting = known(true, input.awaitingCount);
  return overdue + fresh + awaiting;
}

/**
 * The headline's state.
 *
 * Ordered so no later branch can contradict an earlier one:
 *
 *   loading        either loop is still out; nothing may be claimed yet
 *   unavailable    something broke AND nothing is known — the honest nothing
 *   queue-partial  something broke but there IS known work; show it, name the gap
 *   queue          everything answered and there is work
 *   all-clear      everything answered and there is none
 *
 * `all-clear` is reachable only when every source answered, which is the
 * invariant the whole module exists to hold.
 *
 * @param {HeroInput} input
 * @returns {HeroState}
 */
export function resolveHeroState(input) {
  if (input.followupsLoading || input.freshLoading) return 'loading';
  const work = knownWork(input);
  const failed = input.followupsError || input.freshError;
  if (failed) return work > 0 ? 'queue-partial' : 'unavailable';
  return work > 0 ? 'queue' : 'all-clear';
}

/**
 * May the headline say "You're all caught up"?
 *
 * A named predicate rather than `state === 'all-clear'` at the call site: this
 * is the one claim that is actively wrong when the data is incomplete, so the
 * check that guards it is worth being able to find by name.
 *
 * @param {HeroState} state
 * @returns {boolean}
 */
export function mayClaimAllClear(state) {
  return state === 'all-clear';
}

/**
 * The counts the headline may actually print.
 *
 * Not the same as the values in component state. `refetch()` sets the error
 * flag on failure but leaves the previous count in place, so after a load that
 * succeeded and a retry that failed, `overdue` still holds the old number. With
 * the whole headline replaced by "Some updates are unavailable" that was
 * harmless; once `queue-partial` prints counts, printing that one would state a
 * stale figure as current — the overclaim this module exists to stop, moved to
 * a new place.
 *
 * So a failed source's count is zero HERE, by the same rule knownWork() uses,
 * and the component prints these rather than the raw state.
 *
 * @param {Pick<HeroInput,'followupsError'|'freshError'|'overdue'|'newThisWeek'>} input
 * @returns {{overdue: number, newThisWeek: number}}
 */
export function displayCounts(input) {
  return {
    overdue: known(!input.followupsError, input.overdue),
    newThisWeek: known(!input.freshError, input.newThisWeek),
  };
}

/**
 * Does this state show counts?
 *
 * True for `queue` and `queue-partial` — the difference between them is the
 * warning beside the counts, not whether the counts appear.
 *
 * @param {HeroState} state
 * @returns {boolean}
 */
export function showsQueue(state) {
  return state === 'queue' || state === 'queue-partial';
}

/**
 * Which sources could not be read, in prose, or null when all of them answered.
 *
 * Kept here so the headline and the alert row cannot drift into describing the
 * same outage differently.
 *
 * @param {Pick<HeroInput,'followupsError'|'freshError'>} input
 * @returns {string|null}
 */
export function missingSourceLabel(input) {
  if (input.followupsError && input.freshError) return 'Follow-ups and new matches';
  if (input.followupsError) return 'Follow-ups';
  if (input.freshError) return 'New matches';
  return null;
}
