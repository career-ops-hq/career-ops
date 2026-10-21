import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGETS = ['modes/_profile.md', 'modes/_custom.md', 'modes/_brief.md', 'voice-dna.md'];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-readonly-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  return dir;
}

function doctor(dir, args = ['--json']) {
  const result = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--target', dir, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_CLI: 'claude' },
  });
  assert.ifError(result.error);
  return result;
}

function state(dir, args) {
  const result = doctor(dir, args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

// Check names, contents and modification times, including unexpected new files.
//
// walkTree with every guard that could hide a write turned off: this is a
// no-write assertion, so a file the walk skipped would be a write it cannot
// see. `allowNestedCheckouts` keeps a directory doctor marked with `.git` (or
// named like a scratch copy) in view, and `onDir` records every directory —
// empty ones included — with its mtime, as the nested form this replaced did.
// `links: 'reject'`, not 'follow': walkTree's 'follow' silently skips a dangling
// link, where the statSync form this replaced threw on one. The fixture is
// built without links, so any link at all is a write, and rejecting it fails
// the snapshot loudly instead of either form's quieter reading.
function snapshot(dir) {
  const entries = [];
  walkTree(dir, {
    allowNestedCheckouts: true,
    links: 'reject',
    onDir: (abs) => entries.push([relative(dir, abs), statSync(abs).mtimeMs, 'dir']),
    onFile: (abs) => entries.push([relative(dir, abs), statSync(abs).mtimeMs, readFileSync(abs).toString('base64')]),
  });
  return entries;
}

test('--json reports missing prerequisites without copying available templates', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'modes'));
  for (const target of TARGETS) {
    writeFileSync(join(dir, target.replace('.md', '.template.md')), `Template for ${target}\n`);
  }
  const before = snapshot(dir);
  const result = state(dir);
  assert.equal(result.onboardingNeeded, true);
  assert.deepEqual(result.missing, ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml']);
  assert.deepEqual(result.autoCopied, []);
  assert.deepEqual(snapshot(dir), before);
});

test('--json leaves an empty data root empty with shipped templates available', (t) => {
  const dir = fixture(t);
  const result = state(dir);
  assert.equal(result.missing.length, 4);
  assert.deepEqual(result.autoCopied, []);
  assert.deepEqual(readdirSync(dir), []);
});

test('explicit initialization uses local templates and preserves existing user files', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'modes'));
  mkdirSync(join(dir, 'config'));
  for (const path of ['cv.md', 'config/profile.yml', 'portals.yml']) {
    writeFileSync(join(dir, path), 'Existing user input\n');
  }
  writeFileSync(join(dir, 'modes/_profile.md'), 'Personalized targeting\n');
  for (const target of TARGETS) {
    writeFileSync(join(dir, target.replace('.md', '.template.md')), `Local template for ${target}\n`);
  }
  const result = state(dir, ['--json', '--init-templates']);
  assert.equal(result.onboardingNeeded, false);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.autoCopied, TARGETS.slice(1));
  assert.equal(readFileSync(join(dir, 'modes/_profile.md'), 'utf8'), 'Personalized targeting\n');
  for (const target of TARGETS.slice(1)) {
    assert.equal(readFileSync(join(dir, target), 'utf8'), `Local template for ${target}\n`);
  }
  const before = snapshot(dir);
  assert.deepEqual(state(dir).autoCopied, []);
  assert.deepEqual(state(dir, ['--json', '--init-templates']).autoCopied, []);
  assert.deepEqual(snapshot(dir), before);
});

test('explicit initialization supports a separate empty data root and retains personalization warnings', (t) => {
  const dir = fixture(t);
  const result = state(dir, ['--json', '--init-templates']);
  assert.deepEqual(result.autoCopied, TARGETS);
  assert.deepEqual(result.missing, ['cv.md', 'config/profile.yml', 'portals.yml']);
  for (const target of TARGETS) {
    assert.deepEqual(readFileSync(join(dir, target)), readFileSync(join(ROOT, target.replace('.md', '.template.md'))));
  }
  assert.ok(result.unpersonalized.some((entry) => entry.path === 'modes/_profile.md'));
  assert.ok(result.unpersonalized.some((entry) => entry.path === 'modes/_brief.md'));
  assert.ok(!result.unpersonalized.some((entry) => entry.path === 'modes/_custom.md'));
});

test('--init-templates requires --json and leaves the target untouched on misuse', (t) => {
  const dir = fixture(t);
  const result = doctor(dir, ['--init-templates']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--init-templates requires --json/);
  assert.deepEqual(readdirSync(dir), []);
});
