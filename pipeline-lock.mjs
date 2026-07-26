// pipeline-lock.mjs — a tiny cross-process advisory lock for data/pipeline.md.
//
// appendToPipeline() (scan.mjs) is a plain read-modify-write: readFileSync,
// mutate the string, writeFileSync. It's exported and called from three
// places — scan.mjs itself, scan-ats-full.mjs, and plugins.mjs (pipeline
// mode) — so any two of them running concurrently (a scheduled scan
// overlapping a manual `/career-ops pipeline` run, or two plugin jobs) can
// silently drop one side's offers: whichever write lands second overwrites
// the first's in-memory read, with no error and no trace anything was lost.
//
// Protocol: the lock is a directory ("<path>.lock") — a mkdir is atomic. A
// holder older than STALE_MS is presumed crashed and reclaimed. Acquisition
// retries with a short backoff until MAX_WAIT_MS, then throws
// LockTimeoutError. Deliberately self-contained (no re-entrancy tracking):
// nothing in this codebase nests a second acquisition of this same lock, so
// that machinery isn't needed here.

import { mkdirSync, rmSync, statSync, writeFileSync } from 'fs';

const STALE_MS = 30_000;
const RETRY_MS = 80;
const MAX_WAIT_MS = 8_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LockTimeoutError extends Error {
  constructor(lockDir) {
    super(`pipeline lock timeout: ${lockDir} held > ${MAX_WAIT_MS}ms`);
    this.name = 'LockTimeoutError';
    this.lockDir = lockDir;
  }
}

export function lockDirFor(pipelinePath) {
  return `${pipelinePath}.lock`;
}

/** Blocks until the lock on `pipelinePath` is held, then returns a handle whose release() frees it. */
export async function acquirePipelineLock(pipelinePath) {
  const lockDir = lockDirFor(pipelinePath);
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
        continue; // retry immediately
      }
      if (Date.now() > deadline) {
        throw new LockTimeoutError(lockDir);
      }
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

/** Acquires the lock on `pipelinePath`, runs fn, and always releases it. */
export async function withPipelineLock(pipelinePath, fn) {
  const lock = await acquirePipelineLock(pipelinePath);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
