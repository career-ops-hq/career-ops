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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMjsFiles, isNestedCheckout, SKIP_DIRS } from '../lib/mjs-files.mjs';

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

test('a nested checkout is not walked as this repository\u2019s source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-mjs-files-'));
  try {
    writeFileSync(join(dir, 'real.mjs'), '');

    // A linked worktree, exactly as git writes one: a `.git` FILE holding a
    // gitdir pointer. The `.git` entry in SKIP_DIRS matches a NAME, so it never
    // fires here, and the walk used to descend into the whole second checkout —
    // 1097 files reported in a 576-file repo (#3499).
    mkdirSync(join(dir, 'wt'));
    writeFileSync(join(dir, 'wt', '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    writeFileSync(join(dir, 'wt', 'stale.mjs'), '');
    mkdirSync(join(dir, 'wt', 'tests'));
    writeFileSync(join(dir, 'wt', 'tests', 'deep.mjs'), '');

    // A nested independent clone marks itself with a `.git` DIRECTORY. SKIP_DIRS
    // drops git's storage there but not the working tree beside it, so the same
    // second-copy hazard applies.
    mkdirSync(join(dir, 'clone', '.git'), { recursive: true });
    writeFileSync(join(dir, 'clone', 'other.mjs'), '');

    const rel = collectMjsFiles(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, '/'));

    assert.deepEqual(rel, ['real.mjs'],
      `only this checkout's source is walked, got: ${rel.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the walk root is exempt, so running from inside a worktree still checks it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-mjs-files-'));
  try {
    // The root's own `.git` is what makes it the repository, and in a linked
    // worktree it is a file — the same marker the predicate skips on below the
    // root. Applying it to the root would return [] and the syntax gate would
    // report "0 .mjs files" and pass, having checked nothing: strictly worse
    // than the bug it fixes, and the same shape as #3419.
    writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/self\n');
    writeFileSync(join(dir, 'source.mjs'), '');
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'nested.mjs'), '');

    const rel = collectMjsFiles(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, '/'));

    assert.deepEqual(rel, ['lib/nested.mjs', 'source.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isNestedCheckout detects the marker, of either type, and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-mjs-files-'));
  try {
    mkdirSync(join(dir, 'worktree'));
    writeFileSync(join(dir, 'worktree', '.git'), 'gitdir: /elsewhere\n');
    mkdirSync(join(dir, 'clone', '.git'), { recursive: true });
    mkdirSync(join(dir, 'plain'));

    assert.equal(isNestedCheckout(join(dir, 'worktree')), true, 'a .git file is a linked worktree or submodule');
    assert.equal(isNestedCheckout(join(dir, 'clone')), true, 'a .git directory is an independent clone');
    assert.equal(isNestedCheckout(join(dir, 'plain')), false, 'an ordinary subdirectory is source');
    assert.equal(isNestedCheckout(join(dir, 'does-not-exist')), false, 'a missing directory is not a checkout');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every recursive walker over this checkout consults the shared predicate', () => {
  // The previous form of this test pinned three callers BY NAME, and a fourth
  // walker — `test-all.mjs`'s `discoverTests`, the one that hands what it finds
  // to the RUNNER — was omitted precisely because nothing enumerated it: a
  // worktree under `tests/` executed its own stale suites and the run printed
  // "safe to push/merge" for them (#3762). A list cannot catch the walker
  // nobody remembered to add to the list, so this asserts the property instead:
  // every self-recursive `readdirSync` walk in this repository either consults
  // `isNestedCheckout` or is a named, reasoned exemption below.
  //
  // Walkers keep their own recursion rather than calling `collectMjsFiles`
  // because each filters differently (.test.mjs, dot-dirs, per-caller skip
  // sets) — but a hand-rolled `.git` rule is the drift, so they share the
  // predicate.

  // Anchored at a THIRD-PARTY plugin directory, not at this checkout, so
  // "somebody else's source tree" is exactly what they are meant to be reading.
  // For the lock hasher this is load-bearing: skipping a directory that carries
  // a `.git` marker would let a plugin park executable code inside one and drop
  // it out of the integrity hash — the rug-pull that file exists to prevent.
  const EXEMPT = new Map([
    ['plugins/_lock.mjs:walk', 'hashes a plugin tree; skipping a marked dir would be an integrity blind spot'],
    ['plugin-audit.mjs:walk', 'audits a plugin tree, which is not this repository’s source'],
  ]);

  // A function is a walker when its body reads a directory and calls ITSELF.
  // Non-recursive `readdirSync` (a single-level filter, a listing) is not this
  // bug: a nested checkout is a directory, and only descending into one is how
  // its contents get graded.
  const DECL = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/;
  const walkers = [];
  for (const file of collectMjsFiles(ROOT)) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const lines = readFileSync(file, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = DECL.exec(lines[i]);
      if (!m) continue;
      const name = m[1] ?? m[2];
      // Body span by brace balance from the declaration line.
      let depth = 0, opened = false, end = -1;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; opened = true; }
          else if (ch === '}') depth--;
        }
        if (opened && depth <= 0) { end = j; break; }
      }
      if (end < 0) continue;
      const body = lines.slice(i, end + 1).join('\n');
      const inner = lines.slice(i + 1, end + 1).join('\n');
      const selfCall = new RegExp(`\\b${name}\\s*\\(`);
      if (!body.includes('readdirSync(') || !selfCall.test(inner)) continue;
      walkers.push({ id: `${rel}:${name}`, file: rel, line: i + 1, body });
    }
  }

  // A detector that silently stops matching would turn this into a green test
  // of nothing — the exact failure shape lib/mjs-files.mjs exists to remove
  // (#3419). The floor is well below today's count, so it survives a walker
  // being deleted but not the parser breaking.
  assert.ok(
    walkers.length >= 8,
    `found only ${walkers.length} recursive walkers — the detector has stopped matching, not the repo stopped walking`,
  );

  const unguarded = walkers
    .filter((w) => !EXEMPT.has(w.id) && !/isNestedCheckout\(/.test(w.body))
    .map((w) => `${w.file}:${w.line} (${w.id.split(':')[1]})`);
  assert.deepEqual(
    unguarded,
    [],
    `recursive walker(s) descend into a nested checkout unguarded: ${unguarded.join(', ')} — ` +
    'call isNestedCheckout() on child directories, or add a reasoned entry to EXEMPT (#3499, #3762)',
  );

  // An exemption for a walker that no longer exists is a stale claim about the
  // code, and the next reader would take it for a reviewed decision.
  for (const id of EXEMPT.keys()) {
    assert.ok(walkers.some((w) => w.id === id), `EXEMPT lists ${id}, which is no longer a recursive walker`);
  }

  // The IMPORT is a separate assertion from the call. Matching
  // `isNestedCheckout(` anywhere is satisfied by a local
  // `const isNestedCheckout = () => false` — a hand-rolled re-implementation
  // wearing the shared name, which is precisely the drift this test exists to
  // catch, passing as proof against itself. Pinning the import binds the name
  // to the one definition. Derived from the guarded walkers, never listed.
  const guardedFiles = [...new Set(walkers.filter((w) => !EXEMPT.has(w.id)).map((w) => w.file))];
  for (const caller of guardedFiles) {
    if (caller === 'lib/mjs-files.mjs') continue;   // the definition itself
    const src = readFileSync(join(ROOT, caller), 'utf-8');
    assert.match(
      src,
      /import\s*\{[^}]*\bisNestedCheckout\b[^}]*\}\s*from\s*'\.{1,2}\/lib\/mjs-files\.mjs'/,
      `${caller} must import isNestedCheckout FROM lib/mjs-files.mjs, not re-implement it (#3499)`,
    );
  }
});

test('a checkout under tests/ does not get its suites EXECUTED by the runner', () => {
  // The end of the #3762 chain, asserted where it bites. Every other walker in
  // this repository READS what it finds; `discoverTests` feeds `node:test`, so
  // a worktree under `tests/` ran a stale checkout's suites against the current
  // tree and `test-all.mjs` printed "🟢 All tests passed — safe to push/merge"
  // for them. The marker is what the predicate keys on, so a plain file named
  // `.git` reproduces it exactly as `git worktree add tests/x` does, without
  // needing git.
  const fixture = join(ROOT, 'tests', 'nested-checkout-fixture-3762');
  rmSync(fixture, { recursive: true, force: true });
  try {
    mkdirSync(join(fixture, 'tests'), { recursive: true });
    writeFileSync(join(fixture, '.git'), 'gitdir: /nowhere\n');
    writeFileSync(
      join(fixture, 'tests', 'stale.test.mjs'),
      "import test from 'node:test';\ntest('a stale checkout suite must never run', () => {});\n",
    );

    let status = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, ['test-all.mjs', '--only', 'nested-checkout-fixture-3762'], {
        cwd: ROOT, encoding: 'utf-8', timeout: 120000,
      });
    } catch (err) {
      status = err.status;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }

    // `--only` exits 1 on an empty match precisely so a path typo cannot turn
    // CI green; here that same exit is the pass condition — the stale suite was
    // not discovered, so there was nothing to run.
    assert.equal(status, 1, `the runner discovered suites inside a nested checkout:\n${output}`);
    assert.match(output, /no test files matched/, output);
    assert.doesNotMatch(output, /stale\.test\.mjs/, output);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
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
