import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatusLogStages, recoverFunnelStages } from '../funnel-stages.mjs';

test('consecutive retractions keep every retracted stage out of the funnel', () => {
  const ledger = parseStatusLogStages([
    '1\t2026-10-01\tEvaluated\tApplied\tset-status\t',
    '1\t2026-10-02\tApplied\tInterview\tset-status\t',
    '1\t2026-10-02\t-\t-\tmanual\tmis-click one',
    '1\t2026-10-03\t-\t-\tmanual\tmis-click two',
    '1\t2026-10-03\tInterview\tApplied\tset-status\t',
  ].join('\n'));
  assert.deepEqual([...recoverFunnelStages(new Map([[1, 'Applied']]), ledger)], [[1, 1]]);
});
