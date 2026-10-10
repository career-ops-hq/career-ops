// What the Today headline may claim, pinned.
//
// Two failures these assertions exist to prevent, in opposite directions:
//
//   1. claiming "all caught up" when a source did not answer — the app saying
//      there is nothing to do when it does not know;
//   2. suppressing known work because an UNRELATED source failed — the app
//      hiding seven real matches because follow-ups timed out.
//
// main fixed (1). (2) is what queue-partial is for.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHeroState,
  mayClaimAllClear,
  showsQueue,
  knownWork,
  missingSourceLabel,
  displayCounts,
} from '../../src/lib/home/hero-state.mjs';

/** Everything answered, nothing pending, no work. */
const CLEAR = {
  followupsLoading: false,
  freshLoading: false,
  followupsError: false,
  freshError: false,
  overdue: 0,
  newThisWeek: 0,
  awaitingCount: 0,
};

test('nothing may be claimed while either loop is still out', () => {
  assert.equal(resolveHeroState({ ...CLEAR, followupsLoading: true }), 'loading');
  assert.equal(resolveHeroState({ ...CLEAR, freshLoading: true }), 'loading');
  // Even with counts already in state from a previous run: a reload that has
  // not answered yet is not evidence about now.
  assert.equal(resolveHeroState({ ...CLEAR, freshLoading: true, newThisWeek: 9 }), 'loading');
  assert.equal(mayClaimAllClear(resolveHeroState({ ...CLEAR, followupsLoading: true })), false);
});

test('all-clear requires every source to have answered', () => {
  assert.equal(resolveHeroState(CLEAR), 'all-clear');
  assert.equal(mayClaimAllClear('all-clear'), true);
  // The claim this module exists to block: a failure anywhere means the zero is
  // not a measurement.
  for (const broken of [{ followupsError: true }, { freshError: true }]) {
    const state = resolveHeroState({ ...CLEAR, ...broken });
    assert.notEqual(state, 'all-clear');
    assert.equal(mayClaimAllClear(state), false, `${JSON.stringify(broken)} must not claim all-clear`);
  }
});

test('a failed source with nothing known is unavailable, not all-clear', () => {
  assert.equal(resolveHeroState({ ...CLEAR, followupsError: true, freshError: true }), 'unavailable');
  assert.equal(resolveHeroState({ ...CLEAR, freshError: true }), 'unavailable');
  assert.equal(showsQueue('unavailable'), false);
});

test('known work survives an unrelated outage', () => {
  // THE CASE. Follow-ups are down; the discovery loop answered and found seven.
  // main collapses this to "Some updates are unavailable" and shows no number,
  // so seven actionable matches are hidden by an outage in another source.
  const state = resolveHeroState({ ...CLEAR, followupsError: true, newThisWeek: 7 });
  assert.equal(state, 'queue-partial');
  assert.equal(showsQueue(state), true);
  assert.equal(mayClaimAllClear(state), false);
  assert.equal(missingSourceLabel({ followupsError: true, freshError: false }), 'Follow-ups');

  // Mirrored: discovery down, follow-ups answered with work due.
  const other = resolveHeroState({ ...CLEAR, freshError: true, overdue: 3 });
  assert.equal(other, 'queue-partial');
  assert.equal(missingSourceLabel({ followupsError: false, freshError: true }), 'New matches');
});

test('a failed source contributes 0 rather than its stale count', () => {
  // overdue: 4 is in state from before the failure. It must not be counted,
  // because the headline would then present it as a current total.
  assert.equal(knownWork({ ...CLEAR, followupsError: true, overdue: 4 }), 0);
  // And it must not be counted as evidence of work either, so the state is
  // unavailable rather than queue-partial.
  assert.equal(resolveHeroState({ ...CLEAR, followupsError: true, overdue: 4 }), 'unavailable');
});

test('awaiting decisions come from the server snapshot, so they always count', () => {
  // Not fetched, so no outage can make it unknown: both loops can be down and
  // the queue is still provably non-empty.
  const state = resolveHeroState({ ...CLEAR, followupsError: true, freshError: true, awaitingCount: 2 });
  assert.equal(state, 'queue-partial');
  assert.equal(knownWork({ ...CLEAR, followupsError: true, freshError: true, awaitingCount: 2 }), 2);
  assert.equal(missingSourceLabel({ followupsError: true, freshError: true }), 'Follow-ups and new matches');
});

test('counts that are not usable numbers do not become work', () => {
  // A route that answers 200 with a malformed body must not manufacture a queue.
  for (const bad of [NaN, undefined, null, -1, 'seven']) {
    assert.equal(knownWork({ ...CLEAR, newThisWeek: bad }), 0, `newThisWeek=${String(bad)}`);
    assert.equal(resolveHeroState({ ...CLEAR, newThisWeek: bad }), 'all-clear');
  }
  // A real count still counts, and fractions are truncated rather than rounded up.
  assert.equal(knownWork({ ...CLEAR, newThisWeek: 2.9 }), 2);
});

test('every source answering with work is a plain queue, no warning', () => {
  const state = resolveHeroState({ ...CLEAR, overdue: 1, newThisWeek: 2 });
  assert.equal(state, 'queue');
  assert.equal(showsQueue(state), true);
  assert.equal(missingSourceLabel({ followupsError: false, freshError: false }), null);
});

test('a failed source cannot print its stale count', () => {
  // refetch() sets the error flag but leaves the previous count in state, so
  // after one good load and one failed retry `overdue` still holds the old
  // number. queue-partial prints counts, so printing that one would state a
  // stale figure as current.
  const input = { ...CLEAR, followupsError: true, overdue: 4, newThisWeek: 7 };
  assert.equal(resolveHeroState(input), 'queue-partial');
  const shown = displayCounts(input);
  assert.equal(shown.overdue, 0, 'the failed source must print nothing');
  assert.equal(shown.newThisWeek, 7, 'the source that answered still prints');

  // Mirrored, and with both down: nothing is printable.
  assert.deepEqual(
    displayCounts({ ...CLEAR, followupsError: true, freshError: true, overdue: 4, newThisWeek: 7 }),
    { overdue: 0, newThisWeek: 0 },
  );
});
