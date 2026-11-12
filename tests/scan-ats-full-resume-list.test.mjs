// A Workable checkpoint must not be judged against a company-list download.
// The feed restarts, so both resume modes leave the checkpoint alone here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkpointComparesCompanyList } from '../scan-ats-full.mjs';

const workableCheckpoint = {
  current: { name: 'workable', datasetLen: 40, datasetHash: null },
};

test('a restarting source skips the company-list check before either resume mode', () => {
  const sources = { workable: { restartOnResume: true } };
  assert.equal(checkpointComparesCompanyList(workableCheckpoint, sources), false);
});

test('a directory source still compares its list', () => {
  const sources = { greenhouse: { restartOnResume: false } };
  const checkpoint = { current: { name: 'greenhouse', datasetLen: 8 } };
  assert.equal(checkpointComparesCompanyList(checkpoint, sources), true);
  assert.equal(checkpointComparesCompanyList({ current: { name: 'missing' } }, sources), false);
  assert.equal(checkpointComparesCompanyList(null, sources), false);
});
