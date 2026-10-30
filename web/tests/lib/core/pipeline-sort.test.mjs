// web/tests/lib/core/pipeline-sort.test.mjs: the pipeline list's ordering (#4290).
//
// The bug: a date is only a day, so rows sharing one compare equal under the
// original comparator and kept whatever order they arrived in. "Sort by newest"
// therefore never reordered the same-day rows. These tests pin the tie-break.
//
// Mirrors the source path (tests/lib/core/ for src/lib/core/), following
// tests/lib/status-alias.test.mjs.
//
// The score parser under test is the real one from lib/format.ts, reached
// through tests/helpers/web-ts-alias-loader.mjs. This suite exists partly
// because a second parser in the sort module drifted from the real thing when
// the tracker's "4.2/5" cells met it (#4333), so a local stub would not have
// caught that. Node type-strips the .ts on import; the helper only resolves the
// "@/…" specifier format.ts itself uses. Where the local Node cannot strip
// types (on by default only from 22.18), the cases that need the real parser
// skip, as apply-planner-fencing.test.mjs does for the same reason.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/core/pipeline-sort.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../../helpers/web-ts-alias-loader.mjs';

const tsSkipReason = () => (process.features?.typescript
  ? false
  : 'this Node cannot import a .ts module (type stripping is on by default only from 22.18)');
const skipTs = tsSkipReason();

// Dynamic imports on purpose: a static specifier resolves before the loader
// hook above is installed, so format.ts would fail as an unresolved "@/lib".
const { scoreNum } = skipTs ? { scoreNum: null } : await import('../../../src/lib/format.ts');
const { sortRows } = await import('../../../src/lib/core/pipeline-sort.mjs');

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

/** A row the tracker never numbered: its n cell is blank, so it ties on the
 *  row-number key with every row it meets. */
const unnumbered = (date, role) => ({ ...row('', date), n: '', role });

const names = (rows) => rows.map((r) => r.role);

// The reported symptom, in the reporter's own terms: several jobs on one date,
// sorted newest-first.
const SAME_DAY = [row(3, '2026-09-18'), row(1, '2026-09-18'), row(2, '2026-09-18')];

test('newest-first puts the latest-added row first within one date', () => {
  const result = sortRows(SAME_DAY, { key: 'date', dir: -1 }, scoreNum);
  assert.deepEqual(names(result), ['Role 3', 'Role 2', 'Role 1']);
});

test('oldest-first reverses the same-day order, so dir actually applies', () => {
  const result = sortRows(SAME_DAY, { key: 'date', dir: 1 }, scoreNum);
  assert.deepEqual(names(result), ['Role 1', 'Role 2', 'Role 3']);
});

test('the input order does not decide the output', () => {
  const shuffled = [row(2, '2026-09-18'), row(3, '2026-09-18'), row(1, '2026-09-18')];
  assert.deepEqual(names(sortRows(shuffled, { key: 'date', dir: -1 }, scoreNum)), ['Role 3', 'Role 2', 'Role 1']);
  assert.deepEqual(names(sortRows(shuffled, { key: 'date', dir: 1 }, scoreNum)), ['Role 1', 'Role 2', 'Role 3']);
});

test('dates still order before the tie-break', () => {
  const rows = [row(1, '2026-09-17'), row(5, '2026-09-18'), row(2, '2026-09-17')];
  // Newest date first, and within 09-17 the higher row number first.
  assert.deepEqual(names(sortRows(rows, { key: 'date', dir: -1 }, scoreNum)), ['Role 5', 'Role 2', 'Role 1']);
  // Oldest date first, and within 09-17 the lower row number first, since the
  // tie-break follows the active direction rather than always descending.
  assert.deepEqual(names(sortRows(rows, { key: 'date', dir: 1 }, scoreNum)), ['Role 1', 'Role 2', 'Role 5']);
});

test('the tie-break applies to every column, not just date', () => {
  const rows = [
    row(1, '2026-09-18', { company: 'Acme' }),
    row(3, '2026-09-18', { company: 'Acme' }),
    row(2, '2026-09-18', { company: 'Acme' }),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'company', dir: 1 }, scoreNum)), ['Role 1', 'Role 2', 'Role 3']);
});

test('score ordering is unchanged, and ties break the same way', { skip: skipTs }, () => {
  const rows = [
    row(1, '2026-09-18', { score: '8' }),
    row(3, '2026-09-18', { score: '9' }),
    row(2, '2026-09-18', { score: '9' }),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: -1 }, scoreNum)), ['Role 3', 'Role 2', 'Role 1']);
});

test('a non-numeric score sorts last rather than as zero', { skip: skipTs }, () => {
  const rows = [row(1, '2026-09-18', { score: '' }), row(2, '2026-09-18', { score: '7' })];
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: -1 }, scoreNum)), ['Role 2', 'Role 1']);
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: 1 }, scoreNum)), ['Role 1', 'Role 2']);
});

