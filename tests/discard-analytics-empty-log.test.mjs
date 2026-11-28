// tests/discard-analytics-empty-log.test.mjs — an empty --log is a usage error,
// not the default log.
//
// `--log ""` (what a shell variable that expanded to nothing passes) was read
// as no --log at all, so the summary was built from data/discard.log rather
// than the log asked for, at exit 0. `--log=` was already refused.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'discard-analytics-empty-'));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
mkdirSync(join(root, 'data'));
writeFileSync(join(root, 'data', 'discard.log'), '2026-11-20T10:00:00Z\thttps://example.com/default-log-job\tdefault-log reason\n');
const batchLog = join(root, 'batch-discard.log');
writeFileSync(batchLog, '2026-11-21T10:00:00Z\t1\thttps://example.com/batch-job\tbelow-min-score\n');

function run(...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(process.execPath, [join(ROOT, 'discard-analytics.mjs'), ...args], { cwd: root, encoding: 'utf-8', env, timeout: 60_000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  return r;
}

test('an empty --log exits 1 instead of reading the default log', () => {
  for (const args of [['--log', ''], ['--log=']]) {
    const r = run(...args);
    assert.equal(r.status, 1, `${args.join(' ')}\n${describeSpawn(r)}`);
    assert.match(r.stderr, /--log requires a value/);
    assert.doesNotMatch(r.stdout, /default-log/);
  }
});

test('control: a named --log, and no --log, read their own logs', () => {
  const named = run('--log', batchLog);
  assert.equal(named.status, 0, describeSpawn(named));
  assert.match(named.stdout, /below-min-score/);
  assert.doesNotMatch(named.stdout, /default-log/);
  const fallback = run();
  assert.equal(fallback.status, 0, describeSpawn(fallback));
  assert.match(fallback.stdout, /default-log reason/);
});
