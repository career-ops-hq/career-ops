/** Check the provider-only contract that Python discovery consumes. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from '../../adapters/node/providers/_collect.mjs';

const providers = new Map([
  ['fixture', { id: 'fixture', async fetch(target, context) {
    assert.equal(context.includeUndated, true);
    assert.equal(context.sinceMs, 123);
    const jobs = [{ title: 'Engineer', url: 'https://example.com/job', company: target.name }];
    jobs.workdayTruncated = true;
    return jobs;
  } }],
  ['capfixture', { id: 'capfixture', async fetch() {
    const jobs = [];
    jobs.collectionTruncated = true;
    return jobs;
  } }],
  ['gapfixture', { id: 'gapfixture', async fetch() {
    const jobs = [];
    jobs.collectionTruncated = true;
    jobs.collectionTruncationKind = 'coverage_gap';
    return jobs;
  } }],
  ['globalfixture', { id: 'globalfixture', async fetch(_target, context) {
    assert.equal(context.includeUndated, false);
    assert.equal(context.syntheticEntries, true);
    const jobs = [{ title: 'Engineer', url: 'https://example.com/global', company: 'Global' }];
    jobs.workdayNoDateSkip = true;
    jobs.icimsTruncated = true;
    return jobs;
  } }],
]);
const result = await collect({ since_ms: 123, targets: [
  { name: 'Acme', provider: 'fixture' },
  { name: 'Unknown', provider: 'missing' },
  { name: 'Unconfigured' },
  { name: '' },
  { name: 'Capped', provider: 'capfixture' },
  { name: 'Gap', provider: 'gapfixture' },
] }, providers);
assert.deepEqual(result.results.map(row => row.status), ['fetched', 'error', 'error', 'invalid', 'fetched', 'fetched']);
assert.equal(result.results[0].jobs[0].title, 'Engineer');
assert.ok(result.results[0].deadline_ms > Date.now());
assert.equal(result.results[0].truncated, true);
assert.equal(result.results[0].truncation_kind, 'network');
assert.equal(result.results[4].truncation_kind, 'page_cap');
assert.equal(result.results[5].truncation_kind, 'coverage_gap');
assert.equal(result.results[1].kind, 'configuration');
assert.match(result.results[2].error, /No provider matched/);
const global = await collect({ targets: [{ name: 'Global', provider: 'globalfixture' }],
  include_undated: false, synthetic_entries: true, concurrency: 1 }, providers);
assert.equal(global.results[0].no_date_skip, true);
assert.equal(global.results[0].capped, true);
const configured = await collect({ targets: [{ name: 'Configured', provider: 'fixture' }],
  since_ms: 123, mode: 'configured' }, providers);
assert.ok(configured.results[0].deadline_ms > Date.now() + 5 * 60_000);
await assert.rejects(collect({ targets: [], concurrency: 21 }, providers), /concurrency/);
await assert.rejects(collect({ targets: [], mode: 'unknown' }, providers), /mode/);

let releaseSlow;
const slowGate = new Promise(resolve => { releaseSlow = resolve; });
const orderedProviders = new Map([
  ['slow', { id: 'slow', async fetch() { await slowGate; return []; } }],
  ['fast', { id: 'fast', async fetch() { return []; } }],
]);
const progress = [];
const running = collect({ targets: [{ name: 'Slow', provider: 'slow' },
  { name: 'Fast', provider: 'fast' }], concurrency: 2 }, orderedProviders,
  (index) => progress.push(index));
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(progress, [1]);
releaseSlow();
assert.deepEqual((await running).results.map(row => row.status), ['fetched', 'fetched']);
assert.deepEqual(progress, [1, 0]);

const fallbackProviders = new Map([
  ['local-parser', { id: 'local-parser', detect: target => Boolean(target.parser),
    async fetch() { throw new Error('local parser unavailable'); } }],
  ['fixture', { id: 'fixture', detect: target => target.name === 'Fallback',
    async fetch() { return [{ title: 'Engineer', company: 'Fallback', url: 'https://example.com/fallback' }]; } }],
]);
const fallback = await collect({ targets: [{ name: 'Fallback', parser: { command: 'node', script: 'missing.mjs' } }] }, fallbackProviders);
assert.equal(fallback.results[0].status, 'fetched');
assert.equal(fallback.results[0].provider, 'fixture');
assert.match(fallback.results[0].warning, /local parser failed, used API fallback/);
assert.equal(fallback.results[0].jobs[0].url, 'https://example.com/fallback');

const directory = mkdtempSync(join(tmpdir(), 'career-ops-provider-collect-'));
try {
  const input = join(directory, 'input.json');
  const output = join(directory, 'output.json');
  writeFileSync(input, JSON.stringify({ targets: [{ name: 'Fixture Defense',
    careers_url: 'https://boards.example.com/fixture',
    parser: { command: 'node', script: 'tests/fixtures/three-city-board.mjs' } }] }));
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const run = spawnSync(process.execPath, [join(root, 'adapters/node/providers/_collect.mjs'), input, output],
    { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const fetched = JSON.parse(readFileSync(output, 'utf8')).results[0];
  assert.deepEqual(JSON.parse(readFileSync(`${output}.progress`, 'utf8').trim()), { index: 0, row: fetched });
  assert.equal(fetched.status, 'fetched');
  assert.equal(fetched.provider, 'local-parser');
  assert.ok(fetched.jobs.length > 0);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
