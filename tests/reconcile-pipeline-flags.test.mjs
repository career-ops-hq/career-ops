// reconcile-pipeline.mjs must reject a mistyped flag before it can fall
// through to a LIVE run. Before this fix, a typo'd --dry-run (e.g. --dryrun)
// was silently ignored and the script proceeded to overwrite pipeline.md for
// real — the caller believed they were in dry-run mode and were not.
//
// Every invocation below passes --dry-run explicitly (even the ones that
// error before reaching it) so this suite can never write to this repo's own
// data/pipeline.md, regardless of what batch/batch-state.tsv happens to
// contain on the machine running it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'reconcile-pipeline.mjs');

function runReconcile(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `reconcile-pipeline.mjs failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `reconcile-pipeline.mjs was killed by ${result.signal} (timeout?)`);
  return { ...result, all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('--help prints usage and exits 0', () => {
  const result = runReconcile('--help');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /node reconcile-pipeline\.mjs/);
});

test('-h prints usage and exits 0', () => {
  const result = runReconcile('-h');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
});

test('a typo of --dry-run exits 1 instead of silently running live', () => {
  const result = runReconcile('--dryrun');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --dryrun/);
  assert.match(result.stderr, /Valid flags:/);
});

test('an unknown flag exits 1 and names the flag', () => {
  const result = runReconcile('--bogus', '--dry-run');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --bogus/);
});

test('--help plus an unknown flag still fails', () => {
  const result = runReconcile('--help', '--bogus');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --bogus/);
  assert.doesNotMatch(result.stdout, /Usage:/);
});

test('--pipeline without a value is rejected instead of silently using the default', () => {
  const result = runReconcile('--pipeline', '--dry-run');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--pipeline requires a value/);
});

test('--state without a value is rejected instead of silently using the default', () => {
  const result = runReconcile('--state', '--dry-run');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--state requires a value/);
});

test('--pipeline=<path> (equals form) is recognized, not silently discarded', () => {
  // A nonexistent target still resolves inside the repo and reports the same
  // graceful "nothing to reconcile" — the assertion here is that the flag was
  // accepted at all, not that a specific file was read.
  const result = runReconcile('--pipeline=data/does-not-exist.md', '--dry-run');
  assert.doesNotMatch(result.stderr, /unrecognized flag/i);
  assert.doesNotMatch(result.stderr, /requires a value/);
});

test('a path escaping the repo is rejected, not silently accepted', () => {
  const result = runReconcile('--pipeline', '../outside.md', '--dry-run');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /path must stay inside the repository/);
});
