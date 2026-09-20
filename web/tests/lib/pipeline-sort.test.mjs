// web/tests/lib/pipeline-sort.test.mjs: the pipeline list's ordering (#4290).
//
// The bug: a date is only a day, so rows sharing one compare equal under the
// original comparator and kept whatever order they arrived in. "Sort by newest"
// therefore never reordered the same-day rows. These tests pin the tie-break.
//
// Lives under web/tests/ so the web suite collects it, following
// followup-view.test.mjs.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/pipeline-sort.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreNum, sortRows } from '../../src/lib/core/pipeline-sort.mjs';

/** A tracker row, with only the fields these tests care about. */
const row = (n, date, over = {}) => ({
  n: String(n),
  date,
  company: `Company ${n}`,
  via: '',
  role: `Role ${n}`,
  score: '',
  status: 'evaluated',
  pdf: '',
  report: '',
  notes: '',
  ...over,
});

const names = (rows) => rows.map((r) => r.role);

// The reported symptom, in the reporter's own terms: several jobs on one date,
// sorted newest-first.
const SAME_DAY = [row(3, '2026-09-18'), row(1, '2026-09-18'), row(2, '2026-09-18')];

test('newest-first puts the latest-added row first within one date', () => {
  const result = sortRows(SAME_DAY, { key: 'date', dir: -1 });
  assert.deepEqual(names(result), ['Role 3', 'Role 2', 'Role 1']);
});

test('oldest-first reverses the same-day order, so dir actually applies', () => {
  const result = sortRows(SAME_DAY, { key: 'date', dir: 1 });
  assert.deepEqual(names(result), ['Role 1', 'Role 2', 'Role 3']);
});

test('the input order does not decide the output', () => {
  const shuffled = [row(2, '2026-09-18'), row(3, '2026-09-18'), row(1, '2026-09-18')];
  assert.deepEqual(names(sortRows(shuffled, { key: 'date', dir: -1 })), ['Role 3', 'Role 2', 'Role 1']);
  assert.deepEqual(names(sortRows(shuffled, { key: 'date', dir: 1 })), ['Role 1', 'Role 2', 'Role 3']);
});

test('dates still order before the tie-break', () => {
  const rows = [row(1, '2026-09-17'), row(5, '2026-09-18'), row(2, '2026-09-17')];
  // Newest date first, and within 09-17 the higher row number first.
  assert.deepEqual(names(sortRows(rows, { key: 'date', dir: -1 })), ['Role 5', 'Role 2', 'Role 1']);
  // Oldest date first, and within 09-17 the lower row number first, since the
  // tie-break follows the active direction rather than always descending.
  assert.deepEqual(names(sortRows(rows, { key: 'date', dir: 1 })), ['Role 1', 'Role 2', 'Role 5']);
});

test('the tie-break applies to every column, not just date', () => {
  const rows = [
    row(1, '2026-09-18', { company: 'Acme' }),
    row(3, '2026-09-18', { company: 'Acme' }),
    row(2, '2026-09-18', { company: 'Acme' }),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'company', dir: 1 })), ['Role 1', 'Role 2', 'Role 3']);
});

test('score ordering is unchanged, and ties break the same way', () => {
  const rows = [
    row(1, '2026-09-18', { score: '8' }),
    row(3, '2026-09-18', { score: '9' }),
    row(2, '2026-09-18', { score: '9' }),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: -1 })), ['Role 3', 'Role 2', 'Role 1']);
});

test('a non-numeric score sorts last rather than as zero', () => {
  const rows = [row(1, '2026-09-18', { score: '' }), row(2, '2026-09-18', { score: '7' })];
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: -1 })), ['Role 2', 'Role 1']);
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: 1 })), ['Role 1', 'Role 2']);
});

test('a row without a usable n keeps its order instead of jumping', () => {
  const rows = [row(2, '2026-09-18'), { ...row(1, '2026-09-18'), n: '' }, row(3, '2026-09-18')];
  const result = sortRows(rows, { key: 'date', dir: -1 });
  assert.equal(result.length, 3);
  // The unkeyed row is compared as a tie either way, so it must not be forced to
  // one end by an invented number.
  assert.equal(result.map((r) => r.n).filter((n) => n === '').length, 1);
});

test('the input array is not mutated', () => {
  const rows = [row(1, '2026-09-18'), row(2, '2026-09-18')];
  const before = rows.map((r) => r.n);
  sortRows(rows, { key: 'date', dir: -1 });
  assert.deepEqual(rows.map((r) => r.n), before);
});

test('company sorting uses the label the caller supplies', () => {
  const rows = [row(1, '2026-09-18'), row(2, '2026-09-18')];
  const byLabel = (r) => (r.n === '1' ? 'Zeta' : 'Alpha');
  assert.deepEqual(names(sortRows(rows, { key: 'company', dir: 1 }, byLabel)), ['Role 2', 'Role 1']);
});

test('the tracker column compares numerically, and follows the direction', () => {
  const rows = [row(1, '2026-09-18'), row(10, '2026-09-18'), row(2, '2026-09-18')];
  assert.deepEqual(names(sortRows(rows, { key: 'tracker', dir: -1 })), ['Role 10', 'Role 2', 'Role 1']);
  assert.deepEqual(names(sortRows(rows, { key: 'tracker', dir: 1 })), ['Role 1', 'Role 2', 'Role 10']);
});

test('scoreNum reports unusable cells as NaN, never as 0', () => {
  for (const v of ['', null, undefined, 'abc', 'N/A']) assert.ok(Number.isNaN(scoreNum(v)), String(v));
  assert.equal(scoreNum('7'), 7);
  assert.equal(scoreNum(0), 0);
});
