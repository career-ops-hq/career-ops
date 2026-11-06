// tests/scan-seek-review.test.mjs — scan-seek write order, --limit validation,
// blacklist URL, body-read failure.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseLimit, fetchQuery } from '../scan-seek.mjs';
import { makeJobClassifier } from '../scan-local-lib.mjs';

const ok = async (name, fn) => { try { await fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

console.log('\nscan-seek — review fixes');

await ok('parseLimit: absent is Infinity, valid is read in both spellings', () => {
  assert.strictEqual(parseLimit([]), Infinity);
  assert.strictEqual(parseLimit(['--limit', '3']), 3);
  assert.strictEqual(parseLimit(['--limit=4']), 4);
});

for (const a of [['--limit', 'abc'], ['--limit', '0'], ['--limit', '-1'], ['--limit', '2.5'], ['--limit'], ['--limit=']]) {
  await ok(`parseLimit rejects ${a.join(' ')}`, () => {
    assert.throws(() => parseLimit(a), /--limit expects a positive whole number/);
  });
}

await ok('CLI refuses an invalid --limit before reading data or fetching', () => {
  const root = mkdtempSync(join(tmpdir(), 'seek-limit-'));
  try {
    const r = spawnSync(NODE, [join(ROOT, 'scan-seek.mjs'), '--limit', 'abc'], {
      cwd: root, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    assert.strictEqual(r.status, 1, `exit ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /--limit expects a positive whole number/);
    assert.ok(!/Running \d+ of/.test(r.stdout), 'scan started');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await ok('a response-body read failure is a query error, not a crash', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => { throw new Error('socket hang up'); } });
  try {
    const r = await fetchQuery('devops', 'in-Auckland');
    assert.match(r.error, /^network: socket hang up/);
    assert.strictEqual(r.rateLimited, false);
    assert.deepStrictEqual(r.jobs, []);
  } finally {
    globalThis.fetch = real;
  }
});

const index = { tracker: new Map(), seen: new Set(), employerRows: () => [] };
const job = { company: 'Acme', title: 'Platform Engineer', url: 'https://nz.seek.com/job/1', location: 'Auckland', workTypes: 'Full-time', salary: '' };

await ok('classifier passes the listing URL to the blacklist callback', () => {
  const calls = [];
  const c = makeJobClassifier({ index, isBlacklisted: (co, url) => { calls.push([co, url]); return false; } });
  c(job);
  assert.deepStrictEqual(calls, [['Acme', 'https://nz.seek.com/job/1']]);
});

await ok('a kept role stays unseen until commit()', () => {
  const c = makeJobClassifier({ index, isBlacklisted: () => false });
  assert.strictEqual(c(job).verdict, 'keep');
  assert.strictEqual(c(job).verdict, 'keep');
  c.commit(job);
  assert.strictEqual(c(job).verdict, 'repost');
});

await ok('scan-seek writes pipeline, then history, then commits', () => {
  const src = readFileSync(join(ROOT, 'scan-seek.mjs'), 'utf8');
  const p = src.indexOf('await appendToPipeline(toAdd)');
  const h = src.indexOf('await appendToScanHistory(toAdd');
  const c = src.indexOf('classifier.commit(j)');
  assert.ok(p > 0 && p < h && h < c, `order ${p} ${h} ${c}`);
});
