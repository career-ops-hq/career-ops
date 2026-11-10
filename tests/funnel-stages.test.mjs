import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funnelStageRank, parseStatusLogStages, recoverFunnelStages } from '../funnel-stages.mjs';

test('stage rank treats a rejection as a reply and normalizes canonical case', () => {
  assert.equal(funnelStageRank(' rejected '), 2);
  assert.equal(funnelStageRank('OFFER'), 5);
  assert.equal(funnelStageRank('ASSESSMENT'), 3);
  assert.equal(funnelStageRank('constructor'), 0);
  assert.equal(funnelStageRank('Discarded'), 0);
});
test('history recovery ignores malformed and orphan rows and retains highest stage once', () => {
  const ledger = parseStatusLogStages('1\t2026-09-01\toffer\tdiscarded\r\n1\t2026-09-02\tApplied\tRejected\n2\t2026-09-01\tOffer\tHired\n1junk\t2026-09-01\tOffer\tHired\n1\t\tOffer\tHired');
  assert.equal(ledger.length, 3);
  assert.deepEqual([...recoverFunnelStages(new Map([[1,'Discarded']]), ledger)], [[1,5]]);
});

test('current SKIP rows remain outside the funnel despite prior stages', () => {
  const statuses = new Map([[1, 'SKIP'], [2, ' skip '], [3, 'Rejected']]);
  const ledger = parseStatusLogStages([
    '1\t2026-09-01\tInterview\tSKIP',
    '2\t2026-09-01\tOffer\tSKIP',
    '3\t2026-09-01\tInterview\tRejected',
  ].join('\n'));
  assert.deepEqual([...recoverFunnelStages(statuses, ledger)], [[3, 4]]);
  assert.deepEqual([...recoverFunnelStages(statuses, [])], [[3, 2]]);
});

test('Assessment recovery proves a reply but never an interview', () => {
  const statuses = new Map([[1, 'Assessment'], [2, 'Discarded']]);
  const ledger = parseStatusLogStages('2\t2026-10-01\tAssessment\tDiscarded');
  assert.deepEqual([...recoverFunnelStages(statuses, ledger)], [[1, 3], [2, 3]]);
});

test('a retracted transition proves no stage, and neither does the revert that follows it', () => {
  const statuses = new Map([[1, 'Applied'], [2, 'Rejected']]);
  const ledger = parseStatusLogStages([
    '1\t2026-10-01\tEvaluated\tApplied\tset-status\t',
    '1\t2026-10-02\tApplied\tOffer\tset-status\t',
    '1\t2026-10-02\t-\t-\tmanual\tmis-click',
    '1\t2026-10-02\tOffer\tApplied\tset-status\t',
    '2\t2026-10-01\tApplied\tInterview\tset-status\t',
    '2\t2026-10-05\tInterview\tRejected\tset-status\t',
  ].join('\n'));
  assert.deepEqual([...recoverFunnelStages(statuses, ledger)], [[1, 1], [2, 4]]);
});

test('the revert after a retraction proves nothing when it spells the stage in another case', () => {
  const ledger = parseStatusLogStages([
    '1\t2026-10-01\tEvaluated\tApplied\tset-status\t',
    '1\t2026-10-02\tApplied\tOffer\tset-status\t',
    '1\t2026-10-02\t-\t-\tmanual\tmis-click',
    '1\t2026-10-02\toffer\tApplied\tmanual\t',
  ].join('\n'));
  assert.deepEqual([...recoverFunnelStages(new Map([[1, 'Applied']]), ledger)], [[1, 1]]);
});

test('a retraction after a date correction removes the corrected stage', () => {
  const ledger = parseStatusLogStages([
    '1\t2026-10-01\tEvaluated\tApplied\tset-status\t',
    '1\t2026-10-05\tApplied\tInterview\tset-status\t',
    '1\t2026-10-04\tApplied\tInterview\tcorrection\twrong day',
    '1\t2026-10-06\t-\t-\tmanual\tnever happened',
  ].join('\n'));
  assert.deepEqual([...recoverFunnelStages(new Map([[1, 'Applied']]), ledger)], [[1, 1]]);
});
