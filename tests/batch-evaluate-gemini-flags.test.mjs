// tests/batch-evaluate-gemini-flags.test.mjs: batch-evaluate-gemini reads its
// flags in both forms and refuses the ones it does not know.
//
// The script looked only for `--limit=N`, `--concurrency=N` and `--model=NAME`
// and dropped every other argument. `--limit 1` therefore evaluated every
// pending offer in data/pipeline.md, and `--help` started the whole batch.
// Each evaluation spends Gemini quota.
//
// Run:  node --test tests/batch-evaluate-gemini-flags.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBatchArgs, parseCliMode, pendingOfferIndices } from '../batch-evaluate-gemini.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'co-batch-flags-'));
after(() => rmSync(work, { recursive: true, force: true, maxRetries: 10 }));

test('value flags read the same with a space or an equals sign', () => {
  const spaced = parseBatchArgs(['--limit', '1', '--concurrency', '3', '--model', 'gemini-2.5-pro']);
  const joined = parseBatchArgs(['--limit=1', '--concurrency=3', '--model=gemini-2.5-pro']);
  assert.deepEqual(spaced, { limit: 1, concurrency: 3, model: 'gemini-2.5-pro' });
  assert.deepEqual(joined, spaced);
});

test('--limit 1 selects one of two pending offers', () => {
  const pipeline = [
    '## Pending', '',
    '- [ ] https://jobs.example.test/a | Kestrelwood Analytics | Data Analyst',
    '- [ ] https://jobs.example.test/b | Pondmere Health | Analytics Engineer',
    '- [x] https://jobs.example.test/c | Larchfield Co | Analytics Manager',
  ];
  assert.deepEqual(pendingOfferIndices(pipeline, parseBatchArgs(['--limit', '1']).limit), [2]);
  assert.deepEqual(pendingOfferIndices(pipeline, parseBatchArgs([]).limit), [2, 3]);
});

test('no flags keep the defaults', () => {
  assert.deepEqual(parseBatchArgs([]), { limit: 0, concurrency: 2, model: undefined });
});

function run(args) {
  return spawnSync(process.execPath, [join(ROOT, 'batch-evaluate-gemini.mjs'), ...args], {
    cwd: work, encoding: 'utf-8', timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: work, CAREER_OPS_ROOT: work, GEMINI_API_KEY: '' },
  });
}

test('--help prints usage before it looks for an API key', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Usage:/m);
  assert.match(r.stdout, /--limit N/);
  assert.doesNotMatch(r.stderr, /GEMINI_API_KEY not found/);
});

for (const args of [['--limt', '1'], ['--limit=1', '--limit', 'all'], ['--limit', 'all'], ['--limit', '0'], ['--concurrency', 'two']]) {
  test(`${args.join(' ')} is a usage error, not a full run`, () => {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout + r.stderr, /GEMINI_API_KEY|pending offers/);
  });
}

test('a concurrency digit string that Number turns into Infinity is a usage error, not a full run', () => {
  const r = run(['--concurrency', '9'.repeat(400)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs a whole number above 0/);
  assert.doesNotMatch(r.stdout + r.stderr, /GEMINI_API_KEY|pending offers/);
});

test('--mode and --single-pass pass the flag check and pick the evaluation mode', () => {
  for (const args of [['--mode', 'match', '--limit', '1'], ['--mode=full', '--limit=1'], ['--single-pass', '--limit', '1']]) {
    assert.equal(parseBatchArgs(args).limit, 1, args.join(' '));
  }
  assert.equal(parseCliMode(['--mode', 'match']), 'match');
  assert.equal(parseCliMode(['--single-pass']), 'match');
  assert.equal(parseCliMode([]), 'full');
});

for (const args of [['--mode', 'match'], ['--single-pass']]) {
  test(`${args.join(' ')} reaches the API key check instead of a usage error`, () => {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /GEMINI_API_KEY not found/);
    assert.doesNotMatch(r.stderr, /Unknown|unknown flag|Usage:/);
  });
}
