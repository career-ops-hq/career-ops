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
import { parseBatchArgs } from '../batch-evaluate-gemini.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'co-batch-flags-'));
after(() => rmSync(work, { recursive: true, force: true, maxRetries: 10 }));

test('value flags read the same with a space or an equals sign', () => {
  const spaced = parseBatchArgs(['--limit', '1', '--concurrency', '3', '--model', 'gemini-2.5-pro']);
  const joined = parseBatchArgs(['--limit=1', '--concurrency=3', '--model=gemini-2.5-pro']);
  assert.deepEqual(spaced, { limit: 1, concurrency: 3, model: 'gemini-2.5-pro' });
  assert.deepEqual(joined, spaced);
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

for (const args of [['--limt', '1'], ['--limit', 'all'], ['--limit', '0'], ['--concurrency', 'two']]) {
  test(`${args.join(' ')} is a usage error, not a full run`, () => {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout + r.stderr, /GEMINI_API_KEY|pending offers/);
  });
}
