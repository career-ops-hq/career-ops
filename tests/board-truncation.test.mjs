// tests/board-truncation.test.mjs — the one shared reading of a partly-read
// board (#6632).
//
// Run:  node --test tests/board-truncation.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_TRUNCATED_TAGS,
  formatPartialBoard,
  markTruncated,
  readTruncation,
} from '../lib/board-truncation.mjs';

const jobs = (n) => Array.from({ length: n }, (_, i) => ({ title: `Role ${i}`, url: `https://example.invalid/${i}` }));

test('a complete board carries no truncation signal', () => {
  assert.equal(readTruncation(jobs(3)), null);
  assert.equal(readTruncation([]), null);
  assert.equal(readTruncation(null), null);
  assert.equal(readTruncation('not an array'), null);
});

test('markTruncated sets the canonical flag and readTruncation returns it', () => {
  const board = markTruncated(jobs(100), { reason: 'cap', total: 340 });
  assert.deepEqual(board.truncated, { reason: 'cap', fetched: 100, total: 340 });
  assert.deepEqual(readTruncation(board), { reason: 'cap', fetched: 100, total: 340 });
});

test('markTruncated omits total when the provider does not know it', () => {
  const board = markTruncated(jobs(20), { reason: 'cap' });
  assert.deepEqual(board.truncated, { reason: 'cap', fetched: 20 });
  assert.equal('total' in board.truncated, false);
  assert.deepEqual(readTruncation(board), { reason: 'cap', fetched: 20 });
});

test('markTruncated defaults to a cap reason and returns the array', () => {
  const board = jobs(5);
  assert.equal(markTruncated(board), board);
  assert.equal(board.truncated.reason, 'cap');
});

test('markTruncated rejects a non-array, an empty reason, and a bad total', () => {
  assert.throws(() => markTruncated(null), TypeError);
  assert.throws(() => markTruncated(jobs(1), { reason: '' }), TypeError);
  assert.throws(() => markTruncated(jobs(1), { reason: 7 }), TypeError);
  assert.throws(() => markTruncated(jobs(1), { total: -1 }), TypeError);
  assert.throws(() => markTruncated(jobs(1), { total: Number.NaN }), TypeError);
});

test('a bare boolean tag reads as unknown, never as an invented reason', () => {
  // Most providers set a boolean: adp, eightfold, icims, phenom, and the rest.
  for (const tag of ['adpTruncated', 'eightfoldTruncated', 'icimsTruncated', 'phenomTruncated', 'clearcompanyTruncated']) {
    const board = jobs(10);
    board[tag] = true;
    assert.deepEqual(readTruncation(board), { reason: 'unknown', fetched: 10 });
  }
  // And `false` is not a signal at all.
  const board = jobs(10);
  board.eightfoldTruncated = false;
  assert.equal(readTruncation(board), null);
});

test('a string tag carries its reason through verbatim', () => {
  const board = jobs(100);
  board.leverTruncated = 'cap';
  assert.deepEqual(readTruncation(board), { reason: 'cap', fetched: 100 });

  const workday = jobs(50);
  workday.workdayTruncated = 'transient';
  assert.deepEqual(readTruncation(workday), { reason: 'transient', fetched: 50 });

  const structural = jobs(50);
  structural.workdayTruncated = 'structural';
  assert.deepEqual(readTruncation(structural), { reason: 'structural', fetched: 50 });

  // Provider-specific reasons are passed through, not collapsed: aldi-nord
  // reports why its walk stopped in its own words.
  const aldi = jobs(25);
  aldi.aldiNordTruncated = 'source-reports-more';
  assert.deepEqual(readTruncation(aldi), { reason: 'source-reports-more', fetched: 25 });

  const trakstar = jobs(40);
  trakstar.trakstarTruncated = 'repeated';
  assert.deepEqual(readTruncation(trakstar), { reason: 'repeated', fetched: 40 });
});

test('an object tag carries its reason and total', () => {
  const board = jobs(100);
  board.jobstreetTruncated = { reason: 'cap' };
  assert.deepEqual(readTruncation(board), { reason: 'cap', fetched: 100 });

  const withTotal = jobs(100);
  withTotal.jobstreetTruncated = { reason: 'cap', total: 340 };
  assert.deepEqual(readTruncation(withTotal), { reason: 'cap', fetched: 100, total: 340 });
});

test('every legacy tag in the tree is recognised — 20, not the issue’s 19', () => {
  // #6632 counts 19 providers; the tree at this HEAD carries 20 tags, the
  // twentieth being aldiNordTruncated. This test pins the full list so a
  // tag added to a provider without a reader entry fails here, and so a
  // tag dropped to match the issue’s count fails here too.
  assert.equal(LEGACY_TRUNCATED_TAGS.length, 20);
  assert.ok(LEGACY_TRUNCATED_TAGS.includes('aldiNordTruncated'));
  for (const tag of LEGACY_TRUNCATED_TAGS) {
    const board = jobs(2);
    board[tag] = true;
    assert.notEqual(readTruncation(board), null, `${tag} should be recognised`);
  }
});

test('precedence: a specific reason beats a bare true', () => {
  const board = jobs(10);
  board.eightfoldTruncated = true;
  board.leverTruncated = 'cap';
  assert.deepEqual(readTruncation(board), { reason: 'cap', fetched: 10 });
});

test('precedence: fetch-error beats cap — a board that broke is not merely capped', () => {
  const board = jobs(10);
  board.leverTruncated = 'cap';
  board.aldiNordTruncated = 'fetch-error';
  assert.deepEqual(readTruncation(board), { reason: 'fetch-error', fetched: 10 });

  const reversed = jobs(10);
  reversed.aldiNordTruncated = 'fetch-error';
  reversed.leverTruncated = 'cap';
  assert.deepEqual(readTruncation(reversed), { reason: 'fetch-error', fetched: 10 });
});

test('precedence: the canonical flag is a candidate like any other', () => {
  const board = markTruncated(jobs(10), { reason: 'cap' });
  board.eightfoldTruncated = true;
  assert.deepEqual(readTruncation(board), { reason: 'cap', fetched: 10 });
});

test('fetched is the array length at read time, not at mark time', () => {
  const board = markTruncated(jobs(100), { reason: 'cap', total: 340 });
  board.pop();
  assert.deepEqual(readTruncation(board), { reason: 'cap', fetched: 99, total: 340 });
});

test('probe guard: a ctx.maxPages walk is not a truncated board', () => {
  const board = jobs(20);
  board.eightfoldTruncated = true;
  assert.equal(readTruncation(board, { maxPages: 1 }), null);
  assert.deepEqual(readTruncation(board, {}), { reason: 'unknown', fetched: 20 });
  assert.deepEqual(readTruncation(board, null), { reason: 'unknown', fetched: 20 });
  assert.deepEqual(readTruncation(board), { reason: 'unknown', fetched: 20 });
});

test('the summary form matches the issue’s example', () => {
  assert.equal(
    formatPartialBoard({ company: 'Apple', reason: 'cap', fetched: 100, total: 340 }),
    'Apple (page-cap, 100 of 340)',
  );
  assert.equal(
    formatPartialBoard({ company: 'Netflix', reason: 'unknown', fetched: 100, total: 394 }),
    'Netflix (unknown, 100 of 394)',
  );
  assert.equal(
    formatPartialBoard({ company: 'Apple', reason: 'cap', fetched: 100 }),
    'Apple (page-cap, 100)',
  );
});
