/**
 * scratch-dirs.test.mjs — a killed test run must not turn the next one red.
 *
 * `test-all.mjs` copies the checkout into a `.tmp-script-test-*` directory and
 * removes it in a `finally` that an interrupted run never reaches. The leftover
 * is gitignored and carries no `.git`, so neither `git status` nor
 * `isNestedCheckout()` sees it, and every walker reads a second copy of the
 * repository as source: 264 failures on a clean `main`, all naming correct
 * files, none reproducible for anybody else (#3940).
 *
 * The assertions below run the real walk and the real sweep against real
 * directories rather than checking that the prefix appears somewhere. What
 * broke here was never the spelling of a string; it was that a directory
 * nothing could see was being graded as source.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  SCRATCH_PREFIX, MIN_SCRATCH_AGE_MS, isScratchDir, sweepScratchDirs,
  markScratchOwner, scratchOwnerAlive,
} from '../lib/scratch-dirs.mjs';
import { collectMjsFiles } from '../lib/mjs-files.mjs';
import { execFileSync } from 'child_process';

console.log('\nscratch dirs — an interrupted run leaves no trap for the next one');

// Backdate a directory past the age gate. Real mtimes rather than a stubbed
// clock wherever the test is not about the clock itself: the gate reads the
// filesystem, and a stub would let a wrong field (birthtime, ctime) pass.
const age = (dir, ms = MIN_SCRATCH_AGE_MS * 2) => {
  const when = new Date(Date.now() - ms);
  utimesSync(dir, when, when);
};

// ── 1. The predicate ──────────────────────────────────────────────────
{
  // mkdtemp appends six random characters, so the prefix is the entire signal.
  const matches = isScratchDir(`${SCRATCH_PREFIX}OP9Bzd`) && isScratchDir(SCRATCH_PREFIX);
  // Near misses that must NOT be swept: this function authorises a recursive
  // delete, so a loose rule costs somebody their directory.
  const spares = !isScratchDir('tests')
    && !isScratchDir('.tmp-script-tes')
    && !isScratchDir('tmp-script-test-x')
    && !isScratchDir(`prefix-${SCRATCH_PREFIX}x`);
  if (matches && spares) pass('isScratchDir matches the mkdtemp prefix and nothing adjacent to it');
  else fail(`isScratchDir is wrong: matches=${matches} spares=${spares}`);
}

// ── 2. A leftover no longer reaches the walkers ───────────────────────
{
  // The reported failure, reproduced through the real walk: a scratch copy
  // holding a suite, which every layout guard would grade as a suite living
  // outside tests/.
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-walk-'));
  try {
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'tests', 'real.test.mjs'), 'export {};\n');
    const scratch = join(dir, `${SCRATCH_PREFIX}OP9Bzd`, 'tests');
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, 'real.test.mjs'), 'export {};\n');

    const found = collectMjsFiles(dir).map(f => relative(dir, f).split(sep).join('/'));
    if (found.length === 1 && found[0] === 'tests/real.test.mjs') {
      pass('collectMjsFiles skips a scratch copy and still returns the real tree');
    } else {
      fail(`collectMjsFiles returned ${JSON.stringify(found)}; expected only tests/real.test.mjs`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. The sweep removes leftovers, and only leftovers ────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-sweep-'));
  try {
    for (const name of [`${SCRATCH_PREFIX}aaaaaa`, `${SCRATCH_PREFIX}bbbbbb`]) {
      mkdirSync(join(dir, name, 'tests'), { recursive: true });
      age(join(dir, name));
    }
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, `${SCRATCH_PREFIX}not-a-dir`), 'a file, not a scratch tree\n');

    const { removed, failed } = sweepScratchDirs(dir);
    const keptTheRepo = existsSync(join(dir, 'tests'));
    // A FILE carrying the prefix is not a scratch copy, and the sweep deletes
    // directories: matching it would delete something it never created.
    const keptTheFile = existsSync(join(dir, `${SCRATCH_PREFIX}not-a-dir`));
    const gone = [`${SCRATCH_PREFIX}aaaaaa`, `${SCRATCH_PREFIX}bbbbbb`]
      .every(n => !existsSync(join(dir, n)));

    if (gone && keptTheRepo && keptTheFile && failed.length === 0 && removed.length === 2) {
      pass('sweepScratchDirs removes every stale scratch directory and touches nothing else');
    } else {
      fail(`sweep wrong: removed=${JSON.stringify(removed)} failed=${JSON.stringify(failed)} `
        + `gone=${gone} keptTheRepo=${keptTheRepo} keptTheFile=${keptTheFile}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 4. An unremovable leftover is reported, not thrown ────────────────
{
  // Driven through the removal seam. A locked directory is a real case on
  // Windows (a handle held by a just-exited child), and the sweep must not turn
  // it into a crash at the top of the run: it is housekeeping in front of the
  // real work, and the guards below still report the tree either way.
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-locked-'));
  try {
    mkdirSync(join(dir, `${SCRATCH_PREFIX}locked`), { recursive: true });
    age(join(dir, `${SCRATCH_PREFIX}locked`));
    let result;
    try {
      result = sweepScratchDirs(dir, {
        remove: () => { throw new Error('EPERM: operation not permitted'); },
      });
    } catch (err) {
      fail(`sweepScratchDirs threw instead of reporting: ${err?.message ?? err}`);
    }
    if (result && result.removed.length === 0 && result.failed.length === 1
        && /EPERM/.test(result.failed[0].error)) {
      pass('a scratch directory that cannot be removed is reported, not thrown');
    } else if (result) {
      fail(`expected one reported failure, got ${JSON.stringify(result)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 5. .gitignore and SCRATCH_PREFIX cannot drift apart ───────────────
{
  // git is the only thing that can answer this. `.gitignore` cannot import the
  // constant, so the two are a hand-maintained pair — and the invisibility that
  // made #3940 hard to see is exactly what that rule provides. Asked as a
  // question about behaviour: does git ignore a directory named from the
  // constant? A grep for the rule's text would still pass if the rule stopped
  // matching, which is the failure worth catching.
  const probe = `${SCRATCH_PREFIX}gitignoreprobe/tests/probe.test.mjs`;
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', probe],
      { cwd: ROOT, stdio: 'ignore' });
    ignored = true;
  } catch {
    ignored = false;
  }
  if (ignored) {
    pass('.gitignore still ignores a directory named from SCRATCH_PREFIX');
  } else {
    fail(`.gitignore no longer covers ${SCRATCH_PREFIX}*/ — a leftover would show up as `
      + 'untracked noise, or be committed');
  }
}

// ── 6. A live run's scratch survives another run's startup sweep ──────
{
  // The sweep runs at the top of every `test-all.mjs`, and a second run in the
  // same checkout has a scratch of its own that is minutes old. Deleting it
  // crashes a run that was doing nothing wrong — trading #3940's false red for
  // a real one. The age gate is what keeps this sweep off it.
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-live-'));
  try {
    const live = join(dir, `${SCRATCH_PREFIX}live00`);
    const stale = join(dir, `${SCRATCH_PREFIX}stale0`);
    mkdirSync(live, { recursive: true });
    mkdirSync(stale, { recursive: true });
    age(stale);

    const { removed, kept } = sweepScratchDirs(dir);
    if (existsSync(live) && !existsSync(stale)
        && kept.length === 1 && kept[0] === `${SCRATCH_PREFIX}live00`
        && removed.length === 1 && removed[0] === `${SCRATCH_PREFIX}stale0`) {
      pass("a concurrent run's fresh scratch is kept while the stale one is swept");
    } else {
      fail(`age gate wrong: removed=${JSON.stringify(removed)} kept=${JSON.stringify(kept)} `
        + `live exists=${existsSync(live)} stale exists=${existsSync(stale)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7. A symlink named like a scratch is never followed, never removed ─
{
  // This function authorises a recursive delete, so the one input that must
  // never work is a link pointing somewhere else. It is safe today only because
  // `entry.isDirectory()` is false for a symlink — an implicit property of
  // `withFileTypes` that a future switch to `statSync().isDirectory()` would
  // silently reverse. Measured with that switch applied: the link is removed.
  // Its target survives, because `rmSync` on a symlink unlinks it rather than
  // recursing through it — so the damage is the user's link, not the tree
  // behind it. Smaller than it first looks, and still not this function's to
  // delete.
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-symlink-'));
  try {
    const precious = join(dir, 'precious');
    mkdirSync(join(precious, 'work'), { recursive: true });
    writeFileSync(join(precious, 'work', 'important.txt'), 'not yours to delete\n');
    const root = join(dir, 'root');
    mkdirSync(root, { recursive: true });
    const link = join(root, `${SCRATCH_PREFIX}symlink`);
    symlinkSync(precious, link, 'dir');
    // The TARGET is backdated, not just the parent: a sweep that resolved the
    // link with statSync() would read this old mtime, judge the link stale, and
    // act on it. Ageing only the parent would leave the link looking fresh and
    // let a broken sweep pass this on a technicality.
    age(precious);
    age(root);

    const { removed, kept, failed } = sweepScratchDirs(root);
    const survived = existsSync(join(precious, 'work', 'important.txt'));
    if (survived && removed.length === 0 && kept.length === 0 && failed.length === 0) {
      pass('a symlink named like a scratch directory is neither followed nor removed');
    } else {
      fail(`symlink handling wrong: target survived=${survived} `
        + `removed=${JSON.stringify(removed)} kept=${JSON.stringify(kept)} failed=${JSON.stringify(failed)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 8. The prefix names a directory, never a file ─────────────────────
{
  // `isScratchDir` tests a NAME, and a file can carry the prefix too. Excluding
  // one from the walk would drop it from the syntax gate — a check passing by
  // not running, which is the failure `lib/mjs-files.mjs` exists to remove.
  // Only a directory can hold a copy of the repository.
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-file-'));
  try {
    writeFileSync(join(dir, `${SCRATCH_PREFIX}sneaky.mjs`), 'export const a = 1;\n');
    mkdirSync(join(dir, `${SCRATCH_PREFIX}OP9Bzd`), { recursive: true });
    writeFileSync(join(dir, `${SCRATCH_PREFIX}OP9Bzd`, 'copied.mjs'), 'export {};\n');

    const found = collectMjsFiles(dir).map(f => relative(dir, f).split(sep).join('/'));
    if (found.length === 1 && found[0] === `${SCRATCH_PREFIX}sneaky.mjs`) {
      pass('a FILE carrying the scratch prefix stays in the walk; only the directory is skipped');
    } else {
      fail(`walk returned ${JSON.stringify(found)}; expected only ${SCRATCH_PREFIX}sneaky.mjs`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 9. Liveness beats age, in both directions ─────────────────────────
{
  // Age is a proxy, and it is wrong in the direction that costs something: a run
  // stops touching its scratch the moment the copy finishes, so one that then
  // blocks — a debugger, a suspended process, a laptop that slept — ages while
  // it is still running. The owner's pid is a question the OS can answer.
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-owner-'));
  try {
    const live = join(dir, `${SCRATCH_PREFIX}live00`);
    const dead = join(dir, `${SCRATCH_PREFIX}dead00`);
    for (const d of [live, dead]) mkdirSync(d, { recursive: true });
    markScratchOwner(live);            // this process, which is definitionally alive
    markScratchOwner(dead, 0x7fffffff); // a pid nothing is going to be using
    // Both are pushed well past the age gate: age must not be what decides.
    age(live, MIN_SCRATCH_AGE_MS * 24);
    age(dead, MIN_SCRATCH_AGE_MS * 24);

    const { removed, kept } = sweepScratchDirs(dir);
    if (existsSync(live) && !existsSync(dead)
        && kept.length === 1 && removed.length === 1) {
      pass('a live owner keeps its scratch past the age gate, a dead one does not save it');
    } else {
      fail(`liveness wrong: removed=${JSON.stringify(removed)} kept=${JSON.stringify(kept)} `
        + `live exists=${existsSync(live)} dead exists=${existsSync(dead)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 10. An unreadable marker means "unknown", not "alive" ─────────────
{
  // Every leftover written before this marker existed has none, so treating an
  // absent or unparseable marker as a live run would mean never sweeping again —
  // the bug, restored through the mechanism meant to be careful about it.
  const dir = mkdtempSync(join(tmpdir(), 'co-scratch-nomarker-'));
  try {
    const bare = join(dir, `${SCRATCH_PREFIX}bare00`);
    const junk = join(dir, `${SCRATCH_PREFIX}junk00`);
    mkdirSync(bare, { recursive: true });
    mkdirSync(junk, { recursive: true });
    writeFileSync(join(junk, '.owner-pid'), 'not-a-pid\n');

    const unknown = !scratchOwnerAlive(bare) && !scratchOwnerAlive(junk);
    age(bare);
    age(junk);
    const { removed } = sweepScratchDirs(dir);
    if (unknown && removed.length === 2) {
      pass('a missing or unparseable owner marker falls through to the age gate');
    } else {
      fail(`unknown-owner handling wrong: unknown=${unknown} removed=${JSON.stringify(removed)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
