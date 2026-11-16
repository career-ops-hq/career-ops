import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addMonitor, addJobUrls, checkMonitor, fetchMonitorJobs, monitorAction, monitorFile, monitorSummary, normalizeMonitorInput, readMonitorStore, removeMonitor, runDueMonitors, updateMonitor } from '../portal-monitor.mjs';
import { appendToPipeline } from '../scan.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const job = n => ({ title: `AI student ${n}`, company: 'Fixture employer', location: 'London', url: `https://example.com/jobs/${n}` });
const options = { provider: { id: 'greenhouse', fetch: async () => [job(1)] } };

test('monitor input rejects LinkedIn search monitoring and malformed input without touching any configuration', () => {
  assert.throws(() => normalizeMonitorInput({ url: 'https://www.linkedin.com/jobs/search/?keywords=AI' }), /Add job URLs/);
  assert.throws(() => normalizeMonitorInput({ url: 'http://example.com' }), /HTTPS/);
  assert.throws(() => normalizeMonitorInput({ url: 'https://localhost/jobs' }), /public/);
  assert.throws(() => normalizeMonitorInput({ url: 'https://example.com', keywords: {} }), /keywords/);
  assert.deepEqual(normalizeMonitorInput({ url: 'https://example.com/?utm_source=test', keywords: 'AI, ML, AI' }).keywords, ['AI', 'ML']);
});

test('default first scan is a baseline, next due scan appends only newly found jobs and saves a notice', async t => {
  const root = fixture(t);
  const source = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', name: 'University jobs' }, options);
  const now = Date.now();
  let jobs = [job(1)];
  const fetchJobs = async () => ({ jobs, total: jobs.length });
  const baseline = await checkMonitor(root, source.id, { now, fetchJobs });
  assert.equal(baseline.baseline, true);
  assert.equal(baseline.added, 0);
  assert.equal(fs.existsSync(path.join(root, 'data/pipeline.md')), false);
  jobs = [job(1), job(2)];
  assert.equal((await runDueMonitors(root, { now: now + 1000, fetchJobs })).checked, 0);
  const result = await runDueMonitors(root, { now: now + 86400001, fetchJobs });
  assert.equal(result.added, 1);
  const pipeline = fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8');
  assert.match(pipeline, /jobs\/2/);
  assert.doesNotMatch(pipeline, /jobs\/1/);
  const summary = monitorSummary(root);
  assert.equal(summary.unreadCount, 1);
  assert.equal(summary.sources[0].totalAdded, 1);
  assert.equal(summary.sources[0].seenKeys, undefined);
  await monitorAction(root, 'read', { ids: summary.notices.map(n => n.id) });
  assert.equal(monitorSummary(root).unreadCount, 0);
});

test('explicit initial import, manual imports and concurrent appends deduplicate through the core pipeline lock', async t => {
  const root = fixture(t);
  const source = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', includeExisting: true }, options);
  const fetchJobs = async () => ({ jobs: [job(1), job(2)], total: 2 });
  assert.equal((await checkMonitor(root, source.id, { fetchJobs })).added, 2);
  assert.equal((await checkMonitor(root, source.id, { fetchJobs })).added, 0);
  const manual = await addJobUrls(root, { urls: 'https://www.linkedin.com/jobs/view/1234567890/?trk=foo\nhttps://www.linkedin.com/jobs/view/title-1234567890/' });
  assert.equal(manual.added, 1);
  const file = path.join(root, 'data/pipeline.md');
  await Promise.all([appendToPipeline([job(3)], { pipelinePath: file, deduplicate: true }), appendToPipeline([job(3)], { pipelinePath: file, deduplicate: true })]);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal((text.match(/jobs\/3 /g) || []).length, 1);
  assert.equal((text.match(/jobs\/view\/1234567890/g) || []).length, 1);
  await assert.rejects(addJobUrls(root, { urls: 'https://www.linkedin.com/jobs/search/' }), /individual LinkedIn/);
});

