import { test } from 'node:test';
import assert from 'node:assert/strict';
import eightfold from '../providers/eightfold.mjs';
import { parallelFetch, companyFetchHost, SCAN_CONCURRENCY, HOST_CONCURRENCY } from '../scan.mjs';

test('Eightfold tenants share one vendor concurrency slot', async () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    name: `tenant-${index}`,
    careers_url: `https://tenant-${index}.eightfold.ai/careers`,
    _provider: eightfold,
  }));
  let current = 0;
  let peak = 0;
  const tasks = entries.map(() => async () => {
    current += 1;
    peak = Math.max(peak, current);
    await new Promise((resolve) => setTimeout(resolve, 40));
    current -= 1;
  });

  await parallelFetch(tasks, SCAN_CONCURRENCY, () => {}, {
    hostLimit: HOST_CONCURRENCY,
    hostOf: (_task, index) => companyFetchHost(entries[index]),
  });

  assert.ok(peak <= 1, `expected at most one Eightfold board in flight, got ${peak}`);
});
