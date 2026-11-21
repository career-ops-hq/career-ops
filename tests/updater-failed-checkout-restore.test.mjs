/**
 * updater-failed-checkout-restore.test.mjs — an update that fails partway puts
 * back what it had already checked out.
 *
 * apply() checks system files out one path at a time and commits them at the
 * end. When a checkout failed partway (a file another program holds open, a
 * path too long for Windows), the error was rethrown and nothing was undone:
 * the earlier paths stayed at the new version, uncommitted, under the old
 * VERSION. Two places did this. The self-reexec parent checks out the target
 * updater's own import closure before starting it, and its catch rethrew; the
 * child's step-3 loop rethrew a non-benign checkout error.
 *
 * Sections 1 to 4 drive restoreAfterFailedUpdate() against a throwaway repo
 * through the git-runner seam. apply() is not exported and needs a real
 * upstream, so section 5 asserts against its source that both catches call
 * the helper before rethrowing. Sections 8 to 11 cover what the restore must
 * leave alone: the user's own files in a directory the update created, and a
 * preserved file's uncommitted edit; sections 12 and 13, a cleanup that fails.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync, lstatSync, chmodSync, readlinkSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo, captureConsoleErrors, rmSync, ROOT } from './helpers.mjs';
import { gitIn, restoreAfterFailedUpdate, restoreBootstrapBackups, backupSystemFiles, checkoutErrorIsBenign, capturePreUpdateIndex, restoreWrittenDirtyState, locallyModifiedSystemFiles, parsePorcelainStatus, gitStatusEntries, refreshPreUpdateSnapshot, preservedCheckoutCollision, preservedSpecCollision } from '../update-system.mjs';

function write(dir, rel, text) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

// A repo at "v1" with a target commit "v2" that changes sys/a.md, sys/b.md,
// adds sys/dir/new.md and a whole new directory sys/fresh/, then returns to v1
// the way an update starts out.
function makeRepo() {
  const repo = makeUpdaterRepo({ prefix: 'co-failed-checkout-', includeRoot: true });
  const { dir, g } = repo;
  write(dir, 'sys/a.md', 'a v1\n');
  write(dir, 'sys/b.md', 'b v1\n');
  write(dir, 'sys/dir/old.md', 'old v1\n');
  write(dir, 'cv.md', 'my cv\n');
  g('add', '-A');
  g('commit', '-qm', 'v1');
  write(dir, 'sys/a.md', 'a v2\n');
  write(dir, 'sys/b.md', 'b v2\n');
  write(dir, 'sys/dir/new.md', 'new v2\n');
  write(dir, 'sys/fresh/up.md', 'up v2\n');
  g('add', '-A');
  g('commit', '-qm', 'v2');
  const target = g('rev-parse', 'HEAD').trim();
  g('reset', '-q', '--hard', 'HEAD~1');
  return { ...repo, target };
}

const status = (g) => g('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf-8');
// What `initialStatusPaths` holds: modified and untracked files, by path. g()
// trims its output, so slicing porcelain lines would cut the first one short.
const dirtyPaths = (g) => new Set(g('ls-files', '-m', '-o', '--exclude-standard').split('\n').filter(Boolean));

console.log('\n🧪 Testing that a failed update restores what it had checked out...');

// ── 1. paths checked out before the failure go back to HEAD ──
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    // The loop got sys/a.md through, then the directory failed after writing
    // one of its files: the shape a too-long name inside it produces.
    g('checkout', target, '--', 'sys/a.md');
    g('checkout', target, '--', 'sys/dir/new.md');
    const before = status(g).length;
    const { result, errors } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/a.md', 'sys/dir/'], new Set(), { what: 'system path(s)', ...ctx }));
    const after = status(g);
    if (before === 2 && result === true && after.length === 0 && read(dir, 'sys/a.md') === 'a v1\n' && !existsSync(join(dir, 'sys/dir/new.md'))) {
      pass('the paths an update had checked out are back at HEAD, including a file it added');
    } else {
      fail(`restore left ${JSON.stringify(after)} (before: ${before}, result: ${result})`);
    }
    if (errors.some((line) => /^Restored 2 system path\(s\) from HEAD\.$/.test(String(line)))) {
      pass('the restore says what it put back');
    } else {
      fail(`unexpected messages: ${JSON.stringify(errors)}`);
    }
    if (read(dir, 'cv.md') === 'my cv\n') pass('a user file outside the paths is untouched');
    else fail('cv.md changed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. work the user had staged before the update survives ──
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/dir/mine.md', 'staged by the user\n');
    g('add', 'sys/dir/mine.md');
    const protectedPaths = new Set(status(g).map((line) => line.slice(3)));
    g('checkout', target, '--', 'sys/dir/');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/dir/'], protectedPaths, { what: 'system path(s)', ...ctx }));
    if (existsSync(join(dir, 'sys/dir/mine.md')) && !existsSync(join(dir, 'sys/dir/new.md'))) {
      pass('a file the user staged before the update stays; the update\'s addition goes');
    } else {
      fail(`mine.md ${existsSync(join(dir, 'sys/dir/mine.md')) ? 'kept' : 'deleted'}, new.md ${existsSync(join(dir, 'sys/dir/new.md')) ? 'kept' : 'removed'}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. a restore that fails says so and points at rollback ──
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    g('checkout', target, '--', 'sys/a.md');
    const failing = (...args) => {
      if (args[0] === 'checkout') throw new Error('unable to unlink old \'sys/a.md\': Invalid argument');
      return g(...args);
    };
    const { result, errors } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/a.md'], new Set(), { what: 'system path(s)', git: failing, root: ctx.root }));
    const text = errors.join('\n');
    if (result === false && /Could not restore the system path\(s\) \(could not restore from HEAD: sys\/a\.md \(unable to unlink old/.test(text) && /node update-system\.mjs rollback/.test(text)) {
      pass('a failed restore returns false and names `rollback`');
    } else {
      fail(`result ${result}, messages ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


// ── 3b. a path whose HEAD checkout is blocked still loses the update's additions, and later paths restore ──
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    // The update had checked out sys/dir/ (adding new.md) and sys/b.md; the
    // restore's own HEAD checkout of sys/dir/ is then blocked (a persistent
    // write blocker - the #3825-review finding). The old code rethrew here:
    // new.md stayed and sys/b.md was never restored.
    g('checkout', target, '--', 'sys/dir/');
    g('checkout', target, '--', 'sys/b.md');
    const failing = (...args) => {
      if (args[0] === 'checkout' && args.includes('sys/dir/')) throw new Error('unable to unlink old \'sys/dir/old.md\': Permission denied');
      return g(...args);
    };
    const { result, errors } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/dir/', 'sys/b.md'], new Set(), { what: 'system path(s)', git: failing, root: ctx.root }));
    const text = errors.join('\n');
    if (result === false
      && /could not restore from HEAD: sys\/dir \(unable to unlink old/.test(text)
      && !existsSync(join(dir, 'sys/dir/new.md'))
      && read(dir, 'sys/b.md') === 'b v1\n') {
      pass('a blocked HEAD checkout still loses the update\'s additions, later paths restore, and the failure is named');
    } else {
      fail(`result ${result}, new.md ${existsSync(join(dir, 'sys/dir/new.md')) ? 'kept' : 'removed'}, b.md ${JSON.stringify(read(dir, 'sys/b.md'))}, messages ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 4. nothing checked out, nothing done ──
{
  const { errors, result } = await captureConsoleErrors(() =>
    restoreAfterFailedUpdate([], new Set(), { what: 'system path(s)', git: () => { throw new Error('git must not run'); } }));
  if (result === true && errors.length === 0) pass('an empty list runs no git and prints nothing');
  else fail(`empty list: result ${result}, messages ${JSON.stringify(errors)}`);
}

// ── 5. both failure paths in apply() restore before rethrowing ──
{
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const start = source.indexOf('async function apply() {');
  const end = source.indexOf('\nfunction rollback(', start);
  const body = start === -1 || end === -1 ? '' : source.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  if (!body) {
    fail('could not locate apply() in update-system.mjs — update this test');
  } else {
    // The parent: the list must outlive the try for its catch to see it, and be
    // filled from reexecFiles right before the checkout that needs undoing.
    const parent = /let checkedOutForReexec = \[\];\s*\n\s*try \{[\s\S]*?checkedOutForReexec = reexecFiles;\s*\n\s*git\('--literal-pathspecs', 'checkout', targetCommit, '--', \.\.\.reexecFiles\);[\s\S]*?\} catch \(err\) \{[\s\S]*?restoreAfterFailedUpdate\(checkedOutForReexec, initialStatusPaths,[^\n]*\n[\s\S]*?throw err;/;
    if (parent.test(body)) pass('the self-reexec catch restores the updater files it checked out, then rethrows');
    else fail('the self-reexec catch does not restore the files it checked out before rethrowing');

    // The child: the non-benign branch of the step-3 checkout loop.
    // Both restores pass restoreExclusions: the preserved files, which the
    // checkout excluded, plus every pre-update-dirty path, so an edit whose
    // content already matched the target is never reset to HEAD. The first
    // list is everything already written: the loop's `updated`, plus any
    // path a failed batched checkout had started before the loop took over.
    const child = /if \(!checkoutErrorIsBenign\(err, \{ absentUpstream, preservedState \}\)\) \{[\s\S]*?const written = mergePathLists\(updated, batchAttempted\)\.filter\(\(p\) => p !== path\);\n\s*restoreAfterFailedUpdate\(written, initialStatusPaths,[^\n]*exclude: restoreExclusions \}\);\n\s*restoreAfterFailedUpdate\(\[path\], initialStatusPaths,[^\n]*exclude: restoreExclusions \}\);\n\s*[\s\S]*?restoreWrittenDirtyState\(mergePathLists\(written, \[path\]\), \{ initialStatusPaths, initialIndexState, backupByFile, preservedSet \}\);\n\s*throw err;\s*\n\s*\}/;
    if (child.test(body)) pass('a non-benign checkout error restores the paths already updated, preserved files excluded and pre-update dirty state restored, then rethrows');
    else fail('the step-3 checkout loop rethrows without restoring what it had updated, or restores without excluding the preserved files');

    // The parent again: each successful bootstrap backup is recorded where it is
    // reported, and copied back after the files return to HEAD, not before.
    const recorded = /console\.log\(`  \$\{result\.file\}  \(local copy saved: \$\{result\.backup\}\)`\);\s*\n\s*bootstrapBackups\.push\(result\);/;
    const putBack = /restoreAfterFailedUpdate\(checkedOutForReexec, initialStatusPaths,[^\n]*\n\s*restoreBootstrapBackups\(bootstrapBackups\);[\s\S]*?throw err;/;
    if (recorded.test(body) && putBack.test(body)) {
      pass('the self-reexec catch puts the saved local versions back after restoring from HEAD');
    } else {
      fail(`self-reexec catch: backups recorded ${recorded.test(body)}, put back after the HEAD restore ${putBack.test(body)}`);
    }
  }
}

// ── 5b. the per-path fallback refuses a file/directory collision before the
//    exact-preserve skip, inside the try whose catch restores and rethrows
//    (#7250 review): earlier paths the loop already wrote — or a partial write
//    the failed primary left — must not survive the refusal, and the refusal
//    must reach the user as the honest error it is.
{
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const start = source.indexOf('async function apply() {');
  const end = source.indexOf('\nfunction rollback(', start);
  const body = start === -1 || end === -1 ? '' : source.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  const refusalFirst = /let preservedState;\s*try \{\s*const collision = preservedCheckoutCollision\(path, preservedPaths, upstreamFiles\);\s*if \(collision\) throw new Error\(`Cannot check out \$\{path\}: \$\{collision\}`\);\s*preservedState = pathFullyPreserved\(/;
  if (!body) {
    fail('could not locate apply() in update-system.mjs — update this test');
  } else if (refusalFirst.test(body)) {
    pass('the fallback loop refuses a file/directory collision before the exact-preserve skip, inside the restore path');
  } else {
    fail('the fallback loop does not refuse a collision before the exact-preserve skip inside the restore path');
  }
  // The refusal can never be swallowed as a benign skip: its message carries
  // no pathspec cancel-out wording, so checkoutErrorIsBenign rejects it under
  // every combination of the loop's skip evidence.
  const refusal = new Error('Cannot check out lib: the target ships lib as a directory but a preserved local file stands in its place');
  const benign = (opts) => checkoutErrorIsBenign(refusal, opts);
  if (!benign({ absentUpstream: false, preservedState: false })
    && !benign({ absentUpstream: true, preservedState: false })
    && !benign({ absentUpstream: false, preservedState: 'unknown' })
    && !benign({ absentUpstream: true, preservedState: 'unknown' })) {
    pass('the collision refusal is never a benign skip, whatever the skip evidence says');
  } else {
    fail('the collision refusal can be swallowed as a benign skip');
  }
}

// ── 6. an updater file this install had edited comes back as edited ──
//    The self-bootstrap backs the edit up to .bak, checks the target's version
//    out over it, and the child then fails. Restoring from HEAD alone gives back
//    the committed file, not the user's.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v1 with my local fix\n');
    const backups = backupSystemFiles(['sys/a.md'], { root: dir });
    g('checkout', target, '--', 'sys/a.md');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/a.md'], new Set(), { what: 'updater file(s)', ...ctx }));
    // The state this section is about: HEAD's version, the edit only in the .bak.
    const afterHead = read(dir, 'sys/a.md');
    const { result, errors } = await captureConsoleErrors(() => restoreBootstrapBackups(backups, { root: dir }));
    const restored = read(dir, 'sys/a.md');
    const bak = existsSync(join(dir, 'sys/a.md.bak')) ? read(dir, 'sys/a.md.bak') : null;
    if (afterHead === 'a v1\n' && restored === 'a v1 with my local fix\n' && bak === 'a v1 with my local fix\n' && result.length === 0) {
      pass('after a failed self-reexec an edited updater file is the user\'s again, and its .bak stays');
    } else {
      fail(`after HEAD restore ${JSON.stringify(afterHead)}, after put-back ${JSON.stringify(restored)}, .bak ${JSON.stringify(bak)}, failed ${JSON.stringify(result)}`);
    }
    if (errors.some((line) => String(line) === 'Put back your local version of sys/a.md (the copy in sys/a.md.bak stays).')) {
      pass('the put-back says which file and where the copy is');
    } else {
      fail(`unexpected messages: ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7. a copy that cannot be put back is named, with where the edit still is ──
{
  const failing = () => { throw new Error('EBUSY: resource busy or locked'); };
  const { result, errors } = await captureConsoleErrors(() =>
    restoreBootstrapBackups([{ file: 'update-system.mjs', backup: 'update-system.mjs.bak' }], { root: ROOT, copyFile: failing }));
  if (JSON.stringify(result) === '["update-system.mjs"]'
      && errors.some((line) => /^Could not put back your local version of update-system\.mjs \(EBUSY: resource busy or locked\); it is in update-system\.mjs\.bak\.$/.test(String(line)))) {
    pass('a failed put-back is returned and points at the .bak');
  } else {
    fail(`failed put-back: ${JSON.stringify(result)}, messages ${JSON.stringify(errors)}`);
  }
}

// ── 8. a directory the update created keeps the user's own files in it ──
//    sys/fresh/ is new upstream, but this install already had a file there. The
//    restore used to delete the whole directory because HEAD lacks it.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/fresh/mine.md', 'my own notes\n');
    const protectedPaths = dirtyPaths(g);
    g('checkout', target, '--', 'sys/fresh/');
    const { result } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/fresh/'], protectedPaths, { what: 'system path(s)', ...ctx }));
    const mine = existsSync(join(dir, 'sys/fresh/mine.md')) ? read(dir, 'sys/fresh/mine.md') : null;
    const after = status(g);
    if (result === true && mine === 'my own notes\n' && !existsSync(join(dir, 'sys/fresh/up.md'))
        && JSON.stringify(after) === '["?? sys/fresh/mine.md"]') {
      pass('a directory the update created loses only the update\'s files; the user\'s own file there stays');
    } else {
      fail(`result ${result}, mine.md ${JSON.stringify(mine)}, status ${JSON.stringify(after)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 9. ...and with nothing of the user's in it, the directory goes entirely ──
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    g('checkout', target, '--', 'sys/fresh/');
    const { result } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/fresh/'], new Set(), { what: 'system path(s)', ...ctx }));
    if (result === true && !existsSync(join(dir, 'sys/fresh')) && status(g).length === 0) {
      pass('a directory only the update had filled is gone after the restore');
    } else {
      fail(`result ${result}, sys/fresh ${existsSync(join(dir, 'sys/fresh')) ? 'left behind' : 'gone'}, status ${JSON.stringify(status(g))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 10. a preserved file keeps its uncommitted edit through the restore ──
//    apply() checks a directory out with `:(exclude)` for each preserved file
//    (a system file this install changed), so the edit survives the checkout. A
//    bare `git checkout HEAD -- sys/` in the restore reset it to HEAD.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/dir/old.md', 'old v1 with my edit\n');
    const protectedPaths = dirtyPaths(g);
    const preserved = ['sys/dir/old.md'];
    g('checkout', target, '--', 'sys/', ':(exclude)sys/dir/old.md');
    const { result } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/'], protectedPaths, { what: 'system path(s)', exclude: preserved, ...ctx }));
    const after = status(g);
    if (result === true && read(dir, 'sys/dir/old.md') === 'old v1 with my edit\n' && read(dir, 'sys/a.md') === 'a v1\n'
        && !existsSync(join(dir, 'sys/dir/new.md')) && JSON.stringify([...dirtyPaths(g)]) === '["sys/dir/old.md"]' && after.length === 1) {
      pass('the restore puts the rest of a directory back and leaves a preserved file\'s edit in place');
    } else {
      fail(`result ${result}, old.md ${JSON.stringify(read(dir, 'sys/dir/old.md'))}, status ${JSON.stringify(after)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 11. a directory whose only HEAD files are preserved still loses the additions ──
//    Excluding every file HEAD has there makes `git checkout HEAD` match nothing
//    and fail; the restore must not report that as a failure.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/dir/old.md', 'old v1 with my edit\n');
    const protectedPaths = dirtyPaths(g);
    g('checkout', target, '--', 'sys/dir/', ':(exclude)sys/dir/old.md');
    const { result, errors } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/dir/'], protectedPaths, { what: 'system path(s)', exclude: ['sys/dir/old.md'], ...ctx }));
    if (result === true && read(dir, 'sys/dir/old.md') === 'old v1 with my edit\n' && !existsSync(join(dir, 'sys/dir/new.md'))) {
      pass('with every HEAD file under it preserved, the directory keeps the edit and drops the update\'s addition');
    } else {
      fail(`result ${result}, old.md ${JSON.stringify(read(dir, 'sys/dir/old.md'))}, new.md ${existsSync(join(dir, 'sys/dir/new.md')) ? 'kept' : 'removed'}, messages ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 12. an addition that cannot be unstaged makes the restore report failure ──
//    removeAdditionsNotInHead() leaves such a file in place and goes on; the
//    restore used to print "Restored ..." anyway and never mention `rollback`.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    g('checkout', target, '--', 'sys/dir/');
    g('checkout', target, '--', 'sys/a.md');
    const lockedRm = (...args) => {
      if (args[0] === 'rm' && args.includes('sys/dir/new.md')) throw new Error('Unable to create index.lock: File exists');
      return g(...args);
    };
    const { result, errors } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/dir/', 'sys/a.md'], new Set(), { what: 'system path(s)', git: lockedRm, root: ctx.root }));
    const text = errors.join('\n');
    if (result === false && read(dir, 'sys/a.md') === 'a v1\n'
        && /Could not restore the system path\(s\) \(could not remove 1 file\(s\) the update added: sys\/dir\/new\.md\)/.test(text)
        && /node update-system\.mjs rollback/.test(text) && !/^Restored /m.test(text)) {
      pass('a stranded addition fails the restore after the other paths are back, and names the file and `rollback`');
    } else {
      fail(`result ${result}, sys/a.md ${JSON.stringify(read(dir, 'sys/a.md'))}, messages ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 13. additions that could not even be listed fail the restore too ──
//    A failed `git diff --cached` used to read as "the update added nothing",
//    so the restore reported success without having looked.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    g('checkout', target, '--', 'sys/dir/');
    g('checkout', target, '--', 'sys/a.md');
    const brokenDiff = (...args) => {
      if (args[0] === 'diff' && args.includes('sys/dir')) throw new Error('index file corrupt');
      return g(...args);
    };
    const { result, errors } = await captureConsoleErrors(() =>
      restoreAfterFailedUpdate(['sys/dir/', 'sys/a.md'], new Set(), { what: 'system path(s)', git: brokenDiff, root: ctx.root }));
    const text = errors.join('\n');
    if (result === false && read(dir, 'sys/a.md') === 'a v1\n'
        && /Could not restore the system path\(s\) \(could not list what the update added under sys\/dir\/\)/.test(text)
        && /node update-system\.mjs rollback/.test(text) && !/^Restored /m.test(text)) {
      pass('an unreadable additions list fails the restore after the other paths are back, and names `rollback`');
    } else {
      fail(`result ${result}, sys/a.md ${JSON.stringify(read(dir, 'sys/a.md'))}, messages ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 8. a pre-update edit that already matched the target survives the restore ──
//    The preserve scan never flags such a file (it does not differ from
//    upstream), so the checkout lists it and a later failure would reset it to
//    HEAD — destroying an edit the checkout left byte-identical. apply()'s
//    restore call now passes every pre-update-dirty path in `exclude`.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    // Given: the install edited sys/a.md to EXACTLY what the target ships
    write(dir, 'sys/a.md', 'a v2\n');
    // When: the update checked it out (a byte-identical write) and a later
    // path failed, restoring with the pre-update-dirty exclusion
    g('checkout', target, '--', 'sys/a.md');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/a.md'], new Set(['sys/a.md']), { what: 'system path(s)', exclude: ['sys/a.md'], ...ctx }));
    // Then: the edit is still there, not reset to HEAD
    if (read(dir, 'sys/a.md') === 'a v2\n') {
      pass('a pre-update edit matching the target survives the failed-update restore');
    } else {
      fail(`pre-update edit was reset to HEAD: ${JSON.stringify(read(dir, 'sys/a.md'))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // Control: without the exclusion the same restore resets the file to HEAD —
  // the loss this change protects against.
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v2\n');
    g('checkout', target, '--', 'sys/a.md');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/a.md'], new Set(['sys/a.md']), { what: 'system path(s)', ...ctx }));
    if (read(dir, 'sys/a.md') === 'a v1\n') {
      pass('control: without the pre-update-dirty exclusion the restore resets to HEAD');
    } else {
      fail(`control unexpectedly kept the edit: ${JSON.stringify(read(dir, 'sys/a.md'))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // capturePreUpdateIndex records mode+blob for paths that were STAGED before
  // apply; unstaged and untracked paths need no record (their restore is a
  // plain `git reset -q HEAD -- <path>`).
  const state = capturePreUpdateIndex([
    { code: 'M ', path: 'sys/a.md' },
    { code: ' M', path: 'sys/b.md' },
    { code: '??', path: 'sys/new.md' },
  ], { gitRaw: () => '100644 abc1234 0\tsys/a.md\x00100644 def5678 0\tsys/c.md\x00' });
  if (state.get('sys/a.md')?.sha === 'abc1234' && state.get('sys/a.md')?.mode === '100644' &&
      !state.has('sys/b.md') && !state.has('sys/c.md')) {
    pass('capturePreUpdateIndex records the pre-update staged entry only');
  } else {
    fail(`capturePreUpdateIndex wrong: ${JSON.stringify([...state.entries()])}`);
  }
}

{
  // A --force-overwritten local edit: the checkout put the target blob in the
  // worktree AND the index. The failed-update restore must return the local
  // bytes from the .bak and the index to HEAD's entry, so nothing of the
  // failed update stays (#7250 review).
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a local fix\n');
    write(dir, 'sys/a.md.bak', 'a local fix\n');
    g('checkout', target, '--', 'sys/a.md');
    const unrestored = restoreWrittenDirtyState(['sys/'], {
      initialStatusPaths: new Set(['sys/a.md']),
      initialIndexState: new Map(),
      backupByFile: new Map([['sys/a.md', 'sys/a.md.bak']]),
      preservedSet: new Set(),
    }, { ...ctx });
    const headEntry = g('rev-parse', 'HEAD:sys/a.md').trim();
    if (unrestored.length === 0 &&
        read(dir, 'sys/a.md') === 'a local fix\n' &&
        g('rev-parse', ':sys/a.md').trim() === headEntry) {
      pass('a forced-overwritten local edit returns to worktree and index after a failed update');
    } else {
      fail(`forced-overwrite restore wrong: content=${JSON.stringify(read(dir, 'sys/a.md'))} index=${g('rev-parse', ':sys/a.md').trim()} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // An edit STAGED before apply keeps its staged blob: the restore re-stages
  // the recorded index entry instead of leaving the blob the checkout staged.
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a staged fix\n');
    g('add', 'sys/a.md');
    const stagedSha = g('rev-parse', ':sys/a.md').trim();
    const indexState = capturePreUpdateIndex(
      [{ code: 'M ', path: 'sys/a.md' }],
      { gitRaw: (...a) => g(...a) },
    );
    g('checkout', target, '--', 'sys/a.md');
    write(dir, 'sys/a.md', 'a staged fix\n');
    const unrestored = restoreWrittenDirtyState(['sys/'], {
      initialStatusPaths: new Set(['sys/a.md']),
      initialIndexState: indexState,
    }, { ...ctx });
    if (unrestored.length === 0 && g('rev-parse', ':sys/a.md').trim() === stagedSha) {
      pass('an edit staged before apply keeps its staged blob after the failed-update restore');
    } else {
      fail(`staged-edit restore wrong: index=${g('rev-parse', ':sys/a.md').trim()} want=${stagedSha}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // An equal-content pre-update edit (the install's edit already matched the
  // target): the checkout staged the target blob over it. The restore unstages
  // back to HEAD's entry, so `git status` shows the edit exactly as the user
  // had it — unstaged — instead of a staged blob they never staged (#7250 review).
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v2\n');
    g('checkout', target, '--', 'sys/a.md');
    const unrestored = restoreWrittenDirtyState(['sys/'], {
      initialStatusPaths: new Set(['sys/a.md']),
      initialIndexState: new Map(),
    }, { ...ctx });
    const headEntry = g('rev-parse', 'HEAD:sys/a.md').trim();
    const porcelain = g('status', '--porcelain', '--', 'sys/a.md').trim();
    if (unrestored.length === 0 &&
        g('rev-parse', ':sys/a.md').trim() === headEntry &&
        read(dir, 'sys/a.md') === 'a v2\n' &&
        porcelain === 'M sys/a.md') {
      pass('an equal-content pre-update edit returns to unstaged after the failed-update restore');
    } else {
      fail(`equal-content restore wrong: status=${JSON.stringify(porcelain)} content=${JSON.stringify(read(dir, 'sys/a.md'))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // apply()'s failure paths all restore the pre-update dirty state: the
  // bootstrap catch, the per-path checkout catch, and both abort restores.
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const calls = source.match(/restoreWrittenDirtyState\(/g) || [];
  if (calls.length >= 5) {
    pass('every failed-update restore also restores the pre-update dirty state');
  } else {
    fail(`expected restoreWrittenDirtyState at every failure restore site, found ${calls.length} call(s)`);
  }
}

// ── 14. a file the user staged as NEW at a path the target ships: the whole
//    real-apply chain — at-risk attribution, .bak, forced overwrite, failure
//    restore — returns the exact pre-update index AND worktree (#7250 review).
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/dir/new.md', 'my staged new file\n');
    g('add', 'sys/dir/new.md');
    const stagedSha = g('rev-parse', ':sys/dir/new.md').trim();
    // apply() snapshots status at the start, before any scan or backup.
    const statusEntries = parsePorcelainStatus(g('status', '--porcelain', '-z', '--untracked-files=all'));
    const initialStatusPaths = new Set(statusEntries.map((entry) => entry.path));
    const initialIndexState = capturePreUpdateIndex(statusEntries, { gitRaw: (...a) => g(...a) });
    // Attribution: the real scanner must flag the staged-new file at-risk, so
    // the default route preserves it and --force backs it up. diff against the
    // baseline lists an index addition; the untracked sweep skips it (it is in
    // ls-files), so this pins the diff path, not the sweep.
    const atRisk = locallyModifiedSystemFiles(['sys/'], target, ctx);
    if (!atRisk.includes('sys/dir/new.md')) {
      fail(`staged-new file not flagged at-risk: ${JSON.stringify(atRisk)}`);
    } else {
      pass('a staged-new file at a target path is flagged at-risk');
    }
    // --force route: .bak first, then the checkout overwrites worktree+index.
    backupSystemFiles(['sys/dir/new.md'], ctx);
    if (initialIndexState.get('sys/dir/new.md')?.sha !== stagedSha) {
      fail(`capturePreUpdateIndex missed the staged-new entry: ${JSON.stringify([...initialIndexState.entries()])}`);
    }
    g('checkout', target, '--', 'sys/dir/new.md');
    const unrestored = restoreWrittenDirtyState(['sys/'], {
      initialStatusPaths,
      initialIndexState,
      backupByFile: new Map([['sys/dir/new.md', 'sys/dir/new.md.bak']]),
      preservedSet: new Set(),
    }, { ...ctx });
    const porcelain = g('status', '--porcelain', '--', 'sys/dir/new.md').trim();
    if (unrestored.length === 0 &&
        read(dir, 'sys/dir/new.md') === 'my staged new file\n' &&
        g('rev-parse', ':sys/dir/new.md').trim() === stagedSha &&
        porcelain === 'A  sys/dir/new.md') {
      pass('a forced-overwritten staged-new file returns to its exact pre-update index and worktree');
    } else {
      fail(`staged-new restore wrong: status=${JSON.stringify(porcelain)} content=${JSON.stringify(read(dir, 'sys/dir/new.md'))} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 15. an UNTRACKED file at a target path, forced and failed: bytes back
//    from the .bak, index entry the checkout staged dropped — status is `??`
//    again, not a staged blob the user never staged (#7250 review).
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/dir/new.md', 'my untracked file\n');
    const statusEntries = parsePorcelainStatus(g('status', '--porcelain', '-z', '--untracked-files=all'));
    const initialStatusPaths = new Set(statusEntries.map((entry) => entry.path));
    const initialIndexState = capturePreUpdateIndex(statusEntries, { gitRaw: (...a) => g(...a) });
    const atRisk = locallyModifiedSystemFiles(['sys/'], target, ctx);
    if (!atRisk.includes('sys/dir/new.md')) {
      fail(`untracked file not flagged at-risk: ${JSON.stringify(atRisk)}`);
    }
    backupSystemFiles(['sys/dir/new.md'], ctx);
    g('checkout', target, '--', 'sys/dir/new.md');
    const unrestored = restoreWrittenDirtyState(['sys/'], {
      initialStatusPaths,
      initialIndexState,
      backupByFile: new Map([['sys/dir/new.md', 'sys/dir/new.md.bak']]),
      preservedSet: new Set(),
    }, { ...ctx });
    const porcelain = g('status', '--porcelain', '--', 'sys/dir/new.md').trim();
    if (unrestored.length === 0 &&
        read(dir, 'sys/dir/new.md') === 'my untracked file\n' &&
        porcelain === '?? sys/dir/new.md') {
      pass('a forced-overwritten untracked file returns to untracked with its bytes after a failed update');
    } else {
      fail(`untracked restore wrong: status=${JSON.stringify(porcelain)} content=${JSON.stringify(read(dir, 'sys/dir/new.md'))} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 15b. the self-bootstrap catch restores an IGNORED forced updater file:
//    the bootstrap at-risk scan is the same #5088 scanner (untracked + ignored
//    sweep), the .bak lands in bootstrapBackups, and the catch's own order —
//    HEAD restore (which deletes the staged addition the ignored file became),
//    then restoreBootstrapBackups, then restoreWrittenDirtyState without
//    backupByFile — returns its bytes with nothing left staged (#7250 review).
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    // sys/fresh/up.md exists at the target but not in HEAD: the install never
    // tracked it, the user created and ignored it — the #5088 shape.
    write(dir, '.gitignore', 'sys/fresh/up.md\n');
    g('add', '.gitignore');
    g('commit', '-qm', 'ignore the local note');
    write(dir, 'sys/fresh/up.md', 'my ignored updater file\n');
    g('check-ignore', 'sys/fresh/up.md');
    const statusEntries = parsePorcelainStatus(g('status', '--porcelain', '-z', '--untracked-files=all'));
    const initialStatusPaths = new Set(statusEntries.map((entry) => entry.path));
    if (initialStatusPaths.has('sys/fresh/up.md')) {
      fail('fixture wrong: the ignored updater file showed in --untracked-files=all status');
    }
    const initialIndexState = capturePreUpdateIndex(statusEntries, { gitRaw: (...a) => g(...a) });
    // The bootstrap's own scan and backup, through the real functions.
    const atRisk = locallyModifiedSystemFiles(['sys/fresh/up.md'], target, ctx);
    if (!atRisk.includes('sys/fresh/up.md')) {
      fail(`ignored updater file not flagged at-risk: ${JSON.stringify(atRisk)}`);
    }
    const bootstrapBackups = backupSystemFiles(atRisk, ctx).filter((r) => !r.error);
    if (bootstrapBackups.length !== 1) fail(`bootstrap backup wrong: ${JSON.stringify(bootstrapBackups)}`);
    // The bootstrap checkout overwrites and stages it, then the child fails.
    g('checkout', target, '--', 'sys/fresh/up.md');
    // The catch's three steps, in apply()'s order and shapes.
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/fresh/up.md'], initialStatusPaths, { what: 'updater file(s) loaded to run the new version', exclude: [...initialStatusPaths], ...ctx }));
    if (existsSync(join(dir, 'sys/fresh/up.md'))) {
      fail('fixture wrong: revertPaths kept the staged addition the ignored file became');
    }
    const putBackFailed = restoreBootstrapBackups(bootstrapBackups, ctx);
    const unrestored = restoreWrittenDirtyState(['sys/fresh/up.md'], { initialStatusPaths, initialIndexState }, { ...ctx });
    let staged = true;
    try { g('ls-files', '--error-unmatch', '--', 'sys/fresh/up.md'); } catch { staged = false; }
    if (putBackFailed.length === 0 && unrestored.length === 0 &&
        read(dir, 'sys/fresh/up.md') === 'my ignored updater file\n' && !staged) {
      pass('the bootstrap catch restores an ignored forced updater file from its .bak, unstaged');
    } else {
      fail(`bootstrap ignored restore wrong: content=${existsSync(join(dir, 'sys/fresh/up.md')) ? JSON.stringify(read(dir, 'sys/fresh/up.md')) : '<missing>'} staged=${staged} putBack=${JSON.stringify(putBackFailed)} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 16. an IGNORED file at a target path, forced and failed, through the REAL
//    two-stage restore: --untracked-files=all never lists it, so revertPaths
//    removes it as the update's own addition — the .bak copy-back afterwards
//    must still return its bytes, with nothing left staged (#7250 review).
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, '.gitignore', 'sys/dir/new.md\n');
    g('add', '.gitignore');
    g('commit', '-qm', 'ignore the local note');
    write(dir, 'sys/dir/new.md', 'my ignored file\n');
    g('check-ignore', 'sys/dir/new.md');
    const statusEntries = parsePorcelainStatus(g('status', '--porcelain', '-z', '--untracked-files=all'));
    const initialStatusPaths = new Set(statusEntries.map((entry) => entry.path));
    if (initialStatusPaths.has('sys/dir/new.md')) {
      fail('fixture wrong: the ignored file showed in --untracked-files=all status');
    }
    const initialIndexState = capturePreUpdateIndex(statusEntries, { gitRaw: (...a) => g(...a) });
    const atRisk = locallyModifiedSystemFiles(['sys/'], target, ctx);
    if (!atRisk.includes('sys/dir/new.md')) {
      fail(`ignored file not flagged at-risk: ${JSON.stringify(atRisk)}`);
    }
    backupSystemFiles(['sys/dir/new.md'], ctx);
    g('checkout', target, '--', 'sys/dir/new.md');
    // Stage one of the real failure path: the HEAD restore, which removes the
    // staged addition (the ignored file is in no exclusion list).
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/'], initialStatusPaths, { what: 'system path(s) it had already updated', exclude: [], ...ctx }));
    if (existsSync(join(dir, 'sys/dir/new.md'))) {
      fail('fixture wrong: revertPaths kept the staged addition the ignored file became');
    }
    // Stage two: the dirty-state restore puts the user's bytes back.
    const unrestored = restoreWrittenDirtyState(['sys/'], {
      initialStatusPaths,
      initialIndexState,
      backupByFile: new Map([['sys/dir/new.md', 'sys/dir/new.md.bak']]),
      preservedSet: new Set(),
    }, { ...ctx });
    let staged = true;
    try { g('ls-files', '--error-unmatch', '--', 'sys/dir/new.md'); } catch { staged = false; }
    if (unrestored.length === 0 &&
        read(dir, 'sys/dir/new.md') === 'my ignored file\n' &&
        !staged) {
      pass('a forced-overwritten ignored file returns from its .bak, unstaged, after the two-stage restore');
    } else {
      fail(`ignored restore wrong: content=${existsSync(join(dir, 'sys/dir/new.md')) ? JSON.stringify(read(dir, 'sys/dir/new.md')) : '<missing>'} staged=${staged} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// gitStatusEntries reads untrimmed: g() trims, which would eat a leading space of the first ` M` entry.
// It inherits process.env, though, where g() does not: an inherited
// GIT_INDEX_FILE would read status from another index than the blobs g()
// compares. Clear it for this read only; other suites rely on process.env.
const entriesOf = (dir) => {
  const inherited = process.env.GIT_INDEX_FILE;
  delete process.env.GIT_INDEX_FILE;
  try {
    return gitStatusEntries(dir);
  } finally {
    if (inherited !== undefined) process.env.GIT_INDEX_FILE = inherited;
  }
};
const rawOf = (g) => (...a) => g(...a);
const stateOf = (statusEntries) => new Set(statusEntries.map((entry) => entry.path));

// ── 17. the .bak copy-back never writes THROUGH a symlink the checkout left at
//    the path: upstream tracks some paths as symlinks, a forced checkout puts
//    one where the user's file was, and a plain copy would overwrite the
//    link's referent (#7250 review 5955888085). Real filesystem, both restore
//    sites. Skipped where the OS cannot create symlinks.
{
  const { dir, g, ctx } = makeRepo();
  try {
    let canLink = true;
    try { symlinkSync('b.md', join(dir, 'probe-link')); } catch { canLink = false; }
    rmSync(join(dir, 'probe-link'), { force: true });
    if (!canLink) {
      pass('symlink restore check skipped: this filesystem cannot create symlinks');
    } else {
      for (const site of ['dirty-state', 'bootstrap']) {
        write(dir, 'sys/a.md', `my edit ${site}\n`);
        write(dir, 'sys/a.md.bak', `my edit ${site}\n`);
        write(dir, 'sys/b.md', 'b referent\n');
        // The checkout replaced the user's file with a link to another file.
        rmSync(join(dir, 'sys/a.md'), { force: true });
        symlinkSync('b.md', join(dir, 'sys/a.md'));
        const initialStatusPaths = new Set(['sys/a.md']);
        const initialIndexState = new Map();
        let failed;
        if (site === 'dirty-state') {
          failed = restoreWrittenDirtyState(['sys/'], { initialStatusPaths, initialIndexState, backupByFile: new Map([['sys/a.md', 'sys/a.md.bak']]), preservedSet: new Set() }, { ...ctx });
        } else {
          failed = restoreBootstrapBackups([{ file: 'sys/a.md', backup: 'sys/a.md.bak' }], ctx);
        }
        const stillLink = lstatSync(join(dir, 'sys/a.md')).isSymbolicLink();
        if (!stillLink && read(dir, 'sys/a.md') === `my edit ${site}\n` && read(dir, 'sys/b.md') === 'b referent\n') {
          pass(`${site} restore replaces a symlink with the user's bytes and leaves its referent alone`);
        } else {
          fail(`${site} restore followed the link: link=${stillLink} a=${JSON.stringify(read(dir, 'sys/a.md'))} referent=${JSON.stringify(read(dir, 'sys/b.md'))} failed=${JSON.stringify(failed)}`);
        }
        rmSync(join(dir, 'sys/a.md'), { force: true });
        write(dir, 'sys/a.md', 'a v1\n');
        write(dir, 'sys/b.md', 'b v1\n');
        rmSync(join(dir, 'sys/a.md.bak'), { force: true });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 18. the dirty-state index reset is LITERAL: a bracketed name is not a
//    glob, so resetting sys/[x].md must not unstage its sibling sys/x.md.
{
  const { dir, g, ctx } = makeRepo();
  try {
    write(dir, 'sys/[x].md', 'bracket v1\n');
    write(dir, 'sys/x.md', 'x v1\n');
    g('add', '-A');
    g('commit', '-qm', 'bracket files');
    write(dir, 'sys/x.md', 'x staged edit\n');
    g('add', 'sys/x.md');
    write(dir, 'sys/[x].md', 'bracket edit\n');
    const statusEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(statusEntries);
    const initialIndexState = capturePreUpdateIndex(statusEntries, { gitRaw: rawOf(g) });
    // The checkout stages its blob over the bracketed file only.
    write(dir, 'sys/[x].md', 'bracket v2\n');
    g('--literal-pathspecs', 'add', 'sys/[x].md');
    // sys/x.md is not named by the update: the restore must leave it staged.
    const unrestored = restoreWrittenDirtyState(['sys/[x].md'], { initialStatusPaths, initialIndexState, backupByFile: new Map(), preservedSet: new Set() }, { ...ctx });
    const lines = g('status', '--porcelain', '--untracked-files=all');
    if (unrestored.length === 0 && /^M  sys\/x\.md$/m.test(lines) && !/^M  sys\/\[x\]\.md$/m.test(lines)) {
      pass('the dirty-state reset treats a bracketed name literally and leaves a pattern-matching sibling staged');
    } else {
      fail(`literal reset wrong: status=${JSON.stringify(lines)} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 19. a path the user had DELETED stays deleted: a staged deletion returns
//    to staged-deleted (no entry, no file), an unstaged one to unstaged-deleted.
{
  for (const mode of ['staged', 'unstaged']) {
    const { dir, g, ctx, target } = makeRepo();
    try {
      if (mode === 'staged') g('rm', '-q', 'sys/a.md'); else rmSync(join(dir, 'sys/a.md'));
      const before = JSON.stringify(entriesOf(dir));
      const statusEntries = entriesOf(dir);
      const initialStatusPaths = stateOf(statusEntries);
      const initialIndexState = capturePreUpdateIndex(statusEntries, { gitRaw: rawOf(g) });
      // A later path fails after the checkout recreated and staged sys/a.md.
      g('checkout', target, '--', 'sys/a.md');
      const unrestored = restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState, backupByFile: new Map(), preservedSet: new Set() }, { ...ctx });
      const after = JSON.stringify(entriesOf(dir));
      if (unrestored.length === 0 && after === before && !existsSync(join(dir, 'sys/a.md'))) {
        pass(`a ${mode} deletion is a deletion again after the restore (status "${after}")`);
      } else {
        fail(`${mode} deletion restore wrong: before=${JSON.stringify(before)} after=${JSON.stringify(after)} exists=${existsSync(join(dir, 'sys/a.md'))} unrestored=${JSON.stringify(unrestored)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ── 20. the snapshot is re-taken at the write boundary, as a whole. A blob
//    staged during the network wait is the one the failed update puts back,
//    and a path first edited during the wait is PROTECTED: with the start
//    snapshot alone the HEAD restore would reset the user's new edit.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'edit A\n');
    g('add', 'sys/a.md');
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g) });
    // During the fetch: a different blob is staged, and a second file is edited.
    write(dir, 'sys/a.md', 'edit B\n');
    g('add', 'sys/a.md');
    const shaB = g('rev-parse', ':sys/a.md');
    write(dir, 'sys/b.md', 'late edit to b\n');
    const staleProtected = new Set(initialStatusPaths);
    const added = refreshPreUpdateSnapshot(initialStatusPaths, initialIndexState, { statusEntries: entriesOf(dir), gitRaw: rawOf(g) });
    // The checkout writes both files (b.md is not at-risk-preserved here: it
    // matches the --force shape, so it has a .bak), then the update fails.
    write(dir, 'sys/a.md.bak', 'edit B\n');
    write(dir, 'sys/b.md.bak', 'late edit to b\n');
    g('checkout', target, '--', 'sys/a.md', 'sys/b.md');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/a.md', 'sys/b.md'], initialStatusPaths, { what: 'system path(s)', exclude: [...initialStatusPaths], ...ctx }));
    const unrestored = restoreWrittenDirtyState(['sys/a.md', 'sys/b.md'], { initialStatusPaths, initialIndexState, backupByFile: new Map([['sys/a.md', 'sys/a.md.bak'], ['sys/b.md', 'sys/b.md.bak']]), preservedSet: new Set() }, { ...ctx });
    if (added.length === 1 && added[0] === 'sys/b.md' && !staleProtected.has('sys/b.md') &&
        unrestored.length === 0 && g('rev-parse', ':sys/a.md') === shaB &&
        read(dir, 'sys/a.md') === 'edit B\n' && read(dir, 'sys/b.md') === 'late edit to b\n') {
      pass('the write-boundary snapshot returns a restaged blob and protects a path edited during the wait');
    } else {
      fail(`boundary refresh wrong: added=${JSON.stringify(added)} index=${g('rev-parse', ':sys/a.md')} want=${shaB} b=${JSON.stringify(read(dir, 'sys/b.md'))} unrestored=${JSON.stringify(unrestored)}`);
    }
    // Negative control: the START snapshot would not have protected b.md, so the
    // HEAD restore resets the late edit (this is what the refresh prevents).
    if (staleProtected.has('sys/b.md')) fail('control wrong: the start snapshot already named sys/b.md');
    else pass('control: sys/b.md is outside the start snapshot, so only the refresh protects it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20b. bootstrap shape with a late staged edit: an updater file the user
//    staged DURING the wait is backed up, overwritten by the bootstrap
//    checkout, and the parent's catch order (HEAD restore with the snapshot
//    excluded, bootstrap backups, dirty-state restore) returns its bytes AND
//    its staged blob.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g) });
    write(dir, 'sys/a.md', 'late staged updater edit\n');
    g('add', 'sys/a.md');
    const shaLate = g('rev-parse', ':sys/a.md');
    refreshPreUpdateSnapshot(initialStatusPaths, initialIndexState, { statusEntries: entriesOf(dir), gitRaw: rawOf(g) });
    const atRisk = locallyModifiedSystemFiles(['sys/a.md'], target, ctx);
    const bootstrapBackups = backupSystemFiles(atRisk, ctx).filter((r) => !r.error);
    g('checkout', target, '--', 'sys/a.md');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/a.md'], initialStatusPaths, { what: 'updater file(s) loaded to run the new version', exclude: [...initialStatusPaths], ...ctx }));
    const putBackFailed = restoreBootstrapBackups(bootstrapBackups, ctx);
    const unrestored = restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState }, { ...ctx });
    if (atRisk.includes('sys/a.md') && putBackFailed.length === 0 && unrestored.length === 0 &&
        read(dir, 'sys/a.md') === 'late staged updater edit\n' && g('rev-parse', ':sys/a.md') === shaLate) {
      pass('a late staged updater edit comes back with its bytes and its staged blob after a failed bootstrap');
    } else {
      fail(`late bootstrap restore wrong: atRisk=${JSON.stringify(atRisk)} a=${JSON.stringify(read(dir, 'sys/a.md'))} index=${g('rev-parse', ':sys/a.md')} want=${shaLate} putBack=${JSON.stringify(putBackFailed)} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20c. a SYMLINKED PARENT directory is refused: nothing is written through
//    it, the .bak stays, and the failure is reported (both restore sites).
{
  const { dir, g, ctx } = makeRepo();
  try {
    let canLink = true;
    try { symlinkSync('sys/dir', join(dir, 'probe-dir-link')); } catch { canLink = false; }
    rmSync(join(dir, 'probe-dir-link'), { force: true });
    if (!canLink) {
      pass('symlinked-parent check skipped: this filesystem cannot create symlinks');
    } else {
      write(dir, 'elsewhere/f.md', 'outside original\n');
      write(dir, 'sys/f.md.bak', 'user bytes\n');
      symlinkSync(join(dir, 'elsewhere'), join(dir, 'sys/linked'), 'dir');
      write(dir, 'sys/linked.bak.md', 'unused\n');
      // The file to restore sits under the link; its .bak is beside it.
      write(dir, 'elsewhere/f.md.bak', 'user bytes\n');
      const dirtyFailed = restoreWrittenDirtyState(['sys/'], { initialStatusPaths: new Set(['sys/linked/f.md']), initialIndexState: new Map(), backupByFile: new Map([['sys/linked/f.md', 'sys/linked/f.md.bak']]), preservedSet: new Set() }, { ...ctx });
      const bootFailed = restoreBootstrapBackups([{ file: 'sys/linked/f.md', backup: 'sys/linked/f.md.bak' }], ctx);
      if (read(dir, 'elsewhere/f.md') === 'outside original\n' && existsSync(join(dir, 'elsewhere/f.md.bak')) &&
          dirtyFailed.length === 1 && bootFailed.length === 1) {
        pass('a symlinked parent is refused at both restore sites: the referent is untouched and the failure is reported');
      } else {
        fail(`symlinked parent not refused: referent=${JSON.stringify(read(dir, 'elsewhere/f.md'))} dirty=${JSON.stringify(dirtyFailed)} boot=${JSON.stringify(bootFailed)}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20d. bootstrap shape with an UNSTAGED updater edit: the parent's catch
//    order leaves no target blob staged over it. The index is HEAD's again,
//    and the edit is back on disk, still unstaged.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'unstaged updater edit\n');
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g) });
    const headBlob = g('rev-parse', 'HEAD:sys/a.md');
    const bootstrapBackups = backupSystemFiles(locallyModifiedSystemFiles(['sys/a.md'], target, ctx), ctx).filter((r) => !r.error);
    g('checkout', target, '--', 'sys/a.md');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/a.md'], initialStatusPaths, { what: 'updater file(s) loaded to run the new version', exclude: [...initialStatusPaths], ...ctx }));
    const putBackFailed = restoreBootstrapBackups(bootstrapBackups, ctx);
    const unrestored = restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState }, { ...ctx });
    if (bootstrapBackups.length === 1 && putBackFailed.length === 0 && unrestored.length === 0 &&
        read(dir, 'sys/a.md') === 'unstaged updater edit\n' && g('rev-parse', ':sys/a.md') === headBlob) {
      pass('an unstaged updater edit comes back on disk with HEAD\'s index entry after a failed bootstrap');
    } else {
      fail(`unstaged bootstrap restore wrong: backups=${bootstrapBackups.length} a=${JSON.stringify(read(dir, 'sys/a.md'))} index=${g('rev-parse', ':sys/a.md')} want=${headBlob} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20e. an edit staged and then deleted from disk (`MD`) gets its staged
//    blob back, and the file the checkout recreated is removed again.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'staged edit\n');
    g('add', 'sys/a.md');
    const stagedBlob = g('rev-parse', ':sys/a.md');
    rmSync(join(dir, 'sys/a.md'));
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g) });
    g('checkout', target, '--', 'sys/a.md');
    const unrestored = restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState }, { ...ctx });
    if (unrestored.length === 0 && !existsSync(join(dir, 'sys/a.md')) && g('rev-parse', ':sys/a.md') === stagedBlob) {
      pass('a staged edit deleted from disk keeps its staged blob and stays deleted');
    } else {
      fail(`MD restore wrong: exists=${existsSync(join(dir, 'sys/a.md'))} index=${g('rev-parse', ':sys/a.md')} want=${stagedBlob} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20f. a staged deletion with an UNTRACKED replacement on disk (`D ` plus
//    `??`): the index entry stays removed and the replacement stays, whether
//    it matches the target (no .bak, the checkout wrote the same bytes) or
//    differs from HEAD and the target (where `git rm --cached` refuses).
for (const [label, content, withBak] of [['matching the target', 'a v2\n', false], ['of its own', 'my new file\n', true]]) {
  const { dir, g, ctx, target } = makeRepo();
  try {
    g('rm', '-q', '--cached', 'sys/a.md');
    write(dir, 'sys/a.md', content);
    if (withBak) write(dir, 'sys/a.md.bak', content);
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g) });
    g('checkout', target, '--', 'sys/a.md');
    const backupByFile = new Map(withBak ? [['sys/a.md', 'sys/a.md.bak']] : []);
    const { result: unrestored } = await captureConsoleErrors(() => restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState, backupByFile, preservedSet: new Set() }, { ...ctx }));
    const inIndex = g('ls-files', '--', 'sys/a.md') !== '';
    const kept = existsSync(join(dir, 'sys/a.md')) ? read(dir, 'sys/a.md') : null;
    if (unrestored.length === 0 && !inIndex && kept === content) {
      pass(`a staged deletion keeps its untracked replacement ${label}`);
    } else {
      fail(`staged deletion + replacement ${label} wrong: inIndex=${inIndex} content=${JSON.stringify(kept)} unrestored=${JSON.stringify(unrestored)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20g. the staged-deletion restore refuses a SYMLINKED PARENT: removing the
//    recreated file through it would delete the link's referent.
{
  const { dir, g, ctx } = makeRepo();
  try {
    let canLink = true;
    try { symlinkSync('sys/dir', join(dir, 'probe-dir-link'), 'dir'); } catch { canLink = false; }
    rmSync(join(dir, 'probe-dir-link'), { force: true });
    if (!canLink) {
      pass('staged-deletion symlinked-parent check skipped: this filesystem cannot create symlinks');
    } else {
      g('rm', '-q', 'sys/dir/old.md');
      const startEntries = entriesOf(dir);
      const initialStatusPaths = stateOf(startEntries);
      const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g) });
      // A failed checkout left a link where the directory was.
      rmSync(join(dir, 'sys/dir'), { recursive: true, force: true });
      write(dir, 'elsewhere/old.md', 'outside original\n');
      symlinkSync(join(dir, 'elsewhere'), join(dir, 'sys/dir'), 'dir');
      const { result: unrestored } = await captureConsoleErrors(() => restoreWrittenDirtyState(['sys/'], { initialStatusPaths, initialIndexState }, { ...ctx }));
      if (unrestored.length === 1 && read(dir, 'elsewhere/old.md') === 'outside original\n') {
        pass('a staged deletion under a symlinked parent is refused and the referent is untouched');
      } else {
        fail(`staged deletion through a symlinked parent: unrestored=${JSON.stringify(unrestored)} referent=${existsSync(join(dir, 'elsewhere/old.md'))}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20h. the HEAD restore excludes a kept file LITERALLY: `sys/[x].md` read
//    as a glob would exclude `sys/x.md` instead and reset the kept edit.
{
  const { dir, g, ctx } = makeRepo();
  try {
    write(dir, 'sys/[x].md', 'bracket v1\n');
    write(dir, 'sys/x.md', 'x v1\n');
    g('add', '-A');
    g('commit', '-qm', 'bracket names');
    write(dir, 'sys/[x].md', 'my kept edit\n');
    const initialStatusPaths = stateOf(entriesOf(dir));
    write(dir, 'sys/x.md', 'written by the update\n');
    await captureConsoleErrors(() => restoreAfterFailedUpdate(['sys/'], initialStatusPaths, { what: 'system file(s)', exclude: ['sys/[x].md'], ...ctx }));
    if (read(dir, 'sys/[x].md') === 'my kept edit\n' && read(dir, 'sys/x.md') === 'x v1\n') {
      pass('the HEAD restore keeps a bracketed kept file and still restores its glob look-alike');
    } else {
      fail(`literal exclusion wrong: kept=${JSON.stringify(read(dir, 'sys/[x].md'))} lookalike=${JSON.stringify(read(dir, 'sys/x.md'))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20i. the main path re-takes its snapshot after its last waits: the
//    template-variant loading is awaited first, so a file staged during it is
//    in the snapshot and the backups that a failed update restores from.
{
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const templates = source.indexOf('await snapshotConfiguredTemplateVariantsAcrossProfiles(');
  const refresh = source.indexOf('refreshPreUpdateSnapshot(initialStatusPaths, initialIndexState);', templates);
  const backups = source.indexOf('const atRisk = locallyModifiedSystemFiles(updatePaths, targetCommit);');
  if (templates !== -1 && refresh > templates && backups > refresh) {
    pass('the snapshot and the system-file backups come after the template-variant waits');
  } else {
    fail(`write boundary out of order: templates=${templates} refresh=${refresh} backups=${backups}`);
  }
}

// ── 20j. a STAGED RENAME to a new path survives the restore: the checkout
//    recreates the source, and a failure must leave it absent again (index
//    and disk) with the destination's staged blob intact — not a resurrected
//    source that degrades the rename to a copy. (A rename ONTO a tracked path
//    is staged as D plus M, which the deletion and staged-edit legs cover.)
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    g('mv', 'sys/a.md', 'sys/local.md');
    const renamedBlob = g('rev-parse', ':sys/local.md');
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g) });
    g('checkout', target, '--', 'sys/a.md');
    const unrestored = restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState }, { ...ctx });
    const aGone = !existsSync(join(dir, 'sys/a.md')) && g('ls-files', '--', 'sys/a.md') === '';
    const localOk = g('rev-parse', ':sys/local.md') === renamedBlob && read(dir, 'sys/local.md') === 'a v1\n';
    if (unrestored.length === 0 && aGone && localOk) {
      pass('a staged rename keeps the source absent and the destination\'s staged blob after a failed update');
    } else {
      fail(`rename restore wrong: unrestored=${JSON.stringify(unrestored)} aGone=${aGone} localOk=${localOk}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20k. a staged edit a previous update delivered (so no local-edit backup,
//    the way locallyModifiedSystemFiles attributes it) still gets its BYTES
//    back: the index entry alone would leave the checkout's content on disk
//    over the staged blob.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v1.5\n');
    g('add', 'sys/a.md');
    const stagedBlob = g('rev-parse', ':sys/a.md');
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g), root: dir });
    g('checkout', target, '--', 'sys/a.md');
    const { result: unrestored } = await captureConsoleErrors(() => restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState, backupByFile: new Map(), preservedSet: new Set() }, { ...ctx }));
    if (unrestored.length === 0 && g('rev-parse', ':sys/a.md') === stagedBlob && read(dir, 'sys/a.md') === 'a v1.5\n') {
      pass('a staged edit without a backup gets its staged bytes back on disk, not just in the index');
    } else {
      fail(`unbacked staged edit wrong: unrestored=${JSON.stringify(unrestored)} index=${g('rev-parse', ':sys/a.md')} want=${stagedBlob} worktree=${JSON.stringify(read(dir, 'sys/a.md'))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20l. the worktree can hold bytes that are NEITHER HEAD's nor the staged
//    edit's — content the local-edit detector credits to upstream (the
//    update's own content taken ahead of a release), so no .bak is written.
//    A failed update must leave those bytes on disk, not overwrite them with
//    the staged blob.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v1.5\n');
    g('add', 'sys/a.md');
    const stagedBlob = g('rev-parse', ':sys/a.md');
    write(dir, 'sys/a.md', 'a v2\n');
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g), root: dir });
    g('checkout', target, '--', 'sys/a.md');
    const { result: unrestored } = await captureConsoleErrors(() => restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState, backupByFile: new Map(), preservedSet: new Set() }, { ...ctx }));
    if (unrestored.length === 0 && g('rev-parse', ':sys/a.md') === stagedBlob && read(dir, 'sys/a.md') === 'a v2\n') {
      pass('a staged edit whose worktree held the update\'s own content keeps that content, not the staged blob');
    } else {
      fail(`credited worktree content wrong: unrestored=${JSON.stringify(unrestored)} index=${g('rev-parse', ':sys/a.md')} want=${stagedBlob} worktree=${JSON.stringify(read(dir, 'sys/a.md'))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20m. a staged edit whose worktree was then reverted to HEAD's content:
//    the checkout overwrites that third content and the restore must put
//    THOSE bytes back — neither the staged blob nor the checkout's version.
{
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v1.5\n');
    g('add', 'sys/a.md');
    const stagedBlob = g('rev-parse', ':sys/a.md');
    write(dir, 'sys/a.md', 'a v1\n');
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g), root: dir });
    g('checkout', target, '--', 'sys/a.md');
    const { result: unrestored } = await captureConsoleErrors(() => restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState, backupByFile: new Map(), preservedSet: new Set() }, { ...ctx }));
    if (unrestored.length === 0 && g('rev-parse', ':sys/a.md') === stagedBlob && read(dir, 'sys/a.md') === 'a v1\n') {
      pass('a staged edit whose worktree held a third content gets those exact bytes back');
    } else {
      fail(`third-content restore wrong: unrestored=${JSON.stringify(unrestored)} index=${g('rev-parse', ':sys/a.md')} want=${stagedBlob} worktree=${JSON.stringify(read(dir, 'sys/a.md'))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20n-20q. the rest of the worktree states a staged edit can sit over:
//    content no commit or blob names (must survive in the object store), an
//    exec bit that differs from the staged mode, a symlink at the path, and a
//    capture that could not read the disk (reported, never guessed).
async function stagedOver(setupWorktree, mutateState) {
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v1.5\n');
    g('add', 'sys/a.md');
    const stagedBlob = g('rev-parse', ':sys/a.md');
    setupWorktree(dir);
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g), root: dir });
    if (mutateState) mutateState(initialIndexState.get('sys/a.md'));
    g('checkout', target, '--', 'sys/a.md');
    const { result: unrestored } = await captureConsoleErrors(() => restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState, backupByFile: new Map(), preservedSet: new Set() }, { ...ctx }));
    return { dir, g, unrestored, indexOk: g('rev-parse', ':sys/a.md') === stagedBlob };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}
{
  const r = await stagedOver((dir) => write(dir, 'sys/a.md', 'a v9 unique\n'));
  try {
    if (r.unrestored.length === 0 && r.indexOk && read(r.dir, 'sys/a.md') === 'a v9 unique\n') pass('worktree content no commit names survives a failed update');
    else fail(`unique content wrong: ${JSON.stringify(r.unrestored)} ${JSON.stringify(read(r.dir, 'sys/a.md'))}`);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
}
{
  const r = await stagedOver((dir) => chmodSync(join(dir, 'sys/a.md'), 0o755));
  try {
    const exec = (lstatSync(join(r.dir, 'sys/a.md')).mode & 0o111) !== 0;
    if (process.platform === 'win32' || (r.unrestored.length === 0 && r.indexOk && exec)) pass('a worktree exec bit that differs from the staged mode is kept');
    else fail(`mode wrong: ${JSON.stringify(r.unrestored)} exec=${exec}`);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
}
if (process.platform !== 'win32') {
  const r = await stagedOver((dir) => {
    write(dir, 'sys/real.md', 'a v2\n');
    rmSync(join(dir, 'sys/a.md'), { force: true });
    symlinkSync('real.md', join(dir, 'sys/a.md'));
  });
  try {
    const isLink = lstatSync(join(r.dir, 'sys/a.md')).isSymbolicLink();
    if (r.unrestored.length === 0 && r.indexOk && isLink && readlinkSync(join(r.dir, 'sys/a.md')) === 'real.md' && read(r.dir, 'sys/real.md') === 'a v2\n') pass('a symlink at the path is put back as a symlink, not a copy of its referent');
    else fail(`symlink wrong: ${JSON.stringify(r.unrestored)} isLink=${isLink}`);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
}
{
  const r = await stagedOver(() => {}, (entry) => { entry.worktreeCaptureFailed = true; });
  try {
    if (r.unrestored.length === 1 && r.indexOk) pass('a worktree the capture could not read is reported, not overwritten with the staged blob');
    else fail(`capture-failed wrong: ${JSON.stringify(r.unrestored)}`);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
}

// ── 20r. the worktree bytes come back EXACTLY under line-ending conversion and
//    custom filters: a git round trip (clean then smudge) would rewrite mixed
//    endings or, for a lossy filter, change the content.
for (const [label, config, attrs, bytes] of [
  ['autocrlf=true with LF bytes', [['core.autocrlf', 'true']], null, 'a v2\n'],
  ['autocrlf=true with mixed endings', [['core.autocrlf', 'true']], null, 'a x\r\nb y\n'],
  ['autocrlf=input with CRLF bytes', [['core.autocrlf', 'input']], null, 'a v2\r\n'],
  ['eol=crlf attribute with LF bytes', [], 'sys/* text eol=crlf\n', 'a v2\n'],
  ['a lossy custom clean filter', [['filter.up.clean', 'tr a-z A-Z'], ['filter.up.smudge', 'cat']], 'sys/* filter=up\n', 'a v2 lower\n'],
]) {
  const r = await stagedOver((dir) => {
    for (const [k, v] of config) gitIn(dir, 'config', k, v);
    if (attrs) writeFileSync(join(dir, '.git', 'info', 'attributes'), attrs);
    writeFileSync(join(dir, 'sys/a.md'), bytes);
  });
  try {
    const got = readFileSync(join(r.dir, 'sys/a.md'), 'latin1');
    if (r.unrestored.length === 0 && r.indexOk && got === bytes) pass(`exact bytes survive a failed update: ${label}`);
    else fail(`filter round trip changed bytes (${label}): ${JSON.stringify(got)} want ${JSON.stringify(bytes)} unrestored=${JSON.stringify(r.unrestored)}`);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
}

// ── 20s. the exact permission bits come back, so a private file is never
//    widened by a rollback (and a read-only one stays read-only).
if (process.platform !== 'win32') {
  for (const perms of [0o600, 0o400, 0o640, 0o755, 0o700]) {
    const r = await stagedOver((dir) => { writeFileSync(join(dir, 'sys/a.md'), 'a v2\n'); chmodSync(join(dir, 'sys/a.md'), perms); });
    try {
      const got = lstatSync(join(r.dir, 'sys/a.md')).mode & 0o7777;
      if (r.unrestored.length === 0 && r.indexOk && got === perms && read(r.dir, 'sys/a.md') === 'a v2\n') pass(`permission bits ${perms.toString(8)} survive a failed update`);
      else fail(`permissions changed: ${got.toString(8)} want ${perms.toString(8)} unrestored=${JSON.stringify(r.unrestored)}`);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  }
}

// ── 20t. a write that fails part way must not cost the file at the path: the
//    bytes go to a sibling first, so the checkout's version stays in place,
//    no partial sibling is left, and the path is reported.
for (const [label, ctxOverride] of [
  ['the sibling write fails', { writeFile: (path) => { writeFileSync(path, 'par'); throw new Error('ENOSPC: no space left on device'); } }],
  ['the rename fails', { rename: () => { throw new Error('EBUSY: resource busy or locked'); } }],
]) {
  const { dir, g, ctx, target } = makeRepo();
  try {
    write(dir, 'sys/a.md', 'a v1.5\n');
    g('add', 'sys/a.md');
    write(dir, 'sys/a.md', 'a v9 mine\n');
    const startEntries = entriesOf(dir);
    const initialStatusPaths = stateOf(startEntries);
    const initialIndexState = capturePreUpdateIndex(startEntries, { gitRaw: rawOf(g), root: dir });
    g('checkout', target, '--', 'sys/a.md');
    const { result: unrestored } = await captureConsoleErrors(() => restoreWrittenDirtyState(['sys/a.md'], { initialStatusPaths, initialIndexState, backupByFile: new Map(), preservedSet: new Set() }, { ...ctx, ...ctxOverride }));
    const leftovers = g('ls-files', '-o', '--exclude-standard', 'sys').split('\n').filter((f) => f.includes('.restore-'));
    if (unrestored.length === 1 && existsSync(join(dir, 'sys/a.md')) && read(dir, 'sys/a.md') === 'a v2\n' && leftovers.length === 0) {
      pass(`${label}: the file at the path stays, no partial sibling remains, and the path is reported`);
    } else {
      fail(`${label}: unrestored=${JSON.stringify(unrestored)} exists=${existsSync(join(dir, 'sys/a.md'))} leftovers=${JSON.stringify(leftovers)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 21. preserved-collision checks fold case like manifest screening: on a
//    case-insensitive filesystem lib/Local and lib/local are one location.
{
  const a = preservedSpecCollision('lib/local/x.md', ['lib/Local']);
  const b = preservedSpecCollision('lib/Local', ['lib/local/x.md']);
  const c = preservedCheckoutCollision('lib/nested', ['lib/Nested/local.md'], ['lib/nested']);
  const d = preservedCheckoutCollision('lib/nested', ['lib/Nested'], ['lib/nested/x.md']);
  const ok = preservedSpecCollision('lib/other.md', ['lib/Local']);
  if (a && b && c && d && ok === null) {
    pass('collision checks match case-variant paths and still pass unrelated siblings');
  } else {
    fail(`case-folded collisions wrong: ${JSON.stringify({ a, b, c, d, ok })}`);
  }
}

// ── 22. both validation handlers attempt BOTH repairs. apply() is not
//    exported, so this asserts against its source (a source check, not an
//    end-to-end run): each handler wraps revertPaths() in its own try and calls
//    restoreWrittenDirtyState() outside it, so a HEAD restore that throws
//    cannot skip the dirty-state restore.
{
  const src = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const shapes = ['revertPaths(updated, initialStatusPaths', 'revertPaths([...updated], initialStatusPaths'];
  let ok = true;
  for (const shape of shapes) {
    const at = src.indexOf(`try {\n        ${shape}`);
    if (at < 0) { ok = false; continue; }
    const block = src.slice(at, at + 700);
    const closeRevert = block.indexOf('} catch (revertErr)');
    const restore = block.indexOf('restoreWrittenDirtyState(');
    if (closeRevert < 0 || restore < closeRevert) ok = false;
  }
  if (ok) pass('both validation handlers call restoreWrittenDirtyState() after, not inside, the revertPaths() try');
  else fail('a validation handler still lets a revertPaths() throw skip restoreWrittenDirtyState()');
}