// The regression from #4333: the tracker stores scores as "4.2/5", and a
// Number() of that cell is NaN, so with the user's real data the score
// comparison never saw a number at all.
test('a real tracker score, X.X/5, orders and breaks ties', { skip: skipTs }, () => {
  const rows = [
    row(1, '2026-09-18', { score: '3.0/5' }),
    row(3, '2026-09-18', { score: '4.2/5' }),
    row(2, '2026-09-18', { score: '4.2/5' }),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: -1 }, scoreNum)), ['Role 3', 'Role 2', 'Role 1']);
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: 1 }, scoreNum)), ['Role 1', 'Role 2', 'Role 3']);
});

test('the score parser is the caller\'s, since it is a parameter', () => {
  // A caller with another score vocabulary keeps its own parser and the
  // ordering rule does not need to know the format.
  const letters = (s) => (s === 'A' ? 5 : 1);
  const rows = [row(1, '2026-09-18', { score: 'A' }), row(2, '2026-09-18', { score: 'B' })];
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: -1 }, letters)), ['Role 1', 'Role 2']);
});

test('two unusable scores reach the row-number tie-break, both directions', { skip: skipTs }, () => {
  // Both scores are unusable, so both rank below every real score and the two
  // are equal to each other. The comparison must say so rather than subtract:
  // -Infinity minus -Infinity is NaN, which is not a "less than", and the
  // tie-break would never be reached.
  const rows = [row(1, '2026-09-18'), row(3, '2026-09-18')];
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: -1 }, scoreNum)), ['Role 3', 'Role 1']);
  assert.deepEqual(names(sortRows(rows, { key: 'score', dir: 1 }, scoreNum)), ['Role 1', 'Role 3']);
});

test('a row without a usable n keeps its position while the numbered rows sort', () => {
  // The complete order, not just the length: with [n=2, n='', n=3] the blank
  // row ties with both neighbours, so the numbered rows can be left unordered
  // ([2, '', 3] descending) unless they are compared past it.
  const rows = [row(2, '2026-09-18'), unnumbered('2026-09-18', 'Role 1'), row(3, '2026-09-18')];
  const desc = sortRows(rows, { key: 'date', dir: -1 }, scoreNum);
  assert.deepEqual(desc.map((r) => r.role), ['Role 3', 'Role 1', 'Role 2']);
  assert.equal(desc[1].n, '', 'the unnumbered row must stay in its own slot');
  const asc = sortRows(rows, { key: 'date', dir: 1 }, scoreNum);
  assert.deepEqual(asc.map((r) => r.role), ['Role 2', 'Role 1', 'Role 3']);
  assert.equal(asc[1].n, '', 'the unnumbered row must stay in its own slot');
});

test('an unnumbered row at one end of its date does not get moved inward', () => {
  // Its slot is wherever the row list put it, so a fix that hardcodes "second"
  // would be wrong here.
  const rows = [
    unnumbered('2026-09-18', 'Unnumbered'),
    row(2, '2026-09-18', { role: 'Role 2' }),
    row(4, '2026-09-18', { role: 'Role 4' }),
    row(3, '2026-09-18', { role: 'Role 3' }),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'date', dir: -1 }, scoreNum)), ['Unnumbered', 'Role 4', 'Role 3', 'Role 2']);
  assert.deepEqual(names(sortRows(rows, { key: 'date', dir: 1 }, scoreNum)), ['Unnumbered', 'Role 2', 'Role 3', 'Role 4']);
});

test('a row whose n is not numeric is unnumbered, not row 0', () => {
  const rows = [row(2, '2026-09-18'), { ...row(1, '2026-09-18'), n: 'n/a' }, row(3, '2026-09-18')];
  const desc = sortRows(rows, { key: 'date', dir: -1 }, scoreNum);
  assert.deepEqual(desc.map((r) => r.n), ['3', 'n/a', '2']);
});

test('the input array is not mutated', () => {
  const rows = [row(1, '2026-09-18'), row(2, '2026-09-18')];
  const before = rows.map((r) => r.n);
  sortRows(rows, { key: 'date', dir: -1 }, scoreNum);
  assert.deepEqual(rows.map((r) => r.n), before);
});

test('company sorting uses the label the caller supplies', () => {
  const rows = [row(1, '2026-09-18'), row(2, '2026-09-18')];
  const byLabel = (r) => (r.n === '1' ? 'Zeta' : 'Alpha');
  assert.deepEqual(names(sortRows(rows, { key: 'company', dir: 1 }, scoreNum, byLabel)), ['Role 2', 'Role 1']);
});

test('the tracker column compares numerically, and follows the direction', () => {
  const rows = [row(1, '2026-09-18'), row(10, '2026-09-18'), row(2, '2026-09-18')];
  assert.deepEqual(names(sortRows(rows, { key: 'tracker', dir: -1 }, scoreNum)), ['Role 10', 'Role 2', 'Role 1']);
  assert.deepEqual(names(sortRows(rows, { key: 'tracker', dir: 1 }, scoreNum)), ['Role 1', 'Role 2', 'Role 10']);
});

test('scoreNum reports unusable cells as NaN, never as 0', { skip: skipTs }, () => {
  for (const v of ['', 'abc', 'N/A']) assert.ok(Number.isNaN(scoreNum(v)), String(v));
  assert.equal(scoreNum('7'), 7);
  assert.equal(scoreNum('4.2/5'), 4.2);
});
