// Failure-path writes for scan-runs.tsv (#2643): a run that dies after the
// sweep has started must leave a `failed` row carrying the counters
// accumulated so far, so stats.mjs trends can exclude it instead of never
// seeing it (survivorship bias). Dry runs and pre-sweep exits register no
// snapshot, so they keep leaving no trace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scan = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const stats = await import(pathToFileURL(join(ROOT, 'stats.mjs')).href);

const COUNTERS = {
  timestamp: '2026-08-09T10:00:00Z',
  companies: 40, boards: 2, found: 123,
  filteredTitle: 5, filteredTier: 0, filteredLocation: 1, filteredPostingAge: 0,
  filteredSalary: 0, filteredContent: 0, filteredCooldown: 0,
  dupes: 7, newAdded: 0, errors: 3,
  filteredBlacklist: 0, filteredVisa: 0, filteredPostedDate: 0,
  filteredCountryEligibility: 0,
};

test('writeRunFailureRow appends a failed row from the registered snapshot, once', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'scanruns-')), 'scan-runs.tsv');
  scan.registerRunFailureSnapshot(() => ({ ...COUNTERS }));
  assert.equal(scan.writeRunFailureRow('failed', file), true);

  const lines = readFileSync(file, 'utf-8').trim().split('\n');
  assert.equal(lines.length, 2, 'header + exactly one row');
  const header = lines[0].split('\t');
  const cols = lines[1].split('\t');
  const cell = (name) => cols[header.indexOf(name)];
  assert.equal(cell('status'), 'failed');
  assert.equal(cell('found'), '123');
  assert.equal(cell('new_added'), '0');
  assert.equal(cell('errors'), '3');

  // The snapshot is consumed: a second failure signal (e.g. SIGINT handler
  // followed by the fatal catch) must not double-write.
  assert.equal(scan.writeRunFailureRow('failed', file), false);
  assert.equal(readFileSync(file, 'utf-8').trim().split('\n').length, 2);
});

test('writeRunFailureRow is a no-op when no snapshot is registered', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'scanruns-')), 'scan-runs.tsv');
  assert.equal(scan.writeRunFailureRow('failed', file), false);
  assert.equal(existsSync(file), false, 'no file created for an unregistered run');
});

test('clearing the snapshot (success path) disarms the failure write', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'scanruns-')), 'scan-runs.tsv');
  scan.registerRunFailureSnapshot(() => ({ ...COUNTERS }));
  scan.registerRunFailureSnapshot(null);
  assert.equal(scan.writeRunFailureRow('failed', file), false);
  assert.equal(existsSync(file), false);
});

test('a throwing snapshot never masks the original failure', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'scanruns-')), 'scan-runs.tsv');
  scan.registerRunFailureSnapshot(() => { throw new Error('counters gone'); });
  assert.equal(scan.writeRunFailureRow('failed', file), false, 'best-effort: swallowed');
  assert.equal(existsSync(file), false);
});

test('computeRunStats excludes any non-completed status from averages, counts it in failedRuns', () => {
  const tsv = [
    'timestamp\tstatus\tcompanies\tboards\tfound\tfiltered_title\tdupes\tnew_added\terrors',
    '2026-08-01T09:00:00Z\tcompleted\t40\t2\t100\t10\t5\t8\t0',
    '2026-08-02T09:00:00Z\tfailed\t40\t2\t3\t0\t0\t0\t1',
    '2026-08-03T09:00:00Z\taborted\t40\t2\t7\t0\t0\t0\t0',
  ].join('\n') + '\n';
  const r = stats.computeRunStats(tsv);
  assert.equal(r.totalRuns, 3);
  assert.equal(r.failedRuns, 2, 'failed AND aborted both count as non-completed');
  assert.equal(r.avgFoundPerRun, 100, 'averages over completed rows only');
  assert.equal(r.avgNewPerRun, 8);
});
