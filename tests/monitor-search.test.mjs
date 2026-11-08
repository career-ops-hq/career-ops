import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addMonitor, updateMonitor, readMonitorStore, monitorFile, searchMonitorSources, deliverMonitorSearch, runDueMonitors } from '../portal-monitor.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-search-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const now = Date.parse('2026-10-27T12:00:00Z');
const job = (id, fields = {}) => ({ title: 'AI student', company: 'Fixture employer', location: 'London',
  url: `https://example.com/jobs/${id}`, postedAt: now - 1000, ...fields });
const preview = { provider: { id: 'greenhouse', fetch: async () => [job('preview')] } };

test('Explore searches a saved website using its search filters and leaves monitor state untouched', async t => {
  const root = fixture(t);
  const source = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', keywords: ['Retail'] }, preview);
  const before = fs.readFileSync(monitorFile(root), 'utf8');
  let received;
  const result = await searchMonitorSources(root, [source.id], {
    positive: ['AI'], negative: ['senior'], allow: ['London'], sinceDays: 7,
  }, { now, fetchJobs: async s => { received = s; return { provider: 'greenhouse', jobs: [
    job('match'), job('wrong-title', { title: 'Retail' }), job('senior', { title: 'Senior AI engineer' }),
    job('wrong-location', { location: 'Paris' }), job('too-old', { postedAt: now - 8 * 86400000 }),
    job('unknown-date', { postedAt: undefined }),
  ] }; } });
  assert.deepEqual(received.keywords, [], 'the website’s daily-monitor filter must not invisibly narrow Explore');
  assert.equal(result.offers.length, 2);
  assert.equal(result.offers[0].sourceId, source.id);
  assert.equal(result.offers[0].sourceName, 'boards.greenhouse.io'.replace(/^www\./, ''));
  assert.equal(result.unknownDates, 1);
  assert.equal(result.offers[1].postedAt, undefined);
  assert.deepEqual(result.searched, [{ id: source.id, name: source.name, count: 2 }]);
  assert.deepEqual(result.failures, []);
  assert.equal(fs.readFileSync(monitorFile(root), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'data/pipeline.md')), false);
});

test('source failures, paused or removed sources and invalid IDs never masquerade as complete searches', async t => {
  const root = fixture(t);
  const first = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', autoMonitor: false }, preview);
  const second = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-secondary', autoMonitor: false }, preview);
  await updateMonitor(root, second.id, { enabled: false });
  const missing = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  let fetches = 0;
  const result = await searchMonitorSources(root, [first.id, second.id, missing], { sinceDays: 7 }, {
    now, fetchJobs: async () => { fetches++; throw new Error('fixture source outage'); },
  });
  assert.equal(fetches, 1);
  assert.equal(result.searched.length, 0);
  assert.equal(result.failures.length, 3);
  assert.match(result.failures[0].error, /outage/);
  assert.match(result.failures[1].error, /paused/);
  assert.match(result.failures[2].error, /no longer exists/);
  await assert.rejects(searchMonitorSources(root, ['https://evil.example'], {}), /saved websites/);
});

test('scheduled delivery deduplicates, records a notice and preserves the original monitor baseline', async t => {
  const root = fixture(t);
  const source = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', notifyDesktop: true }, preview);
  let notified = 0;
  const initial = readMonitorStore(root).sources[0].seenKeys;
  const offers = [job('new', { sourceId: source.id }), job('new', { sourceId: source.id })];
  assert.deepEqual(await deliverMonitorSearch(root, offers, { now, notify: async n => { notified += n; } }), { added: 1, failures: [] });
  const state = readMonitorStore(root);
  assert.deepEqual(state.sources[0].seenKeys, initial);
  assert.equal(state.notices[0].count, 1);
  assert.equal(notified, 1);
  assert.deepEqual(await deliverMonitorSearch(root, offers, { now }), { added: 0, failures: [] });
  await updateMonitor(root, source.id, { enabled: false });
  const paused = await deliverMonitorSearch(root, [job('later', { sourceId: source.id })], { now });
  assert.equal(paused.added, 0);
  assert.match(paused.failures[0].error, /paused/);
});

test('new passive sources do not create a separate daily monitor, while old source defaults keep theirs', async t => {
  const root = fixture(t);
  const passive = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-secondary', autoMonitor: false }, preview);
  const legacy = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary' }, preview);
  assert.equal(passive.autoMonitor, false);
  assert.equal(legacy.autoMonitor, true);
  const calls = [];
  const result = await runDueMonitors(root, { now: Date.now() + 1000, fetchJobs: async s => { calls.push(s.id); return { jobs: [], total: 0 }; } });
  assert.equal(result.checked, 1);
  assert.deepEqual(calls, [legacy.id]);
  assert.equal(readMonitorStore(root).sources.find(s => s.id === passive.id).lastSuccess, undefined);
});

test('scheduled baselines keep each source’s complete identity even when two sites list the same job', async t => {
  const root = fixture(t);
  const first = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', autoMonitor: false }, preview);
  const second = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-secondary', autoMonitor: false }, preview);
  const fetchJobs = async () => ({ provider: 'fixture', jobs: [job('shared', { postedAt: undefined })] });
  const regular = await searchMonitorSources(root, [first.id, second.id], { sinceDays: 7 }, { now, fetchJobs });
  assert.equal(regular.offers.length, 1);
  assert.equal(regular.unknownDates, 1);
  const scheduled = await searchMonitorSources(root, [first.id, second.id], { sinceDays: 7 }, {
    now, fetchJobs, excludeSeen: false, dedupeAcrossSources: false,
  });
  assert.deepEqual(scheduled.searched.map(s => s.count), [1, 1]);
  assert.deepEqual(scheduled.offers.map(o => o.sourceId), [first.id, second.id]);
  assert.equal(scheduled.unknownDates, 2);
});
