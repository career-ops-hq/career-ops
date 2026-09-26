import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funnelStageRank, parseStatusLogStages, recoverFunnelStages } from '../funnel-stages.mjs';

test('stage rank treats a rejection as a reply and normalizes canonical case', () => {
  assert.equal(funnelStageRank(' rejected '), 2);
  assert.equal(funnelStageRank('OFFER'), 4);
  assert.equal(funnelStageRank('constructor'), 0);
  assert.equal(funnelStageRank('Discarded'), 0);
});
test('history recovery ignores malformed and orphan rows and retains highest stage once', () => {
  const ledger = parseStatusLogStages('1\t2026-09-01\toffer\tdiscarded\r\n1\t2026-09-02\tApplied\tRejected\n2\t2026-09-01\tOffer\tHired\n1junk\t2026-09-01\tOffer\tHired\n1\t\tOffer\tHired');
  assert.equal(ledger.length, 3);
  assert.deepEqual([...recoverFunnelStages(new Map([[1,'Discarded']]), ledger)], [[1,4]]);
});
