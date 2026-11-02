// An unavailable CV archive lock must preserve the CLI's structured error contract.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';

const initial = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-05 | Fictional | Engineer | 4/5 | Applied | — | — | notes |\n';
for (const explicit of [true, false]) for (const timeout of [true, false]) for (const json of [true, false]) {
  const label = `${explicit ? 'selected' : 'automatic'} CV ${timeout ? 'lock timeout' : 'lock I/O failure'} returns ${json ? 'JSON' : 'text'} without recording an outcome`;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-cv-lock-error-')));
  const tracker = join(root, 'data', 'applications.md');
  const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
  const lock = join(archive, '.submitted-cv.lock');
  const source = join(root, 'cv.md');
  const bytes = '# Fictional selected CV\n';
  const owner = JSON.stringify({ pid: process.pid, token: 'fictional-holder', started_at: new Date().toISOString() });
  mkdirSync(archive, { recursive: true });
  writeFileSync(tracker, initial);
  writeFileSync(source, bytes);
  if (timeout) { mkdirSync(lock); writeFileSync(join(lock, 'owner.json'), owner); }
  const preload = join(root, 'lock-failure.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const lock = ${JSON.stringify(lock)}, original = fs.mkdirSync, now = Date.now;
let attempted = false;
fs.mkdirSync = (path, ...args) => {
  if (String(path) === lock) {
    attempted = true;
    if (!${timeout}) throw Object.assign(new Error('injected archive lock I/O failure'), { code: 'EIO' });
  }
  return original(path, ...args);
};
// Exercise the real timeout against a live fixture owner without waiting a minute.
Date.now = () => now() + (${timeout} && attempted ? 61_000 : 0);
syncBuiltinESMExports();
`);
  try {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'outcome.mjs'), '1', 'hired', ...(explicit ? ['--cv', source] : []), ...(json ? ['--json'] : [])], {
      cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 1, result.error?.message || result.stderr);
    if (json) {
      const error = JSON.parse(result.stdout);
      assert.equal(error.code, 'cv-archive-locked');
      assert.match(error.error, /CV archive lock unavailable/);
      assert.equal(result.stderr, '');
    } else {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /CV archive lock unavailable/);
      assert.doesNotMatch(result.stderr, /Selected CV could not be archived|at file:/);
    }
    assert.equal(readFileSync(tracker, 'utf8'), initial);
    assert.equal(readFileSync(source, 'utf8'), bytes);
    assert.equal(existsSync(join(archive, 'submitted_cv.md')), false);
    assert.equal(existsSync(join(archive, 'outcome.md')), false);
    assert.equal(existsSync(lock), timeout);
    if (timeout) assert.equal(readFileSync(join(lock, 'owner.json'), 'utf8'), owner);
    pass(label);
  } catch (err) { fail(`${label}: ${err.message}`); process.exitCode = 1; }
  finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
}
