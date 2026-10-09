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
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMjsFiles, isNestedCheckout, trackedFiles, SKIP_DIRS } from '../lib/mjs-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * A throwaway repository, and a `git` bound to it.
 *
 * `-C dir` rather than `cwd`, so nothing here depends on the process working
 * directory. The three configs are not decoration: `user.*` because `commit`
 * refuses without them on a machine that has no global identity, and
 * `commit.gpgsign=false` because a contributor whose global config signs every
 * commit would otherwise have these fixtures block on a passphrase prompt.
 *
 * @param {string} prefix - mkdtemp prefix.
 * @returns {{dir: string, git: (...args: string[]) => string}} The repo.
 */
function gitRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  git('init', '-q', '-b', 'trunk');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  git('config', 'commit.gpgsign', 'false');
  // A globally configured hooks path reaches a fresh `git init`, so a
  // contributor's pre-commit hook would otherwise run inside these fixtures.
  // A local override also bypasses hooks copied by `init.templateDir`.
  git('config', 'core.hooksPath', join(dir, '.git', 'no-hooks'));
  return { dir, git };
}

/** Repo-relative POSIX paths, so an assertion reads the same on every OS. */
const relPaths = (files, dir) => files.map((f) => f.slice(dir.length + 1).replace(/\\/g, '/'));

/**
 * Run `body` with console.warn captured.
 *
 * @param {() => T} body - The call under test.
 * @returns {{value: T, warnings: string[]}} Its return value and what it warned.
 * @template T
 */
function capturingWarnings(body) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { value: body(), warnings };
  } finally {
    console.warn = original;
  }
}

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

// Through the RE-EXPORT on purpose: `lib/walk-tree.mjs` owns the predicate now,
// but intake.mjs and older callers import it from here, and this is the test
// that notices if the re-export is dropped.
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

// ── trackedFiles: the guards' enumerator ────────────────────────────────────

