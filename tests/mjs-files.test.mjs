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

// ── Recursive-walker detection ───────────────────────────────────────────
// Used by the two tests below. A helper rather than an inline scan because a
// detector that silently stops matching turns its test into a green check of
// nothing — the failure shape lib/mjs-files.mjs exists to remove (#3419) — so
// the shapes it claims to recognize are themselves covered by fixtures.

/**
 * Blank every comment, string, template literal and regex literal, preserving
 * length and line structure.
 *
 * Two things depend on this. Brace counting: a `}` inside a string or a comment
 * ends the body early, the extracted body is truncated, and a real
 * `isNestedCheckout(` call falls outside it — a FALSE FAILURE naming a walker
 * that is correctly guarded. And guard detection: `isNestedCheckout(` written
 * in a comment would otherwise satisfy the gate, so a walker could be
 * documented as guarded while descending into every checkout it finds.
 *
 * @param {string} src - Source text.
 * @returns {string} Same length, with non-code spans replaced by spaces.
 */
function blankNonCode(src) {
  const out = src.split('');
  const blank = (i) => { if (src[i] !== '\n') out[i] = ' '; };
  let prev = '';       // last significant code character, for the regex/division split
  let prevWord = '';   // ...and the identifier it belongs to, when it is one
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') blank(i++);
      continue;
    }
    if (c === '/' && d === '*') {
      blank(i++); blank(i++);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) blank(i++);
      if (i < src.length) { blank(i++); blank(i++); }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      blank(i++);
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { blank(i++); if (i < src.length) blank(i++); continue; }
        blank(i++);
      }
      if (i < src.length) blank(i++);
      prev = 'x';   // a literal is a value, so a following `/` is division
      prevWord = '';
      continue;
    }
    // `/` opens a regex only where a value cannot precede it; after an
    // identifier, `)` or `]` it is division. Getting this wrong in the safe
    // direction (treating division as a regex) blanks code, so the rule is
    // deliberately conservative.
    //
    // A KEYWORD is an operand position too, and `prev` cannot see it: after
    // `return` the last significant character is a letter, so `return
    // /[{}]/.test(s)` read as division leaves those braces counted, `bodySpan`
    // ends the body early, and a real `isNestedCheckout(` call falls outside
    // it — the false failure this helper exists to prevent. `>` covers the
    // arrow body `=> /}/`.
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%~^>'.includes(prev) || KEYWORD_BEFORE_REGEX.test(prevWord))) {
      blank(i++);
      let inClass = false;
      while (i < src.length && src[i] !== '\n' && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') { blank(i++); if (i < src.length) blank(i++); continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        blank(i++);
      }
      if (i < src.length && src[i] === '/') blank(i++);
      prev = 'x';
      prevWord = '';
      continue;
    }
    if (!/\s/.test(c)) {
      prev = c;
      prevWord = /\w/.test(c) ? prevWord + c : '';
    }
    i++;
  }
  return out.join('');
}

// Keywords after which a `/` opens a regex literal rather than dividing:
// each expects an operand next. Hoisted so the scanner does not rebuild it per
// character.
const KEYWORD_BEFORE_REGEX = /(?:^|\b)(?:return|case|typeof|instanceof|in|of|new|delete|void|do|else|yield|await)$/;

// Statement keywords that take a parenthesized head followed by a block, which
// the method-shorthand pattern below is otherwise shaped exactly like.
const NOT_A_DECLARATION = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'with', 'return', 'function', 'typeof', 'await', 'yield',
]);

/**
 * Every function declaration in `code`, as {name, head} where `head` indexes
 * the start of its parameter list — the `(`, or the identifier itself for an
 * arrow whose single parameter is unparenthesized.
 *
 * Four shapes, because a walker written in any of them recurses just the same:
 * `function walk(...)`, `const walk = (...) =>` / `= function (...)`, the
 * method shorthand `walk(...) {` of a class body or object literal, and
 * `const walk = dir => ...`, where the parameter wears no parentheses at all.
 */
