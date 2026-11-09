import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkNodeModules } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHIPPED_FILES = spawnSync('git', ['ls-files', '-z', '--', '.', ':!tests', ':!web', ':!docs'], { cwd: ROOT, encoding: 'utf-8' })
  .stdout.split('\0').filter(Boolean);

function doctorCheckout(t, { packageJson, nodeModules }) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-no-deps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  for (const file of SHIPPED_FILES) {
    if (file === 'package.json') continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(dir, file));
  }
  if (packageJson) writeFileSync(join(dir, 'package.json'), packageJson);
  if (nodeModules) assert.equal(linkNodeModules(dir), null);
  return dir;
}

function runDoctor(dir, args) {
  const run = spawnSync(process.execPath, [join(dir, 'doctor.mjs'), ...args], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', NODE_PATH: '' },
  });
  return { ...run, output: run.stdout + run.stderr };
}

const realPackageJson = readFileSync(join(ROOT, 'package.json'), 'utf8');

for (const args of [[], ['--json']]) {
  const mode = args.join(' ') || '(human run)';

  test(`doctor ${mode} names the package it needs when package.json is missing`, (t) => {
    const run = runDoctor(doctorCheckout(t, { packageJson: null }), args);
    assert.equal(run.status, 1, run.output);
    assert.doesNotMatch(run.output, /ENOENT|ERR_MODULE_NOT_FOUND/);
    assert.match(run.output, /dependencies are not installed in .* \(missing: [\w@\/.-]+\)/);
    assert.match(run.output, /Fix: run `npm install`/);
  });
}

test('doctor --json still reports when only a package doctor does not load is missing', (t) => {
  const manifest = JSON.parse(realPackageJson);
  manifest.dependencies = { ...manifest.dependencies, 'career-ops-test-absent': '1.0.0' };
  const dir = doctorCheckout(t, { packageJson: JSON.stringify(manifest), nodeModules: true });
  const json = runDoctor(dir, ['--json']);
  assert.equal(json.status, 0, json.output);
  assert.doesNotThrow(() => JSON.parse(json.stdout), json.output);
  const human = runDoctor(dir, []);
  assert.match(human.output, /Dependencies missing: career-ops-test-absent/);
});

test('doctor reports a missing package.json as a failed check when packages are installed', (t) => {
  const run = runDoctor(doctorCheckout(t, { packageJson: null, nodeModules: true }), []);
  assert.doesNotMatch(run.output, /^Error: ENOENT/m);
  assert.match(run.output, /Dependencies could not be checked: package.json unreadable/);
});
