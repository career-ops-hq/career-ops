// tests/find-installed-package.test.mjs — findInstalledPackage() walks parent
// directories the way Node's bare-specifier lookup does, and linkRepoPackage()
// takes the package from wherever that walk lands.
//
// linkRepoPackage() used to insist on `ROOT/node_modules/<pkg>`. A git worktree
// has no node_modules of its own, so the scripts under test resolved js-yaml
// from the main checkout's node_modules while every suite that links it into a
// sandbox threw "is not installed" before asserting anything.
//
// Run:  node --test tests/find-installed-package.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInstalledPackage, linkRepoPackage, rmSync } from './helpers.mjs';

function tempTree() {
  // realpath so a symlinked tmpdir (macOS /var -> /private/var) cannot make a
  // returned path differ from the one the test built.
  return realpathSync(mkdtempSync(join(tmpdir(), 'find-installed-package-')));
}

function install(dir, pkgName) {
  const pkgDir = join(dir, 'node_modules', pkgName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkgName }));
  return pkgDir;
}

test('finds a package installed in a parent of a directory with no node_modules', () => {
  const root = tempTree();
  try {
    const installed = install(root, 'x');
    const nested = join(root, '.claude', 'worktrees', 'w');
    mkdirSync(nested, { recursive: true });
    assert.equal(findInstalledPackage('x', nested), installed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the nearest installation wins', () => {
  const root = tempTree();
  try {
    install(root, 'x');
    const nested = join(root, 'a', 'b');
    const nearer = install(join(root, 'a'), 'x');
    mkdirSync(nested, { recursive: true });
    assert.equal(findInstalledPackage('x', nested), nearer);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns null when the package is installed nowhere', () => {
  const root = tempTree();
  try {
    assert.equal(findInstalledPackage('career-ops-no-such-package-4f2a', root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a directory without package.json is not an installation', () => {
  const root = tempTree();
  try {
    const installed = install(root, 'x');
    const child = join(root, 'child');
    mkdirSync(join(child, 'node_modules', 'x'), { recursive: true });   // empty: no package.json
    assert.equal(findInstalledPackage('x', child), installed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finds a scoped package', () => {
  const root = tempTree();
  try {
    const installed = install(root, '@google/generative-ai');
    const nested = join(root, 'deep', 'er');
    mkdirSync(nested, { recursive: true });
    assert.equal(findInstalledPackage('@google/generative-ai', nested), installed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips node_modules/node_modules, as Node does', () => {
  const root = tempTree();
  try {
    const installed = install(root, 'x');
    // The decoy sits at root/node_modules/node_modules/x. Starting inside
    // root/node_modules/a, the walk reaches root/node_modules, whose basename
    // is node_modules, so it must not look in root/node_modules/node_modules.
    install(join(root, 'node_modules'), 'x');
    const start = join(root, 'node_modules', 'a');
    mkdirSync(start, { recursive: true });
    assert.equal(findInstalledPackage('x', start), installed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('linkRepoPackage links the installation findInstalledPackage resolves', () => {
  const expected = findInstalledPackage('js-yaml');
  assert.ok(expected, 'js-yaml must be installed somewhere above the repo root -- run npm install');
  const sandbox = tempTree();
  try {
    const linked = linkRepoPackage(sandbox, 'js-yaml');
    assert.equal(linked, join(sandbox, 'node_modules', 'js-yaml'));
    if (lstatSync(linked).isSymbolicLink()) {
      assert.equal(realpathSync(linked), realpathSync(expected));
    } else {
      // linkRepoPackage's last resort is a copy, where no link exists to follow.
      assert.equal(
        readFileSync(join(linked, 'package.json'), 'utf-8'),
        readFileSync(join(expected, 'package.json'), 'utf-8'),
      );
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
