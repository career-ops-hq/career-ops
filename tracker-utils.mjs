/**
 * tracker-utils.mjs — shared helpers for rewriting `data/applications.md` rows.
 *
 * The tracker is a markdown table that several scripts mutate in place
 * (`dedup-tracker.mjs`, `normalize-statuses.mjs`, `merge-tracker.mjs`,
 * `set-status.mjs`). Keeping the row-rewrite, path-resolution, locking, and
 * atomic-write logic here means a fix lands once instead of drifting between
 * copies — and every writer excludes every other writer through the same lock.
 */

import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, statSync, lstatSync, existsSync, realpathSync } from 'fs';
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'path';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';
import * as yaml from 'js-yaml';
// One definition for both locks: this module and pipeline-lock.mjs implement
// the same directory-lock protocol on purpose, and #2777 showed how the two
// copies drift — pipeline-lock learned that Windows answers mkdir/rm with
// EPERM/EACCES/EBUSY under contention while this file still treated anything
// but EEXIST as fatal, killing a writer and losing its item.
import {
  isMkdirContention, isRmContention, rmLockArtifactSync, createLockWaitPolicy,
  lockRecoveryVerdict, RECOVER_STALE,
} from './pipeline-lock.mjs';
import { normalizeTextKey } from './tracker-parse.mjs';

/**
 * Minimum age before directory age alone may condemn an ownerless lock or
 * recover guard. See `lockRecoveryVerdict` for why the age check needs a floor.
 *
 * Re-exported rather than redeclared: the floor is applied inside that function
 * now, so a local copy would be a constant this file no longer enforces — free
 * to drift from the one that actually decides.
 */
export { OWNERLESS_GRACE_MS } from './pipeline-lock.mjs';

/**
 * Rebuild a markdown table row from the cells produced by `line.split('|')`.
 *
 * `split('|')` yields a leading empty element (before the opening `|`) and,
 * when the row ends with a trailing `|`, a trailing empty element too. A naive
 * `slice(1, -1)` assumes that trailing empty always exists — but a row written
 * without a trailing pipe (`| 5 | … | note`, still a valid row) keeps its real
 * last cell (the notes) at the end, so `slice(1, -1)` silently drops it. Here we
 * drop the leading empty and only drop a trailing element when it is genuinely
 * empty, preserving every real cell regardless of trailing-pipe style (and
 * tolerating extra columns like a custom Location).
 *
 * @param {string[]} parts - Trimmed cells from `line.split('|').map(s => s.trim())`.
 * @returns {string} The rebuilt `| a | b | … |` row.
 */
