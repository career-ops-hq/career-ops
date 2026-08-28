/**
 * followup-view.test.mjs — regression tests for pickNextUpcoming()
 * (web/src/lib/core/followup-view.mjs, PR #2157 CodeRabbit fixup).
 *
 * pickNextUpcoming() used to rank candidates by `daysUntilNext ?? Infinity`.
 * When daysUntilNext is missing/null on more than one eligible entry (e.g. a
 * stale snapshot that has nextFollowupDate but never recomputed the derived
 * days-until field), every such entry ties at Infinity and Array.sort's
 * stability then just preserves input order -- NOT the actually-nearer date.
 * This reproduces that with a stable-sort tie: a far entry placed BEFORE a
 * near entry, both missing daysUntilNext, must still yield the near one.
 *
 * Lives under web/tests/ so the web CI collects it and the core runner never
 * has to know it exists -- no test-all.mjs hook, no update-system.mjs
 * registration, and no core-only-install skip guard, because web/ is always
 * present when this suite runs.
 *
 * Run (from web/, as `npm test` does):  node --test tests/lib/followup-view.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNextUpcoming, isDue, selectDueFollowups } from '../../src/lib/core/followup-view.mjs';

test('isDue: keyed on urgency, not the tracker status field — a conflicting status must not override it', () => {
  // status is the tracker status (applied/responded/interview...), never
  // "overdue"/"urgent" — the bug this module exists to fix was filtering on
  // status instead of urgency, so a conflicting status must have no effect.
  assert.equal(isDue({ status: 'overdue', urgency: 'waiting' }), false);
  assert.equal(isDue({ status: 'applied', urgency: 'urgent' }), true);
  assert.equal(isDue({ status: 'applied', urgency: 'overdue' }), true);
  assert.equal(isDue({ status: 'applied', urgency: 'cold' }), false);
});

test('selectDueFollowups: urgent entries sort before overdue entries', () => {
  const overdue = { urgency: 'overdue', company: 'Overdue Co' };
  const urgent = { urgency: 'urgent', company: 'Urgent Co' };
  // overdue placed first in the input -- selectDueFollowups must still put
  // urgent first in the output, proving it orders by urgency and doesn't
  // just preserve input order.
  const result = selectDueFollowups([overdue, urgent]);
  assert.deepEqual(result, [urgent, overdue]);
});

test('selectDueFollowups: excludes non-due urgencies (waiting/cold) even when present', () => {
  const urgent = { urgency: 'urgent', company: 'Urgent Co' };
  const waiting = { urgency: 'waiting', company: 'Waiting Co' };
  const cold = { urgency: 'cold', company: 'Cold Co' };
  assert.deepEqual(selectDueFollowups([waiting, urgent, cold]), [urgent]);
});

test('selectDueFollowups: caps at the default limit of 8', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ urgency: 'overdue', company: `Co ${i}` }));
  assert.equal(selectDueFollowups(entries).length, 8);
});

test('selectDueFollowups: honors an explicit limit override', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ urgency: 'urgent', company: `Co ${i}` }));
  assert.equal(selectDueFollowups(entries, 3).length, 3);
});

test('pickNextUpcoming: picks the actually-nearer date, not just the first entry, when daysUntilNext is missing on both candidates', () => {
  const far = { urgency: 'waiting', nextFollowupDate: '2026-12-01', daysUntilNext: null };
  const near = { urgency: 'waiting', nextFollowupDate: '2026-08-01', daysUntilNext: null };
  // far placed first -- a comparator that treats both as tied (Infinity)
  // would return far here under a stable sort, which is the bug.
  const result = pickNextUpcoming([far, near]);
  assert.equal(result, near);
});

test('pickNextUpcoming: an unparseable nextFollowupDate sorts after a valid one', () => {
  const invalid = { urgency: 'waiting', nextFollowupDate: 'not-a-date', daysUntilNext: null };
  const valid = { urgency: 'waiting', nextFollowupDate: '2026-08-01', daysUntilNext: 5 };
  assert.equal(pickNextUpcoming([invalid, valid]), valid);
  assert.equal(pickNextUpcoming([valid, invalid]), valid);
});

test('pickNextUpcoming: returns null when nothing is upcoming', () => {
  assert.equal(pickNextUpcoming([]), null);
  assert.equal(pickNextUpcoming([{ urgency: 'overdue', nextFollowupDate: '2026-01-01' }]), null);
});
