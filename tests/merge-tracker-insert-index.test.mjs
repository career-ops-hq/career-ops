// tests/merge-tracker-insert-index.test.mjs — a new row goes into the tracker's
// table, not into whichever table happens to sit above it.
//
// `applications.md` is user-authored, so a preamble table above the applications
// table is legitimate. Locating the insert point from the FIRST markdown
// separator in the file put the new row above that preamble's header, where no
// reader parses it, while the run printed "➕ Add #N", exited 0 and archived the
// TSV, so the row was gone and the additions file said it had landed.
//
// The index is asserted by splicing with it, the way the caller does, rather than
// by comparing the number alone: `splice(index, 0, row)` inserts BEFORE `index`,
// so a helper that returned the separator's own index would pass a bare number
// assertion while malforming the table.
//
// Run:  node --test tests/merge-tracker-insert-index.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeInsertIndex } from '../merge-tracker.mjs';

const TRACKER_HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const TRACKER_SEPARATOR = '|---|---|---|---|---|---|---|---|---|';
const row = '| 1 | 2026-11-01 | Acme | Engineer | 4/5 | Evaluated | — | [r](reports/1-x.md) | |';
const NEW_ROW = '| 2 | 2026-11-02 | Initech | Manager | 3/5 | Evaluated | — | [r](reports/2-y.md) | |';

/** Insert through the helper the way mergeTracker does. */
function merged(lines) {
  const at = mergeInsertIndex(lines);
  assert.notEqual(at, -1, 'expected an insert point');
  const copy = [...lines];
  copy.splice(at, 0, NEW_ROW);
  return copy;
}

test('the new row lands after the separator, not between header and separator', () => {
  const lines = ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, row];
  assert.equal(mergeInsertIndex(lines), 4);

  const out = merged(lines);
  assert.equal(out[2], TRACKER_HEADER, 'the header must stay put');
  assert.equal(out[3], TRACKER_SEPARATOR, 'the separator must stay directly under it');
  assert.equal(out[4], NEW_ROW, 'the new row is the first data row');
  assert.equal(out[5], row, 'the row that was already there follows');
});

test('ignores a table above the tracker', () => {
  const lines = [
    '# Applications Tracker',
    '',
    '| Metric | Value |',
    '|---|---|',
    '| Applied | 12 |',
    '',
    TRACKER_HEADER,
    TRACKER_SEPARATOR,
    row,
  ];
  assert.equal(mergeInsertIndex(lines), 8, 'the preamble separator must not be the insert point');

  const out = merged(lines);
  assert.equal(out[6], TRACKER_HEADER);
  assert.equal(out[7], TRACKER_SEPARATOR);
  assert.equal(out[8], NEW_ROW);
});

test('the merged row is the last data row and the table stays well formed', () => {
  // The shape the merge produces, and the shape an integration suite parses:
  // header, separator, then data rows only. A SKIP row appended by the caller
  // must still end up after the inserted row.
  const lines = ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, row];
  const out = merged(lines);
  out.push('|  |  | Adatum | Analyst | 1/5 | SKIP | — | — | |');

  const separatorAt = out.indexOf(TRACKER_SEPARATOR);
  assert.equal(separatorAt, 3);
  const dataRows = out.slice(separatorAt + 1);
  assert.equal(dataRows.length, 3, 'every line after the separator is a data row');
  for (const line of dataRows) {
    assert.match(line, /^\|.*\|$/, `not a table row: ${line}`);
  }
  assert.equal(dataRows.at(-1), '|  |  | Adatum | Analyst | 1/5 | SKIP | — | — | |');
});

test('no tracker header means no insert point', () => {
  assert.equal(mergeInsertIndex([]), -1);
  assert.equal(mergeInsertIndex(['# Applications Tracker', '']), -1);
});

test('a header with no separator under it is not an insert point', () => {
  // The row must not be spliced between a header and a data row, which would
  // corrupt the table for every reader.
  const lines = [TRACKER_HEADER, row];
  assert.equal(mergeInsertIndex(lines), -1);
});