import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldDedupScanHistoryRow } from '../scan.mjs';

test('a no-apply-control result does not permanently deduplicate an uncertain posting', () => {
  const row = { firstSeen: '2025-09-01', status: 'skipped_no_apply_control' };

  assert.equal(
    shouldDedupScanHistoryRow(row, { recheckAfterDays: 30, today: '2026-10-06' }),
    false,
  );
});
