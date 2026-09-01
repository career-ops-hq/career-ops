// tests/mjs-files.test.mjs — the syntax gate covers the whole repository, and
// both gates agree about what "the whole repository" is (#3419).
//
// The defect: test-all.mjs's section 1 called a NON-recursive readdirSync on the
// repository root, so it syntax-checked 121 of ~575 .mjs files while printing a
// `{file} syntax OK` line for each one it did check — a screen of green that
// looked complete and never mentioned the 263 files under tests/. It also
// narrowed by one every time a file moved out of the root, silently, which is
// how #3306's eleven suites and #3388's nine left the gate unnoticed.
//
// Three halves-of-a-fix, and the third is the one that lasts:
//
//   1. BEHAVIOUR — the collector actually recurses, skips what it claims to
//      skip, and returns a stable order.
//   2. SCOPE — test-all.mjs's gate and `npm run lint` check the SAME set. This
//      is the assertion the old code would have failed.
//   3. CONVENTION — neither caller re-derives the file list itself. A second
//      hand-rolled walk is free to re-diverge the next time one of them learns
//      about a directory, which is exactly how the two drifted apart.
//
// Run:  node --test tests/mjs-files.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMjsFiles, SKIP_DIRS } from '../lib/mjs-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('collectMjsFiles recurses, filters, skips and sorts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-mjs-files-'));
  try {
    mkdirSync(join(dir, 'nested', 'deep'), { recursive: true });
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'zz-root.mjs'), '');
    writeFileSync(join(dir, 'nested', 'mid.mjs'), '');
    writeFileSync(join(dir, 'nested', 'deep', 'leaf.mjs'), '');
    writeFileSync(join(dir, 'nested', 'notes.md'), '');
    writeFileSync(join(dir, 'node_modules', 'dep.mjs'), '');

    const rel = collectMjsFiles(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, '/'));

    assert.ok(rel.includes('nested/deep/leaf.mjs'), 'walk must reach nested directories');
    assert.ok(rel.includes('nested/mid.mjs'));
    assert.ok(rel.includes('zz-root.mjs'));
    assert.ok(!rel.includes('nested/notes.md'), 'only .mjs files');
    assert.ok(!rel.some((f) => f.startsWith('node_modules/')), 'SKIP_DIRS entries are not walked');
    assert.deepEqual(rel, [...rel].sort(), 'order is stable, not readdir order');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing root throws rather than reporting an empty, passing scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-mjs-files-'));
  try {
    // The whole point of the module: a gate that checks nothing must never
    // read as a gate that passed. Returning [] here would make section 1 print
    // "0 .mjs files" and go green (#3419).
    assert.throws(() => collectMjsFiles(join(dir, 'does-not-exist')), { code: 'ENOENT' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKIP_DIRS excludes generated and user content, so the count is checkout-independent', () => {
  for (const name of ['.git', 'node_modules', 'output', 'data', 'coverage', 'test-results']) {
    assert.ok(SKIP_DIRS.has(name), `${name} must stay excluded`);
  }
});

test('the syntax gate reaches past the repository root', () => {
  const files = collectMjsFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'));
  const rootOnly = files.filter((f) => !f.includes('/'));

  // The exact numbers move with the repo; the RATIO is the invariant that
  // failed. Root-only coverage was ~20% of the tree and read as complete.
  assert.ok(files.length > rootOnly.length * 2,
    `gate must cover far more than the root: ${files.length} total vs ${rootOnly.length} at root`);
  assert.ok(files.some((f) => f.startsWith('tests/')), 'tests/ must be inside the gate');
  assert.ok(files.some((f) => f.startsWith('providers/')), 'providers/ must be inside the gate');
  assert.ok(files.some((f) => f.startsWith('lib/')), 'lib/ must be inside the gate');

  // web/ is the one opt-in subproject in this list (#2360): tests/, providers/
  // and lib/ ship with every install, but a checkout that never took the web UI
  // has no web/ on disk. Assert it's inside the gate when it exists; when it
  // doesn't, the invariant is vacuously true — the same conditional the adjacent
  // 'web/ test discovery contract' check already uses instead of hardcoding it.
  if (existsSync(join(ROOT, 'web'))) {
    assert.ok(files.some((f) => f.startsWith('web/')), 'web/ must be inside the gate when present');
  }
});

test('both syntax checkers derive their file list from the shared collector', () => {
  for (const caller of ['test-all.mjs', 'scripts/check-syntax.mjs']) {
    const src = readFileSync(join(ROOT, caller), 'utf-8');
    assert.match(src, /collectMjsFiles\(/, `${caller} must use lib/mjs-files.mjs`);
  }

  // Scoped to section 1 rather than the whole file: test-all.mjs legitimately
  // walks other subtrees for other reasons (plugins/, web/), and a
  // whole-file ban would fail on those. What must not come back is a walk
  // feeding THIS gate — that is the drift, and re-reading a directory here is
  // the only way to reintroduce it.
  const testAll = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
  const start = testAll.indexOf('1. SYNTAX CHECKS');
  const end = testAll.indexOf('2. SCRIPT EXECUTION');
  assert.ok(start > 0 && end > start, 'section 1 and 2 banners must still be findable');
  assert.ok(!/readdirSync\s*\(/.test(testAll.slice(start, end)),
    'the syntax gate must not re-derive its file list from its own readdir walk');
});
