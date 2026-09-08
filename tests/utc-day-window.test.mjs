// Guards the bracketing helpers that keep date assertions from racing UTC
// midnight (#3816). A suite that captures the day once and compares it to a
// date a child process computed for itself reads the clock twice; when the day
// rolls over in between, the two disagree and an otherwise-green run goes red
// on whichever runner happens to straddle the boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NODE, utcDay, daysSpanned, runAcrossUtcDay } from './helpers.mjs';

// The child prints the same expression the scripts under test use for their
// own today(), so the window has to contain whatever it observed.
const PRINT_OWN_DAY = ['-e', "console.log(new Date().toISOString().split('T')[0])"];

test('utcDay renders an instant as a UTC calendar day, not a local one', () => {
  assert.equal(utcDay(new Date('2026-09-03T23:59:59.999Z')), '2026-09-03');
  assert.equal(utcDay(new Date('2026-09-04T00:00:00.000Z')), '2026-09-04');
  assert.match(utcDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test('daysSpanned collapses to one day, and keeps both across a rollover', () => {
  assert.deepEqual(daysSpanned('2026-09-03', '2026-09-03'), ['2026-09-03']);
  assert.deepEqual(daysSpanned('2026-09-03', '2026-09-04'), ['2026-09-03', '2026-09-04']);
});

test('daysSpanned fills the range, so no intervening day is omitted', () => {
  // run()'s timeout is caller-overridable, so a child can outlive two
  // midnights and report a day that is neither bound.
  assert.deepEqual(daysSpanned('2026-09-03', '2026-09-06'), [
    '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06',
  ]);
  // month and year boundaries are the range's real edge cases
  assert.deepEqual(daysSpanned('2026-02-28', '2026-03-01'), ['2026-02-28', '2026-03-01']);
  assert.deepEqual(daysSpanned('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.deepEqual(daysSpanned('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
});

test('daysSpanned survives a backwards clock step and refuses garbage', () => {
  // NTP can step a CI runner backwards mid-call; the covering range is still
  // the honest answer, and an ordered pair must not become an empty window.
  assert.deepEqual(daysSpanned('2026-09-04', '2026-09-03'), ['2026-09-03', '2026-09-04']);
  assert.deepEqual(daysSpanned('not-a-date', '2026-09-04'), []);
  // Equal bounds take their own branch, so garbage has to be rejected there
  // too — otherwise the answer depends on which branch a bad input reaches.
  assert.deepEqual(daysSpanned('not-a-date', 'not-a-date'), []);
  // well-formed but not a real date: Date.parse rejects month 13
  assert.deepEqual(daysSpanned('2026-13-01', '2026-13-01'), []);
});

test('runAcrossUtcDay returns a window containing the day the child saw', () => {
  const { out, days } = runAcrossUtcDay(NODE, PRINT_OWN_DAY);
  assert.ok(days.length === 1 || days.length === 2, `window spans ${days.length} days`);
  // The invariant the fixed assertions rest on: the child ran inside the
  // bracket, so its own clock read is one of the returned days. True even when
  // this very test crosses midnight.
  assert.ok(days.includes(out), `child saw ${out}, window was ${JSON.stringify(days)}`);
});

// The child throws rather than exiting with a code: test-all refuses to
// import any discovered suite whose source matches /process\.exit\s*\(/,
// and that gate reads source text, so even this argument string would trip
// it (#1916). A throw exits non-zero just as well.
test('runAcrossUtcDay passes a child failure through as run() does', () => {
  const { out, days } = runAcrossUtcDay(NODE, ['-e', 'throw new Error("boom")']);
  assert.equal(out, null);
  assert.ok(days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)));
});
