// The morning scan used to run 10 companies at a time, no matter how many
// ATS hosts were in the list. One host still stays at 10. Other hosts can
// use the spare slots, up to 32 in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  parallelFetch,
  companyFetchHost,
  SCAN_CONCURRENCY,
  HOST_CONCURRENCY,
  VERIFY_CONCURRENCY,
} = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

test('scan fetches up to 32 companies and 10 per host', () => {
  assert.equal(SCAN_CONCURRENCY, 32);
  assert.equal(HOST_CONCURRENCY, 10);
  assert.equal(VERIFY_CONCURRENCY, 10);
  assert.ok(SCAN_CONCURRENCY > HOST_CONCURRENCY);
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
