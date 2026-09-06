/**
 * calibrate-tracker-colmap.test.mjs — regression suite for calibrate.mjs's
 * tracker loader.
 *
 * calibrate.mjs's `--self-test` covers computeCalibration() against in-memory
 * rows, so it never exercises the step that turns applications.md into those
 * rows. That gap hid a column-map bug: loadTrackerRows() called
 * `resolveColumns(headerLine)` with a single string, but resolveColumns()
 * takes the LINE ARRAY and finds the header itself. detectColumns() iterated
 * the string character by character, matched no header, and fell back to
 * LEGACY_COLMAP — the 9-column order with no Via column.
 *
 * On a tracker carrying the optional Via column (#1596), which sits between
 * Company and Role, every field from `role` onward then reads one column to
 * the left: `status` reads the score cell ("4.5/5"), no canonical status
 * matches, and every row drops out of the population. The failure is silent —
 * the report renders "0 resolved / 0 in-flight" and an "insufficient data"
 * verdict rather than an error, so a user reads it as "not enough history yet"
 * on a tracker full of recorded outcomes.
 *
 * Every other resolveColumns() caller in the repo passes `lines`.
 *
 * Run: node tests/calibrate-tracker-colmap.test.mjs
 */

import { loadTrackerRows } from '../calibrate.mjs';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail } from './helpers.mjs';

console.log('\ncalibrate.mjs — tracker column mapping');

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

const dir = mkdtempSync(join(tmpdir(), 'calibrate-colmap-'));

// A tracker WITH the Via column, in its documented position: between Company
// and Role (see AGENTS.md, "Optional Via field").
const withVia = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-02 | Acme | Hays | Backend Dev | 4.5/5 | Applied | ✅ | [1](reports/1.md) | note |
| 2 | 2026-01-03 | Globex | — | Eng Lead | 2.2/5 | Rejected | ❌ | [2](reports/2.md) | note |
`;
const viaFile = join(dir, 'applications-via.md');
writeFileSync(viaFile, withVia, 'utf-8');
const viaRows = loadTrackerRows(viaFile);

ok('Via tracker: both rows load', viaRows.length === 2);
ok('Via tracker: status reads the Status column, not the score cell',
  viaRows[0].status === 'Applied' && viaRows[1].status === 'Rejected');
ok('Via tracker: score reads the Score column',
  viaRows[0].score === 4.5 && viaRows[1].score === 2.2);
ok('Via tracker: company is not shifted into Via',
  viaRows[0].company === 'Acme' && viaRows[1].company === 'Globex');

// The legacy 9-column tracker (no Via) must keep loading identically.
const legacy = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-02 | Acme | Backend Dev | 4.5/5 | Applied | ✅ | [1](reports/1.md) | note |
`;
const legacyFile = join(dir, 'applications-legacy.md');
writeFileSync(legacyFile, legacy, 'utf-8');
const legacyRows = loadTrackerRows(legacyFile);

ok('legacy tracker: row loads', legacyRows.length === 1);
ok('legacy tracker: status still correct', legacyRows[0].status === 'Applied');
ok('legacy tracker: score still correct', legacyRows[0].score === 4.5);
ok('legacy tracker: company still correct', legacyRows[0].company === 'Acme');
