// tests/board-truncation.test.mjs — lib/board-truncation.mjs, the one reading
// of "this board was only partly read" that scan.mjs uses to log a board
// `partial` instead of `reachable` (Google AIP-217: report what was not reached).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardTruncation, markTruncated, describeTruncation } from '../lib/board-truncation.mjs';
import { computeConsecutiveFailures } from '../scan.mjs';

test('a whole board reads as not truncated', () => {
  assert.equal(boardTruncation([{ title: 'a' }]), null);
  assert.equal(boardTruncation([]), null);
  assert.equal(boardTruncation(undefined), null);
});

test('canonical truncated object carries reason and counts', () => {
  const jobs = markTruncated([{ title: 'a' }], 'page-cap', { fetched: 100, total: 340 });
  assert.deepEqual(boardTruncation(jobs), { reason: 'page-cap', fetched: 100, total: 340, source: 'truncated' });
});

test('markTruncated keeps its reason argument even if counts carries one', () => {
  const jobs = markTruncated([], 'page-cap', /** @type {any} */ ({ fetched: 5, reason: 'other' }));
  assert.equal(boardTruncation(jobs)?.reason, 'page-cap');
});

test('legacy per-provider tags are recognized without provider changes', () => {
  const eightfold = Object.assign([{ title: 'a' }], { eightfoldTruncated: true });
  assert.deepEqual(boardTruncation(eightfold), { reason: 'cap-or-fetch-error', source: 'eightfoldTruncated' });
  const workday = Object.assign([], { workdayTruncated: 'transient' });
  assert.equal(boardTruncation(workday)?.reason, 'transient');
  const jobstreet = Object.assign([], { jobstreetTruncated: { reason: 'cap' } });
  assert.equal(boardTruncation(jobstreet)?.reason, 'cap');
});

test('a falsy legacy tag and unrelated properties are ignored', () => {
  assert.equal(boardTruncation(Object.assign([], { workdayTruncated: false })), null);
  assert.equal(boardTruncation(Object.assign([], { Truncated: true, workdayNoDateSkip: 3 })), null);
});

test('summary fragment names counts when known', () => {
  assert.equal(describeTruncation('Apple', { reason: 'page-cap', fetched: 100, total: 340, source: 'truncated' }), 'Apple (page-cap, 100 of 340)');
  assert.equal(describeTruncation('Netflix', { reason: 'rate-limited', fetched: 100, source: 'truncated' }), 'Netflix (rate-limited, 100 read)');
  assert.equal(describeTruncation('X', { reason: 'incomplete', source: 'xTruncated' }), 'X (incomplete)');
});

test('a partial board counts toward the persistent-failure streak; a whole read resets it', () => {
  const streaks = computeConsecutiveFailures([
    { company: 'Apple', status: 'partial' },
    { company: 'Apple', status: 'partial' },
    { company: 'Apple', status: 'partial' },
    { company: 'Cisco', status: 'partial' },
    { company: 'Cisco', status: 'reachable' },
  ]);
  assert.equal(streaks.get('Apple'), 3);
  assert.equal(streaks.get('Cisco'), 0);
});
