import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueSeenCloseRefresh } from '../scan-ats-full.mjs';
import { alignCloseRefreshOffers } from '../scan.mjs';
import { selectCloseDateRefreshes } from '../lib/posting-close.mjs';
import { SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';

function historyRow(url, day) {
  const byName = Object.fromEntries(SCAN_HISTORY_COLUMNS.map((name) => [name, '']));
  Object.assign(byName, { url, closes_at: day, status: 'added', first_seen: '2026-10-01' });
  return SCAN_HISTORY_COLUMNS.map((name) => byName[name]).join('\t');
}

test('a seen full-scan offer keeps a new close day and drops its description', () => {
  const bucket = [];
  const job = {
    url: 'https://jobs.example/Acme',
    title: 'Analyst',
    closesAt: '2026-12-01',
    description: 'a long posting body',
  };
  queueSeenCloseRefresh(bucket, job, 'icims-full', false);
  assert.equal(bucket.length, 1);
  assert.equal(bucket[0].closesAt, '2026-12-01');
  assert.equal(bucket[0].source, 'icims-full');
  assert.equal(bucket[0].fingerprint, '');
  assert.equal(Object.hasOwn(bucket[0], 'description'), false);
  assert.equal(job.description, 'a long posting body');
});

test('a seen full-scan offer with no close day is not queued', () => {
  const bucket = [];
  queueSeenCloseRefresh(bucket, { url: 'https://jobs.example/Acme', description: 'body' }, 'icims-full', false);
  queueSeenCloseRefresh(bucket, { url: 'https://jobs.example/Acme', closesAt: '2026-12-01', description: 'body' }, 'icims-full', true);
  assert.deepEqual(bucket, []);
});

test('a full-scan refresh writes only a changed day for the stored URL', () => {
  const history = [
    historyRow('https://jobs.example/Acme', '2026-01-01'),
    historyRow('https://jobs.example/Other', '2026-02-02'),
  ].join('\n');
  const bucket = [];
  queueSeenCloseRefresh(bucket, { url: 'https://jobs.example/acme', closesAt: '2026-06-06', description: 'body' }, 'icims-full', false);
  queueSeenCloseRefresh(bucket, { url: 'https://jobs.example/Other', closesAt: '2026-02-02' }, 'icims-full', false);
  const selected = selectCloseDateRefreshes(alignCloseRefreshOffers(bucket, history), history);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].url, 'https://jobs.example/Acme');
  assert.equal(selected[0].closesAt, '2026-06-06');
});
