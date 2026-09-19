import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync } from './helpers.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'batch-limit-'));
  const batch = join(root, 'batch');
  const bin = join(root, 'bin');
  mkdirSync(batch);
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'batch/batch-runner.sh'), join(batch, 'batch-runner.sh'));
  writeFileSync(join(batch, 'batch-prompt.md'), 'Test prompt');
  writeFileSync(join(batch, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/1\ttest\tfirst\n2\thttps://example.com/2\ttest\tsecond\n');
  // A real CLI must never run, even if a broken limit accidentally queues work.
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\necho unexpected-worker >&2\nexit 99\n', { mode: 0o755 });
  return { root, batch, run: args => spawnSync(getBash(), [join(batch, 'batch-runner.sh'), ...args], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: bin + delimiter + process.env.PATH },
  }) };
}

test('explicit zero and malformed limits fail before touching batch state or locks', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.batch, 'batch-runner.pid'), 'existing-lock\n');
    const before = readdirSync(f.batch).sort();
    for (const args of [
      ['--limit', '0'], ['--limit', '00'], ['--dry-run', '--limit', '0'],
      ['--limit', '-1'], ['--limit', 'oops'], ['--limit', '1.5'],
      ['--limit', ''], ['--limit'],
    ]) {
      const result = f.run(args);
      assert.ifError(result.error);
      assert.equal(result.status, 1, JSON.stringify(args));
      assert.match(result.stdout, /--limit must be a positive integer; omit --limit for no limit/);
      assert.deepEqual(readdirSync(f.batch).sort(), before);
      assert.equal(readFileSync(join(f.batch, 'batch-runner.pid'), 'utf8'), 'existing-lock\n');
      assert.doesNotMatch(result.stdout + result.stderr, /unexpected-worker/);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('omitting the limit retains all pending offers; positive limits cap the real queue', () => {
  const f = fixture();
  try {
    for (const [args, count] of [[[], 2], [['--limit', '1'], 1], [['--limit', '2'], 2]]) {
      const result = f.run(['--dry-run', '--model', 'test-model', ...args]);
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`Would process ${count} offers`));
      assert.match(result.stdout, /#1: https:\/\/example.com\/1/);
      if (count === 1) assert.doesNotMatch(result.stdout, /#2:/);
      else assert.match(result.stdout, /#2: https:\/\/example.com\/2/);
      assert.doesNotMatch(result.stdout + result.stderr, /unexpected-worker/);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
