// tests/doctor-dependency-resolution.test.mjs — checkDependencies() asks
// whether each package.json dependency resolves from the code root the way
// Node will at run time, not whether a node_modules directory exists.
//
// The directory check was wrong both ways (2026-10-05): a git worktree with no
// node_modules of its own reported "not installed" although Node resolved its
// packages through the main checkout's node_modules one level up, and a main
// checkout whose node_modules predated undici (#4445) reported "installed"
// while the import failed.
//
// Driven through --target, the existing seam that points codeRoot at another
// checkout (tests/doctor-tracked-bak-files.test.mjs uses it the same way).
// Fixture packages carry names no real registry install would have, so a
// global folder on the test machine cannot satisfy them by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCTOR = join(ROOT, 'doctor.mjs');

const DEPS = ['co-doctor-fake-alpha', '@co-doctor-fake/scoped', 'co-doctor-fake-esm-only'];

function writeManifest(codeRoot) {
  mkdirSync(codeRoot, { recursive: true });
  const dependencies = Object.fromEntries(DEPS.map((name) => [name, '^1.0.0']));
  writeFileSync(join(codeRoot, 'package.json'), JSON.stringify({ name: 'fixture', dependencies }), 'utf-8');
}

function installPackage(dir, name) {
  const pkgDir = join(dir, 'node_modules', ...name.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  // The ESM-only fixture's exports map has no `require` condition and does not
  // export ./package.json — the shape require.resolve() refuses even though the
  // package is installed and imports fine.
  const manifest = name === 'co-doctor-fake-esm-only'
    ? { name, version: '1.0.0', type: 'module', exports: { '.': { import: './index.js' } } }
    : { name, version: '1.0.0', main: 'index.js' };
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest), 'utf-8');
  writeFileSync(join(pkgDir, 'index.js'), '', 'utf-8');
}

function dependencyLine(codeRoot, { nodePath = '' } = {}) {
  const run = spawnSync(process.execPath, [DOCTOR, '--target', codeRoot], {
    cwd: codeRoot,
    encoding: 'utf-8',
    // Pinned so an inherited NODE_PATH can never be what decides the outcome.
    env: { ...process.env, NODE_PATH: nodePath },
  });
  assert.equal(run.stderr, '', `doctor wrote to stderr: ${run.stderr}`);
  const line = run.stdout.split('\n').find((l) => /Dependencies/.test(l));
  assert.ok(line, `no Dependencies line in doctor output:\n${run.stdout}`);
  return line;
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-deps-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('every dependency resolvable from the code root passes', () => {
  withTempDir((dir) => {
    writeManifest(dir);
    for (const name of DEPS) installPackage(dir, name);
    assert.match(dependencyLine(dir), /✓ Dependencies installed/);
  });
});

test('one missing dependency fails, naming only that package', () => {
  withTempDir((dir) => {
    writeManifest(dir);
    installPackage(dir, 'co-doctor-fake-alpha');
    installPackage(dir, 'co-doctor-fake-esm-only');
    const line = dependencyLine(dir);
    assert.match(line, /✗ Dependencies missing: @co-doctor-fake\/scoped$/);
  });
});

test('dependencies resolvable only from a parent directory pass (git worktree layout)', () => {
  withTempDir((dir) => {
    // A worktree under .claude/worktrees/<name> has no node_modules of its own;
    // Node resolves through the main checkout's node_modules above it.
    const worktree = join(dir, '.claude', 'worktrees', 'some-branch');
    writeManifest(worktree);
    for (const name of DEPS) installPackage(dir, name);
    assert.match(dependencyLine(worktree), /✓ Dependencies installed/);
  });
});

test('an existing but stale node_modules fails, naming the package it lacks', () => {
  withTempDir((dir) => {
    // The bug's other direction: node_modules exists, so the old directory
    // check passed, but it was installed before the newest dependency.
    writeManifest(dir);
    installPackage(dir, 'co-doctor-fake-alpha');
    installPackage(dir, '@co-doctor-fake/scoped');
    assert.match(dependencyLine(dir), /✗ Dependencies missing: co-doctor-fake-esm-only$/);
  });
});

test('a dependency reachable only through NODE_PATH is missing', () => {
  withTempDir((dir) => {
    // require() searches NODE_PATH, but the ESM imports every script uses do
    // not, so a package found only there still fails to import at run time.
    const codeRoot = join(dir, 'checkout');
    const elsewhere = join(dir, 'global');
    writeManifest(codeRoot);
    installPackage(codeRoot, 'co-doctor-fake-alpha');
    installPackage(codeRoot, '@co-doctor-fake/scoped');
    installPackage(elsewhere, 'co-doctor-fake-esm-only');
    const line = dependencyLine(codeRoot, { nodePath: join(elsewhere, 'node_modules') });
    assert.match(line, /✗ Dependencies missing: co-doctor-fake-esm-only$/);
  });
});

test('no node_modules anywhere fails, listing every dependency', () => {
  withTempDir((dir) => {
    writeManifest(dir);
    assert.equal(dependencyLine(dir), `✗ Dependencies missing: ${DEPS.join(', ')}`);
  });
});

test('a code root without package.json fails instead of crashing', () => {
  withTempDir((dir) => {
    assert.match(dependencyLine(dir), /✗ Dependencies could not be checked: package\.json unreadable/);
  });
});
