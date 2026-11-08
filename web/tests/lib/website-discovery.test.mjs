import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runWebsiteDiscovery } from '../../src/lib/core/website-discovery.mjs';
import { addMonitor, monitorFile } from '../../../portal-monitor.mjs';

test('website discovery invokes the real core reader in a child without writing user data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'website-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const job = { title: 'AI student', company: 'Fixture', url: 'https://example.com/job/preview' };
  const source = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', autoMonitor: false },
    { provider: { id: 'greenhouse', fetch: async () => [job] } });
  const before = fs.readFileSync(monitorFile(root), 'utf8');
  const payload = { jobs: [{ id: 1, title: 'AI student fixture',
    absolute_url: 'https://employer.example/jobs/1', location: { name: 'London' } }] };
  const preload = path.join(root, 'http-fixture.mjs');
  fs.writeFileSync(preload, `globalThis.fetch = async url => { if (!String(url).startsWith('https://boards-api.greenhouse.io/v1/boards/fixture-primary/jobs?')) throw new Error('Unexpected fixture request'); return Response.json(${JSON.stringify(payload)}); };`);
  const keys = ['NODE_OPTIONS', 'CAREER_OPS_ROOT', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_TRACKER', 'CAREER_OPS_SCAN_HISTORY'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of keys) old[k] === undefined ? delete process.env[k] : process.env[k] = old[k]; });
  Object.assign(process.env, { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, CAREER_OPS_ROOT: root,
    CAREER_OPS_PIPELINE: path.join(root, 'data/pipeline.md'), CAREER_OPS_TRACKER: path.join(root, 'data/applications.md'),
    CAREER_OPS_SCAN_HISTORY: path.join(root, 'data/scan-history.tsv') });
  const core = fileURLToPath(new URL('../../../portal-monitor.mjs', import.meta.url));
  const result = await runWebsiteDiscovery(core, root, { websiteIds: [source.id], positive: ['AI'], sinceDays: 7 });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].title, 'AI student fixture');
  assert.equal(result.offers[0].postedAt, undefined);
  assert.equal(result.unknownDates, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(fs.readFileSync(monitorFile(root), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'data/pipeline.md')), false);
});

test('a stuck website reader is stopped and reported as incomplete', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'website-discovery-timeout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'stuck.mjs');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  await assert.rejects(runWebsiteDiscovery(script, root, {}, { timeoutMs: 100 }), /timed out/);
});

test('cancelling discovery closes its child before releasing the workspace', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'website-discovery-cancel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'stuck.mjs');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  const controller = new AbortController();
  const run = runWebsiteDiscovery(script, root, {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(run, { name: 'AbortError' });
  fs.rmSync(root, { recursive: true });
});
