// tests/weekly-digest-missing-dir.test.mjs — an explicit --dir that does not
// exist is an error, not an empty week.
//
// A missing --dir was read as no sessions: the digest printed "No interviews
// recorded in this range (interview-prep/sessions/ not found)", naming the
// default folder rather than the one given, and exited 0. As in #7840 and
// #7781, only the default path may be absent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'weekly-digest-missing-'));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
const sessions = join(root, 'sessions');
mkdirSync(sessions);

function run(...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(process.execPath, [join(ROOT, 'weekly-digest.mjs'), '--summary', ...args], { cwd: root, encoding: 'utf-8', env, timeout: 60_000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  return r;
}

test('a --dir that does not exist exits 1 and names it', () => {
  const r = run('--dir', join(root, 'sesions'));
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /--dir not found: .*sesions/);
  assert.doesNotMatch(r.stdout, /No interviews recorded/);
});

test('an empty --dir exits 1 instead of digesting the default folder', () => {
  const r = run('--dir', '');
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /--dir requires a value/);
  assert.doesNotMatch(r.stdout, /Weekly Interview Digest/);
});

test('control: an existing empty --dir, and the absent default, still print the digest', () => {
  for (const args of [['--dir', sessions], []]) {
    const r = run(...args);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /No interviews recorded in this range/);
  }
});
