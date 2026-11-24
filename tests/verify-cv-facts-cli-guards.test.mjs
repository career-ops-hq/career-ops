// A missing default cv.md used to be reported as invented metrics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function run(root, ...args) {
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_CV: '' };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [join(ROOT, 'verify-cv-facts.mjs'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 20000, env,
  });
}

test('a missing default cv.md is named and is not an invented-metric list', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-facts-missing-'));
  try {
    writeFileSync(join(root, 'letter.md'), 'Reached 16,181 users.\n');
    const r = run(root, 'letter.md', '--json');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /cv\.md not found/);
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /invented|16181/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--source does not take a flag as the path', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-facts-source-'));
  try {
    writeFileSync(join(root, 'letter.md'), 'Hello.\n');
    writeFileSync(join(root, '--json'), 'Reached 16,181 users.\n');
    const r = run(root, 'letter.md', '--source', '--json');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /--source requires a path/);
    assert.doesNotMatch(r.stderr, /16181/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--help --bogus exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-facts-help-'));
  try {
    const r = run(root, '--help', '--bogus');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /unknown option: --bogus/);
    assert.equal(r.stdout, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
