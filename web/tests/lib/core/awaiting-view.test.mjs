/**
 * awaiting-view.test.mjs — regression tests for selectAwaitingDecision()
 * (web/src/lib/core/awaiting-view.mjs).
 *
 * The home dashboard's "Awaiting your decision" panel used to take the first N
 * Evaluated rows in tracker order. Tracker rows are appended chronologically,
 * so that returned the most recently SCANNED roles rather than the
 * highest-SCORING ones — on a real tracker a 1.9 was shown while thirteen 4.6s
 * were never surfaced at all. The panel exists to present what is most worth
 * acting on, so it must rank by score.
 *
 * Imports directly from awaiting-view.mjs (the single source of truth) so the
 * test and production code can never drift out of sync.
 *
 * Run (from web/, as `npm test` does):  node --test tests/lib/core/awaiting-view.test.mjs
 * From the repo root:                   node --test web/tests/lib/core/awaiting-view.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAwaitingDecision } from '../../../src/lib/core/awaiting-view.mjs';

const row = (num, score, status = 'Evaluated', date = '2026-07-01') =>
  ({ num: String(num), score, status, date, company: `Co${num}` });

test('selectAwaitingDecision: ranks by score, so a high scorer late in the tracker still surfaces', () => {
  // Tracker order puts the weak rows first — exactly the real-world shape.
  const rows = [row(1, '1.9/5'), row(2, '3.2/5'), row(3, '4.6/5'), row(4, '2.8/5')];
  const out = selectAwaitingDecision(rows, 2);
  assert.deepEqual(out.map((r) => r.score), ['4.6/5', '3.2/5']);
});

test('selectAwaitingDecision: excludes rows that already have a terminal status', () => {
  const rows = [row(1, '4.8/5', 'Applied'), row(2, '4.7/5', 'Rejected'), row(3, '3.0/5', 'Evaluated')];
  const out = selectAwaitingDecision(rows, 6);
  assert.deepEqual(out.map((r) => r.num), ['3']);
});

test('selectAwaitingDecision: caps at the requested limit', () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(i, `${(i % 5) + 1}.0/5`));
  assert.equal(selectAwaitingDecision(rows, 6).length, 6);
});

test('selectAwaitingDecision: breaks a score tie by newest date first', () => {
  const rows = [row(1, '4.6/5', 'Evaluated', '2026-06-01'), row(2, '4.6/5', 'Evaluated', '2026-07-20')];
  assert.deepEqual(selectAwaitingDecision(rows, 2).map((r) => r.num), ['2', '1']);
});

test('selectAwaitingDecision: an unparseable score sorts last rather than corrupting the order', () => {
  const rows = [row(1, 'n/a'), row(2, '—'), row(3, '3.1/5')];
  const out = selectAwaitingDecision(rows, 6);
  assert.equal(out[0].num, '3', 'a real score must outrank a placeholder');
  assert.equal(out.length, 3, 'placeholder scores are still awaiting a decision, not dropped');
});

test('selectAwaitingDecision: tolerates an empty list, a short list, and missing fields', () => {
  assert.deepEqual(selectAwaitingDecision([], 6), []);
  assert.equal(selectAwaitingDecision([row(1, '4.0/5')], 6).length, 1);
  assert.doesNotThrow(() => selectAwaitingDecision([{ status: 'Evaluated' }], 6));
  assert.doesNotThrow(() => selectAwaitingDecision(undefined, 6));
});

test('selectAwaitingDecision: a negative limit returns nothing rather than all-but-the-last row', () => {
  const rows = [row(1, '4.6/5'), row(2, '3.2/5'), row(3, '1.9/5')];
  // Array.prototype.slice(0, -1) drops only the last element, so an
  // un-normalized negative limit would surface almost the whole tracker.
  assert.deepEqual(selectAwaitingDecision(rows, -1), []);
  assert.deepEqual(selectAwaitingDecision(rows, -99), []);
});

test('selectAwaitingDecision: a zero limit returns an empty list', () => {
  const rows = [row(1, '4.6/5'), row(2, '3.2/5')];
  assert.deepEqual(selectAwaitingDecision(rows, 0), []);
});

test('selectAwaitingDecision: a fractional limit truncates toward zero', () => {
  const rows = [row(1, '4.6/5'), row(2, '3.2/5'), row(3, '1.9/5')];
  assert.deepEqual(selectAwaitingDecision(rows, 2.7).map((r) => r.num), ['1', '2']);
  assert.deepEqual(selectAwaitingDecision(rows, -0.5), []);
});

test('selectAwaitingDecision: a non-finite or non-numeric limit falls back to the default', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i, `${(i % 5) + 1}.0/5`));
  // Falling back to the default (rather than to 0) keeps a caller bug from
  // silently emptying the panel — the failure mode this module exists to fix.
  assert.equal(selectAwaitingDecision(rows, NaN).length, 6);
  assert.equal(selectAwaitingDecision(rows, Infinity).length, 6);
  assert.equal(selectAwaitingDecision(rows, -Infinity).length, 6);
  assert.equal(selectAwaitingDecision(rows, '3').length, 6);
  assert.equal(selectAwaitingDecision(rows, null).length, 6);
  assert.equal(selectAwaitingDecision(rows, {}).length, 6);
});

test('selectAwaitingDecision: does not mutate the caller array', () => {
  const rows = [row(1, '1.0/5'), row(2, '4.6/5')];
  const before = rows.map((r) => r.num).join(',');
  selectAwaitingDecision(rows, 2);
  assert.equal(rows.map((r) => r.num).join(','), before);
});

test('selectAwaitingDecision: a score with a stray digit elsewhere in the string does not outrank a real score', () => {
  // scoreValue() must validate the whole string, not just find any digit in
  // it — "n/a (2026)" has no real score, but a bare digit-substring match
  // would read "2026" and let this row outrank every genuine 4.x/5.
  const rows = [row(1, 'n/a (2026)'), row(2, '4.6/5')];
  const out = selectAwaitingDecision(rows, 6);
  assert.equal(out[0].num, '2', 'a real score must outrank a malformed one, even with a large embedded digit');
});

test('selectAwaitingDecision: an out-of-range or malformed score does not outrank a real score', () => {
  const rows = [row(1, '-1/5'), row(2, '10/5'), row(3, '3.0/5')];
  const out = selectAwaitingDecision(rows, 6);
  assert.equal(out[0].num, '3', 'the only well-formed 0–5 score must sort first');
  assert.equal(out.length, 3, 'malformed scores are still awaiting a decision, not dropped');
});

test('selectAwaitingDecision: excludes "Evaluating" and "Evaluation failed" — only the canonical "Evaluated" status counts', () => {
  // The old /^evaluat/i prefix test also matched these two non-canonical
  // states (see templates/states.yml), letting an in-progress or failed row
  // consume a result slot and displace a real Evaluated row.
  const rows = [row(1, '4.9/5', 'Evaluating'), row(2, '4.8/5', 'Evaluation failed'), row(3, '3.0/5', 'Evaluated')];
  const out = selectAwaitingDecision(rows, 6);
  assert.deepEqual(out.map((r) => r.num), ['3']);
});

test('selectAwaitingDecision: status match is case-insensitive but still exact', () => {
  const rows = [row(1, '4.0/5', 'evaluated'), row(2, '4.0/5', 'EVALUATED')];
  assert.equal(selectAwaitingDecision(rows, 6).length, 2);
});

// EVALUATED_STATUS accepts the "Evaluada" alias (templates/states.yml), but
// the case-insensitivity test above only exercised "Evaluated" case variants
// — a regression that dropped the alias branch entirely would have passed it.
test('selectAwaitingDecision: includes rows using the "Evaluada" status alias', () => {
  const rows = [row(1, '4.5/5', 'Evaluada'), row(2, '4.0/5', 'evaluada')];
  assert.deepEqual(selectAwaitingDecision(rows, 6).map((r) => r.num), ['1', '2']);
});
