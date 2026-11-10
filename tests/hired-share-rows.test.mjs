// tests/hired-share-rows.test.mjs — hiredRows() must select rows the way the
// rest of the tooling identifies them: the canonical report parser and an
// exact canonical state, never a first-digit-run and a substring.
//
// The old code took the FIRST run of digits anywhere in the Report cell, so a
// bare `reports/012-acme.md` answered to `--report 12` as "not found" (it
// extracted `012`), and matched status with `/hired/i`, so any future state
// containing "hired" (NotHired, PreHired) counted as a landed job. Both live
// in hiredRows(); both are pinned here against the exported function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiredRows } from '../hired-share.mjs';

const HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;
const row = (cells) => `| ${cells.join(' | ')} |`;

test('a padded report link resolves to its unpadded number', () => {
  const rows = hiredRows(HEADER + row(['42', '2026-01-01', 'Acme', 'Eng', '4.0/5', 'Hired', '✅', '[012](reports/012-acme.md)', '']) + '\n');
  assert.equal(rows.length, 1, 'the Hired row must be selected');
  assert.equal(rows[0].report, '12', 'the report number is the parsed target, not a digit grab');
});

test('a bare report path resolves like the canonical parser does', () => {
  const rows = hiredRows(HEADER + row(['43', '2026-01-01', 'Beta', 'Eng', '4.0/5', 'Hired', '✅', 'reports/007-beta.md', '']) + '\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].report, '7', 'zero padding must not survive into the id');
});

test('a status merely containing "hired" is not a hire', () => {
  const text = HEADER
    + row(['44', '2026-01-01', 'Gamma', 'Eng', '4.0/5', 'NotHired', '✅', '[9](reports/9-gamma.md)', '']) + '\n'
    + row(['45', '2026-01-01', 'Delta', 'Eng', '4.0/5', 'PreHired', '✅', '[10](reports/10-delta.md)', '']) + '\n';
  assert.deepEqual(hiredRows(text), [], 'only the canonical hired state counts');
});

test('case and bold variants of the canonical state still count', () => {
  const text = HEADER
    + row(['46', '2026-01-01', 'Eps', 'Eng', '4.0/5', 'hired', '✅', '[11](reports/11-eps.md)', '']) + '\n'
    + row(['47', '2026-01-01', 'Zeta', 'Eng', '4.0/5', '**Hired**', '✅', '[13](reports/13-zeta.md)', '']) + '\n';
  const rows = hiredRows(text);
  assert.deepEqual(rows.map((r) => r.report), ['11', '13'], 'canonical spellings resolve; near-misses do not');
});

test('a report link outside the file-naming convention still resolves', () => {
  const rows = hiredRows(HEADER + row(['48', '2026-01-01', 'Eta', 'Eng', '4.0/5', 'Hired', '✅', '[12](reports/12.md)', '']) + '\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].report, '12', 'a local report link keeps its number whatever the file is called');
});

test('a third-party URL in the Report cell is not a report number', () => {
  const rows = hiredRows(HEADER + row(['49', '2026-01-01', 'Theta', 'Eng', '4.0/5', 'Hired', '✅', '[13](https://boards.example.com/jobs/13)', '']) + '\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].report, '', 'another site\'s posting id is not one of ours');
});

test('a report link in Notes is used when the Report cell is empty', () => {
  const text = HEADER
    + row(['50', '2026-01-01', 'Iota', 'Eng', '4.0/5', 'Hired', '✅', '', 'see [14](reports/14-iota.md)']) + '\n'
    + row(['51', '2026-01-01', 'Kappa', 'Eng', '4.0/5', 'Hired', '❌', '—', 'no report here']) + '\n';
  const rows = hiredRows(text);
  assert.deepEqual(rows.map((r) => r.report), ['14', ''], 'the Notes link resolves; a row without a report stays empty');
});