export function rebuildRow(parts) {
  const cells = parts.slice(1);
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * Normalize company names for same-company lookups across tracker scripts.
 *
 * Company names can contain spaces, punctuation, or branding variants in the
 * tracker and incoming rows. Folding them gives every consumer (merge-tracker
 * dedup, set-status/outcome row resolution, company-history grouping, the
 * scan blacklist) the same stable company key, so a row one script would match
 * is never missed by another.
 *
 * Script-preserving via the shared normalizeTextKey(): the previous
 * `[^a-z0-9]` filter DELETED every non-Latin name, so アクメ株式会社,
 * グロベックス合同会社 and Яндекс all produced `''` and compared equal to each
 * other — merge-tracker then treated applications at different companies as
 * the same row and silently overwrote one (#2429). `?` still folds to `''`,
 * which is what the #1596 cross-channel Via guard depends on.
 *
 * @param {string} name - Company name from the tracker or an input row.
 * @returns {string} Case-folded, punctuation-free, script-preserving key.
 */
export function normalizeCompany(name) {
  return normalizeTextKey(name);
}

/**
 * Control characters that are invisible in every rendered view of the tracker.
 *
 * C0 and DEL and C1, minus the three whitespace controls: `\t` is ordinary
 * whitespace inside a cell, and `\r`/`\n` are folded to a single space by
 * cell() before this runs — stripping any of the three would glue words
 * together instead of separating them.
 *
 * Deliberately NOT shared with the plugin token/display sanitizer, which strips
 * the same idea but a different range: it collapses all whitespace first and so
 * can take `\t`/`\r`/`\n` with the rest, which here would destroy word breaks.
 * Two ranges that must differ are two constants; only the ranges that must
 * agree are shared, which is the single export below.
 *
 * Exported because verify-pipeline.mjs has to recognize exactly what cell()
 * removes: stripping only stops NEW bytes entering, and a second copy of this
 * range would let the write path and the detector disagree about what counts.
 */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Neutralize characters that would corrupt the applications.md table.
 *
 * Tracker rows are read with a raw `line.split('|')`, so a literal pipe or a
 * newline in a free-text value (company/role/location/notes) would shift every
 * later column. Replace rather than backslash-escape: `\|` would still split
 * on the inner pipe. Additive — normal cells are unchanged; only values that
 * would already break the table get sanitized.
 *
 * Control characters (#3892) get the same treatment for the same reason, and
 * here rather than in each writer: this is the one sanitizer every tracker
 * writer passes through — merge-tracker's buildRow (and so the web, which
 * dictates its rows through the same merge path), set-status's note. A guard
 * added per writer is a guard the next writer is free to reintroduce the bug
 * around. They are DELETED, not replaced with a space: the byte renders as
 * nothing in markdown, on GitHub and in the dashboard, so a substitution would
 * change text a human has already read. The asymmetry is the point — a byte
 * that costs one regex to reject costs an unrelated arithmetic discrepancy
 * much later to find, because every view of the table hides it.
 *
 * @param {*} v - Free-text value headed for a table cell.
 * @returns {string} Table-safe value.
 */
export function cell(v) {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\s*\|\s*/g, ' / ')
    .trim();
}

/**
 * Resolve the tracker file path for the current workspace.
 *
 * Supports both layouts: `data/applications.md` (boilerplate) and
 * `applications.md` (original root layout). The `CAREER_OPS_TRACKER` env var
 * overrides the path (used by tests and non-standard layouts). The result is
 * canonicalized so every script that locks or hashes the tracker path agrees
 * on one spelling.
 *
 * @param {string} rootDir - The career-ops repository root.
 * @returns {string} Absolute canonical tracker path.
 */
export { resolveTrackerPath } from './path-resolver.mjs';

/**
 * Resolve the workspace root that owns a tracker, i.e. where `reports/` and
 * `data/` sit: the tracker's parent in the `data/applications.md` layout, and
 * the tracker's own directory in the root `applications.md` layout.
 *
 * Derive sibling paths from THIS rather than from a script's own location, so
 * that pointing `CAREER_OPS_TRACKER` at another workspace moves the whole set
 * together. A script that mixes the two (tracker from the env, manifest from
 * its own directory) reads one workspace and writes another — which is how the
 * merge-tracker suite came to read a developer's real `data/pdf-index.tsv`
 * while writing an isolated temp tracker.
 *
 * @param {string} trackerPath - Tracker path, typically from resolveTrackerPath().
 * @returns {string} Absolute workspace root directory.
 */
export function resolveWorkspaceRoot(trackerPath) {
  const trackerDir = dirname(trackerPath);
  return basename(trackerDir) === 'data' ? dirname(trackerDir) : trackerDir;
}

/**
 * Resolve the PDF manifest (`data/pdf-index.tsv`) for the workspace that owns
 * a tracker. `CAREER_OPS_PDF_INDEX` overrides it explicitly.
 *
 * One definition for every reader, because the manifest path was previously
 * rebuilt from a literal in each script — and each picked its own base
 * directory, so `merge-tracker.mjs` derived it from the tracker while
 * `sync-pdf-flags.mjs` and `find.mjs` used their own install directory. Scripts
 * that resolve the tracker from `CAREER_OPS_TRACKER` then read one workspace's
 * manifest against another's tracker (#2471).
 *
 * @param {string} trackerPath - Tracker path, typically from resolveTrackerPath().
 * @returns {string} Absolute path to the PDF manifest.
 */
export function resolvePdfIndexPath(trackerPath) {
  return process.env.CAREER_OPS_PDF_INDEX
    || join(resolveWorkspaceRoot(trackerPath), 'data', 'pdf-index.tsv');
}

/**
 * Convert the tracker path into one stable absolute spelling before hashing it.
 *
 * Equivalent tracker paths can be written in multiple ways, such as a relative
 * path from the current shell, an absolute path, or a path that travels through
 * a symlink. The lock key must be based on one canonical spelling so all
 * processes that target the same tracker also target the same lock directory.
 *
 * @param {string} path - Raw tracker path from config, env, or the default.
 * @returns {string} Absolute canonical path when the file exists, else resolved path.
 */
import { canonicalizeTrackerPath } from './path-resolver.mjs';
export { canonicalizeTrackerPath };

/**
 * Check whether one absolute path stays inside another directory.
 *
 * This protects recursive lock cleanup from accepting paths that escape the
 * system temp directory through `..` segments or unrelated absolute roots.
 * Also the shared boundary check for outcome.mjs's --clean-output (#2653,
 * #2911), where an output/ path must be validated before ever being deleted.
 *
 * @param {string} childPath - Candidate path to validate.
 * @param {string} parentDir - Required parent directory boundary.
 * @param {{relative: Function, isAbsolute: Function, sep: string}} [pathMod] -
 *   Path primitives to use, defaulting to the platform's own. Tests pass
 *   `path.win32` or `path.posix` to deterministically exercise one platform's
 *   separator and absolute-path rules (drive letters, UNC paths) regardless
 *   of the host OS running the suite.
 * @returns {boolean} True when childPath is inside parentDir or equal to it.
 */
export function pathIsInside(childPath, parentDir, pathMod = { relative, isAbsolute, sep }) {
  const relativePath = pathMod.relative(parentDir, childPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${pathMod.sep}`) && !pathMod.isAbsolute(relativePath));
}

/**
 * Walk up to the nearest ancestor that exists on disk.
 *
 * `lstatSync`, not `statSync`: a symlink must count as existing in its own
 * right, so the caller canonicalizes the link itself rather than walking past
 * it to a parent that looks contained.
 *
 * @param {string} pathValue - Absolute candidate path.
 * @returns {string} The candidate, or its nearest existing ancestor.
 */
function nearestExistingPath(pathValue) {
  let candidate = pathValue;
  while (true) {
    try {
      lstatSync(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

/**
 * Check containment both lexically AND canonically (symlinks resolved).
 *
 * `pathIsInside` compares strings, which is right for a boundary that is only
 * ever about spelling (the lock-name guard) and for the injected-`pathMod`
 * tests that exercise win32/posix rules on paths that do not exist. It is NOT
 * enough before deleting: `resolve()` never follows symlinks, so an `output/`
 * containing a link to somewhere else lets a path spell itself as contained
 * while pointing outside — and the deletion is unrecoverable.
 *
 * Mirrors `isWorkspaceOutputPath` in generate-pdf.mjs, which guards the far
 * lower-stakes *write* path. Lives here so a third copy is not needed; that
 * one should be migrated onto this rather than left to drift (see #2911).
 *
 * @param {string} childPath - Candidate path to validate.
 * @param {string} parentDir - Required parent directory boundary.
 * @returns {boolean} True only when the path is inside both lexically and after
 *   resolving symlinks. False if canonicalization fails for any reason.
 */
export function pathIsInsideCanonical(childPath, parentDir) {
  const parent = resolve(parentDir);
  const child = resolve(childPath);
  if (!pathIsInside(child, parent)) return false;

  try {
    const canonicalParent = realpathSync(parent);
    const canonicalChild = realpathSync(nearestExistingPath(child));
    return pathIsInside(canonicalChild, canonicalParent);
  } catch {
    return false;
  }
}

/**
 * Compute the tracker lock directory for a tracker file.
 *
 * The lock name is derived from a hash of the canonical tracker path, so every
 * writer (`merge-tracker.mjs`, `set-status.mjs`) that targets the same tracker
 * contends on the same lock. `CAREER_OPS_TRACKER_LOCK` exists for tests and
 * unusual local layouts, but lock directories are removed recursively, so
 * env-provided paths must be absolute, live under the OS temp directory, and
 * use the career-ops lock-name prefix. Invalid values are ignored and the
 * deterministic temp-dir default is used instead.
 *
 * @param {string} appsFile - Canonical tracker path (see canonicalizeTrackerPath).
 * @returns {string} Safe lock directory path.
 */
export function trackerLockDirFor(appsFile) {
  const lockKey = createHash('sha256').update(appsFile).digest('hex').slice(0, 16);
  const tmpRoot = realpathSync(tmpdir());
  const fallback = join(tmpRoot, `career-ops-merge-tracker-${lockKey}.lock`);
  const envValue = process.env.CAREER_OPS_TRACKER_LOCK;
  if (!envValue || !isAbsolute(envValue)) return fallback;

  const candidate = resolve(envValue);
  const parentDir = dirname(candidate);
  const canonicalParent = existsSync(parentDir) ? realpathSync(parentDir) : resolve(parentDir);
  if (!pathIsInside(canonicalParent, tmpRoot)) return fallback;
  if (!basename(candidate).startsWith('career-ops-merge-tracker-')) return fallback;
  return candidate;
}

/**
 * Pause the async lock flow for a fixed number of milliseconds.
 *
 * Used in the lock retry loop, where waiting briefly avoids a tight CPU spin
 * while another process owns the tracker lock.
 *
 * @param {number} ms - Milliseconds to wait before resolving.
 * @returns {Promise<void>} Resolves after the requested delay.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read lock ownership metadata from a tracker lock directory.
 *
 * The metadata contains the owner PID, a unique release token, the acquisition
 * timestamp, and the tracker path. Invalid or missing metadata is treated as
 * unreadable so the stale-lock recovery path can fall back to directory age.
 *
 * @param {string} lockDir - Directory that represents the active lock.
 * @returns {object|null} Parsed owner metadata, or null when unavailable.
 */
function readLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function sameLockDirectory(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && (left.ino !== 0 || left.birthtimeMs === right.birthtimeMs);
}

// The recovery judgment comes from pipeline-lock rather than a second copy of
// it. "Mirrors pipeline-lock" was the previous arrangement, and mirroring is
// precisely what drifts: this copy still answered a bare boolean, so "the
// directory was gone when I looked" reached the caller as a licence to DELETE
// whatever is at that path now — a lock a rival acquirer may have created in
// between, whose winner then dies with ENOENT writing its own owner.json.

/**
 * Acquire an exclusive filesystem lock for one tracker mutation.
 *
 * The critical section must cover the full read/modify/write/move sequence, not
 * just the final write. Otherwise two processes can read the same old tracker
 * snapshot, compute independent updates, and let the later writer erase rows
 * written by the earlier one. The lock is implemented with atomic directory
 * creation, owner metadata, retry/backoff, stale-owner recovery, and a release
 * token so one process cannot delete another process's newer lock.
 *
 * @param {string} lockDir - Directory path used as the lock sentinel.
 * @param {object} [options] - Lock timing options.
 * @param {number} [options.timeoutMs=60000] - Maximum time to wait for the lock.
 * @param {number} [options.retryMs=75] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=600000] - Metadata-free stale-lock threshold, floored at OWNERLESS_GRACE_MS.
 * @param {string} [options.tracker] - Tracker path recorded in owner metadata.
 * @param {Function} [options.removeLock] - Release hook for deterministic fault tests.
 * @returns {Promise<{attempts:number,waitMs:number,staleRecovered:boolean,release:Function}>}
 * Lock handle with metadata and an idempotent release method.
 */
export async function acquireTrackerLock(lockDir, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retryMs = options.retryMs ?? 75;
  const staleMs = options.staleMs ?? 10 * 60_000;
  const recoverGuardDir = `${lockDir}.recover`;
  const token = randomUUID();
  const startedAt = Date.now();
  let attempts = 0;
  let staleRecovered = false;

  // Jitter and the progress rule come from pipeline-lock rather than a fourth
  // hand-rolled wait loop. This file slept a FIXED retryMs and bounded the loop
  // on plain elapsed time, so it carried both defects #2506 and #2835 removed
  // from the definition: waiters woke in lockstep and re-raced, and a caller
  // waiting on a healthy lock being handed round briskly was killed anyway.
  //
  // There is no separate maxWaitMs knob here, so no hardDeadline is passed and
  // the policy applies its own ceiling. Writing one out here would put a fourth
  // copy of that bound in the tree, and a copy that drifts changes retry timing
  // silently — nothing fails, so nothing reports it (#3895).
  const { backoffMs, holderStillWedged, noteWaiting, ceilingReached } = createLockWaitPolicy(lockDir, {
    timeoutMs, retryMs, deadline: Date.now() + timeoutMs,
  });
  for (;;) {
    if (holderStillWedged() || ceilingReached()) break;
    attempts++;
    try {
      mkdirSync(lockDir);
      try {
        writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
          pid: process.pid,
          token,
          started_at: new Date().toISOString(),
          tracker: options.tracker ?? '',
        }, null, 2));
      } catch (ownerErr) {
        // ENOENT writing owner.json means the just-won lock directory is
        // gone: another caller (mis)judged it reclaimable and deleted it.
        // A lost race, not a failure — re-enter the loop and compete again
        // (mirrors pipeline-lock; dying here loses the caller's write).
        if (ownerErr?.code === 'ENOENT') continue;
        // We created the dir but could not record ownership. An empty,
        // owner-less lock dir would block every future locker until the
        // staleMs age-out — remove what we just created before rethrowing.
        // Scoped to the owner write only: the mkdir contention path is still
        // handled by the outer catch. Best-effort removal: a contended rm
        // must not mask ownerErr, and the orphan ages out regardless.
        rmLockArtifactSync(lockDir);
        throw ownerErr;
      }

      let ownerVerified = false;
      let verifiedDir = null;
      let released = false;
      const removeLock = typeof options.removeLock === 'function'
        ? options.removeLock
        : path => rmSync(path, { recursive: true, force: true });
      return {
        attempts,
        waitMs: Date.now() - startedAt,
        staleRecovered,
        release() {
          if (released) return;
          if (ownerVerified) {
            let currentDir;
            try {
              currentDir = statSync(lockDir);
            } catch (err) {
              if (err?.code === 'ENOENT') {
                released = true;
                return;
              }
              throw err;
            }
            if (!sameLockDirectory(verifiedDir, currentDir)) {
              released = true;
              return;
            }
            const owner = readLockOwner(lockDir);
            if (owner && owner.token !== token) {
              released = true;
              return;
            }
            if (!owner && existsSync(join(lockDir, 'owner.json'))) {
              throw new Error(`Cannot verify tracker lock ownership at ${lockDir}`);
            }
          } else {
            let beforeRead;
            try {
              beforeRead = statSync(lockDir);
            } catch (err) {
              if (err?.code === 'ENOENT') {
                released = true;
                return;
              }
              throw err;
            }
            const owner = readLockOwner(lockDir);
            if (owner?.token !== token) {
              if (owner) released = true;
              else throw new Error(`Cannot verify tracker lock ownership at ${lockDir}`);
              return;
            }
            const afterRead = statSync(lockDir);
            if (!sameLockDirectory(beforeRead, afterRead)) {
              released = true;
              return;
            }
            ownerVerified = true;
            verifiedDir = afterRead;
          }
          // Best-effort, mirroring pipeline-lock's release: ownership was
          // verified above, so a contended rm (Windows EPERM/EBUSY while
          // another process stats the directory) must not kill a caller whose
          // work already succeeded — the orphaned lock ages out via
          // lockRecoveryVerdict. Injected removeLock hooks (fault tests) keep
          // their errors: only the known contention codes are swallowed.
          try {
            removeLock(lockDir);
          } catch (rmErr) {
            if (!isRmContention(rmErr)) throw rmErr;
          }
          released = true;
        },
      };
    } catch (err) {
      // Not just EEXIST: Windows reports a lock directory that is mid-create
      // or mid-remove by another process as EPERM/EACCES. That is contention,
      // not failure — treating it as fatal is how a concurrent writer dies and
      // its write is lost (#2777, measured on windows-latest).
      if (!isMkdirContention(err)) throw err;
      noteWaiting();

      let hasRecoverGuard = false;
      try {
        mkdirSync(recoverGuardDir);
        hasRecoverGuard = true;
      } catch (guardErr) {
        if (!isMkdirContention(guardErr)) throw guardErr;
        // A process killed between creating the guard and its cleanup leaves
        // the guard behind forever, permanently disabling stale-lock recovery
        // for every future writer. The guard normally lives for milliseconds,
        // so an old one is judged stale by the same age rule as a
        // metadata-free lock and removed; the next loop iteration can then
        // take the guard and run recovery.
        //
        // Only an EEXIST guard is judged by age: an EPERM/EACCES answer means
        // the guard is mid-flight right now, and reasoning about the age of a
        // directory we cannot even stat reliably would evict a live guard.
        // STALE only: a guard already gone needs no eviction, and evicting on
        // that answer deletes the guard another caller has just taken.
        if (guardErr.code === 'EEXIST'
          && lockRecoveryVerdict(recoverGuardDir, staleMs) === RECOVER_STALE) {
          rmLockArtifactSync(recoverGuardDir);
        }
      }

      if (hasRecoverGuard) {
        try {
          // STALE only. VANISHED means the lock was absent when we looked, and
          // by the time this line runs another acquirer may have won the mkdir
          // and be partway through writing owner.json — deleting on that answer
          // destroys a live lock and kills its winner with ENOENT.
          if (lockRecoveryVerdict(lockDir, staleMs) === RECOVER_STALE) {
            if (rmLockArtifactSync(lockDir)) {
              staleRecovered = true;
              continue;
            }
            // rm hit contention: another process is touching the stale lock at
            // this instant — back off instead of treating the collision as fatal.
          }
        } finally {
          rmLockArtifactSync(recoverGuardDir);
        }
      }

      await sleep(backoffMs());
    }
  }

  // Tag the timeout so callers can tell "lock is busy, retry later" apart
  // from filesystem/configuration failures rethrown out of the loop above.
  const timeoutErr = new Error(`Timed out waiting for tracker lock at ${lockDir}`);
  timeoutErr.code = 'LOCK_TIMEOUT';
  throw timeoutErr;
}

/**
 * Open one serialized read/replace transaction for an applications tracker.
 * Writers receive only the canonical path plus guarded read and atomic replace
 * operations, keeping the complete mutation inside one shared lock lifetime.
 */
export async function openTrackerTransaction(appsFile, options = {}) {
  const trackerPath = canonicalizeTrackerPath(appsFile);
  const { lockDir = trackerLockDirFor(trackerPath), ...lockOptions } = options;
  const lock = await acquireTrackerLock(lockDir, {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...lockOptions,
  });
  let closed = false;
  let closeError = null;
  const assertOpen = () => {
    if (closed) throw new Error('Tracker transaction is already closed');
  };
  return {
    path: trackerPath,
    read() {
      assertOpen();
      return readFileSync(trackerPath, 'utf-8');
    },
    replace(content) {
      assertOpen();
      writeFileAtomic(trackerPath, content);
    },
    close() {
      if (closed) return closeError;
      try {
        lock.release();
      } catch (err) {
        closeError = err;
        console.error(`Warning: tracker transaction closed but lock cleanup failed at ${lockDir}: ${err.message}`);
      } finally {
        closed = true;
      }
      return closeError;
    },
  };
}

/**
 * Codes Windows raises when a rename-over-existing-file loses a race for the
 * destination handle. Same portability gap this module already documents for
 * mkdir/rm (#2777): POSIX `rename(2)` atomically replaces the destination and
 * cannot fail this way, so these never fire on Linux/macOS.
 */
const RENAME_CONTENTION_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Backoff schedule for a contended rename. Worst case ~193ms, then rethrow. */
export const RENAME_RETRY_DELAYS_MS = [1, 2, 5, 10, 25, 50, 100];

/**
 * Is this error Windows saying "the destination is busy right now"?
 *
 * Exported for the same reason `pipeline-lock.mjs` exports `isMkdirContention`
 * and `isRmContention`: one definition, testable, and no second copy to drift.
 *
 * @param {unknown} err - Error thrown by a rename attempt.
 * @returns {boolean} True when the rename should be retried.
 */
export function isRenameContention(err) {
  return RENAME_CONTENTION_CODES.has(err?.code);
}

/**
 * Block the current thread for `ms` without an event-loop turn.
 *
 * `writeFileAtomic` is synchronous by contract (every tracker writer calls it
 * inside a held lock), so the backoff cannot be a promise.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @returns {void}
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * `renameSync` that survives Windows contention for the destination handle.
 *
 * Windows refuses a rename whose destination is open by anyone else at that
 * instant, and answers EPERM/EACCES/EBUSY. The holder is usually not another
 * writer of ours (they are serialized by the tracker lock) but a transient
 * reader: an antivirus scanner, the Search indexer, or a concurrent
 * `readFileSync` from a reporting script. The handle is released in
 * milliseconds, so a short backoff converts a lost write into a completed one.
 *
 * This mirrors `isMkdirContention` / `isRmContention` in pipeline-lock.mjs.
 * Same reasoning as #2777: treating portable-looking contention as fatal is how
 * a write gets LOST, and the tracker is the canonical store.
 *
 * @param {string} tmpPath - Source path (the fully written temporary file).
 * @param {string} path - Destination path to replace.
 * @param {(from: string, to: string) => void} [rename] - Injectable rename, for tests.
 * @returns {void}
 */
export function renameSyncWithRetry(tmpPath, path, rename = renameSync) {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tmpPath, path);
      return;
    } catch (err) {
      if (!isRenameContention(err) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err;
      sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Replace a tracker file atomically using a same-directory temporary file.
 *
 * Writing into the same directory keeps the final rename atomic on normal
 * filesystems and avoids exposing a partially written `applications.md` to other
 * readers. The rename retries through short Windows contention (see
 * `renameSyncWithRetry`). If the write or rename ultimately fails, the temporary
 * file is cleaned up before the original error is rethrown.
 *
 * @param {string} path - Final file path to replace.
 * @param {string} content - Complete file content to write.
 * @returns {void}
 */
export function writeFileAtomic(path, content) {
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, content);
    renameSyncWithRetry(tmpPath, path);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Load the canonical tracker states from `templates/states.yml`.
 *
 * states.yml is the single source of truth for the 8 canonical states and
 * their aliases. Parsing it here (instead of hardcoding the list) means a new
 * state or alias lands in one file and every consumer follows.
 *
 * @param {string} statesPath - Path to templates/states.yml.
 * @returns {{id:string,label:string,aliases:string[]}[]} Parsed state entries.
 */
export function loadCanonicalStates(statesPath) {
  const doc = yaml.load(readFileSync(statesPath, 'utf-8'));
  if (!doc || !Array.isArray(doc.states)) {
    throw new Error(`Malformed states file at ${statesPath}: expected a top-level "states" list`);
  }
  return doc.states.map(s => ({
    id: String(s.id ?? ''),
    label: String(s.label ?? ''),
    aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : [],
  }));
}

/**
 * Resolve user input to a canonical state label, strictly.
 *
 * Case-insensitive match against each state's label, id, and aliases, after
 * stripping markdown bold. Unlike merge-tracker's lenient batch normalization
 * (which defaults unknowns to "Evaluated" so a whole merge isn't lost), this
 * is the strict variant for interactive/CLI use: unknown input returns null so
 * the caller can reject it before anything touches the tracker.
 *
 * @param {string} input - Raw state text from the user or a script.
 * @param {{id:string,label:string,aliases:string[]}[]} states - From loadCanonicalStates().
 * @returns {string|null} Canonical label (e.g. "Applied"), or null when unknown.
 */
/**
 * Case-fold a status the way a HUMAN typed it, not the way JS lowercases it.
 *
 * JavaScript lowercases the Turkish dotted capital `İ` (U+0130) to `i` plus a
 * COMBINING DOT ABOVE (U+0307), and the mark survives — so `TEKLİF` becomes
 * `tekli\u0307f`, which equals no alias anyone would ever write. Turkish
 * uppercase status words are ordinary, so every all-caps Turkish row missed.
 *
 * Dropping U+0307 after an NFKC lowercase repairs it for every alias at once, rather
 * than listing the ~32 mark-bearing spellings the aliases would otherwise need
 * — a list that would also have to carry `ski\u0307p` and `hi\u0307red`, and that
 * would silently need extending on every future alias containing an `i`.
 *
 * No canonical state, label or alias legitimately contains U+0307, so this
 * cannot collapse two different states together (asserted in test-all).
 *
 * @param {*} input - Raw status text.
 * @returns {string} Lowercased, mark-folded, bold/whitespace-stripped status.
 */
export function foldStatusInput(input) {
  return String(input ?? '')
    .replace(/\*\*/g, '')
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    // NO `NFD`, for the same structural reason normalizeTextKey documents:
    // NFKC leaves ż, ė and ġ as SINGLE precomposed code points so this strip
    // cannot reach their dots, while `i` + U+0307 (what lowercasing `İ`
    // produces) has no precomposed form and stays exposed. Decomposing first
    // looks equivalent and is not — it collapses Żubr/Zubr, Ėmė/Eme and
    // Ġenerali/Generali, which is what 5df43e7 had to undo on the company key.
    .replace(/\u0307/gu, '');
}

export function resolveCanonicalState(input, states) {
  const clean = foldStatusInput(input);
  if (!clean) return null;
  for (const s of states) {
    if (s.label.toLowerCase() === clean) return s.label;
    if (s.id.toLowerCase() === clean) return s.label;
    if (s.aliases.some(a => a.toLowerCase() === clean)) return s.label;
  }
  return null;
}

/**
 * Canonical process-exit codes shared by every locked, single-purpose
 * tracker-writer CLI (set-status.mjs, mark-pdf-ready.mjs, ...) — one source
 * so a new script can't drift from the numbering an existing one already
 * commits to (callers/CI may depend on these exact values).
 */
export const CLI_EXIT = { OK: 0, USAGE: 1, NOT_FOUND: 2, AMBIGUOUS: 3, LOCK_TIMEOUT: 4 };

/**
 * Build a failWith(exitCode, code, message, extra) bound to a --json flag,
 * shared by every canonical tracker-writer CLI so the JSON-vs-human error
 * contract can't drift between them.
 *
 * With json:true the error object goes to stdout so machine callers always
 * parse one stream; the human-readable message always goes to stderr.
 *
 * @param {boolean} json - The CLI's --json flag.
 * @returns {(exitCode: number, code: string, message: string, extra?: object) => never}
 */
export function makeCliFailWith(json) {
  return function failWith(exitCode, code, message, extra = {}) {
    if (json) {
      console.log(JSON.stringify({ error: message, code, ...extra }));
    }
    console.error(`❌ ${message}`);
    process.exit(exitCode);
  };
}

/**
 * Acquire the shared tracker lock for a locked read-modify-write CLI,
 * routing any failure through the caller's failWith so every canonical
 * writer surfaces lock errors identically (LOCK_TIMEOUT → CLI_EXIT.LOCK_TIMEOUT,
 * anything else → CLI_EXIT.USAGE as a non-retryable config/filesystem error).
 *
 * Dry-run never writes, so it must not hold the exclusive lock: a read-only
 * preview should not block (or be blocked by) another writer — returns null
 * in that case. Registers the `process.exit` release safety net these CLIs
 * rely on (failWith/failUsage/row-resolution all exit directly and skip an
 * explicit release — release() is idempotent, so both firing is fine).
 *
 * @param {string} appsFile - Canonical tracker path (resolveTrackerPath()).
 * @param {{dryRun: boolean, failWith: (exitCode: number, code: string, message: string, extra?: object) => never}} options
 * @returns {Promise<{release: Function}|null>}
 */
export async function acquireTrackerLockForCli(appsFile, { dryRun, failWith }) {
  if (dryRun) return null;
  let lock;
  try {
    lock = await acquireTrackerLock(trackerLockDirFor(appsFile), {
      timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
      retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
      staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
      tracker: appsFile,
    });
  } catch (err) {
    // Exit 4 means "lock is busy — retry later" and must stay reserved for
    // the actual timeout. Filesystem/configuration failures (EACCES on the
    // lock dir, unwritable owner.json, …) are not retryable and fail as a
    // config error instead.
    if (err?.code === 'LOCK_TIMEOUT') {
      failWith(CLI_EXIT.LOCK_TIMEOUT, 'lock-timeout', err.message);
    } else {
      failWith(CLI_EXIT.USAGE, 'lock-error', `Cannot acquire tracker lock: ${err.message}`);
    }
    // failWith is documented (and, today, always) to exit the process — but
    // this function is now shared, so don't let a future non-exiting failWith
    // silently fall through to releasing/returning an undefined lock; fail
    // loudly instead.
    throw err;
  }
  process.once('exit', () => lock.release());
  return lock;
}
