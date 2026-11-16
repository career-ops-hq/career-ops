import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyScanPhase } from '../../src/lib/explore-error.mjs';

test('a completed zero-match website-only search is empty rather than reported as an outage', () => {
  const defaults = { capHit: false, datasetIssue: false, droppedNoDate: 0, companiesScanned: 0, websitesSearched: 0, broad: false };
  assert.equal(emptyScanPhase({ ...defaults, websitesSearched: 1 }), 'empty-loose');
  assert.equal(emptyScanPhase({ ...defaults, websitesSearched: 1, broad: true }), 'empty-current');
  assert.equal(emptyScanPhase(defaults), 'degraded');
  assert.equal(emptyScanPhase({ ...defaults, websitesSearched: 1, datasetIssue: true }), 'degraded');
  assert.equal(emptyScanPhase({ ...defaults, websitesSearched: 1, droppedNoDate: 3 }), 'degraded');
});
