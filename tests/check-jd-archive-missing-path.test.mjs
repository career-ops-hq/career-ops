// tests/check-jd-archive-missing-path.test.mjs — an explicit --reports-dir or
// --tracker that does not exist is an error, not an empty archive.
//
// A mistyped --reports-dir printed "No report files found under reports/" and
// exited 0, and a mistyped --tracker dropped the tracker join without a word,
// so the check passed on data it never read. As in #7840 and #7781, only the
// default paths may be absent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'check-jd-archive-missing-'));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
mkdirSync(join(root, 'reports'));
mkdirSync(join(root, 'jds'));
const tracker = join(root, 'applications.md');
writeFileSync(tracker, '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');

function run(...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(process.execPath, [join(ROOT, 'check-jd-archive.mjs'), '--summary', ...args], { cwd: root, encoding: 'utf-8', env, timeout: 60_000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  return r;
}

test('a --reports-dir that does not exist exits 2 and names it', () => {
  const missing = join(root, 'reprots');
  const r = run('--reports-dir', missing, '--jds-dir', join(root, 'jds'), '--tracker', tracker);
  assert.equal(r.status, 2, describeSpawn(r));
  assert.match(r.stderr, /--reports-dir not found: .*reprots/);
  assert.doesNotMatch(r.stdout, /No report files found/);
});

test('a --tracker that does not exist exits 2 and names it', () => {
  const r = run('--reports-dir', join(root, 'reports'), '--jds-dir', join(root, 'jds'), '--tracker', join(root, 'aplications.md'));
  assert.equal(r.status, 2, describeSpawn(r));
  assert.match(r.stderr, /--tracker not found: .*aplications\.md/);
});

test('an empty --reports-dir or --tracker exits 2 instead of checking the default', () => {
  for (const args of [['--reports-dir='], ['--reports-dir', ''], ['--tracker='], ['--tracker', '']]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')}\n${describeSpawn(r)}`);
    assert.match(r.stderr, /--(reports-dir|tracker) requires a path/);
  }
});

test('control: existing paths, and --no-tracker with a missing --tracker, run as before', () => {
  const ok = run('--reports-dir', join(root, 'reports'), '--jds-dir', join(root, 'jds'), '--tracker', tracker);
  assert.equal(ok.status, 0, describeSpawn(ok));
  const skipped = run('--reports-dir', join(root, 'reports'), '--jds-dir', join(root, 'jds'), '--no-tracker', '--tracker', join(root, 'gone.md'));
  assert.equal(skipped.status, 0, describeSpawn(skipped));
});
