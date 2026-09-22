import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeTilesWithHistory } from '../../src/lib/funnel-tiles.mjs';

test('terminal states retain distinct ledger achievements, never orphan rows', () => {
  const apps = [{n:'1',status:'REJECTED'}, {n:'2',status:'DISCARDED'}, {n:'3',status:'REJECTED'}];
  const log = '1\t2026-09-01\tInterview\tRejected\n2\t2026-09-01\tOffer\tDiscarded\n1\t2026-09-01\tInterview\tRejected\n99\t2026-09-01\tOffer\tHired\n3junk\t2026-09-01\tOffer\tHired\n3\t\tOffer\tHired';
  assert.deepEqual(cumulativeTilesWithHistory(apps, log), {interviews:2,offers:1});
  assert.deepEqual(cumulativeTilesWithHistory(apps, null), {interviews:0,offers:0});
});

test('backfill IDs do not share history and snapshots include hired', () => {
  assert.deepEqual(cumulativeTilesWithHistory([{n:'N/A',status:'HIRED'}, {n:'N/A',status:'INTERVIEW'}], ''), {interviews:2,offers:1});
});
