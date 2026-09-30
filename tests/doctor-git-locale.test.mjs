import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const doctor = fileURLToPath(new URL('../doctor.mjs', import.meta.url));

function run(t, scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-git-locale-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const capture = join(dir, 'git-env.json');
  const preload = join(dir, 'git-probe.cjs');
  // Mock the Git subprocess, not doctor: no installed locale catalog needed,
  // and every platform exercises the exact exec options used in production.
  writeFileSync(preload, `
const cp = require('node:child_process');
const fs = require('node:fs');
const original = cp.execFileSync;
cp.execFileSync = function (file, args, opts) {
  if (file !== 'git' || args[0] !== 'ls-files') return original(file, args, opts);
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({
    childLocale: opts.env?.LC_ALL, parentLocale: process.env.LC_ALL,
    childLanguage: opts.env?.LANGUAGE,
  }));
  if (${JSON.stringify(scenario)} === 'tracked') return 'fixture.md.bak\\0';
  const stderr = ${JSON.stringify(scenario)} === 'permission'
    ? 'fatal: cannot read index: Permission denied'
    : opts.env?.LC_ALL === 'C'
      ? 'fatal: not a git repository (or any of the parent directories): .git'
      : '致命错误：不是 Git 仓库（或者任何父目录）：.git';
  throw Object.assign(new Error('git failed'), { stderr, status: 128 });
};
require('node:module').syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--require', preload, doctor, '--json', '--target', dir], {
    cwd: dir, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, LC_ALL: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN', CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const state = JSON.parse(result.stdout);
  return { warnings: state.warnings.join('\n'), env: JSON.parse(readFileSync(capture, 'utf8')) };
}

test('localized parent does not turn a non-checkout into a backup warning', (t) => {
  const { warnings, env } = run(t, 'not-repo');
  assert.doesNotMatch(warnings, /Tracked \.bak files: check could not run/);
  assert.equal(env.childLocale, 'C');
  assert.equal(env.parentLocale, 'zh_CN.UTF-8', 'do not mutate the process-wide locale');
});

test('Git permission failures remain visible', (t) => {
  const { warnings } = run(t, 'permission');
  assert.match(warnings, /Tracked \.bak files: check could not run.*Permission denied/);
});

test('tracked backup files are still reported', (t) => {
  const { warnings } = run(t, 'tracked');
  assert.match(warnings, /fixture\.md\.bak/);
  assert.match(warnings, /git rm --cached/);
});
