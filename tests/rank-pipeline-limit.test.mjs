import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { selectBatch, LIMIT_CEILING } from '../rank-pipeline.mjs';

for (const args of [
  ...['0', '-1', 'nope', 'Infinity', '1.5', '1e2', '', '9007199254740992', ' 1', '1 '].map(limit => [`--limit=${limit}`]),
  ['--limit'],
  ['--limit', '--dry-run'],
  ['--limit', '--help'],
  ['--limit', '-h'],
]) {
  test(`an invalid limit ${JSON.stringify(args)} fails before calling the CLI`, t => {
    const root = mkdtempSync(join(tmpdir(), 'rank-limit-'));
    t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    mkdirSync(join(root, 'data'));
    const pipeline = join(root, 'data', 'pipeline.md');
    const original = Array.from({ length: 25 }, (_, i) => `- [ ] https://example.test/${i} | Example | Engineer`).join('\n');
    writeFileSync(pipeline, original);
    // Node is an offline CLI stand-in on every platform. If validation falls
    // through, its -p invocation fails on the rank prompt instead of spending tokens.
    const result = spawnSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--cli', process.execPath, ...args], {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root },
      encoding: 'utf8', timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, args[0] === '--limit' || args[0] === '--limit=' ? /--limit requires a value/ : /--limit must be a positive integer/);
    assert.doesNotMatch(result.stderr, /CLI call failed/);
    assert.equal(readFileSync(pipeline, 'utf8'), original);
  });
}

test('omitted limit keeps the default and valid limits keep the ceiling', () => {
  const entries = Array(400).fill({});
  assert.equal(selectBatch(entries, undefined).length, 20);
  assert.equal(selectBatch(entries, 1).length, 1);
  assert.equal(selectBatch(entries, 5000).length, LIMIT_CEILING);
});