test('failed source does not checkpoint or block other due sources; pause, resume and remove preserve inbox data', async t => {
  const root = fixture(t);
  const source = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', includeExisting: true }, options);
  const other = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-secondary', includeExisting: true }, options);
  const now = Date.now();
  const results = await runDueMonitors(root, { now, fetchJobs: async s => { if (s.id === source.id) throw new Error('Fixture outage'); return { jobs: [job(2)], total: 1 }; } });
  assert.equal(results.added, 1);
  const failed = readMonitorStore(root).sources.find(s => s.id === source.id);
  assert.deepEqual(failed.seenKeys, []);
  assert.equal(failed.lastSuccess, undefined);
  assert.equal(Date.parse(failed.nextRunAt), now + 3600000);
  assert.match(failed.lastError, /Fixture outage/);
  await updateMonitor(root, other.id, { enabled: false });
  assert.equal((await runDueMonitors(root, { now: now + 86400001, fetchJobs: async () => ({ jobs: [], total: 0 }) })).checked, 1);
  await updateMonitor(root, other.id, { enabled: true, keywords: 'AI' });
  assert.equal(monitorSummary(root).sources.find(s => s.id === other.id).enabled, true);
  const before = fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8');
  await removeMonitor(root, other.id);
  assert.equal(fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8'), before);
});

test('malformed store is an error and survives an attempted mutation unchanged', async t => {
  const root = fixture(t);
  fs.mkdirSync(path.dirname(monitorFile(root)), { recursive: true });
  fs.writeFileSync(monitorFile(root), '{broken');
  assert.throws(() => readMonitorStore(root), /Could not read/);
  await assert.rejects(addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary' }, options));
  assert.equal(fs.readFileSync(monitorFile(root), 'utf8'), '{broken');
});

test('keywords filter titles through the core matcher and duplicate URLs within a feed are collapsed', async () => {
  const result = await fetchMonitorJobs(normalizeMonitorInput({ url: 'https://example.com', keywords: 'AI' }), {
    provider: { id: 'fixture', fetch: async () => [job(1), job(1), { ...job(2), title: 'Retail assistant' }] },
  });
  assert.equal(result.total, 2);
  assert.equal(result.jobs.length, 1);
});

test('OS worker checks monitored websites even with no broad scheduled scans configured', { skip: !fs.existsSync(new URL('../web/scripts/scheduled-jobs-runner.mjs', import.meta.url)) && 'web/ is not installed' }, async t => {
  const root = fixture(t);
  await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', includeExisting: true }, options);
  // Stub only the public HTTP boundary in this child process. Exercise the
  // actual OS entrypoint, provider registry, reader, store and pipeline writes.
  const payload = { jobs: [{ id: 1, title: 'AI student fixture',
    absolute_url: 'https://employer.example/jobs/1', location: { name: 'London' } }] };
  const loader = path.join(root, 'http-fixture.mjs');
  fs.writeFileSync(loader, `globalThis.fetch = async url => { if (!String(url).startsWith('https://boards-api.greenhouse.io/v1/boards/fixture-primary/jobs?')) throw new Error('Unexpected fixture network request'); return Response.json(${JSON.stringify(payload)}); };`);
  const codeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, path.join(codeRoot, 'web/scripts/scheduled-jobs-runner.mjs')], {
    cwd: codeRoot, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root,
      CAREER_OPS_SCHEDULED_JOBS_PATH: path.join(root, 'data/scheduled-jobs.json'),
      CAREER_OPS_PIPELINE: path.join(root, 'data/pipeline.md'), CAREER_OPS_TRACKER: path.join(root, 'data/applications.md'), CAREER_OPS_SCAN_HISTORY: path.join(root, 'data/scan-history.tsv') },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).monitors.added, 1);
  assert.match(fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8'), /AI student fixture/);
});
