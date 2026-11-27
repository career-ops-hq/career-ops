import { after, test } from 'node:test';
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

// One copy of the shipped tree for the whole file: copying all of it per test
// was most of this suite's time on Windows, and doctor never writes to it.
// Each test sets only what differs, package.json and node_modules. The link is
// one-way: the tests that need no node_modules run first, in file order.
let checkout = null;
let linked = false;
after(() => { if (checkout) rmSync(checkout, { recursive: true, force: true, maxRetries: 10 }); });

function doctorCheckout({ packageJson, nodeModules }) {
  if (!checkout) {
    checkout = mkdtempSync(join(tmpdir(), 'co-doctor-no-deps-'));
    for (const file of SHIPPED_FILES) {
      if (file === 'package.json') continue;
      mkdirSync(dirname(join(checkout, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(checkout, file));
    }
  }
  if (linked && !nodeModules) throw new Error('node_modules is already linked: put this test before the ones that link it');
  if (nodeModules && !linked) {
    assert.equal(linkNodeModules(checkout), null);
    linked = true;
  }
  rmSync(join(checkout, 'package.json'), { force: true });
  if (packageJson) writeFileSync(join(checkout, 'package.json'), packageJson);
  return checkout;
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

  test(`doctor ${mode} names the package it needs when package.json is missing`, () => {
    const run = runDoctor(doctorCheckout({ packageJson: null }), args);
    assert.equal(run.status, 1, run.output);
    assert.doesNotMatch(run.output, /ENOENT|ERR_MODULE_NOT_FOUND/);
    assert.match(run.output, /dependencies are not installed in .* \(missing: [\w@\/.-]+\)/);
    assert.match(run.output, /Fix: run `npm install`/);
  });
}

test('doctor --json still reports when only a package doctor does not load is missing', () => {
  const manifest = JSON.parse(realPackageJson);
  manifest.dependencies = { ...manifest.dependencies, 'career-ops-test-absent': '1.0.0' };
  const dir = doctorCheckout({ packageJson: JSON.stringify(manifest), nodeModules: true });
  const json = runDoctor(dir, ['--json']);
  assert.equal(json.status, 0, json.output);
  assert.doesNotThrow(() => JSON.parse(json.stdout), json.output);
  const human = runDoctor(dir, []);
  assert.match(human.output, /Dependencies missing: career-ops-test-absent/);
});

test('doctor reports a missing package.json as a failed check when packages are installed', () => {
  const run = runDoctor(doctorCheckout({ packageJson: null, nodeModules: true }), []);
  assert.doesNotMatch(run.output, /^Error: ENOENT/m);
  assert.match(run.output, /Dependencies could not be checked: package.json unreadable/);
});
