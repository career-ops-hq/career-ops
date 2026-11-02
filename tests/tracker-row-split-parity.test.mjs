// tests/tracker-row-split-parity.test.mjs — Node's tracker row splitter matches
// the shared row-split parity table.
//
// One table, two readers: test-fixtures/tracker-row-split-parity.json is
// asserted here against splitTrackerCells and in
// dashboard/internal/data/career_test.go against the Go dashboard's
// splitTrackerRow. The Go reader treated any line holding a tab as a legacy
// tab-delimited row, so a pipe row whose notes held a tab (which
// set-status.mjs --note stores verbatim) split into two fields and vanished
// from the dashboard while Node still read it. test-fixtures/ is in
// SYSTEM_PATHS but not BOOTSTRAP_PATHS, so a bootstrap-only install has this
// suite without the table; the Go half fails hard if it is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitTrackerCells } from '../tracker-parse.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PARITY_FIXTURE = join(ROOT, 'test-fixtures', 'tracker-row-split-parity.json');

// splitTrackerCells keeps line.split('|') index space: cell 0 is the text
// before the opening pipe and the last cell follows a closing pipe. The table
// lists the real cells only, # first, which is the Go reader's index space.
function realCells(line) {
  const cells = splitTrackerCells(line).map(s => s.trim());
  return cells.slice(1, line.trimEnd().endsWith('|') ? -1 : undefined);
}

test('Node reader matches the shared row-split parity table (also asserted against the Go reader)',
  existsSync(PARITY_FIXTURE) ? {} : { skip: 'test-fixtures/ not present (bootstrap-only install)' },
  () => {
    const { cases } = JSON.parse(readFileSync(PARITY_FIXTURE, 'utf-8'));
    assert.ok(cases?.length > 0, 'parity fixture has no cases');
    for (const { name, line, cells } of cases) assert.deepEqual(realCells(line), cells, name);
  });

test('a tab in a pipe row is note text, not a column delimiter', () => {
  const cells = realCells('| 7 | 2026-09-01 | Example Co | Engineer | 4.2/5 | Applied | ✅ | — | recruiter said:\tcall Tue |');
  assert.equal(cells.length, 9);
  assert.equal(cells[8], 'recruiter said:\tcall Tue');
});
