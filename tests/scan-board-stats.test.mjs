// tests/scan-board-stats.test.mjs — the per-source table in the scan summary.
//
// Run:  node --test tests/scan-board-stats.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printBoardStats } from '../scan.mjs';

function stat(over = {}) {
  return { fetched: 0, source: 0, sourceDetail: {}, title: 0, location: 0, age: 0, other: 0, seen: 0, passed: 0, new: 0, error: false, ...over };
}

function capture(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.log = original; }
  return lines.join('\n');
}

test('printBoardStats prints one row per source, best first, with a total row', () => {
  const stats = new Map([
    ['Alpha', stat({ fetched: 10, title: 6, seen: 2, passed: 2, new: 2 })],
    ['Beta', stat({ fetched: 20, title: 10, location: 3, other: 1, seen: 1, passed: 5, new: 5 })],
  ]);
  const out = capture(() => printBoardStats(stats));
  assert.ok(out.indexOf('Beta') < out.indexOf('Alpha'), 'the source with more new offers comes first');
  const total = out.split('\n').find(line => line.trim().startsWith('Total'));
  assert.match(total, /30\s+0\s+16\s+3\s+0\s+1\s+3\s+7$/, `total row: ${total}`);
});

test('printBoardStats shows source-side drops and marks a failed source', () => {
  const stats = new Map([
    ['JustJoin', stat({ fetched: 100, source: 90, sourceDetail: { workplace: 60, language: 30 }, title: 8, passed: 2, new: 2 })],
    ['Broken', stat({ error: true })],
  ]);
  const out = capture(() => printBoardStats(stats));
  assert.match(out, /JustJoin: workplace 60, language 30/);
  assert.match(out, /Broken ✗/);
});

test('printBoardStats adds a verify column only in verify mode', () => {
  const stats = new Map([['Alpha', stat({ fetched: 5, passed: 5, new: 3 })]]);
  assert.doesNotMatch(capture(() => printBoardStats(stats)), /verify/);
  const out = capture(() => printBoardStats(stats, { verify: true }));
  const row = out.split('\n').find(line => line.trim().startsWith('Alpha'));
  assert.match(row, /\s2\s+3$/, `verify column shows the 2 offers verification dropped: ${row}`);
});

test('printBoardStats prints nothing for an empty run', () => {
  assert.equal(capture(() => printBoardStats(new Map())), '');
});