test('trackedFiles lists what git tracks, and nothing else', () => {
  const { dir, git } = gitRepo('co-tracked-');
  try {
    mkdirSync(join(dir, 'nested', 'deep'), { recursive: true });
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ngenerated.mjs\n');
    writeFileSync(join(dir, 'zz-root.mjs'), '');
    writeFileSync(join(dir, 'nested', 'deep', 'leaf.mjs'), '');
    writeFileSync(join(dir, 'nested', 'notes.md'), '');
    git('add', '-A');

    // The three kinds of file a hand-maintained skip-list gets wrong, all
    // present at once: vendored code it has to remember to exclude, generated
    // output it has to remember to exclude, and a brand-new working file that
    // is not part of the repository yet. The index already knows which is
    // which, so none of them needs a rule here.
    writeFileSync(join(dir, 'node_modules', 'dep.mjs'), '');
    writeFileSync(join(dir, 'generated.mjs'), '');
    writeFileSync(join(dir, 'scratch.mjs'), '');

    const rel = relPaths(trackedFiles(dir), dir);

    assert.deepEqual(rel, ['.gitignore', 'nested/deep/leaf.mjs', 'nested/notes.md', 'zz-root.mjs'],
      `only tracked paths, sorted, at any depth — got: ${rel.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles applies the caller filter to the repo-relative path', () => {
  const { dir, git } = gitRepo('co-tracked-filter-');
  try {
    mkdirSync(join(dir, 'templates'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'cv.html'), '');
    writeFileSync(join(dir, 'root.mjs'), '');
    writeFileSync(join(dir, 'root.test.mjs'), '');
    git('add', '-A');

    // POSIX separators in the filter argument on every platform: `ls-files`
    // emits forward slashes even on Windows, and a caller scoping to a subtree
    // writes `startsWith('templates/')` exactly once rather than per-OS.
    assert.deepEqual(relPaths(trackedFiles(dir, (rel) => rel.startsWith('templates/')), dir),
      ['templates/cv.html']);
    assert.deepEqual(
      relPaths(trackedFiles(dir, (rel) => rel.endsWith('.mjs') && !rel.endsWith('.test.mjs')), dir),
      ['root.mjs'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles skips a path the index lists but the tree does not have, and says so', () => {
  // A REAL unresolved merge, not a simulated one. `git ls-files` reports the
  // index, and mid-merge the index holds stages for a path the working tree may
  // not have — here because the deletion is the resolution being accepted and
  // has not been staged yet. That is an ordinary Tuesday, not a corrupt repo,
  // and a guard that throws ENOENT during conflict resolution is a guard people
  // learn to skip (#3890).
  const { dir, git } = gitRepo('co-tracked-unmerged-');
  try {
    writeFileSync(join(dir, 'keep.mjs'), 'const keep = 1;\n');
    writeFileSync(join(dir, 'doomed.mjs'), 'const a = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'base');

    git('checkout', '-q', '-b', 'deleting');
    git('rm', '-q', 'doomed.mjs');
    git('commit', '-qm', 'delete it');

    git('checkout', '-q', 'trunk');
    writeFileSync(join(dir, 'doomed.mjs'), 'const a = 2;\n');
    git('commit', '-qam', 'change it');

    git('checkout', '-q', 'deleting');
    // Exits non-zero on the conflict it is here to create.
    assert.throws(() => git('merge', 'trunk'), /./, 'the fixture must actually conflict');
    unlinkSync(join(dir, 'doomed.mjs'));   // accept the deletion, do not stage it

    const status = git('status', '--porcelain');
    assert.match(status, /^DU doomed\.mjs$/m, `fixture is not in the DU state: ${status}`);

    const { value: files, warnings } = capturingWarnings(() => trackedFiles(dir));

    // The crash this exists to prevent, asserted where it actually happened:
    // every path handed back can be opened.
    for (const file of files) readFileSync(file);

    assert.deepEqual(relPaths(files, dir), ['keep.mjs'],
      'the listed-but-absent path must be skipped, and the rest of the scan must survive it');
    assert.equal(warnings.length, 1, `expected exactly one warning, got: ${JSON.stringify(warnings)}`);
    assert.match(warnings[0], /doomed\.mjs/, 'the warning must name the path that was skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles skips a tracked symlink rather than following it', (t) => {
  // `ls-files` lists symlinks, and existsSync/readFileSync follow them. This
  // repository tracks seven (each CLI's SKILL.md links to the canonical one),
  // so following is not hypothetical: the target is tracked in its own right,
  // and one offender inside it would be reported once per link. A link pointing
  // OUT of the checkout is worse — it puts source this repository does not own
  // under a guard that grades it, the #3499 hazard in a new costume.
  const { dir, git } = gitRepo('co-tracked-symlink-');
  try {
    writeFileSync(join(dir, 'real.mjs'), 'const a = 1;\n');
    try {
      symlinkSync(join(dir, 'real.mjs'), join(dir, 'alias.mjs'));
    } catch (err) {
      // Windows needs a privilege for this unless Developer Mode is on (#2828).
      // A machine that cannot link must SKIP, not redden.
      return t.skip(`symlinks unsupported here (${err.code || err.message})`);
    }
    git('add', '-A');
    assert.match(git('ls-files', '-s'), /^120000 /m, 'the fixture did not track a symlink');

    const { value: files, warnings } = capturingWarnings(() => trackedFiles(dir));

    assert.deepEqual(relPaths(files, dir), ['real.mjs'],
      'the link must be skipped and its target returned exactly once');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /alias\.mjs \(a symlink\)/, 'the warning must name the link, and say it is one');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles skips a gitlink directory rather than throwing EISDIR', () => {
  // An initialised submodule is one index entry (mode 160000) that is a
  // DIRECTORY on disk. existsSync says yes and readFileSync throws EISDIR.
  // Written straight into the index rather than by wiring up a real submodule:
  // the entry is what the enumerator sees, and this needs no second repository,
  // no network, and no `protocol.file.allow` config to reproduce.
  const { dir, git } = gitRepo('co-tracked-gitlink-');
  try {
    writeFileSync(join(dir, 'real.mjs'), 'const a = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const sha = git('rev-parse', 'HEAD').trim();
    git('update-index', '--add', '--cacheinfo', `160000,${sha},sub`);
    mkdirSync(join(dir, 'sub'));
    assert.match(git('ls-files', '-s'), /^160000 /m, 'the fixture did not create a gitlink');

    const { value: files, warnings } = capturingWarnings(() => trackedFiles(dir));

    for (const file of files) readFileSync(file);   // the EISDIR this prevents

    assert.deepEqual(relPaths(files, dir), ['real.mjs']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /sub \(not a regular file\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles survives a path it cannot stat, and names the reason', () => {
  // `throwIfNoEntry: false` suppresses ENOENT and nothing else. When the index
  // names `a/b.mjs` but the tree has `a` as a regular FILE, the stat takes the
  // whole scan with it -- the case the docblock above promises to survive,
  // arriving through an errno other than ENOENT. EACCES on an unreadable
  // parent directory is the same shape. Skip it the way the other three are
  // skipped: loudly, named, and with the rest of the scan intact.
  //
  // WHICH errno depends on the OS, so the fixture asks rather than assumes.
  // POSIX reports ENOTDIR for a non-directory component and the catch branch
  // names it. Windows reports ERROR_PATH_NOT_FOUND, libuv maps that to ENOENT,
  // and `throwIfNoEntry: false` swallows it, so the same fixture reaches the
  // missing-path branch instead (#3904). Both are the MISSING case, and the
  // requirement is the same on both: one warning, naming the path, rest of the
  // scan intact. Probing the real behaviour keeps the errno assertion live
  // wherever the errno exists, without pinning a platform list.
  const { dir, git } = gitRepo('co-tracked-unstattable-');
  try {
    writeFileSync(join(dir, 'real.mjs'), 'const a = 1;\n');
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a', 'b.mjs'), 'const b = 2;\n');
    git('add', '-A');

    // Replace the directory with a file, leaving `a/b.mjs` in the index.
    rmSync(join(dir, 'a'), { recursive: true, force: true });
    writeFileSync(join(dir, 'a'), 'now a regular file\n');

    let expected;
    try {
      lstatSync(join(dir, 'a', 'b.mjs'), { throwIfNoEntry: false });
      expected = /a\/b\.mjs \(not in the working tree\)/;
    } catch (err) {
      expected = new RegExp(`a/b\\.mjs \\(${err.code}\\)`);
    }

    const { value: files, warnings } = capturingWarnings(() => trackedFiles(dir));

    assert.ok(relPaths(files, dir).includes('real.mjs'),
      'one unstattable path must not cost the rest of the scan');
    assert.ok(!relPaths(files, dir).includes('a/b.mjs'),
      'the path behind the failing stat must not be returned');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], expected,
      'the warning must name the path and why it was skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles rethrows a stat failure it does not recognise, instead of logging it', (t) => {
  // The skip list is deliberate, not a catch-all. ENOTDIR and EACCES are the
  // MISSING case wearing a different errno, so they are skipped. Anything else
  // is a filesystem the scan cannot read, and swallowing it would do exactly
  // what this module exists to prevent: report a clean pass over a tree it
  // never managed to inspect. An EIO on every path would otherwise return an
  // empty list and a tidy warning.
  //
  // ELOOP is the producible unrecognised errno: lstat does not follow the FINAL
  // component, but it does resolve intermediate ones, so a self-referential
  // directory symlink in the middle of the path throws. As with the unstattable
  // fixture above, the real errno is probed rather than a platform list pinned —
  // where the probe yields a recognised code, the skip contract is asserted
  // instead, so the test stays live either way.
  const { dir, git } = gitRepo('co-tracked-unknown-errno-');
  try {
    writeFileSync(join(dir, 'real.mjs'), 'const a = 1;\n');
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a', 'b.mjs'), 'const b = 2;\n');
    git('add', '-A');

    // Replace the directory with a symlink to itself, leaving a/b.mjs indexed.
    rmSync(join(dir, 'a'), { recursive: true, force: true });
    try {
      symlinkSync('a', join(dir, 'a'));
    } catch (err) {
      // Windows needs a privilege for this unless Developer Mode is on (#2828),
      // the same rule the tracked-symlink fixture above follows. A machine that
      // cannot link must SKIP, not redden.
      return t.skip(`symlinks unsupported here (${err.code || err.message})`);
    }

    let probe = null;
    try {
      lstatSync(join(dir, 'a', 'b.mjs'), { throwIfNoEntry: false });
    } catch (err) {
      probe = err.code;
    }

    if (probe && !['ENOTDIR', 'EACCES'].includes(probe)) {
      assert.throws(() => trackedFiles(dir), (err) => err.code === probe,
        `an unrecognised ${probe} must end the scan, not become a warning line`);
    } else {
      const { value: files, warnings } = capturingWarnings(() => trackedFiles(dir));
      assert.ok(relPaths(files, dir).includes('real.mjs'),
        'a recognised skip must leave the rest of the scan intact');
      assert.equal(warnings.length, 1, 'a recognised skip is reported once');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles returns an unmerged path once, not once per index stage', () => {
  // `git ls-files` prints one line per stage, so a conflicted path arrives two
  // or three times. Left as-is, every offender inside one would be reported
  // twice and every per-file count would be wrong for the duration of a merge.
  const { dir, git } = gitRepo('co-tracked-stages-');
  try {
    writeFileSync(join(dir, 'both.mjs'), 'const a = 0;\n');
    git('add', '-A');
    git('commit', '-qm', 'base');

    git('checkout', '-q', '-b', 'theirs');
    writeFileSync(join(dir, 'both.mjs'), 'const a = 2;\n');
    git('commit', '-qam', 'theirs');

    git('checkout', '-q', 'trunk');
    writeFileSync(join(dir, 'both.mjs'), 'const a = 1;\n');
    git('commit', '-qam', 'ours');
    assert.throws(() => git('merge', 'theirs'), /./, 'the fixture must actually conflict');

    // The fixture is only meaningful while git really is listing it repeatedly.
    const listed = git('ls-files').trim().split('\n').filter((l) => l === 'both.mjs');
    assert.ok(listed.length > 1, `ls-files listed the unmerged path ${listed.length} time(s)`);

    assert.deepEqual(relPaths(trackedFiles(dir), dir), ['both.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trackedFiles throws rather than reporting an empty, passing scan', () => {
  // Same stance as collectMjsFiles above and validate-system-paths-coverage.mjs:
  // a guard that could not look must never read as a guard that passed. The
  // realistic way to get here is running from a temp copy inside the repo,
  // where `ls-files` reports nothing at all — which is how the SYSTEM_PATHS
  // coverage guard sat green and inert in CI for its whole life.
  const empty = gitRepo('co-tracked-empty-');
  try {
    writeFileSync(join(empty.dir, 'untracked.mjs'), '');
    assert.throws(() => trackedFiles(empty.dir), /no tracked files|tracked nothing|listed no/i);
  } finally {
    rmSync(empty.dir, { recursive: true, force: true });
  }

  const notARepo = mkdtempSync(join(tmpdir(), 'co-tracked-norepo-'));
  try {
    // And a failing `git` must propagate as a failure, not as "nothing tracked".
    assert.throws(() => trackedFiles(notARepo));
  } finally {
    rmSync(notARepo, { recursive: true, force: true });
  }
});

test('trackedFiles enumerates this repository, and reaches past its root', () => {
  const rel = relPaths(trackedFiles(ROOT, (f) => f.endsWith('.mjs')), ROOT);
  const rootOnly = rel.filter((f) => !f.includes('/'));

  assert.ok(rel.length > rootOnly.length * 2,
    `the guards must cover far more than the root: ${rel.length} total vs ${rootOnly.length} at root`);
  assert.ok(rel.includes('lib/mjs-files.mjs'), 'the module under test must be inside its own enumeration');
  assert.ok(rel.some((f) => f.startsWith('tests/')), 'tests/ must be enumerated');
  assert.ok(!rel.some((f) => f.startsWith('node_modules/')), 'vendored code is never tracked, so never enumerated');
});

test('every repo-scanning guard enumerates through the shared definition', () => {
  // The four that did not, and carried #3419's defect the whole time: a private
  // walk with a hand-maintained skip-list, silently narrowing whenever a file
  // moved or a directory was forgotten (#3890).
  //
  // The IMPORT is the assertion, for the same reason as the predicate check
  // below: matching `trackedFiles(` anywhere is satisfied by a local
  // re-implementation wearing the shared name.
  for (const caller of [
    'tests/main-guard-convention.test.mjs',
    'tests/local-today-gates.test.mjs',
    'tests/mojibake-canary.test.mjs',
    'tests/helpers.mjs',
  ]) {
    const src = readFileSync(join(ROOT, caller), 'utf-8');
    assert.match(
      src,
      /import\s*\{[^}]*\btrackedFiles\b[^}]*\}\s*from\s*'\.{1,2}\/lib\/mjs-files\.mjs'/,
      `${caller} must enumerate through lib/mjs-files.mjs, not its own walk (#3890)`,
    );
    assert.match(src, /trackedFiles\(/, `${caller} must actually call trackedFiles (#3890)`);

    // ...and must not have kept a walk beside it. A readdir here is how a
    // second definition of "every file" gets back in, which is the whole
    // reason this module exists.
    assert.doesNotMatch(src, /readdirSync\s*\(/,
      `${caller} still walks a directory to build its own file list (#3890)`);
  }
});

// #3792's static analysis of every hand-rolled walker — guardsEveryDescent and
// its detector — is superseded by the ban in tests/walk-tree.test.mjs: there is
// one recursion left, so the question "does this recursion guard the right
// path?" has one answer, proved by running it, and the question that remains is
// "is there another recursion?", which is decidable (#3818).
//
// The two below are kept from #3792 unchanged in intent, because they hold no
// matter how a walk is implemented: neither reads a line of source.

test('a checkout under tests/ does not get its suites EXECUTED by the runner', () => {
  // The end of the #3762 chain, asserted where it bites. Every other walker in
  // this repository READS what it finds; `discoverTests` feeds `node:test`, so
  // a worktree under `tests/` ran a stale checkout's suites against the current
  // tree and `test-all.mjs` printed "🟢 All tests passed — safe to push/merge"
  // for them. The marker is what the predicate keys on, so a plain file named
  // `.git` reproduces it exactly as `git worktree add tests/x` does, without
  // needing git.
  //
  // mkdtemp rather than a fixed path: the fixture has to live under the real
  // tests/ for the real discovery to walk it, and the previous form cleared its
  // path with a recursive rm BEFORE creating it — which is a delete of whatever
  // a developer happened to have there. The generated basename is what `--only`
  // filters on, so the discovery contract is unchanged.
  const fixture = mkdtempSync(join(ROOT, 'tests', 'nested-checkout-3762-'));
  const only = basename(fixture);
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
      output = execFileSync(process.execPath, ['test-all.mjs', '--only', only], {
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
  // mkdtemp for the same reason as the test above — and the `state-` prefix
  // keeps the probe shaped like the thing it is pretending to be.
  const probe = mkdtempSync(join(FIXTURES, 'state-nested-checkout-probe-'));
  const probeName = basename(probe);
  try {
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
      !states.includes(probeName),
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
