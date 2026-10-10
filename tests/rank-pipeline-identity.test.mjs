import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

const raw = '- [ ] https://example.test/job | Example | Engineer';
const rank = (score, reason) => `${raw} | rank: ${score}.0/5 — ${reason}`;

function runRanking(rows, results, current = null, limit = rows.length) {
  const root = mkdtempSync(join(tmpdir(), 'rank-identity-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'data', 'pipeline.md'), rows.join('\n'));
    const binary = join(root, 'bin', 'fixture-ranker');
    writeFileSync(binary, `#!${process.execPath}\n`
      + (current === null ? '' : `require('node:fs').writeFileSync(process.env.RANK_PIPELINE, ${JSON.stringify(current.join('\n'))});\n`)
      + `console.log(${JSON.stringify(JSON.stringify(results))});\n`);
    chmodSync(binary, 0o755);
    execFileSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--cli', 'fixture-ranker', '--limit', String(limit)], {
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        RANK_PIPELINE: join(root, 'data', 'pipeline.md'),
      },
    });
    return readFileSync(join(root, 'data', 'pipeline.md'), 'utf8').split('\n');
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const options = { skip: process.platform === 'win32' && 'POSIX executable fixture' };
test('out-of-order model IDs keep scores on their original duplicate occurrences', options, () => {
  assert.deepEqual(runRanking([raw, raw], [
    { id: 1, score: 3, reason: 'second' },
    { id: 0, score: 5, reason: 'first' },
  ]), [rank(5, 'first'), rank(3, 'second')]);
});
test('repeated IDs never consume another duplicate row', options, () => {
  assert.deepEqual(runRanking([raw, raw], [
    { id: 0, score: 5, reason: 'first' },
    { id: 0, score: 1, reason: 'repeat' },
    { id: 1, score: 3, reason: 'second' },
  ]), [rank(5, 'first'), rank(3, 'second')]);
});
test('a partial response for the second duplicate leaves the first unranked', options, () => {
  assert.deepEqual(runRanking([raw, raw], [{ id: 1, score: 3, reason: 'second' }]), [raw, rank(3, 'second')]);
});
test('unknown and malformed IDs leave all duplicate rows untouched', options, () => {
  assert.deepEqual(runRanking([raw, raw], [
    { id: 8, score: 4, reason: 'unknown' },
    { id: null, score: 4, reason: 'malformed' },
    { id: 0, score: null, reason: 'malformed' },
  ]), [raw, raw]);
});
test('duplicate identity remains global across batches', options, () => {
  const rows = Array(12).fill(raw);
  const expected = rows.map((_, i) => i === 0 || i === 10 ? rank(5, 'first') : i === 1 || i === 11 ? rank(3, 'second') : raw);
  assert.deepEqual(runRanking(rows, [
    { id: 1, score: 3, reason: 'second' },
    { id: 0, score: 5, reason: 'first' },
  ]), expected);
});
test('concurrent annotation does not slide a first-occurrence score onto the second', options, () => {
  assert.deepEqual(runRanking([raw, raw], [
    { id: 0, score: 5, reason: 'first' },
    { id: 1, score: 3, reason: 'second' },
  ], [rank(2, 'concurrent'), raw]), [rank(2, 'concurrent'), rank(3, 'second')]);
});
test('concurrent processing does not steal the processed occurrence score', options, () => {
  const processed = raw.replace('- [ ]', '- [x]');
  assert.deepEqual(runRanking([raw, raw], [
    { id: 0, score: 5, reason: 'first' },
    { id: 1, score: 3, reason: 'second' },
  ], [processed, raw]), [processed, rank(3, 'second')]);
});
test('a removed duplicate makes identity ambiguous and leaves the survivor untouched', options, () => {
  assert.deepEqual(runRanking([raw, raw], [{ id: 0, score: 5, reason: 'first' }], [raw]), [raw]);
});
test('an inserted duplicate cannot inherit a selected occurrence score', options, () => {
  assert.deepEqual(runRanking([raw, raw], [{ id: 0, score: 5, reason: 'first' }], [raw, raw, raw], 1), [raw, raw, raw]);
});
test('an inserted different row preserves the original scores', options, () => {
  const added = '- [ ] https://example.test/new | New | Engineer';
  assert.deepEqual(runRanking([raw, raw], [
    { id: 0, score: 5, reason: 'first' },
    { id: 1, score: 3, reason: 'second' },
  ], [added, raw, raw]), [added, rank(5, 'first'), rank(3, 'second')]);
});
