import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'plugin-audit.mjs');

function runAudit(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 10_000,
  });
  assert.equal(r.error, undefined, `plugin-audit.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `plugin-audit.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('--help prints usage and exits 0', () => {
  const r = runAudit('--help');
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node plugin-audit\.mjs <plugin-dir>/);
  assert.equal(r.status, 0, '--help must exit 0');
});

test('-h prints usage and exits 0', () => {
  const r = runAudit('-h');
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node plugin-audit\.mjs <plugin-dir>/);
  assert.equal(r.status, 0, '-h must exit 0');
});

test('--bogus unrecognized flag is rejected and exits 1', () => {
  const r = runAudit('--bogus');
  assert.match(r.stderr, /Error: unrecognized flag\(s\): --bogus/);
  assert.match(r.stderr, /Usage:/);
  assert.notEqual(r.status, 0, 'unrecognized flag must exit non-zero');
});

test('valid directory runs the audit', () => {
  // Use a known existing plugin directory from the repository.
  const r = runAudit('plugins/apify');
  // It shouldn't print usage or flag errors.
  assert.doesNotMatch(r.all, /unrecognized flag/);
  assert.doesNotMatch(r.all, /Usage:/);
});

test('help exits before checking a missing directory', () => {
  for (const flag of ['--help', '-h']) {
    const r = runAudit(flag, join(ROOT, '__missing_plugin_audit_fixture__'));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
    assert.equal(r.stderr, '');
  }
});

test('--bogus --help is rejected as unknown flag before checking help', () => {
  const r = runAudit('--bogus', '--help');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Error: unrecognized flag\(s\): --bogus/);
});
