// A stop mid-sweep, mid-retry, and after the totals fold must agree with
// the checkpoint. Retired boards and retry errors are counted once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldSourceScan, stoppedScanCounts } from '../scan-ats-full.mjs';

test('a sweep stop removes the unfinished tail and the retired boards', () => {
  assert.deepEqual(stoppedScanCounts({
    phase: 'sweep',
    totalCompaniesScanned: 100,
    totalErrors: 1,
    entries: 100,
    lastDone: 40,
    deadBoardsSkipped: 5,
    errors: 2,
  }), { totalCompaniesScanned: 35, totalErrors: 3 });
});

test('a retry stop does not subtract retired boards again and keeps retry errors', () => {
  assert.deepEqual(stoppedScanCounts({
    phase: 'retry',
    totalCompaniesScanned: 95,
    totalErrors: 1,
    entries: 100,
    lastDone: 100,
    deadBoardsSkipped: 5,
    errors: 4,
  }), { totalCompaniesScanned: 95, totalErrors: 5 });
});

test('an outage drops the unattempted tail before the phase folds', () => {
  const folded = foldSourceScan({
    totalCompaniesScanned: 100,
    entries: 100,
    lastDone: 40,
    resolverOutage: true,
  });
  assert.deepEqual(folded, { totalCompaniesScanned: 40, phase: 'folded' });
  assert.deepEqual(stoppedScanCounts({
    phase: folded.phase,
    totalCompaniesScanned: folded.totalCompaniesScanned,
    totalErrors: 1,
    entries: 100,
    lastDone: 40,
    deadBoardsSkipped: 5,
    errors: 2,
  }), { totalCompaniesScanned: 40, totalErrors: 1 });
});

test('a finished source folds the total it already has', () => {
  assert.deepEqual(foldSourceScan({
    totalCompaniesScanned: 95,
    entries: 100,
    lastDone: 100,
    resolverOutage: false,
  }), { totalCompaniesScanned: 95, phase: 'folded' });
});

test('a folded stop reports the totals as they stand', () => {
  assert.deepEqual(stoppedScanCounts({
    phase: 'folded',
    totalCompaniesScanned: 95,
    totalErrors: 5,
    entries: 100,
    lastDone: 40,
    deadBoardsSkipped: 5,
    errors: 4,
  }), { totalCompaniesScanned: 95, totalErrors: 5 });
});
