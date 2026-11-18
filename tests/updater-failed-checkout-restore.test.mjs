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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo, captureConsoleErrors, rmSync, ROOT } from './helpers.mjs';
import { restoreAfterFailedUpdate, restoreBootstrapBackups, backupSystemFiles, checkoutErrorIsBenign } from '../update-system.mjs';

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
    const child = /if \(!checkoutErrorIsBenign\(err, \{ absentUpstream, preservedState \}\)\) \{[\s\S]*?const written = mergePathLists\(updated, batchAttempted\)\.filter\(\(p\) => p !== path\);\n\s*restoreAfterFailedUpdate\(written, initialStatusPaths,[^\n]*exclude: restoreExclusions \}\);\n\s*restoreAfterFailedUpdate\(\[path\], initialStatusPaths,[^\n]*exclude: restoreExclusions \}\);\n\s*throw err;\s*\n\s*\}/;
    if (child.test(body)) pass('a non-benign checkout error restores the paths already updated, preserved files excluded, then rethrows');
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
