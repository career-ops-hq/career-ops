// portal-health-lock.mjs — a tiny cross-process advisory lock for
// data/portal-health.tsv, so appendPortalHealth() (scan.mjs) and any
// read-modify-write cleanup of the same file (tests/portal-health-guard.mjs)
// can never interleave. A concurrent appender that lands between a cleanup's
// read and write would otherwise be silently discarded.
//
// Same mkdir-is-atomic protocol used elsewhere in this codebase for
// single-file locks: the lock is a directory ("<path>.lock"); a holder older
// than STALE_MS is presumed crashed and reclaimed; acquisition retries with
// backoff until MAX_WAIT_MS, then throws LockTimeoutError. Deliberately
// self-contained (no re-entrancy tracking) — neither caller ever nests a
// second acquisition of this same lock, so that machinery isn't needed here.

import { mkdirSync, rmSync, statSync, writeFileSync } from 'fs';

const STALE_MS = 30_000;
const RETRY_MS = 80;
const MAX_WAIT_MS = 8_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LockTimeoutError extends Error {
  constructor(lockDir) {
    super(`portal-health lock timeout: ${lockDir} held > ${MAX_WAIT_MS}ms`);
    this.name = 'LockTimeoutError';
    this.lockDir = lockDir;
  }
}

function lockDirFor(filePath) {
  return `${filePath}.lock`;
}

/** Blocks until the lock on `filePath` is held, then returns a handle whose release() frees it. */
export async function acquirePortalHealthLock(filePath) {
  const lockDir = lockDirFor(filePath);
  const deadline = Date.now() + MAX_WAIT_MS;

  for (;;) {
    try {
      mkdirSync(lockDir);
      break; // acquired
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let ageMs = Infinity;
      try {
        ageMs = Date.now() - statSync(lockDir).mtimeMs;
      } catch {
        ageMs = Infinity; // vanished between mkdir and stat — retry
      }
      if (ageMs > STALE_MS) {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          /* another process may have reclaimed it first */
        }
        continue;
      }
      if (Date.now() > deadline) throw new LockTimeoutError(lockDir);
      await sleep(RETRY_MS);
    }
  }

  try {
    writeFileSync(`${lockDir}/owner`, `${process.pid} ${new Date().toISOString()}\n`);
  } catch {
    /* owner stamp is diagnostic only */
  }

  return {
    lockDir,
    release() {
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {
        /* best-effort release; a stale-reclaim will recover it */
      }
    },
  };
}

/** Acquires the lock on `filePath`, runs fn, and always releases it. */
export async function withPortalHealthLock(filePath, fn) {
  const lock = await acquirePortalHealthLock(filePath);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
