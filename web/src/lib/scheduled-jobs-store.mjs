import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const OWNERLESS_GRACE_MS = 1_000;
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

function readOwner(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function readLockStatus(resourcePath, options = {}) {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const lockDir = `${resourcePath}.lock`;
  if (!fs.existsSync(lockDir)) return { exists: false, active: false, stale: false, owner: null };
  const owner = readOwner(lockDir);
  if (owner?.pid) {
    const active = processIsAlive(owner.pid);
    return { exists: true, active, stale: !active, owner };
  }
  try {
    const stale = Date.now() - fs.statSync(lockDir).mtimeMs > Math.max(staleMs, OWNERLESS_GRACE_MS);
    return { exists: true, active: false, stale, owner: null };
  } catch {
    return { exists: true, active: false, stale: true, owner: null };
  }
}

function takeOverStaleLock(lockDir) {
  const quarantine = `${lockDir}.recovery-${process.pid}-${randomUUID()}`;
  try {
    // Rename is atomic: if another process acquired the lock after our status
    // read, this fails instead of recursively deleting its live lock.
    fs.renameSync(lockDir, quarantine);
  } catch (error) {
    if (["ENOENT", "EEXIST", "ENOTEMPTY"].includes(error?.code)) return false;
    throw error;
  }
  const movedOwner = readOwner(quarantine);
  if (movedOwner?.pid && processIsAlive(movedOwner.pid)) {
    try {
      fs.renameSync(quarantine, lockDir);
    } catch {
      // A newer owner is already at lockDir; never remove it.
    }
    return false;
  }
  try { fs.rmSync(quarantine, { recursive: true, force: true }); } catch { /* retry next pass */ }
  return true;
}

async function withRecoveryGuard(resourcePath, options, fn) {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const guardDir = `${resourcePath}.recovery.lock`;
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(guardDir), { recursive: true });
  for (;;) {
    let created = false;
    try {
      fs.mkdirSync(guardDir);
      created = true;
      fs.writeFileSync(path.join(guardDir, "owner.json"), JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }), "utf8");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        if (created) {
          try { fs.rmSync(guardDir, { recursive: true, force: true }); } catch { /* best effort */ }
        }
        throw error;
      }
      if (readLockStatus(`${resourcePath}.recovery`, { staleMs }).stale) {
        takeOverStaleLock(guardDir);
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`scheduled-jobs lock timeout: ${resourcePath}`);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  try {
    return await fn();
  } finally {
    if (readOwner(guardDir)?.token === token) {
      try { fs.rmSync(guardDir, { recursive: true, force: true }); } catch { /* stale recovery handles it */ }
    }
  }
}

async function acquireResourceLock(resourcePath, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const lockDir = `${resourcePath}.lock`;
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  for (;;) {
    const acquired = await withRecoveryGuard(resourcePath, options, () => {
      let created = false;
      try {
        fs.mkdirSync(lockDir);
        created = true;
        fs.writeFileSync(
          path.join(lockDir, "owner.json"),
          JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }, null, 2),
          "utf8",
        );
        return true;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          if (created) {
            try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* best effort */ }
          }
          throw error;
        }
        if (readLockStatus(resourcePath, { staleMs }).stale) takeOverStaleLock(lockDir);
        return false;
      }
    });
    if (acquired) break;
    if (Date.now() >= deadline) throw new Error(`scheduled-jobs lock timeout: ${resourcePath}`);
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (readOwner(lockDir)?.token !== token) return;
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // A future stale-lock recovery can remove it.
    }
  };
}

export async function withResourceLock(resourcePath, fn, options = {}) {
  const release = await acquireResourceLock(resourcePath, options);
  try {
    return await fn();
  } finally {
    release();
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
