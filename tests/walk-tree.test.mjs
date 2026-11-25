// tests/walk-tree.test.mjs — the guard is a property of one walker, and a ban
// keeps it that way.
//
// Run:  node --test tests/walk-tree.test.mjs
//
// This file replaces ~430 lines of source analysis that tried to prove, for
// each of fourteen hand-rolled recursions, that it consulted `isNestedCheckout`
// on the path it was about to descend into. That is a DATAFLOW question asked
// with TEXT MATCHING, and over four review rounds on #3792 it had eleven
// distinct bypasses found and closed in it: a guard on the directory being read
// rather than the child; a guard on an unrelated path; `const full = dir`;
// `resolve(dir)`; `join(dir, 'safe')`; the result computed and dropped; the
// guard placed after the descent; the guard on the second of two descents; the
// right argument in the wrong branch; shapes the parser could not see; and an
// entry guard accepted because it sat after a WRAPPER read the reader resolved
// transitively but the position rule did not. Every fix was real. Round twelve
// would have found something too — an approximation of a dataflow question has
// no fixed point (#3818).
//
// So the file splits in two, and neither half is an approximation:
//
//   1. BEHAVIOUR — plant real markers in a real temp tree and assert the real
//      walker does not return anything under them. Once, not fourteen times,
//      and by running the code rather than by reading it.
//
//   2. THE BAN — no other recursive directory walker may exist. "Is there a
//      recursion here that reads a directory?" is a question about the call
//      graph, which is decidable; "does this branch prevent that descent?" is
//      not, at this budget. None of the eleven bypasses above is expressible
//      against the ban, because every one of them lives inside a recursion the
//      ban does not permit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkTree, listTree, isNestedCheckout } from '../lib/walk-tree.mjs';
import { SCRATCH_PREFIX } from '../lib/scratch-dirs.mjs';
import { collectMjsFiles } from '../lib/mjs-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Build a tree from a {relPath: contents} map; a `null` value makes a directory. */
function tree(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'walk-tree-'));
  for (const [rel, contents] of Object.entries(spec)) {
    const abs = join(dir, ...rel.split('/'));
    if (contents === null) { mkdirSync(abs, { recursive: true }); continue; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return dir;
}
const rel = (dir, paths) => paths.map((p) => relative(dir, p).split(sep).join('/')).sort();

// ───────────────────────────────────────────────────────────────────────────
// 1. Behaviour: the guard, proved by running it
// ───────────────────────────────────────────────────────────────────────────

test('nothing below a nested checkout is ever returned, at any depth or marker type', () => {
  // Depths 1, 2 and 3, and both marker types — a `.git` FILE (linked worktree
  // or submodule) and a `.git` DIRECTORY (nested independent clone). The
  // file/directory distinction is the whole of #3499: excluding the NAME `.git`
  // catches all of git's storage in a clone and none of it in a worktree.
  const dir = tree({
    'keep.mjs': 'ok',
    'src/keep.mjs': 'ok',
    'src/deep/keep.mjs': 'ok',

    'wt/.git': 'gitdir: /elsewhere/.git/worktrees/wt',   // depth 1, file marker
    'wt/stale.mjs': 'STALE',
    'wt/nested/stale.mjs': 'STALE',

    'src/clone/.git/HEAD': 'ref: refs/heads/main',        // depth 2, dir marker
    'src/clone/stale.mjs': 'STALE',

    'src/deep/wt2/.git': 'gitdir: /elsewhere',            // depth 3, file marker
    'src/deep/wt2/stale.mjs': 'STALE',
  });
  try {
    const found = rel(dir, walkTree(dir));
    assert.deepEqual(found, ['keep.mjs', 'src/deep/keep.mjs', 'src/keep.mjs']);
    // The assertion that matters is stated as a property, not as a list: no
    // returned path may sit under a marked directory, whatever the tree holds.
    for (const p of found) {
      assert.ok(!/(^|\/)(wt|wt2|clone)\//.test(p), `${p} came from a nested checkout`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the walk ROOT is never tested — a gate run from inside a worktree checks that worktree', () => {
  // The root's own `.git` is what makes it a repository. Testing it would make
  // every gate return an empty list when run from a linked worktree, and a gate
  // that reports "0 files" and passes is worse than the bug it replaced (#3419).
  const dir = tree({ '.git': 'gitdir: /elsewhere/.git/worktrees/self', 'a.mjs': 'ok' });
  try {
    assert.equal(isNestedCheckout(dir), true, 'the fixture root really is marked');
    assert.deepEqual(rel(dir, walkTree(dir)), ['.git', 'a.mjs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allowNestedCheckouts descends anyway — the exemption is a call-site argument', () => {
  // plugins/_lock.mjs and the plugin deny-list scans need this: a third-party
  // directory that could opt out of an integrity hash by planting a `.git`
  // marker is a place to hide code.
  const dir = tree({ 'plug/.git': 'gitdir: /elsewhere', 'plug/index.mjs': 'x' });
  try {
    assert.deepEqual(rel(dir, walkTree(dir)), [], 'guarded by default');
    assert.deepEqual(
      rel(dir, walkTree(dir, { allowNestedCheckouts: true })),
      ['plug/.git', 'plug/index.mjs'],
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a leftover scratch copy is skipped like a checkout — directories only, at any depth', () => {
  // A copy left by an interrupted test-all.mjs carries no `.git`, so only its
  // name marks it (#3940). Planted at the root and nested inside another, the
  // shape a copy that wrapped an earlier leftover produces. A FILE carrying the
  // prefix is source and must survive: skipping it would quietly drop it from
  // the syntax gate.
  const dir = tree({
    'keep.mjs': 'ok',
    [`${SCRATCH_PREFIX}OP9Bzd/tests/stale.test.mjs`]: 'STALE',
    [`sub/${SCRATCH_PREFIX}tBjFgy/stale.mjs`]: 'STALE',
    [`${SCRATCH_PREFIX}named-like-one.mjs`]: 'a real source file',
  });
  try {
    assert.deepEqual(rel(dir, walkTree(dir)), [`${SCRATCH_PREFIX}named-like-one.mjs`, 'keep.mjs']);
    // The repo collectors inherit it, which is what keeps the ban below from
    // naming files that ship to nobody after a killed run.
    assert.deepEqual(rel(dir, collectMjsFiles(dir)), [`${SCRATCH_PREFIX}named-like-one.mjs`, 'keep.mjs']);
    // ...and the third-party scans do NOT: a plugin directory named like a
    // scratch copy is as much a hiding place as one carrying `.git`.
    assert.ok(
      rel(dir, walkTree(dir, { allowNestedCheckouts: true })).includes(`sub/${SCRATCH_PREFIX}tBjFgy/stale.mjs`),
      'allowNestedCheckouts must descend into a scratch-named directory too',
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listTree carries the same guard, so a one-call walk cannot forget it', () => {
  const dir = tree({ 'a.md': 'x', 'wt/.git': 'gitdir: /e', 'wt/b.md': 'x', 'sub/c.md': 'x', 'sub/d.txt': 'x' });
  try {
    assert.deepEqual(rel(dir, listTree(dir, { match: /\.md$/ })), ['a.md', 'sub/c.md']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('skip sees files and directories, and depth 0 means "directly inside the root"', () => {
  // test-all.mjs's tree copy needs the root-only form: a top-level `data/` is
  // excluded, but `test-fixtures/upgrade/state-*/data` must still be copied.
  const dir = tree({ 'data/x.mjs': 'x', 'sub/data/y.mjs': 'y', 'skipme.mjs': 'z', 'keep.mjs': 'k' });
  try {
    const found = rel(dir, walkTree(dir, {
      skip: (entry, _d, depth) =>
        (depth === 0 && entry.isDirectory() && entry.name === 'data') || entry.name === 'skipme.mjs',
    }));
    assert.deepEqual(found, ['keep.mjs', 'sub/data/y.mjs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('onDir materialises directories the file callback never sees, including empty ones', () => {
  const dir = tree({ 'empty': null, 'sub/f.txt': 'x' });
  try {
    const dirs = [];
    walkTree(dir, { onDir: (abs) => dirs.push(abs) });
    assert.deepEqual(rel(dir, dirs), ['empty', 'sub']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('entries are sorted at every level, so run order does not depend on the filesystem', () => {
  const dir = tree({ 'b/2.txt': 'x', 'b/1.txt': 'x', 'a.txt': 'x', 'c.txt': 'x' });
  try {
    assert.deepEqual(rel(dir, walkTree(dir)).length, 4);
    const order = walkTree(dir).map((p) => relative(dir, p).split(sep).join('/'));
    assert.deepEqual(order, ['a.txt', 'b/1.txt', 'b/2.txt', 'c.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing ROOT throws whatever onError says; a vanished child does not', () => {
  // Asymmetric on purpose. Below the root, ENOENT is a race with readdir — a
  // concurrent checkout, a test tearing down a temp tree — and aborting a whole
  // run over a directory that has ceased to be helps nobody. At the root it is
  // a bad argument, and swallowing it would return [] and pass a gate that
  // checked nothing.
  assert.throws(() => walkTree(join(tmpdir(), 'walk-tree-does-not-exist-3818')), { code: 'ENOENT' });
  assert.throws(
    () => walkTree(join(tmpdir(), 'walk-tree-does-not-exist-3818'), { onError: 'ignore' }),
    { code: 'ENOENT' },
    'onError is about children; it must not be able to silence a bad root',
  );
});

test('symlink policy: skip by default, follow on request, reject when a hash depends on it', (t) => {
  const dir = tree({ 'real/f.txt': 'x', 'here.txt': 'y' });
  try {
    try {
      symlinkSync(join(dir, 'real'), join(dir, 'link'), 'dir');
    } catch {
      t.skip('this machine cannot create directory symlinks (Windows without Developer Mode)');
      return;
    }
    assert.deepEqual(rel(dir, walkTree(dir)), ['here.txt', 'real/f.txt'], 'default skips links');
    assert.deepEqual(
      rel(dir, walkTree(dir, { links: 'follow' })),
      ['here.txt', 'link/f.txt', 'real/f.txt'],
    );
    assert.throws(() => walkTree(dir, { links: 'reject' }), /refusing to follow symlink/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a symlinked FILE is dropped by default and returned under links: follow', (t) => {
  // The plugin deny-list scans rely on this half: the walks they replaced
  // pushed a symlinked .mjs because a link's Dirent is not a directory, so it
  // fell through to the file branch. Dropping it would make a link the same
  // hiding place nested checkouts used to be.
  const dir = tree({ 'outside/evil.mjs': 'x', 'plug/index.mjs': 'y' });
  try {
    try {
      symlinkSync(join(dir, 'outside', 'evil.mjs'), join(dir, 'plug', 'linked.mjs'), 'file');
    } catch {
      t.skip('this machine cannot create symlinks (Windows without Developer Mode)');
      return;
    }
    const plug = join(dir, 'plug');
    assert.deepEqual(rel(plug, walkTree(plug)), ['index.mjs']);
    assert.deepEqual(rel(plug, walkTree(plug, { links: 'follow' })), ['index.mjs', 'linked.mjs']);
    assert.deepEqual(rel(plug, listTree(plug, { links: 'follow', match: /\.mjs$/ })), ['index.mjs', 'linked.mjs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('links: follow survives a link onto an ancestor, and still follows sibling aliases', (t) => {
  // A link pointing back up its own tree (docs/current -> docs/) passes statSync
  // as an ordinary directory, so without a cycle guard the walk re-enters it
  // until the path length or the stack gives out. Both callers that follow
  // links walk trees a user can shape: test-all.mjs's repo copy and
  // seed-fixture.mjs's fixture manifest.
  const dir = tree({ 'docs/a.txt': 'x', 'docs/deep/b.txt': 'y' });
  try {
    try {
      symlinkSync(join(dir, 'docs'), join(dir, 'docs', 'loop'), 'dir');
      symlinkSync(join(dir, 'docs'), join(dir, 'alias'), 'dir');
    } catch {
      t.skip('this machine cannot create directory symlinks (Windows without Developer Mode)');
      return;
    }
    const found = rel(dir, walkTree(dir, { links: 'follow' }));
    // The cycle terminates...
    assert.ok(found.length > 0 && found.length < 20, `walk did not terminate cleanly: ${found.length} paths`);
    assert.ok(found.includes('docs/a.txt') && found.includes('docs/deep/b.txt'));
    // ...and the guard is the ANCESTOR CHAIN, not a global visited set: `alias`
    // is a second route to a directory already walked, but it is not a cycle,
    // and a tree copy that dropped it would not mirror what is there.
    assert.ok(found.includes('alias/a.txt'), `a sibling alias must still be followed: ${found.join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the repo collectors inherit the guard without asking for it', () => {
  // The end-to-end shape: a worktree parked anywhere under the repo must not
  // put a second checkout's files into the syntax gate's list.
  const dir = tree({
    'a.mjs': 'x', 'lib/b.mjs': 'x',
    'wt/.git': 'gitdir: /elsewhere', 'wt/c.mjs': 'x', 'wt/lib/d.mjs': 'x',
  });
  try {
    assert.deepEqual(rel(dir, collectMjsFiles(dir)), ['a.mjs', 'lib/b.mjs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The ban: one recursion, and a decidable rule that keeps it that way
// ───────────────────────────────────────────────────────────────────────────

/**
 * Blank out comments, string literals and regex literals, leaving code.
 *
 * Prose that talks about `readdirSync` is not a call, and a regex literal can
 * hold quotes and braces (`/['"{]/`) that would unbalance every brace count
 * after it — which is not hypothetical: without this, two ordinary scripts read
 * as one 19KB function calling everything in the file, including itself.
 * Template substitutions are kept, because they hold real code.
 */
export function stripNonCode(src) {
  // A `/` opens a regex literal rather than a division when the last
  // significant token cannot end an expression.
  const REGEX_OK_BEFORE = /(?:^|[(,=:[!&|?{};+\-*%~^]|\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await))\s*$/;
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    // Tail slice, not the whole accumulator: `\s*$` against an ever-growing
    // string is quadratic, and the longest token this cares about is ten chars.
    if (c === '/' && REGEX_OK_BEFORE.test(out.slice(-32))) {
      i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i++; break; }
        else if (src[i] === '\n') break; // unterminated: it was a division after all
        i++;
      }
      while (i < n && /[a-z]/.test(src[i])) i++; // flags
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2;
          const start = i;
          while (i < n && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
          out += ` ${src.slice(start, i - 1)} `;
          continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const NAME = '[A-Za-z_$][\\w$]*';
const NOT_A_FUNCTION = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'await', 'new', 'do', 'else', 'with', 'super', 'this',
]);
// Every shape a walker has actually been written in here, plus the ones review
// pointed out it could be written in next. Round ten of #3792 was spent adding
// these one at a time to a detector that had assumed the first of them, so they
// are enumerated once, in one place, and tested below.
//
// A private method's `#` sits OUTSIDE the capture group, so `#walk` is recorded
// under `walk` — which is the name `this.#walk(...)` presents to the call scan
// too (`#` is a non-word character, so `\b` matches between it and the name).
// Property forms require a visible `=>` or `function` rather than just a `(`,
// so an ordinary parenthesized value (`total: (a + b)`) is not read as a
// function definition.
// Each pattern stops just BEFORE the parameter list (or, for the one shape that
// has none, just after its `=>`), so `bodyAt` always resumes from the same
// place whatever matched.
const DEFS = [
  new RegExp(`\\bfunction\\s*\\*?\\s*(${NAME})\\s*(?=\\()`, 'g'),                                       // function walk(dir)
  new RegExp(`\\b(?:const|let|var)\\s+(${NAME})\\s*=\\s*(?:async\\s*)?(?:function\\s*\\*?\\s*(?:${NAME})?\\s*)?(?=\\()`, 'g'), // const walk = (dir) =>
  new RegExp(`\\b(?:const|let|var)\\s+(${NAME})\\s*=\\s*(?:async\\s+)?${NAME}\\s*=>`, 'g'),             // const walk = dir => …  (no parens)
  new RegExp(`(?:^|[;{}\\s,])#?(${NAME})\\s*(?=\\([^()]*\\)\\s*\\{)`, 'gm'),                             // walk(dir) { … / #walk(dir) { …
  // obj.walk = (dir) => … / walk: (dir) => …  (property-assigned, object literal)
  new RegExp(`(?:^|[;{},\\s])(?:[\\w$]+\\s*\\.\\s*)?(${NAME})\\s*[:=]\\s*(?:async\\s*)?\\([^()]*\\)\\s*=>`, 'gm'),
  // obj.walk = dir => … / walk: dir => …
  new RegExp(`(?:^|[;{},\\s])(?:[\\w$]+\\s*\\.\\s*)?(${NAME})\\s*[:=]\\s*(?:async\\s+)?${NAME}\\s*=>`, 'gm'),
  // obj.walk = function (dir) { … } / walk: function (dir) { … }
  new RegExp(`(?:^|[;{},\\s])(?:[\\w$]+\\s*\\.\\s*)?(${NAME})\\s*[:=]\\s*(?:async\\s*)?function\\s*\\*?\\s*(?:${NAME})?\\s*(?=\\()`, 'gm'),
];

/** The body of the definition whose match ended at `idx`, brace-matched. */
function bodyAt(code, idx) {
  let i = idx;
  const skipWs = () => { while (i < code.length && /\s/.test(code[i])) i++; };
  skipWs();
  if (code[i] === '(') {
    let d = 0;
    while (i < code.length) {
      if (code[i] === '(') d++;
      else if (code[i] === ')') { d--; if (d === 0) { i++; break; } }
      i++;
    }
  }
  skipWs();
  if (code[i] === '=' && code[i + 1] === '>') { i += 2; skipWs(); }
  if (code[i] !== '{') {
    // Brace-less arrow: the body runs to the end of the expression.
    let d = 0;
    const start = i;
    while (i < code.length) {
      const c = code[i];
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) { if (d === 0) break; d--; }
      else if ((c === ';' || c === ',') && d === 0) break;
      i++;
    }
    return code.slice(start, i);
  }
  let d = 0;
  const start = i;
  while (i < code.length) {
    if (code[i] === '{') d++;
    else if (code[i] === '}') { d--; if (d === 0) { i++; break; } }
    i++;
  }
  return code.slice(start, i);
}

/**
 * The argument text of every call to `name` in `code`, parens balanced.
 *
 * A flat `[^)]*` cannot do this: it stops at the FIRST `)`, so a nested call in
 * the first argument hides everything after it —
 * `readdirSync(join(d, 'x'), { recursive: true })` reads as clean. Matching the
 * two halves independently across the whole file is worse in the other
 * direction: `mkdirSync(dest, { recursive: true })` appears dozens of times in
 * this repo, and every file holding one alongside any `readdirSync` would be
 * flagged. Balance the parens instead.
 *
 * @param {string} code - Source with comments, strings and regex literals blanked.
 * @param {string} name - Callee identifier.
 * @returns {string[]} Each call's argument list, without the enclosing parens.
 */
export function callArgs(code, name) {
  const out = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + m[0].length;
    const start = i;
    let depth = 1;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      i++;
    }
    out.push(code.slice(start, depth === 0 ? i - 1 : i));
  }
  return out;
}

/**
 * Names in `src` that are BOTH recursive and reach a directory read.
 *
 * Both halves are reachability over one call graph, which is why this is a
 * fraction of the size of what it replaces and has no branch-, position- or
 * argument-sensitivity to be fooled about:
 *
 *  - "reaches a read" is transitive, so a walker that reads through a local
 *    `readDir` wrapper counts (bypass #11);
 *  - "is recursive" means *can reach itself*, so mutual recursion between two
 *    halves of a walker counts as much as direct self-calls;
 *  - a name declared twice is one node whose body is the concatenation, so the
 *    conservative answer wins — over-flagging asks a human to look, which is
 *    the safe direction for a ban.
 */
export function recursiveDirWalkers(src) {
  const code = stripNonCode(src);
  if (!/\breaddirSync\s*\(|\bglobSync\s*\(/.test(code)) return [];

  const bodies = new Map();
  for (const re of DEFS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      const name = m[1];
      if (NOT_A_FUNCTION.has(name)) continue;
      const body = bodyAt(code, m.index + m[0].length);
      if (!body) continue;
      bodies.set(name, (bodies.get(name) ?? '') + '\n' + body);
    }
  }

  const names = new Set(bodies.keys());
  const calls = new Map();
  const reads = new Set();
  const CALLED = new RegExp(`\\b(${NAME})\\s*\\(`, 'g');
  for (const [name, body] of bodies) {
    if (/\breaddirSync\s*\(|\bglobSync\s*\(/.test(body)) reads.add(name);
    const edges = new Set();
    CALLED.lastIndex = 0;
    let m;
    while ((m = CALLED.exec(body)) !== null) if (names.has(m[1])) edges.add(m[1]);
    calls.set(name, edges);
  }

  // Transitive closure of "reaches a directory read".
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, edges] of calls) {
      if (reads.has(name)) continue;
      for (const c of edges) if (reads.has(c)) { reads.add(name); changed = true; break; }
    }
  }

  // "Can reach itself" — direct or mutual.
  const out = [];
  for (const name of names) {
    if (!reads.has(name)) continue;
    const seen = new Set();
    const stack = [...calls.get(name)];
    while (stack.length) {
      const c = stack.pop();
      if (c === name) { out.push(name); break; }
      if (seen.has(c)) continue;
      seen.add(c);
      for (const x of calls.get(c) ?? []) stack.push(x);
    }
  }
  return out.sort();
}

// The two walks that stay hand-rolled, each with the reason it cannot be the
// shared one. An entry here is a review event, not a formality.
const EXEMPT = new Map([
  ['plugins/_lock.mjs', [
    'walk',
    // Hashes a third-party plugin tree for integrity. It must THROW on a
    // symlink, on an unreadable directory, and on any non-regular file —
    // walkTree silently ignores the last of those, and an un-hashed entry in an
    // integrity hash is exactly the hole the hash exists to close. Bending
    // walkTree to express "fail on a fifo" would be bending a shared walker
    // around one caller's threat model.
  ]],
  ['intake.mjs', [
    'claimRealDirs', 'walk',
    // Deliberately follows symlinks (a symlinked master CV is a natural setup)
    // AND dedupes by realpath in two passes, so that the key written into
    // intake-state.json is the path the user created rather than whichever
    // alias readdir happened to reach first. Two mutually-constraining passes
    // over one tree is not a walk with options; it is a different algorithm.
  ]],
]);

test('lib/walk-tree.mjs holds the only recursive directory walker in the repo', () => {
  const offenders = [];
  for (const abs of collectMjsFiles(ROOT)) {
    const relPath = relative(ROOT, abs).split(sep).join('/');
    if (relPath === 'lib/walk-tree.mjs') continue;          // the one that is allowed to be one
    if (relPath === 'tests/walk-tree.test.mjs') continue;   // this file describes them; it is not one
    const allowed = new Set(EXEMPT.get(relPath) ?? []);
    for (const name of recursiveDirWalkers(readFileSync(abs, 'utf-8'))) {
      if (!allowed.has(name)) offenders.push(`${relPath}: ${name}()`);
    }
  }
  assert.deepEqual(
    offenders, [],
    'hand-rolled recursive directory walkers found. Use walkTree()/listTree() from '
    + 'lib/walk-tree.mjs — it applies the nested-checkout guard on every descent, so a '
    + 'linked worktree or nested clone can never feed a second repository into this one\'s '
    + 'gates (#3499, #3762). If the walk genuinely cannot use it, add it to EXEMPT above '
    + 'WITH the reason (#3818).',
  );
});

test('every EXEMPT entry still names a real walker — an exemption cannot outlive its walker', () => {
  for (const [relPath, names] of EXEMPT) {
    const abs = join(ROOT, relPath);
    assert.ok(existsSync(abs), `EXEMPT names ${relPath}, which no longer exists`);
    const found = new Set(recursiveDirWalkers(readFileSync(abs, 'utf-8')));
    for (const name of names) {
      assert.ok(found.has(name), `EXEMPT lists ${relPath}: ${name}(), which is no longer a recursive directory walker — drop the entry`);
    }
  }
});

test('nothing outside lib/walk-tree.mjs recurses via globSync or readdirSync({recursive:true})', () => {
  // The other way to walk a tree, and neither form has any idea what a nested
  // checkout is. This half of the ban is pure presence matching, which is what
  // text matching is actually good at.
  const offenders = [];
  for (const abs of collectMjsFiles(ROOT)) {
    const relPath = relative(ROOT, abs).split(sep).join('/');
    if (relPath === 'lib/walk-tree.mjs' || relPath === 'tests/walk-tree.test.mjs') continue;
    const code = stripNonCode(readFileSync(abs, 'utf-8'));
    if (/\bglobSync\s*\(/.test(code)) offenders.push(`${relPath}: globSync`);
    if (callArgs(code, 'readdirSync').some((args) => /\brecursive\s*:\s*true\b/.test(args))) {
      offenders.push(`${relPath}: readdirSync({recursive:true})`);
    }
  }
  assert.deepEqual(offenders, [], 'use listTree() from lib/walk-tree.mjs, which applies the nested-checkout guard (#3818)');
});

// ── The detector's own tests ────────────────────────────────────────────────
// A ban is only as good as its ability to see a walker. Every shape below cost
// a review round on #3792, so they are pinned rather than re-discovered.

test('the detector sees a recursive directory walker in every shape one has been written in', () => {
  const shapes = {
    'function declaration': 'function walk(d) { for (const e of readdirSync(d)) walk(join(d, e)); }',
    'const arrow with parens': 'const walk = (d) => { for (const e of readdirSync(d)) walk(e); };',
    'const arrow, unparenthesized param': 'const walk = d => { readdirSync(d).forEach(e => walk(e)); };',
    'brace-less arrow body': 'const walk = (d) => readdirSync(d).flatMap((e) => e.isDirectory() ? walk(e) : [e]);',
    'object / class method shorthand': 'const o = { walk(d) { for (const e of readdirSync(d)) this.walk(e); walk(d); } };',
    'async function': 'async function walk(d) { for (const e of readdirSync(d)) await walk(e); }',
    'reads through a local wrapper (bypass #11)':
      'const readDir = (d) => readdirSync(d, { withFileTypes: true });\n'
      + 'function walk(d) { for (const e of readDir(d)) walk(join(d, e.name)); }',
    'mutual recursion': 'function walk(d) { for (const e of readdirSync(d)) descend(e); }\nfunction descend(d) { walk(d); }',
    'globSync instead of readdirSync': 'function walk(d) { for (const e of globSync(d + "/*")) walk(e); }',
    'declared twice, only one of them recursive':
      'const walk = (d) => readdirSync(d);\nfunction walk(d) { walk(d); }',
    'object-literal property': 'const fs2 = { walk: (d) => { for (const e of readdirSync(d)) fs2.walk(e); } };',
    'object-literal property, unparenthesized param': 'const fs2 = { walk: d => { readdirSync(d).forEach((e) => fs2.walk(e)); } };',
    'object-literal property, function expression': 'const fs2 = { walk: function (d) { for (const e of readdirSync(d)) fs2.walk(e); } };',
    'assigned to a property': 'const o = {};\no.walk = (d) => { for (const e of readdirSync(d)) o.walk(e); };',
    'class private method': 'class W { #walk(d) { for (const e of readdirSync(d)) this.#walk(e); } }',
  };
  for (const [label, src] of Object.entries(shapes)) {
    assert.ok(
      recursiveDirWalkers(src).length > 0,
      `the detector missed a recursive directory walker written as: ${label}`,
    );
  }
});

test('the detector does not flag what is not a recursive directory walk', () => {
  const clean = {
    'a flat read': 'function list(d) { return readdirSync(d).filter(f => f.endsWith(".md")); }',
    'recursion that reads no directory': 'function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }',
    'a caller of the shared walker': 'import { walkTree } from "./lib/walk-tree.mjs";\nfunction walk(d) { return walkTree(d); }',
    'the word in a comment': '// walk() used to readdirSync(dir) and call walk() again\nfunction walk(d) { return walkTree(d); }',
    'the word in a string': 'const help = "walk(dir) calls readdirSync(dir) then walk(child)";\nfunction walk(d) { return walkTree(d); }',
    'a regex literal holding braces and quotes':
      'const RE = /["{}]readdirSync\\(/;\nfunction walk(d) { return walkTree(d).filter(f => RE.test(f)); }',
    // The property patterns require a visible `=>` or `function`, so an
    // ordinary parenthesized value is not mistaken for a definition.
    'a parenthesized object value next to a flat read':
      'const cfg = { total: (1 + 2) };\nfunction list(d) { return readdirSync(d).length + cfg.total; }',
  };
  for (const [label, src] of Object.entries(clean)) {
    assert.deepEqual(recursiveDirWalkers(src), [], `false positive on: ${label}`);
  }
});

test('the recursive-readdir ban is call-scoped, so a nested call cannot hide the option', () => {
  // `readdirSync(...)` matched with a flat `[^)]*` stops at the FIRST `)`, so
  // the inner join() hid the option entirely.
  assert.deepEqual(
    callArgs(stripNonCode("readdirSync(join(d, 'x'), { recursive: true })"), 'readdirSync'),
    ["join(d,  ), { recursive: true }"],
  );
  const hasRecursive = (src) =>
    callArgs(stripNonCode(src), 'readdirSync').some((a) => /\brecursive\s*:\s*true\b/.test(a));

  assert.equal(hasRecursive("readdirSync(join(d, 'x'), { recursive: true })"), true, 'nested call must not hide it');
  assert.equal(hasRecursive('readdirSync(d, { recursive: true })'), true);
  // ...and the other direction, which is why this is not two file-wide regexes
  // ANDed together: `mkdirSync(x, { recursive: true })` appears dozens of times
  // in this repo, usually within a line or two of a legitimate flat readdir.
  assert.equal(
    hasRecursive("mkdirSync(dest, { recursive: true });\nconst names = readdirSync(dest);"),
    false,
    'an unrelated recursive:true elsewhere in the file must not be attributed to readdirSync',
  );
});

test('stripNonCode survives a regex literal without unbalancing the file after it', () => {
  // The concrete failure this prevents: a `/^["'{]/` literal read as a string
  // opener swallowed the rest of two scripts, and their every function came
  // back as one 19KB body that appeared to call itself.
  const src = 'const v = s.replace(/^["\'{]+/g, "");\nfunction later() { return 1; }';
  const code = stripNonCode(src);
  assert.ok(code.includes('function later'), 'code after a regex literal must survive');
  assert.ok(!code.includes('replace(/^'), 'the regex literal itself must be blanked');
});
