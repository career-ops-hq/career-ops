// The company scan runs under two limits: one for the whole scan and one per
// hostname. Both come from env values and default to 10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_URL = pathToFileURL(join(ROOT, 'scan.mjs')).href;
const {
  parallelFetch,
  companyFetchHost,
  resolveConcurrency,
  DEFAULT_CONCURRENCY,
  VERIFY_CONCURRENCY,
} = await import(SCAN_URL);

test('both scan limits default to 10 and verify has its own limit of 10', () => {
  assert.equal(DEFAULT_CONCURRENCY, 10);
  assert.equal(resolveConcurrency(undefined), 10);
  assert.equal(VERIFY_CONCURRENCY, 10);
});

test('resolveConcurrency accepts only a positive integer', () => {
  assert.equal(resolveConcurrency('7'), 7);
  assert.equal(resolveConcurrency(' 32 '), 32);
  for (const bad of [undefined, null, '', '  ', '0', '-1', '2.5', 'abc', 'Infinity']) {
    assert.equal(resolveConcurrency(bad), DEFAULT_CONCURRENCY, `value: ${JSON.stringify(bad)}`);
  }
});

test('the env values reach the limits the scan uses', () => {
  const child = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `const m = await import(${JSON.stringify(SCAN_URL)}); console.log(m.SCAN_CONCURRENCY, m.HOST_CONCURRENCY, m.VERIFY_CONCURRENCY);`,
  ], {
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_SCAN_CONCURRENCY: '32', CAREER_OPS_SCAN_HOST_CONCURRENCY: '4' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), '32 4 10');
});

test('a full host does not block the other host', async () => {
  const names = [...Array(6).fill('alpha.example'), ...Array(6).fill('beta.example')];
  const inflight = new Map();
  const peak = new Map();
  let global = 0;
  let globalPeak = 0;
  const tasks = names.map((host) => async () => {
    inflight.set(host, (inflight.get(host) || 0) + 1);
    peak.set(host, Math.max(peak.get(host) || 0, inflight.get(host)));
    global += 1;
    globalPeak = Math.max(globalPeak, global);
    await new Promise((resolve) => setTimeout(resolve, 60));
    inflight.set(host, inflight.get(host) - 1);
    global -= 1;
    return host;
  });
  await parallelFetch(tasks, 12, () => {}, {
    hostOf: (_task, index) => names[index],
    hostLimit: 3,
  });
  assert.ok(peak.get('alpha.example') <= 3, `alpha peak ${peak.get('alpha.example')}`);
  assert.ok(peak.get('beta.example') <= 3, `beta peak ${peak.get('beta.example')}`);
  assert.equal(peak.get('alpha.example'), 3);
  assert.equal(peak.get('beta.example'), 3);
  // Both hosts in flight together. A pool that finishes one host first peaks at 3.
  assert.ok(globalPeak >= 5, `global peak ${globalPeak}`);
  assert.ok(globalPeak <= 6, `global peak ${globalPeak}`);
});

test('an empty host is not forced into one shared bucket', async () => {
  let current = 0;
  let peak = 0;
  const tasks = Array.from({ length: 8 }, () => async () => {
    current += 1;
    peak = Math.max(peak, current);
    await new Promise((resolve) => setTimeout(resolve, 40));
    current -= 1;
  });
  await parallelFetch(tasks, 4, () => {}, { hostOf: () => '', hostLimit: 1 });
  assert.equal(peak, 4);
});

test('a thrown task releases its slot and the rest still run', async () => {
  let ran = 0;
  const tasks = [
    async () => { throw new Error('first boom'); },
    async () => { throw new Error('second boom'); },
    async () => { ran += 1; },
    async () => { ran += 1; },
  ];
  await assert.rejects(
    () => parallelFetch(tasks, 2, () => {}, { hostOf: () => 'h.example', hostLimit: 2 }),
    /first boom/,
  );
  assert.equal(ran, 2);
});

test('no host function keeps a plain worker pool', async () => {
  let current = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, () => async () => {
    current += 1;
    peak = Math.max(peak, current);
    await new Promise((resolve) => setTimeout(resolve, 30));
    current -= 1;
  });
  await parallelFetch(tasks, 6);
  assert.equal(peak, 6);
});

test('host is the detect URL hostname, and a missing URL is empty', () => {
  const detected = {
    api: 'https://api.example/other',
    careers_url: 'https://boards.example/careers',
    _provider: { detect: () => ({ url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs' }) },
  };
  assert.equal(companyFetchHost(detected), 'boards-api.greenhouse.io');
  assert.equal(companyFetchHost({ api: 'https://api.lever.co/v0/postings/acme' }), 'api.lever.co');
  assert.equal(companyFetchHost({}), '');
  assert.equal(companyFetchHost({ careers_url: 'not a url' }), '');
  assert.equal(companyFetchHost({ _provider: { detect() { throw new Error('bad'); } } }), '');
});

test('fetchHost names the host the provider calls, ahead of detect', async () => {
  const mixed = {
    api: 'https://api.example/other',
    careers_url: 'https://boards.example/careers',
    _provider: {
      fetchHost: () => 'API.Shared.example',
      detect: () => ({ url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs' }),
    },
  };
  assert.equal(companyFetchHost(mixed), 'api.shared.example');
  assert.equal(companyFetchHost({
    _provider: {
      fetchHost: () => '   ',
      detect: () => ({ url: 'https://api.lever.co/v0/postings/acme' }),
    },
  }), 'api.lever.co');

  const schoolspring = (await import(pathToFileURL(join(ROOT, 'providers/schoolspring.mjs')).href)).default;
  const getro = (await import(pathToFileURL(join(ROOT, 'providers/getro.mjs')).href)).default;
  const gupy = (await import(pathToFileURL(join(ROOT, 'providers/gupy.mjs')).href)).default;
  const district = (host) => ({
    name: host,
    careers_url: `https://${host}/`,
    _provider: schoolspring,
  });
  assert.equal(companyFetchHost(district('alpha.schoolspring.com')), 'api.schoolspring.com');
  assert.equal(companyFetchHost(district('beta.schoolspring.com')), 'api.schoolspring.com');
  const board = (url) => ({ name: url, careers_url: url, _provider: getro });
  assert.equal(companyFetchHost(board('https://jobs.one.vc/jobs')), 'api.getro.com');
  assert.equal(companyFetchHost(board('https://talent.two.example/jobs')), 'api.getro.com');
  assert.equal(companyFetchHost({
    name: 'Gupy',
    careers_url: 'https://employability-portal.gupy.io/job-search',
    _provider: gupy,
  }), 'portal.gupy.io');
  assert.equal(companyFetchHost({ name: 'Gupy', provider: 'gupy', _provider: gupy }), 'portal.gupy.io');
});
