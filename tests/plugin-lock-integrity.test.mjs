// tests/plugin-lock-integrity.test.mjs — what the plugin lock pins, and what
// install refuses so that the lock never has to pin it.
//
// hashPluginTree skips node_modules (a developer's linked checkout keeps its
// own dependencies there, with symlinks the hash refuses), so a community
// plugin must never arrive with one: validateInstall runs the audit, and the
// audit fails a tree that contains node_modules at any depth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const lock = await import(pathToFileURL(join(ROOT, 'plugins/_lock.mjs')).href);
const install = await import(pathToFileURL(join(ROOT, 'plugin-install.mjs')).href);

test('a top-level file named __proto__ is recorded and hashed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-lock-proto-'));
  try {
    writeFileSync(join(dir, 'index.mjs'), 'export default {};\n');
    const without = lock.hashPluginTree(dir);
    writeFileSync(join(dir, '__proto__'), 'export const a = 1;\n');
    const withFile = lock.hashPluginTree(dir);
    assert.ok(Object.hasOwn(withFile.files, '__proto__'), `files map lost __proto__: ${JSON.stringify(Object.keys(withFile.files))}`);
    assert.notEqual(withFile.integrity, without.integrity, 'adding __proto__ must change the integrity');
    writeFileSync(join(dir, '__proto__'), 'export const a = 2;\n');
    assert.notEqual(lock.hashPluginTree(dir).integrity, withFile.integrity, 'editing __proto__ must change the integrity');

    // Through the lock file and back: the drift report names the file.
    const pinned = JSON.parse(JSON.stringify({ version: '1.0.0', integrity: without.integrity, files: without.files }));
    const d = lock.diffPlugin({ id: 'p', version: '1.0.0', dir, allowedHosts: [], requiredEnv: [] }, pinned);
    assert.equal(d.status, 'drift-nobump');
    assert.deepEqual(d.added, ['__proto__']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install refuses a plugin that ships a node_modules directory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'co-install-nm-'));
  try {
    const dir = join(tmp, 'nmfix');
    cpSync(join(ROOT, 'plugins', '_template'), dir, { recursive: true });
    if (existsSync(join(dir, 'skill.md.template'))) renameSync(join(dir, 'skill.md.template'), join(dir, 'skill.md'));
    const manifestFile = join(dir, 'manifest.json');
    writeFileSync(manifestFile, readFileSync(manifestFile, 'utf8').replaceAll('{{NAME}}', 'nmfix'));
    const clean = install.validateInstall(dir, 'nmfix');
    assert.equal(clean.ok, true, `the template fixture must install cleanly first: ${JSON.stringify(clean.problems)}`);
    // The template's smoke test imports its entry by a literal path, so the
    // audit can read it and a fresh plugin installs with no warning at all.
    assert.deepEqual(clean.warnings, [], 'a plugin built from the template must audit clean');

    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'index.mjs'), 'export default {};\n');
    const result = install.validateInstall(dir, 'nmfix');
    assert.equal(result.ok, false, 'a tree with node_modules must not install');
    assert.ok(result.problems.some((p) => /^node_modules: /.test(p)), JSON.stringify(result.problems));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