function declarations(code) {
  const found = [];
  const push = (name, head) => { if (!NOT_A_DECLARATION.has(name)) found.push({ name, head }); };
  for (const m of code.matchAll(/(?:^|[\n;{}(,])\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/g)) {
    push(m[1], m.index + m[0].length - 1);
  }
  for (const m of code.matchAll(/(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*\w*\s*)?\(/g)) {
    push(m[1], m.index + m[0].length - 1);
  }
  // Params without nested parens keeps this from matching a call whose argument
  // list contains one (`test('x', () => {`), which is not a declaration.
  for (const m of code.matchAll(/(?:^|[\n{,])\s*(?:static\s+|async\s+|get\s+|set\s+)?(\w+)\s*\([^()]*\)\s*\{/g)) {
    push(m[1], m.index + m[0].indexOf('('));
  }
  // `const walk = dir => ...`. The lookahead ends the match ON the parameter,
  // so `head` points at it the way it points at a `(` above.
  for (const m of code.matchAll(/(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?=[A-Za-z_$][\w$]*\s*=>)/g)) {
    push(m[1], m.index + m[0].length);
  }
  return found;
}

/**
 * The body span of the declaration whose parameter list starts at `head`.
 *
 * Handles the braced body and the brace-less arrow (`const walk = (d) =>
 * readdirSync(d).flatMap(...)`) — an earlier version required a `{`, so a
 * brace-less walker was silently dropped rather than audited.
 *
 * @returns {[number, number]|null} Half-open [start, end) into `code`.
 */
function bodySpan(code, head) {
  let i = head;
  if (code[i] === '(') {
    let depth = 0;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
  } else {
    // An unparenthesized arrow parameter: step over the identifier itself.
    while (i < code.length && /[\w$]/.test(code[i])) i++;
  }
  const arrow = /^\s*=>/.exec(code.slice(i));
  // A bare identifier is a parameter only when an arrow follows it.
  if (code[head] !== '(' && !arrow) return null;
  let j = i + (arrow ? arrow[0].length : 0);
  while (j < code.length && /\s/.test(code[j])) j++;
  if (code[j] === '{') {
    let d = 0;
    for (let k = j; k < code.length; k++) {
      if (code[k] === '{') d++;
      else if (code[k] === '}' && --d === 0) return [j, k + 1];
    }
    return null;
  }
  if (!arrow) return null;   // a bare declaration with no body (e.g. a call)
  // Brace-less arrow: the expression runs to its terminating `;` or to the
  // closer of whatever encloses it, whichever comes first.
  let d = 0;
  for (let k = j; k < code.length; k++) {
    const c = code[k];
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) { if (d === 0) return [j, k]; d--; }
    else if (c === ';' && d === 0) return [j, k];
  }
  return [j, code.length];
}

/**
 * Does the branch `guard` controls EXCLUDE the descent at `descentIndex`?
 *
 * Order, argument and a controlling position are still not enough:
 * `if (isNestedCheckout(full)) walk(full);` has all three and steps straight
 * into the checkout, because the branch it controls is the one that descends.
 * Polarity decides which side must hold the descent — a positive test has to
 * skip (`continue` / `return` / `break`) with the descent outside it, a negated
 * one has to wrap the descent.
 *
 * @param {string} body - The function body.
 * @param {{index: number, negated: boolean}} guard - A predicate call in it.
 * @param {number} descentIndex - Offset of the recursive call.
 * @returns {boolean}
 */
function branchExcludesDescent(body, guard, descentIndex) {
  // The span of `{...}` or `stmt;` starting at `from`.
  const consequentSpan = (from) => {
    let i = from;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] === '{') {
      let depth = 0;
      for (let k = i; k < body.length; k++) {
        if (body[k] === '{') depth++;
        else if (body[k] === '}' && --depth === 0) return [i, k + 1];
      }
      return null;
    }
    const end = body.indexOf(';', i);
    return end === -1 ? null : [i, end + 1];
  };
  const matching = (open, chars) => {
    let depth = 0;
    for (let k = open; k < body.length; k++) {
      if (chars[0].includes(body[k])) depth++;
      else if (chars[1].includes(body[k]) && --depth === 0) return k;
    }
    return -1;
  };

  // `if (...)` whose condition contains the guard.
  const ifs = [...body.matchAll(/\bif\s*\(/g)].filter((m) => m.index < guard.index);
  const nearestIf = ifs[ifs.length - 1];
  if (nearestIf) {
    const condOpen = nearestIf.index + nearestIf[0].length - 1;
    const condClose = matching(condOpen, ['(', ')']);
    if (condClose > guard.index) {
      const span = consequentSpan(condClose + 1);
      if (!span) return false;
      const inside = descentIndex >= span[0] && descentIndex < span[1];
      if (guard.negated) return inside;
      return !inside && /\b(?:continue|return|break)\b/.test(body.slice(span[0], span[1]));
    }
  }

  // `cond ? a : b` — the descent must sit on the side the predicate allows.
  const callClose = matching(body.indexOf('(', guard.index), ['([{', ')]}']);
  const rest = body.slice(callClose + 1);
  const q = rest.search(/\?/);
  const semi = rest.search(/;/);
  if (q !== -1 && (semi === -1 || q < semi)) {
    const colon = rest.indexOf(':', q);
    if (colon === -1) return false;
    const trueSide = [callClose + 1 + q, callClose + 1 + colon];
    const inTrue = descentIndex > trueSide[0] && descentIndex < trueSide[1];
    return guard.negated ? inTrue : !inTrue && descentIndex > trueSide[1];
  }
  return false;
}

/**
 * Is every recursive descent in `fn` preceded by a guard on THAT descent's own
 * argument?
 *
 * The rule is deliberately about the pairing rather than the shape of either
 * half, because every shape-based approximation had a way past it:
 *   - `isNestedCheckout(dir)` inside the read loop tests the directory being
 *     listed, so the files sitting directly in a checkout are still collected;
 *   - `const full = dir` and `resolve(dir)` name the parameter and still test
 *     the parent;
 *   - `join(dir, 'safe')` is a child path, of a directory the walk never
 *     descends into;
 *   - `isNestedCheckout(full);` as a statement computes a boolean and drops it;
 *   - a guard after the recursion prevents nothing, and a guard before the
 *     SECOND of two descents leaves the first unguarded;
 *   - `if (isNestedCheckout(full)) walk(full);` has the right argument in the
 *     right order under a real branch, and steps into the checkout, because
 *     the branch it controls is the descending one.
 *
 * Matching the guard's argument to the descent's argument answers all of them
 * at once: the guarded path is the path being entered, or it is not a guard.
 * Textual match after whitespace normalization — every walker in this
 * repository guards `full`, `p`, `abs` or `join(dir, entry.name)` and then
 * recurses into exactly that.
 *
 * The one exception stays the entry guard (`copyDirSync`): a controlling call
 * on the function's own parameter, before the first directory read, covers
 * every descent at once because the recursion re-enters through it.
 *
 * @param {{params: string, body: string}} fn - A declaration record.
 * @param {string[]} recursiveNames - Names whose call is the recursion.
 * @returns {boolean}
 */
function guardsEveryDescent(fn, recursiveNames) {
  const firstParam = /^\s*\(?\s*([A-Za-z_$][\w$]*)/.exec(fn.params)?.[1];
  if (!firstParam) return false;
  const norm = (expr) => expr.replace(/\s+/g, '');

  // The first argument of the call whose `(` is at `open`.
  const firstArg = (open) => {
    let depth = 0;
    for (let i = open; i < fn.body.length; i++) {
      const c = fn.body[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (--depth === 0) return fn.body.slice(open + 1, i); }
      else if (c === ',' && depth === 1) return fn.body.slice(open + 1, i);
    }
    return '';
  };

  // A guard is a call whose RESULT reaches a branch. A bare statement drops it.
  const guards = [...fn.body.matchAll(/\bisNestedCheckout\s*\(/g)]
    .map((m) => ({ m, before: fn.body.slice(Math.max(0, m.index - 60), m.index) }))
    .filter(({ before }) => /(?:if\s*\(|&&|\|\||!|\?|:|return\s|=>\s*)\s*$/.test(before))
    .map(({ m, before }) => ({
      index: m.index,
      arg: norm(firstArg(m.index + m[0].length - 1)),
      negated: /!\s*$/.test(before),
    }));

  // Covering a descent takes all four: the guard comes first, names the same
  // path, and the branch it controls is the one that does NOT descend.
  const covers = (g, descentIndex) =>
    g.index < descentIndex && branchExcludesDescent(fn.body, g, descentIndex);

  const descents = recursiveNames.flatMap((name) =>
    [...fn.body.matchAll(new RegExp(`\\b${name.split('#')[0]}\\s*\\(`, 'g'))]
      .map((m) => ({ index: m.index, arg: norm(firstArg(m.index + m[0].length - 1)) })),
  );
  if (descents.length === 0) return false;

  // The entry guard covers every descent at once — the recursion re-enters
  // through it — so it is checked against all of them, not one.
  const read = fn.body.search(/\breaddirSync\s*\(/);
  if (guards.some((g) => g.arg === firstParam && (read === -1 || g.index < read)
      && descents.every((d) => covers(g, d.index)))) return true;

  return descents.every((d) => guards.some((g) => g.arg === d.arg && g.arg !== '' && covers(g, d.index)));
}

/**
 * Every recursive directory walker in `entries`.
 *
 * A walker reads a directory and reaches itself through the file's own call
 * graph — which covers mutual recursion (`a` calls `b` calls `a`), where no
 * single body contains a call to itself. The read counts transitively too: a
 * body that calls a local `readDir` wrapper is reading a directory, and
 * requiring the literal `readdirSync(` made `intake.mjs`'s recursion over
 * `documents/` invisible. Non-recursive `readdirSync` is not this bug: a nested
 * checkout is a directory, and only descending into one gets its contents
 * graded.
 *
 * `guarded` is reported over the whole recursion cycle, not one body: in a
 * mutually recursive pair, either half may hold the guard. The ARGUMENT is
 * checked, not just the call: `isNestedCheckout(dir)` inside the loop tests the
 * directory being read rather than the child about to be descended into, so it
 * skips a marked directory's subdirectories while still walking the files
 * directly inside it. That mutant passed the gate. The one shape where testing
 * the walk's own parameter IS correct is a guard placed BEFORE the read, at
 * function entry (`copyDirSync`), where every child is checked as it recurses.
 *
 * @param {{rel: string, src: string}[]} entries
 * @returns {{id: string, file: string, name: string, line: number, guarded: boolean}[]}
 */
function findRecursiveWalkers(entries) {
  const walkers = [];
  for (const { rel, src } of entries) {
    const code = blankNonCode(src);
    // Keyed per DECLARATION, not per name. Keeping only the first `walk` in a
    // file drops the second — and a file whose first `walk` is a flat listing
    // would hide a recursive one below it, which is this issue's own failure
    // shape (a walker nothing enumerates). Duplicate names are common here:
    // 19 files declare one, including this test's own fixtures.
    const fns = new Map();
    const seenNames = new Map();
    for (const { name, head } of declarations(code)) {
      const span = bodySpan(code, head);
      if (!span) continue;
      const n = (seenNames.get(name) ?? 0) + 1;
      seenNames.set(name, n);
      // The first declaration keeps the bare `file:name` id, so an EXEMPT entry
      // stays stable when an unrelated same-named function is added later.
      fns.set(n === 1 ? name : `${name}#${n}`, {
        name,
        head,
        // The parameter list as written, so a guard's argument can be compared
        // against the directory this function was handed.
        params: code.slice(head, span[0]),
        body: code.slice(span[0], span[1]),
      });
    }
    // A call resolves BY NAME, so with duplicates it reaches every declaration
    // wearing that name. Deliberately over-approximate: the wrong direction to
    // err in is the one that drops an edge, because that hides a walker
    // silently, while a spurious edge at worst asks for a guard on a function
    // that turns out not to need one — loudly, in a failure someone reads.
    const callsOf = new Map(
      [...fns.entries()].map(([key, fn]) => [
        key,
        [...fns.entries()].filter(([, other]) => new RegExp(`\\b${other.name}\\s*\\(`).test(fn.body)).map(([k]) => k),
      ]),
    );
    const reaches = (from, target) => {
      const seen = new Set();
      const queue = [...(callsOf.get(from) ?? [])];
      while (queue.length) {
        const n = queue.shift();
        if (n === target) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(...(callsOf.get(n) ?? []));
      }
      return false;
    };
    // Reading a directory counts through a local wrapper, so a walker whose
    // body only calls `readDir(dir)` is still a walker.
    const readsDir = (key, seen = new Set()) => {
      if (seen.has(key)) return false;
      seen.add(key);
      if (fns.get(key).body.includes('readdirSync(')) return true;
      return (callsOf.get(key) ?? []).some((k) => readsDir(k, seen));
    };
    for (const [key, fn] of fns) {
      if (!readsDir(key)) continue;
      if (!reaches(key, key)) continue;
      // The recursion cycle: everything fn reaches that reaches fn back. The
      // guard may sit in either half of a mutually recursive pair, and nowhere
      // else counts — a mention in some unrelated function it happens to call
      // is not this walker being guarded.
      const cycle = [key, ...[...fns.keys()].filter((k) => k !== key && reaches(key, k) && reaches(k, key))];
      walkers.push({
        id: `${rel}:${key}`,
        file: rel,
        name: key,
        line: src.slice(0, fn.head).split('\n').length,
        // EVERY member of the cycle, not any: in a mutually recursive pair, a
        // guarded half does not make the unguarded half's descent safe.
        guarded: cycle.every((k) => guardsEveryDescent(fns.get(k), cycle)),
      });
    }
  }
  return walkers;
}
test('the walker detector recognizes every shape it claims to, and only real recursion', () => {
  // Fixtures, not repository files: the detector's limits must fail a test
  // rather than pass silently, and the three shapes below are exactly the ones
  // an earlier version missed — each would have let an unguarded walker through
  // while the repo-wide test opposite stayed green (#3762 review).
  const f = (rel, src) => ({ rel, src });
  const found = findRecursiveWalkers([
    // A method walker in an object literal or class body.
    f('method.mjs', `
      const scanner = {
        walk(dir) {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) this.walk(join(dir, e.name));
          }
        },
      };
    `),
    // A brace-less arrow walker: no body braces at all.
    f('arrowless.mjs', `
      const walk = (d) => readdirSync(d, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    `),
    // Mutual recursion: neither body calls itself.
    f('mutual.mjs', `
      function descend(dir) { return collect(join(dir, 'x')); }
      function collect(dir) {
        for (const e of readdirSync(dir)) descend(join(dir, e));
      }
    `),
    // Guarded, with braces inside a string, a comment and a regex. Counting
    // those would truncate the body and drop the guard out of it — a false
    // failure against a walker that is correct.
    f('braces-in-literals.mjs', `
      function walk(dir) {
        const tpl = '}}}';                 // }
        const re = /[{}]}/;                /* } } } */
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { const full = join(dir, e.name); if (isNestedCheckout(full)) continue; walk(full); }
        }
        return tpl + re;
      }
    `),
    // Guarded, with a regex literal in a KEYWORD position before the guard.
    // Read as division, `/[{}]/` leaves its braces counted and the body ends
    // before the guard — a false failure against a correct walker.
    f('regex-after-keyword.mjs', `
      function walk(dir, depth) {
        if (depth > 9) return /[{}]/.test(dir);
        const skip = (name) => /}{/.test(name);
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { const full = join(dir, e.name); if (isNestedCheckout(full) || skip(e.name)) continue; walk(full, depth + 1); }
        }
        return true;
      }
    `),
    // An arrow whose single parameter wears no parentheses.
    f('arrow-ident.mjs', `
      const walk = dir => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(join(dir, e.name));
        }
      };
    `),
    // Two declarations of one name: a flat listing first, an unguarded walker
    // second. Keeping only the first hid the second entirely.
    f('duplicate-names.mjs', `
      function walk(dir) { return readdirSync(dir).length; }
      export function scan(root) {
        function walk(dir) {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) walk(join(dir, e.name));
          }
        }
        return walk(root);
      }
    `),
    // Reads through a local wrapper: no literal readdirSync in the walker.
    f('wrapper-read.mjs', `
      function scan(root) {
        const readDir = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };
        const walk = (dir) => {
          for (const e of readDir(dir)) if (e.isDirectory()) walk(join(dir, e.name));
        };
        return walk(root);
      }
    `),
    // Consults the predicate on the directory being READ, not the child about
    // to be descended into: files sitting directly inside a marked directory
    // are still collected. A call is not a guard.
    f('guards-parent.mjs', `
      function walk(dir, out) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { if (isNestedCheckout(dir)) continue; walk(join(dir, e.name), out); }
          else out.push(e.name);
        }
      }
    `),
    // The one shape where testing the walk's own parameter is right: a guard at
    // function ENTRY, before the read, which the recursion applies to every
    // child as it enters.
    f('entry-guard.mjs', `
      const copyDir = (src, dest) => {
        if (src !== ROOT && isNestedCheckout(src)) return;
        for (const name of readdirSync(src)) copyDir(join(src, name), join(dest, name));
      };
    `),
    // Calls the predicate on a directory it never descends into. A call is not
    // a guard: this walks every nested checkout exactly as if the line were
    // absent, and "not the walk's own parameter" used to be enough to pass.
    f('guards-elsewhere.mjs', `
      function walk(dir) {
        if (isNestedCheckout(ROOT)) return;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(join(dir, e.name));
        }
      }
    `),
    // An ALIAS of the parent wearing a child's name. It mentions `dir`, which
    // used to be enough, and tests the directory already being read.
    f('guards-alias.mjs', `
      function walk(dir) {
        const full = dir;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { if (isNestedCheckout(full)) continue; walk(join(dir, e.name)); }
        }
      }
    `),
    // The parent again, normalized inline. One operand, so nothing about the
    // current entry reaches the predicate.
    f('guards-normalized-parent.mjs', `
      function walk(dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { if (isNestedCheckout(resolve(dir))) continue; walk(join(dir, e.name)); }
        }
      }
    `),
    // Right argument, result thrown away: the boolean is computed and the walk
    // descends anyway.
    f('guards-ignored-result.mjs', `
      function walk(dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) { isNestedCheckout(full); walk(full); }
        }
      }
    `),
    // Right argument, right branch, but AFTER the recursion it should have
    // prevented.
    f('guards-too-late.mjs', `
      function walk(dir, out) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) { walk(full, out); if (isNestedCheckout(full)) out.push(full); }
        }
      }
    `),
    // A child path, of a directory the walk never enters: it tests
    // `join(dir, 'safe')` and descends into `join(dir, e.name)`.
    f('guards-other-child.mjs', `
      function walk(dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { if (isNestedCheckout(join(dir, 'safe'))) continue; walk(join(dir, e.name)); }
        }
      }
    `),
    // Two descents, one guard: the first call runs before the check, so it
    // enters a nested checkout no matter what the second one does.
    f('guards-second-descent-only.mjs', `
      function walk(dir, out) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === 'first') walk(full, out);
            if (isNestedCheckout(full)) continue;
            walk(full, out);
          }
        }
      }
    `),
    // Right argument, right order, real branch — and the branch it controls is
    // the one that descends. Polarity is the whole difference.
    f('guards-wrong-polarity.mjs', `
      function walk(dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) { if (isNestedCheckout(full)) walk(full); }
        }
      }
    `),
    // The same test written the other way round: NOT nested, so the descent
    // belongs inside the branch. This is intake.mjs's shape and must stay
    // guarded — rejecting it would be the opposite mistake.
    f('guards-negated.mjs', `
      function walk(dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory() && !isNestedCheckout(full)) walk(full);
        }
      }
    `),
    // The guard named ONLY in a comment. Documented as guarded, descends into
    // every checkout it finds.
    f('comment-only.mjs', `
      function walk(dir) {
        // isNestedCheckout(full) — TODO
        for (const e of readdirSync(dir)) walk(e);
      }
    `),
    // Reads a directory, never recurses: a single-level listing is not this bug.
    f('flat.mjs', `
      function listStates(dir) { return readdirSync(dir).filter(Boolean); }
    `),
    // Recurses, never reads a directory.
    f('no-readdir.mjs', `
      function deepen(n) { return n <= 0 ? 0 : deepen(n - 1); }
    `),
  ]);

  assert.deepEqual(
    found.map((w) => `${w.id}${w.guarded ? ' [guarded]' : ''}`).sort(),
    [
      'arrow-ident.mjs:walk',
      'arrowless.mjs:walk',
      'braces-in-literals.mjs:walk [guarded]',
      'comment-only.mjs:walk',
      'duplicate-names.mjs:walk#2',
      'entry-guard.mjs:copyDir [guarded]',
      'guards-alias.mjs:walk',
      'guards-elsewhere.mjs:walk',
      'guards-ignored-result.mjs:walk',
      'guards-negated.mjs:walk [guarded]',
      'guards-normalized-parent.mjs:walk',
      'guards-other-child.mjs:walk',
      'guards-parent.mjs:walk',
      'guards-second-descent-only.mjs:walk',
      'guards-too-late.mjs:walk',
      'guards-wrong-polarity.mjs:walk',
      'method.mjs:walk',
      'mutual.mjs:collect',
      'mutual.mjs:descend',
      'regex-after-keyword.mjs:walk [guarded]',
      'wrapper-read.mjs:walk',
    ],
    'the detector must see method, brace-less-arrow, unparenthesized-parameter arrow, mutually recursive, same-named and wrapper-reading walkers, must reject a guard that names anything other than the path being descended into — the directory being read, an alias or normalization of it, an unrelated directory, another child — while accepting one at function entry, must reject a predicate result that is dropped, consulted after the recursion, missing before an earlier descent, or controlling the branch that descends rather than the one that skips (while accepting the negated form that wraps the descent), must not truncate a body at braces inside a literal or a keyword-position regex, must not count a guard written in a comment, and must ignore a non-recursive read',
  );
});

test('every recursive walker over this checkout consults the shared predicate', () => {
  // The previous form of this test pinned three callers BY NAME, and a fourth
  // walker — `test-all.mjs`'s `discoverTests`, the one that hands what it finds
  // to the RUNNER — was omitted precisely because nothing enumerated it: a
  // worktree under `tests/` executed its own stale suites and the run printed
  // "safe to push/merge" for them (#3762). Worse, that list-shaped test PASSED
  // the whole time, because `test-all.mjs` imports and calls the predicate
  // elsewhere in the file. A list cannot catch the walker nobody added to it,
  // and a per-file assertion cannot catch the walker inside a file that already
  // complies — so this asserts the property over every walker in the repository.
  //
  // Walkers keep their own recursion rather than calling `collectMjsFiles`
  // because each filters differently (.test.mjs, dot-dirs, per-caller skip
  // sets) — but a hand-rolled `.git` rule is the drift, so they share the
  // predicate.

  // Anchored at a THIRD-PARTY plugin directory rather than at this checkout, so
  // "somebody else's source tree" is exactly what they are meant to be reading,
  // and both are security scans over it. Guarding them would INVERT their
  // purpose: a plugin could drop a `.git` file beside its sources and opt out
  // of the deny-list scan, or park executable code inside a marked directory
  // and have it drop out of the integrity hash — the rug-pull `_lock.mjs`
  // exists to prevent.
  const EXEMPT = new Map([
    ['plugins/_lock.mjs:walk', 'hashes a plugin tree; skipping a marked dir would be an integrity blind spot'],
    ['plugin-audit.mjs:walk', 'audits a plugin tree, which is not this repository’s source'],
    ['test-all.mjs:walkMjs', 'deny-list security scan over plugins/; a marked dir must not be able to opt out'],
  ]);

  const walkers = findRecursiveWalkers(
    collectMjsFiles(ROOT).map((file) => ({
      rel: file.slice(ROOT.length + 1).replace(/\\/g, '/'),
      src: readFileSync(file, 'utf-8'),
    })),
  );

  // A detector that silently stops matching would turn this into a green test
  // of nothing — the exact failure shape lib/mjs-files.mjs exists to remove
  // (#3419). The floor is well below today's count, so it survives a walker
  // being deleted but not the parser breaking. The test above is the finer
  // instrument; this is the backstop.
  assert.ok(
    walkers.length >= 8,
    `found only ${walkers.length} recursive walkers — the detector has stopped matching, not the repo stopped walking`,
  );

  // EXEMPT is keyed `file:name`, deliberately WITHOUT the `#N` ordinal a
  // duplicate declaration carries: an unrelated same-named function added above
  // an exempt walker would otherwise renumber it, and the exemption would go
  // stale for a reason that has nothing to do with either walker. The trade is
  // that a name must stay unambiguous within its file — two walkers sharing an
  // exempt name fail loudly rather than one silently inheriting the other's
  // reason.
  const baseId = (w) => `${w.file}:${w.name.split('#')[0]}`;
  for (const id of EXEMPT.keys()) {
    const matches = walkers.filter((w) => baseId(w) === id);
    assert.ok(matches.length > 0, `EXEMPT lists ${id}, which is no longer a recursive walker`);
    assert.equal(
      matches.length, 1,
      `EXEMPT lists ${id}, but ${matches.length} walkers in that file share the name (${matches.map((w) => `line ${w.line}`).join(', ')}) — ` +
      'an exemption must name one walker, so rename one of them',
    );
  }

  const unguarded = walkers
    .filter((w) => !EXEMPT.has(baseId(w)) && !w.guarded)
    .map((w) => `${w.file}:${w.line} (${w.name})`);
  assert.deepEqual(
    unguarded,
    [],
    `recursive walker(s) descend into a nested checkout unguarded: ${unguarded.join(', ')} — ` +
    'call isNestedCheckout() on child directories, or add a reasoned entry to EXEMPT (#3499, #3762)',
  );

  // Recursion that Node performs INSIDE one call — `readdirSync(dir, {
  // recursive: true })` and `globSync` — leaves no per-directory decision to
  // guard, so `findRecursiveWalkers` cannot see it and the floor above would
  // never notice. It is the same defect: a worktree under `modes/` turned 174
  // files into 459 and failed a real check naming another tree's file (#3762).
  // The rule there is to filter the RESULT, so the gate is that such a call and
  // `isUnderNestedCheckout` appear in the same file. Coarse on purpose — a
  // finer rule would have to bind the filter to the call, and the honest
  // instrument for that is the behavioural test, not this.
  // `[^)]*` between the call and the option would stop at the first `)`, which
  // in `readdirSync(join(ROOT, 'modes'), { recursive: true })` belongs to
  // join() — the regex then missed the exact call this gate exists for. Bounded
  // by statement instead.
  const ONE_CALL_RECURSION = /readdirSync\s*\([^;]{0,200}?recursive\s*:\s*true|\bglobSync\s*\(/;
  const unfiltered = [];
  for (const file of collectMjsFiles(ROOT)) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (rel === 'tests/mjs-files.test.mjs' || rel === 'lib/mjs-files.mjs') continue;   // this gate and the helper itself
    const src = readFileSync(file, 'utf-8');
    if (ONE_CALL_RECURSION.test(src) && !src.includes('isUnderNestedCheckout(')) unfiltered.push(rel);
  }
  assert.deepEqual(
    unfiltered,
    [],
    `${unfiltered.join(', ')}: expands a whole subtree in one call (readdirSync recursive / globSync) without ` +
    'filtering the result through isUnderNestedCheckout — a nested checkout\u2019s files come back as ours (#3762)',
  );

  // The IMPORT is a separate assertion from the call. Matching
  // `isNestedCheckout(` anywhere is satisfied by a local
  // `const isNestedCheckout = () => false` — a hand-rolled re-implementation
  // wearing the shared name, which is precisely the drift this test exists to
  // catch, passing as proof against itself. Pinning the import binds the name
  // to the one definition. Derived from the guarded walkers, never listed, and
  // accepting any relative depth: a walker can live at any depth under ROOT, so
  // a depth-limited pattern would accuse a correctly guarded nested file of
  // re-implementing the predicate.
  const guardedFiles = [...new Set(walkers.filter((w) => !EXEMPT.has(baseId(w))).map((w) => w.file))];
  for (const caller of guardedFiles) {
    if (caller === 'lib/mjs-files.mjs') continue;   // the definition itself
    const src = readFileSync(join(ROOT, caller), 'utf-8');
    assert.match(
      src,
      /import\s*\{[^}]*\bisNestedCheckout\b[^}]*\}\s*from\s*['"](?:\.{1,2}\/)+lib\/mjs-files\.mjs['"]/,
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
    // Directly beside the marker, NOT one level below it. With the suite at
    // `fixture/tests/`, a guard mutated to test the directory being read
    // (`isNestedCheckout(dir)`) still skipped it — that mutant kept every test
    // green while walking the files sitting immediately inside a checkout. The
    // second copy deeper down keeps the recursive case covered too.
    const stale = "import test from 'node:test';\ntest('NESTED SUITE EXECUTED', () => { throw new Error('a stale checkout suite ran'); });\n";
    writeFileSync(join(fixture, 'stale.test.mjs'), stale);
    writeFileSync(join(fixture, 'tests', 'stale-nested.test.mjs'), stale);

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
    assert.doesNotMatch(output, /stale(-nested)?\.test\.mjs|NESTED SUITE EXECUTED/, output);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('a checkout parked among the fixture states is not an allowlisted state', () => {
  // The class no static gate can see: `listStates()` reads one level, and its
  // result becomes the ROOT that `walk()` starts from — where the child-only
  // guard is deliberately blind (the walk root is exempt on purpose). So a
  // checkout at test-fixtures/upgrade/<state> would be a valid `--state` name
  // and seedFixture would copy a whole second repository into the install
  // under test, hashing every file of it into the manifest (#3762).
  const FIXTURES = join(ROOT, 'test-fixtures', 'upgrade');
  const probe = join(FIXTURES, 'state-nested-checkout-probe');
  rmSync(probe, { recursive: true, force: true });
  try {
    mkdirSync(probe, { recursive: true });
    writeFileSync(join(probe, '.git'), 'gitdir: /nowhere\n');
    writeFileSync(join(probe, 'cv.md'), '# not ours\n');

    const listed = execFileSync(
      process.execPath,
      ['-e', "import('./seed-fixture.mjs').then((m) => console.log(JSON.stringify(m.listStates())))"],
      { cwd: ROOT, encoding: 'utf-8', timeout: 60000 },
    );
    const states = JSON.parse(listed);
    assert.ok(states.length > 0, 'the probe must not empty the state list — that would pass for the wrong reason');
    assert.ok(
      !states.includes('state-nested-checkout-probe'),
      `listStates() offered a nested checkout as a fixture state: ${states.join(', ')}`,
    );
  } finally {
    rmSync(probe, { recursive: true, force: true });
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
