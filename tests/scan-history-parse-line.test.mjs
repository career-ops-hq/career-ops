import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { parseScanHistoryLine, SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';
import { unescapeFormulaCell } from '../lib/tsv-formula-escape.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

ok('a full row maps each cell to its column name, in column order', () => {
  const cells = SCAN_HISTORY_COLUMNS.map((c) => `${c}-value`);
  const row = parseScanHistoryLine(cells.join('\t'));
  assert.deepStrictEqual(Object.keys(row), [...SCAN_HISTORY_COLUMNS]);
  assert.deepStrictEqual(Object.values(row), cells);
});

ok('a legacy six-cell row reads every later column as an empty string', () => {
  const row = parseScanHistoryLine('https://jobs.example.com/acme/1\t2026-09-01\tgreenhouse\tPlatform Engineer\tAcme\tadded');
  assert.strictEqual(row.status, 'added');
  for (const c of SCAN_HISTORY_COLUMNS.slice(6)) assert.strictEqual(row[c], '', c);
});

ok('a null or empty line reads as a row of empty cells', () => {
  for (const line of [null, undefined, '']) {
    assert.deepStrictEqual(parseScanHistoryLine(line), Object.fromEntries(SCAN_HISTORY_COLUMNS.map((c) => [c, ''])));
  }
});

ok('a formula-escaped cell loses exactly one apostrophe', () => {
  const row = parseScanHistoryLine(`u\td\tp\t'=Staff Engineer\t''+Acme\tadded\t'-Remote\t'@x`);
  assert.strictEqual(row.title, '=Staff Engineer');
  assert.strictEqual(row.company, "'+Acme");
  assert.strictEqual(row.location, '-Remote');
  assert.strictEqual(row.fingerprint, '@x');
});

ok('an apostrophe that is not a formula escape is kept', () => {
  for (const value of ["'plain", "'", "''", "it's", "'' ", "' =x"]) {
    assert.strictEqual(unescapeFormulaCell(value), value);
  }
});

ok('a non-string cell is read as its string form', () => {
  assert.strictEqual(unescapeFormulaCell(42), '42');
  assert.strictEqual(unescapeFormulaCell(null), '');
  assert.strictEqual(unescapeFormulaCell(undefined), '');
});
