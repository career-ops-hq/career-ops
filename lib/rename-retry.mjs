// lib/rename-retry.mjs — the Windows rename-contention retry (#3006, #3046).
//
// Imports node:fs and nothing else. plugins/_lock.mjs uses it, and doctor.mjs
// loads that file before `npm install` has run
// (tests/doctor-without-node-modules.test.mjs), so this module must never pull
// in a package. tracker-utils.mjs re-exports everything here, so callers that
// already import from it keep working.

import { renameSync } from 'node:fs';

/**
 * Codes Windows raises when a rename-over-existing-file loses a race for the
 * destination handle. Same portability gap lib/dir-lock.mjs documents for
 * mkdir/rm (#2777): POSIX `rename(2)` atomically replaces the destination and
 * cannot fail this way, so these never fire on Linux/macOS.
 */
const RENAME_CONTENTION_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Backoff schedule for a contended rename. Worst case ~193ms, then rethrow. */
export const RENAME_RETRY_DELAYS_MS = [1, 2, 5, 10, 25, 50, 100];

/**
 * Is this error Windows saying "the destination is busy right now"?
 *
 * Exported for the same reason `lib/dir-lock.mjs` exports `isMkdirContention`
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
 * `writeFileAtomic` in tracker-utils.mjs and `saveLock` in plugins/_lock.mjs
 * are synchronous by contract (both run inside a held lock), so the backoff
 * cannot be a promise.
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
 * This mirrors `isMkdirContention` / `isRmContention` in lib/dir-lock.mjs.
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
