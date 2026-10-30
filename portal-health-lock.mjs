// portal-health-lock.mjs — a cross-process advisory lock for
// data/portal-health.tsv, so appendPortalHealth() (scan.mjs) and any
// read-modify-write cleanup of the same file (tests/portal-health-guard.mjs)
// can never interleave. A concurrent appender that lands between a cleanup's
// read and write would otherwise be silently discarded.
//
// The protocol — the lock directory, owner.json, the recover guard, stale
// recovery and the token-checked release — is lib/dir-lock.mjs, shared with
// every other lock in the core. This module picks the lock path, the timing
// defaults and their env overrides, and the timeout error.
//
// It used to carry its own copy, and that copy was the one that could free a
// peer's lock: a failed owner.json write removed whatever sat at the lock path,
// including a newer caller's live lock after an ENOENT (#5358).

import { acquireDirLock, releaseOrWarn } from './lib/dir-lock.mjs';

// Re-exported rather than redeclared: the floor is applied inside
// lockRecoveryVerdict, so a local copy of the number would be a constant this
// file no longer enforces — free to drift from the one that decides.
export { OWNERLESS_GRACE_MS } from './lib/dir-lock.mjs';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 80;
const DEFAULT_TIMEOUT_MS = 8_000;

export class LockTimeoutError extends Error {
  constructor(lockDir, timeoutMs) {
    super(`portal-health lock timeout: ${lockDir} held > ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
    this.lockDir = lockDir;
  }
}

function lockDirFor(filePath) {
  return `${filePath}.lock`;
}

/**
 * Blocks until the lock on `filePath` is held, then returns a handle whose
 * release() frees it. Throws LockTimeoutError if the lock stays busy.
 *
 * @param {string} filePath - File the lock guards.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=8000] - Max time to wait for the lock.
 * @param {number} [options.retryMs=80] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=30000] - Age threshold for a lock with no readable owner.
 */
export async function acquirePortalHealthLock(filePath, options = {}) {
  // Env overrides let a caller several frames up the stack tune contention
  // timing without threading options through every signature — the same
  // escape hatch the tracker lock provides.
  const timeoutMs = options.timeoutMs ?? (Number(process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const retryMs = options.retryMs ?? (Number(process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_RETRY_MS) || DEFAULT_RETRY_MS);
  const staleMs = options.staleMs ?? (Number(process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_STALE_MS) || DEFAULT_STALE_MS);
  const lock = await acquireDirLock(lockDirFor(filePath), {
    timeoutMs,
    retryMs,
    staleMs,
    owner: { file: filePath },
    createParent: true,
    timeoutError: ({ lockDir }) => new LockTimeoutError(lockDir, timeoutMs),
  });
  return { lockDir: lock.lockDir, release: lock.release };
}

/** Acquires the lock on `filePath`, runs fn, and always releases it. */
export async function withPortalHealthLock(filePath, fn, options = {}) {
  const lock = await acquirePortalHealthLock(filePath, options);
  try {
    return await fn();
  } finally {
    releaseOrWarn(lock);
  }
}
