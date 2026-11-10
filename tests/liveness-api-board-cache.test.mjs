// tests/liveness-api-board-cache.test.mjs — Ashby's posting API is the whole
// board, so checking N postings on one board used to download that board N
// times in a row. checkLivenessViaApi takes a per-run `boardCache`, and
// check-liveness.mjs passes one.
//
// Run: node --test tests/liveness-api-board-cache.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkLivenessViaApi } from '../liveness-api.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LIVE = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const BOARD = { jobs: [{ id: LIVE, isListed: true }] };

async function withFetch(respond, run) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return respond(String(url), calls.length); };
  try { await run(); } finally { globalThis.fetch = previous; }
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('with a boardCache, postings on one Ashby board share one fetch', async () => {
  const boardCache = new Map();
  const results = [];
  const calls = await withFetch(() => json(BOARD), async () => {
    results.push(await checkLivenessViaApi(`https://jobs.ashbyhq.com/acme/${LIVE}`, { boardCache }));
    results.push(await checkLivenessViaApi(`https://jobs.ashbyhq.com/acme/${GONE}`, { boardCache }));
    results.push(await checkLivenessViaApi(`https://jobs.ashbyhq.com/acme/${LIVE}/application`, { boardCache }));
  });
  assert.equal(calls.length, 1, `expected one board fetch, got ${JSON.stringify(calls)}`);
  assert.deepEqual(results.map((r) => r?.code), ['ashby_api_ok', 'ashby_api_unlisted', 'ashby_api_ok']);
});

test('different boards are fetched separately', async () => {
  const boardCache = new Map();
  const calls = await withFetch(() => json(BOARD), async () => {
    await checkLivenessViaApi(`https://jobs.ashbyhq.com/acme/${LIVE}`, { boardCache });
    await checkLivenessViaApi(`https://jobs.ashbyhq.com/globex/${OTHER}`, { boardCache });
  });
  assert.equal(calls.length, 2);
});

test('without a boardCache every posting still fetches its board', async () => {
  const calls = await withFetch(() => json(BOARD), async () => {
    await checkLivenessViaApi(`https://jobs.ashbyhq.com/acme/${LIVE}`);
    await checkLivenessViaApi(`https://jobs.ashbyhq.com/acme/${GONE}`);
  });
  assert.equal(calls.length, 2);
});

test('a failed, unparseable or board-less 200 is not cached', async () => {
  const boardCache = new Map();
  const results = [];
  const calls = await withFetch(
    (_url, n) => (n === 1 ? new Response('rate limited', { status: 429 })
      : n === 2 ? new Response('{not json', { status: 200 })
      : n === 3 ? json({ error: 'not a board' })
      : json(BOARD)),
    async () => {
      for (let i = 0; i < 4; i++) results.push(await checkLivenessViaApi(`https://jobs.ashbyhq.com/acme/${LIVE}`, { boardCache }));
    },
  );
  assert.equal(calls.length, 4, 'each failure must leave the next posting free to retry');
  assert.deepEqual(results.map((r) => r?.code ?? null), [null, null, null, 'ashby_api_ok']);
  assert.equal(boardCache.size, 1, 'only the classifiable board is cached');
});

test('check-liveness fetches a shared Ashby board once per run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-liveness-board-cache-'));
  try {
    const countFile = join(dir, 'fetches.json');
    const preload = join(dir, 'mock-fetch.mjs');
    // Values reach the preload through the environment, never spliced into
    // its source.
    writeFileSync(preload, [
      "import { writeFileSync } from 'node:fs';",
      'const calls = [];',
      'const board = process.env.MOCK_ASHBY_BOARD;',
      'const countFile = process.env.MOCK_FETCH_LOG;',
      'globalThis.fetch = async (url) => {',
      '  calls.push(String(url));',
      "  return new Response(board, { status: 200, headers: { 'content-type': 'application/json' } });",
      '};',
      "process.on('exit', () => writeFileSync(countFile, JSON.stringify(calls)));",
    ].join('\n'));
    const out = execFileSync(process.execPath, [
      '--import', pathToFileURL(preload).href,
      join(ROOT, 'check-liveness.mjs'), '--no-record',
      `https://jobs.ashbyhq.com/acme/${LIVE}`,
      `https://jobs.ashbyhq.com/acme/${GONE}`,
      `https://jobs.ashbyhq.com/acme/${OTHER}`,
    ], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, MOCK_ASHBY_BOARD: JSON.stringify(BOARD), MOCK_FETCH_LOG: countFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    const calls = JSON.parse(readFileSync(countFile, 'utf-8'));
    assert.equal(calls.filter((u) => u.includes('posting-api/job-board/acme')).length, 1, `board fetched ${calls.length} times: ${out}`);
    assert.match(out, /active.*\(api\).*11111111/);
    assert.match(out, /expired.*\(api\).*22222222/);
  } catch (err) {
    // check-liveness exits non-zero when any URL is expired; the verdicts are
    // what this test reads, so keep its output.
    if (err.status === undefined || !err.stdout) throw err;
    const calls = JSON.parse(readFileSync(join(dir, 'fetches.json'), 'utf-8'));
    assert.equal(calls.filter((u) => u.includes('posting-api/job-board/acme')).length, 1, `board fetched ${calls.length} times: ${err.stdout}`);
    assert.match(err.stdout, /active.*\(api\).*11111111/);
    assert.match(err.stdout, /expired.*\(api\).*22222222/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
