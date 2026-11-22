// pipeline-lock.mjs — a cross-process advisory lock for data/pipeline.md.
//
// appendToPipeline() (scan.mjs) is a plain read-modify-write: readFileSync,
// mutate the string, writeFileSync. It's exported and called from three
// places — scan.mjs itself, scan-ats-full.mjs, and plugins.mjs (pipeline
// mode) — so any two of them running concurrently (a scheduled scan
// overlapping a manual `/career-ops pipeline` run, or two plugin jobs) can
// silently drop one side's offers: whichever write lands second overwrites
// the first's in-memory read, with no error and no trace anything was lost.
//
// The protocol itself — the lock directory, owner.json, the recover guard,
// stale recovery and the token-checked release — is lib/dir-lock.mjs, shared
// with every other lock in the core. This module picks the lock path, the
// timing defaults and their env overrides, and the timeout error. The
// protocol's helpers are re-exported so existing importers keep working.

import { lstatSync, readlinkSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { acquireDirLock, releaseOrWarn } from './lib/dir-lock.mjs';

export {
  OWNERLESS_GRACE_MS,
  sameLockDirectory,
  isMkdirContention,
  isRmContention,
  rmLockArtifactSync,
  RECOVER_STALE,
  RECOVER_VANISHED,
  RECOVER_LIVE,
  lockRecoveryVerdict,
  createLockWaitPolicy,
} from './lib/dir-lock.mjs';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 80;
const DEFAULT_TIMEOUT_MS = 8_000;

export class LockTimeoutError extends Error {
  constructor(lockDir, timeoutMs) {
    super(`pipeline lock timeout: ${lockDir} held > ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
    this.lockDir = lockDir;
  }
}

/**
 * The real file a pipeline path names, so two spellings of one file share a lock.
 *
 * A symlink to the file used to lock beside the link (`alias.md.lock`) while
 * the real path locked beside the file (`pipeline.md.lock`). Those are
 * different directories, so two scans both wrote and one offer disappeared.
 * A symlink in a parent directory already shared one inode; resolving the
 * file makes the file-symlink case do the same. A file that is not there yet
 * resolves the parent that does exist and keeps its own name. A dangling
 * symlink is followed by its link text, so the lock stays on the target
 * after that file is created.
 *
 * @param {string} pipelinePath
 * @returns {string}
 */
function followSymlinks(start) {
  let current = start;
  const seen = new Set();
  for (let hop = 0; hop <= 16; hop++) {
    if (seen.has(current)) return current;
    seen.add(current);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (err) {
      if (err.code === 'ENOENT') return current;
      throw err;
    }
    if (!stat.isSymbolicLink()) return current;
    if (hop === 16) {
      throw new Error(`pipeline path has more than 16 symbolic links: ${start}`);
    }
    current = resolve(dirname(current), readlinkSync(current));
  }
}

function canonicalPipelinePath(pipelinePath) {
  const absolute = resolve(pipelinePath);
  try {
    return realpathSync(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const followed = followSymlinks(absolute);
  const parent = dirname(followed);
  const name = basename(followed);
  try {
    return join(realpathSync(parent), name);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return followed;
  }
}

export function lockDirFor(pipelinePath) {
  return `${canonicalPipelinePath(pipelinePath)}.lock`;
}

/**
 * Blocks until the lock on `pipelinePath` is held, then returns a handle whose
 * release() frees it. Throws LockTimeoutError if the lock stays busy.
 *
 * @param {string} pipelinePath - File the lock guards.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=8000] - Max time a SINGLE holder may block this caller. Waiting is extended while the lock keeps changing hands (see createLockWaitPolicy).
 * @param {number} [options.retryMs=80] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=30000] - Age threshold for a lock with no readable owner, floored at OWNERLESS_GRACE_MS.
 * @param {number} [options.maxWaitMs] - Absolute ceiling on waiting, however much progress the lock makes. Defaults to 10x timeoutMs.
 */
export async function acquirePipelineLock(pipelinePath, options = {}) {
  // Env overrides let a caller several frames up the stack (a test driving
  // appendToPipeline, say) tune contention timing without threading options
  // through every signature — same escape hatch the tracker lock provides.
  const timeoutMs = options.timeoutMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const retryMs = options.retryMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_RETRY_MS) || DEFAULT_RETRY_MS);
  const staleMs = options.staleMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_STALE_MS) || DEFAULT_STALE_MS);
  // A ceiling that is not a number is not a ceiling. NaN compares false against
  // everything, so a bad value would not fail loudly — it would silently remove
  // the only bound on waiting, which is the single thing this option exists to
  // provide. Only a usable ceiling is honoured; everything else is dropped, and
  // the protocol applies its default, which is at least bounded.
  //
  // Read WITHOUT the `|| default` idiom its three siblings above use, because
  // for this one 0 is a meaningful setting — "never wait past now" — and
  // `0 || default` would turn a caller who asked for no waiting into one who
  // waits the whole default ceiling, the exact opposite. timeoutMs and retryMs
  // have no such reading, which is why the idiom is fine there and wrong here.
  //
  // Infinity is kept as written: an explicit, legible "no ceiling" is a choice,
  // not a mistake. -Infinity and NaN are mistakes, so they take the default
  // rather than being clamped into a silently different behaviour.
  const envMaxWait = process.env.CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS;
  const requestedMaxWait = options.maxWaitMs
    ?? (envMaxWait === undefined || envMaxWait.trim() === '' ? undefined : envMaxWait);
  const parsedMaxWait = requestedMaxWait === undefined ? undefined : Number(requestedMaxWait);
  const maxWaitMs = parsedMaxWait === Infinity || (Number.isFinite(parsedMaxWait) && parsedMaxWait >= 0)
    ? parsedMaxWait
    : undefined;

  const lock = await acquireDirLock(lockDirFor(pipelinePath), {
    timeoutMs,
    retryMs,
    staleMs,
    maxWaitMs,
    owner: { pipeline: pipelinePath },
    createParent: true,
    timeoutError: ({ lockDir, expiredMs, owner, lastMkdirError, diagnosis }) => {
      const err = new LockTimeoutError(lockDir, expiredMs);
      err.owner = owner;
      err.message += diagnosis;
      if (lastMkdirError) err.lastMkdirError = lastMkdirError;
      return err;
    },
  });
  return { lockDir: lock.lockDir, release: lock.release };
}

/** Acquires the lock on `pipelinePath`, runs fn, and always releases it. */
export async function withPipelineLock(pipelinePath, fn, options = {}) {
  const lock = await acquirePipelineLock(pipelinePath, options);
  try {
    return await fn();
  } finally {
    releaseOrWarn(lock);
  }
}
