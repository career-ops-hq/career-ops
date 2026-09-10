/**
 * scratch-dirs.mjs — the one definition of "a throwaway copy of this checkout".
 *
 * Section 75 of `test-all.mjs` copies the whole checkout into
 * `mkdtempSync(join(ROOT, '.tmp-script-test-'))` so the script smoke tests can
 * run against a tree they are free to damage, and removes it in a `finally`. A
 * run killed between the two — a timeout, Ctrl-C, a crash — never reaches that
 * `finally` and leaves the copy behind.
 *
 * Nothing then notices. `.gitignore` carries a directory rule for the prefix, so
 * `git status` is empty; the copy excludes `.git`, so `isNestedCheckout()` in
 * `mjs-files.mjs` cannot recognise it either. Every walker reads the stale copy
 * as part of the repository, and the guards that grade file LAYOUT are the ones
 * that break: a full second copy of `tests/` is, to
 * `tests/core-test-layout.test.mjs`, several hundred suites sitting outside
 * `tests/`. Measured on a clean `main`: 264 failures locally against 0 in CI,
 * naming paths under `.tmp-script-test-OP9Bzd/.tmp-script-test-tBjFgy/…`
 * (#3940). The nesting in that path is the second half of the bug — the copy
 * loop did not exclude an existing scratch either, so each run wrapped the
 * previous leftover inside its own.
 *
 * That failure shape is worse than a plain false red. It is unreproducible for
 * anyone else, it points at correct files, it appears on a commit the developer
 * did not write, and the state causing it is invisible to every command they
 * would think to run.
 *
 * The prefix lives here rather than at its three use sites because it was
 * already written twice — the `mkdtempSync` call and `.gitignore` — and had
 * begun to drift: one of them knew the scratch directory existed and the other
 * did not. A consumer that must recognise a scratch directory imports
 * `isScratchDir`; it cannot be spelled slightly differently in a fourth place.
 *
 * `.gitignore` is the one copy that cannot import this, since git reads it. Its
 * rule is the prefix followed by a glob and a directory slash, and
 * `tests/scratch-dirs.test.mjs` pins the two against each other by asking git
 * itself whether it ignores a directory named from this constant — a textual
 * comparison would pass on a rule that no longer matches anything.
 */

import { readdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * The prefix `mkdtempSync` is called with, and therefore the only thing a
 * scratch directory is guaranteed to have in common with the next one — the
 * six random characters after it are the point of `mkdtemp`.
 */
export const SCRATCH_PREFIX = '.tmp-script-test-';

/**
 * Is this directory NAME a throwaway copy left by the script smoke tests?
 *
 * Takes a bare name, not a path, because both walkers that consult it are
 * already iterating `readdirSync` entries and a path-taking predicate would
 * invite a caller to pass a path and match a legitimate directory that merely
 * sits inside a scratch tree.
 *
 * @param {string} name - A single path segment.
 * @returns {boolean}
 */
export function isScratchDir(name) {
  return name.startsWith(SCRATCH_PREFIX);
}

/**
 * How long a scratch directory must have sat untouched before a sweep will
 * delete it.
 *
 * The sweep is housekeeping, not correctness. What keeps a leftover from
 * breaking a run is `isScratchDir` in the walkers — the guards never read one
 * whether it is swept or not. All the sweep does is reclaim the disk, so it can
 * afford to be timid, and being timid is the whole point here: a second
 * `test-all.mjs` running in the same checkout has a scratch directory of its
 * own, and deleting THAT crashes a run that was doing nothing wrong.
 *
 * An hour, against a full suite that takes ~4 minutes locally and well under 30
 * on the slowest CI runner. The leftovers in #3940 were dated 7-aug and 15-aug,
 * so nothing is being kept that anyone wanted.
 */
export const MIN_SCRATCH_AGE_MS = 60 * 60 * 1000;

/**
 * Name of the marker a run drops inside its own scratch directory, holding the
 * pid that owns it.
 *
 * Age alone is a proxy for "is anybody using this", and it is wrong in one
 * direction that matters: a run paused or blocked after its copy finished stops
 * touching the tree, so its mtime stales while the run is very much alive. This
 * turns the question into one the operating system can answer.
 */
export const SCRATCH_OWNER_FILE = '.owner-pid';

/**
 * The age past which a scratch directory is removed even if its marker claims a
 * living owner.
 *
 * `kill(pid, 0)` answers "is that pid running", not "is that pid the run that
 * wrote this marker". After a crash the pid is free to be reused, and a marker
 * pointing at a recycled pid reads as alive forever — so without a ceiling,
 * "never sweep a live run's tree" quietly becomes "never sweep this tree".
 *
 * A week, chosen to be unreachable by any real run rather than to be tight: the
 * claim being overruled is a liveness signal, and overruling it early would put
 * back the failure the marker was added to remove. What it bounds is disk, not
 * correctness — the walkers skip a scratch either way.
 */
export const MAX_SCRATCH_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Record this process as the owner of `dir`.
 *
 * Best effort. A scratch that fails to get a marker is not broken, it just
 * falls back to being judged on age — which is exactly where this started, so
 * the failure mode is the previous behaviour rather than a new one.
 *
 * @param {string} dir - The scratch directory.
 * @param {number} [pid]
 */
export function markScratchOwner(dir, pid = process.pid) {
  try {
    writeFileSync(join(dir, SCRATCH_OWNER_FILE), `${pid}\n`);
  } catch {
    // See above: no marker means the age gate decides, which is survivable.
  }
}

/**
 * Is the process that owns this scratch directory still running?
 *
 * `kill(pid, 0)` sends no signal; it asks whether the pid can be signalled.
 * ESRCH means gone. EPERM means it exists and belongs to somebody else, which
 * for this question is a yes — and is the safer reading regardless, since the
 * caller is deciding whether to delete a directory.
 *
 * Unknown (no marker, unreadable, not a number) is deliberately NOT "alive": a
 * leftover from before this marker existed has none, and treating that as a
 * live run would mean never sweeping anything.
 *
 * @param {string} dir
 * @param {(pid: number) => void} [signal] - Seam for the liveness probe.
 * @returns {boolean}
 */
export function scratchOwnerAlive(dir, signal = (pid) => process.kill(pid, 0)) {
  let pid;
  try {
    pid = Number.parseInt(readFileSync(join(dir, SCRATCH_OWNER_FILE), 'utf-8').trim(), 10);
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    signal(pid);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Remove every scratch directory directly under `root` that has been untouched
 * for at least `minAgeMs`, and say which.
 *
 * Called at the start of a run rather than only at the end of one: the leftover
 * exists precisely because the previous run's cleanup did not get to execute,
 * so a second cleanup path scheduled the same way would not have run either.
 * The next run's startup is the first moment that is guaranteed to happen.
 *
 * Liveness is asked first, and answered by the operating system: a run marks
 * its own scratch with its pid (`markScratchOwner`), and a directory whose
 * owner is still running is never removed no matter how old it looks. That
 * matters because mtime stops advancing once the copy that filled the tree has
 * finished, so a run that then blocks — a debugger, a suspended process, a
 * laptop that slept — goes on aging while it is very much alive.
 *
 * Age is the fallback, for a directory with no usable marker: leftovers that
 * predate this mechanism, and any run whose marker could not be written. It is
 * also the ceiling — past `maxAgeMs` a living-owner claim is overruled, because
 * a pid outlives the run that wrote it and a recycled one would otherwise keep
 * a dead run's tree forever.
 *
 * Top level only. A scratch directory is created directly under ROOT, so that
 * is where a stale one is; recursing would mean walking into a tree this
 * function is about to delete, and a `.tmp-script-test-` name deeper in the
 * repository belongs to whoever put it there.
 *
 * Symlinks are never followed, and never removed: `entry.isDirectory()` is
 * false for one, so a link named like a scratch directory is skipped before any
 * of this. That is load-bearing — this function authorises a recursive delete,
 * and following a link would move that delete somewhere nobody asked for — so
 * `tests/scratch-dirs.test.mjs` pins it rather than leaving it to be inferred
 * from `withFileTypes`.
 *
 * Returns the names rather than printing them, so the caller decides whether a
 * sweep is worth a line of output. Silence would be wrong — a run that quietly
 * deleted a directory is its own small mystery — but that is the caller's call
 * to make, not this function's.
 *
 * A directory that cannot be removed is reported, not thrown: a sweep is
 * housekeeping in front of the real work, and failing the whole suite because a
 * stale copy is momentarily locked would replace a false red with another one.
 * The walkers skip it regardless, so the run stays correct either way.
 *
 * @param {string} root - Absolute path to sweep.
 * @param {object} [options]
 * @param {number} [options.minAgeMs] - Age floor; see MIN_SCRATCH_AGE_MS.
 * @param {number} [options.maxAgeMs] - Age past which a living-owner claim is
 *   overruled; see MAX_SCRATCH_AGE_MS.
 * @param {() => number} [options.now] - Clock seam, so the age gate is testable
 *   without sleeping for an hour.
 * @param {(dir: string) => void} [options.remove] - Removal seam, so a test can
 *   drive the failure branch without arranging an undeletable directory.
 * @param {(dir: string) => boolean} [options.isAlive] - Liveness seam.
 * @returns {{removed: string[], kept: string[], failed: {name: string, error: string}[]}}
 */
export function sweepScratchDirs(root, options = {}) {
  const {
    minAgeMs = MIN_SCRATCH_AGE_MS,
    maxAgeMs = MAX_SCRATCH_AGE_MS,
    now = Date.now,
    remove = (dir) => rmSync(dir, { recursive: true, force: true }),
    isAlive = scratchOwnerAlive,
  } = options;

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    // An unreadable root is the caller's problem, and it is about to be their
    // very loud problem regardless: everything after this reads the same tree.
    return { removed: [], kept: [], failed: [] };
  }

  const removed = [];
  const kept = [];
  const failed = [];
  const at = now();
  for (const entry of entries) {
    if (!entry.isDirectory() || !isScratchDir(entry.name)) continue;
    const dir = join(root, entry.name);

    let age;
    try {
      age = at - statSync(dir).mtimeMs;
    } catch {
      // Gone between readdir and stat, or unreadable. Either way this sweep has
      // nothing to do with it: not removed, and not claimed as kept.
      continue;
    }

    // Liveness is asked before age, because it is the real question — but it is
    // overruled past maxAgeMs, since a marker can outlive its run through pid
    // reuse and would otherwise protect the directory forever.
    if (age < maxAgeMs && isAlive(dir)) {
      kept.push(entry.name);
      continue;
    }
    if (age < minAgeMs) {
      // Young enough to belong to a run that is still going. Left alone, and
      // named, so a caller that wonders why the directory is still there can be
      // told rather than left guessing.
      kept.push(entry.name);
      continue;
    }

    try {
      remove(dir);
      removed.push(entry.name);
    } catch (err) {
      failed.push({ name: entry.name, error: err?.message ?? String(err) });
    }
  }
  return { removed: removed.sort(), kept: kept.sort(), failed };
}
