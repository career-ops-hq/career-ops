import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  acquireDirLock,
  lockRecoveryVerdict,
  readLockOwner,
  releaseOrWarn,
  RECOVER_LIVE,
  RECOVER_STALE,
  RECOVER_VANISHED,
} from "./core/dir-lock.mjs";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_MS = 80;
const DEFAULT_STALE_MS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSafeScheduledId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function emptyScheduledStore() {
  return { jobs: [], runs: [], queue: [] };
}

export function readScheduledStore(storePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("store root must be an object");
    for (const key of ["jobs", "runs", "queue"]) {
      if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
        throw new Error(key + " must be an array");
      }
    }
    const store = {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
    };
    validateScheduledStore(store);
    return store;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyScheduledStore();
    throw new Error(`Invalid scheduled-jobs store at ${storePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertIso(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

export function validateScheduledStore(store) {
  for (const job of store.jobs) {
    if (!isObject(job) || !isSafeScheduledId(job.id)) throw new Error("Invalid scheduled job identifier");
    if (!["active", "paused", "deleted"].includes(job.status)) throw new Error(`Invalid status for scheduled job ${job.id}`);
    if (typeof job.name !== "string" || typeof job.startAt !== "string") throw new Error(`Invalid scheduled job ${job.id}`);
    assertIso(job.startAt, `scheduled job ${job.id}.startAt`);
    assertIso(job.createdAt, `scheduled job ${job.id}.createdAt`);
    assertIso(job.updatedAt, `scheduled job ${job.id}.updatedAt`);
    if (job.nextRunAt !== undefined) assertIso(job.nextRunAt, `scheduled job ${job.id}.nextRunAt`);
  }
  for (const run of store.runs) {
    if (!isObject(run) || !isSafeScheduledId(run.id) || !isSafeScheduledId(run.jobId)) throw new Error("Invalid scheduled run identifier");
    if (!["queued", "running", "success", "failed", "cancelled"].includes(run.state)) throw new Error(`Invalid state for scheduled run ${run.id}`);
    assertIso(run.at, `scheduled run ${run.id}.at`);
  }
  for (const item of store.queue) {
    if (!isObject(item) || !isSafeScheduledId(item.id) || !isSafeScheduledId(item.jobId)) throw new Error("Invalid scheduled queue identifier");
    assertIso(item.queuedAt, `scheduled queue item ${item.id}.queuedAt`);
    if (item.claimToken !== undefined && !isSafeScheduledId(item.claimToken)) throw new Error(`Invalid claim token for ${item.id}`);
    if (item.claimedAt !== undefined) assertIso(item.claimedAt, `scheduled queue item ${item.id}.claimedAt`);
  }
}

export function writeScheduledStoreAtomic(storePath, store) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, storePath);
  } finally {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // The atomic rename already succeeded, or best-effort cleanup failed.
    }
  }
}

export function readLockStatus(resourcePath, options = {}) {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const lockDir = `${resourcePath}.lock`;
  // The protocol's own verdict, so status and recovery cannot disagree about
  // what "stale" means. Only STALE says the holder is gone; LIVE also covers a
  // lock we could not inspect, which is not proof that nobody holds it.
  const verdict = lockRecoveryVerdict(lockDir, staleMs);
  if (verdict === RECOVER_VANISHED) return { exists: false, active: false, stale: false, owner: null };
  return { exists: true, active: verdict === RECOVER_LIVE, stale: verdict === RECOVER_STALE, owner: readLockOwner(lockDir).owner };
}

// The shared directory-lock protocol (lib/dir-lock.mjs, mirrored into the web
// because Next bundles with the Turbopack root pinned to web/). This file used
// to carry its own acquire loop, recovery guard and rename-based takeover; the
// takeover's rename crashed on Windows EBUSY/EPERM and its release removed the
// lock on a token match alone, with no check that the directory was still the
// one it had stamped (#5358).
function acquireResourceLock(resourcePath, options = {}) {
  return acquireDirLock(`${resourcePath}.lock`, {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryMs: options.retryMs ?? DEFAULT_RETRY_MS,
    staleMs: options.staleMs ?? DEFAULT_STALE_MS,
    createParent: true,
    // The API routes map /lock timeout/ to a 409, so the message keeps that
    // phrase; the diagnosis names the holder and any non-EEXIST mkdir error.
    timeoutError: ({ lastMkdirError, diagnosis }) => Object.assign(
      new Error(`scheduled-jobs lock timeout: ${resourcePath}${diagnosis}`),
      { code: "LOCK_TIMEOUT", lastMkdirError },
    ),
  });
}

export async function withResourceLock(resourcePath, fn, options = {}) {
  const lock = await acquireResourceLock(resourcePath, options);
  try {
    return await fn();
  } finally {
    releaseOrWarn(lock);
  }
}

export async function withScheduledStore(storePath, mutate, options = {}) {
  return withResourceLock(
    storePath,
    async () => {
      const store = readScheduledStore(storePath);
      const result = await mutate(store);
      validateScheduledStore(store);
      writeScheduledStoreAtomic(storePath, store);
      return result;
    },
    options,
  );
}
