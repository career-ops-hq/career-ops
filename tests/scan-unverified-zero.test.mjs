import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeHttpCtx } from '../providers/_http.mjs';
import { computeConsecutiveFailures, emptyTargetStatus } from '../scan.mjs';

function observedContext() {
  const observation = { requests: 0, successfulResponses: 0, lastStatus: null };
  const ctx = makeHttpCtx({
    onRequest: () => { observation.requests++; },
    onResponse: status => {
      observation.lastStatus = status;
      if (status >= 200 && status < 300) observation.successfulResponses++;
    },
  });
  return { ctx, observation };
}

test('parallel provider contexts distinguish a healthy empty board from a swallowed HTTP failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('/healthy')
    ? new Response('[]', { status: 200 })
    : new Response('unavailable', { status: 503 });
  try {
    const healthy = observedContext();
    const failed = observedContext();
    const responses = [];
    const [jobs, failure] = await Promise.all([
      healthy.ctx.fetchJson('https://example.com/healthy'),
      failed.ctx.fetchJson('https://example.com/failed', {
        onResponse: response => responses.push(response.status),
      }).catch(error => error),
    ]);
    assert.deepEqual(jobs, []);
    assert.equal(failure.status, 503);
    assert.deepEqual(responses, [503]);
    assert.deepEqual(healthy.observation, { requests: 1, successfulResponses: 1, lastStatus: 200 });
    assert.deepEqual(failed.observation, { requests: 1, successfulResponses: 0, lastStatus: 503 });
    assert.equal(emptyTargetStatus(healthy.observation), 'empty');
    assert.equal(emptyTargetStatus(failed.observation), 'unverified_zero');
    assert.equal(emptyTargetStatus(observedContext().observation), 'empty');
    assert.equal(computeConsecutiveFailures([
      { company: 'Failed', status: 'unverified_zero' },
      { company: 'Failed', status: 'unverified_zero' },
      { company: 'Healthy', status: 'empty' },
      { company: 'Failed', status: 'unverified_zero' },
    ]).get('Failed'), 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a transport failure before response is an unverified zero when the provider swallows it', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
  try {
    const { ctx, observation } = observedContext();
    await assert.rejects(ctx.fetchText('https://example.com/failed'), TypeError);
    assert.deepEqual(observation, { requests: 1, successfulResponses: 0, lastStatus: null });
    assert.equal(emptyTargetStatus(observation), 'unverified_zero');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scan records a swallowed first-page HTTP failure as unverified_zero', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-unverified-zero-'));
  try {
    mkdirSync(join(dataRoot, 'config'));
    writeFileSync(join(dataRoot, 'config', 'profile.yml'), '{}\n');
    writeFileSync(join(dataRoot, 'portals.yml'), [
      'tracked_companies:',
      '  - name: Failed Board',
      '    provider: builtin',
      'job_boards: []',
      '',
    ].join('\n'));
    const preload = join(dataRoot, 'stub-provider.mjs');
    writeFileSync(preload, [
      `import provider from ${JSON.stringify(new URL('../providers/builtin.mjs', import.meta.url).href)};`,
      `globalThis.fetch = async () => new Response('unavailable', { status: 503 });`,
      `provider.fetch = async (_entry, ctx) => {`,
      `  try { await ctx.fetchJson('https://builtin.com/jobs', { redirect: 'error' }); } catch {}`,
      `  return [];`,
      `};`,
    ].join('\n'));
    const result = spawnSync(process.execPath, [
      '--import', pathToFileURL(preload).href, fileURLToPath(new URL('../scan.mjs', import.meta.url)), '--json', '--quiet',
    ], {
      cwd: dataRoot,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_PORTALS: join(dataRoot, 'portals.yml') },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.errors, []);
    assert.deepEqual(receipt.unverified_zero, ['Failed Board']);
    const health = readFileSync(join(dataRoot, 'data', 'portal-health.tsv'), 'utf8');
    assert.match(health, /\tFailed Board\tunverified_zero(?:\r?\n|$)/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
