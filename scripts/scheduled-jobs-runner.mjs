#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import {
  isSafeScheduledId,
  withResourceLock,
  withScheduledStore,
  writeScheduledStoreAtomic,
} from "../web/src/lib/scheduled-jobs-store.mjs";
import { nextScheduledRun } from "../web/src/lib/scheduled-cadence.mjs";
import { isMainModule } from "../lib/is-main-module.mjs";
import { scheduledRunnerResourcePath, scheduledStorePath } from "../web/src/lib/scheduled-runner-path.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MAX_RUNS = 100;
const MAX_NOTICES = 100;
export const MAX_ATTEMPTS = 3;
export const SCAN_TIMEOUT_MS = 25 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const QUEUE_CLAIM_STALE_MS = 30 * 1_000;

const nowIso = () => new Date().toISOString();

export const nextFutureRun = nextScheduledRun;

export function enqueueDueJobs(store, nowMs = Date.now()) {
  let queued = 0;
  for (const job of store.jobs) {
    if (job.status !== "active") continue;
    const dueAt = job.nextRunAt || job.startAt;
    const dueMs = Date.parse(dueAt);
    if (!Number.isFinite(dueMs) || dueMs > nowMs) continue;

    if (!store.queue.some((item) => item.jobId === job.id)) {
      store.queue.push({ id: randomUUID(), jobId: job.id, queuedAt: new Date(nowMs).toISOString() });
      queued += 1;
    }

    const nextRunAt = nextScheduledRun(dueAt, job.every, job.unit, nowMs, job.timezone || "UTC");
    if (nextRunAt) job.nextRunAt = nextRunAt;
    job.updatedAt = new Date(nowMs).toISOString();
  }
  return queued;
}

function claimIsStale(item, nowMs) {
  if (!item.claimToken || !item.claimedAt) return false;
  const claimedMs = Date.parse(item.claimedAt);
  return !Number.isFinite(claimedMs) || nowMs - claimedMs >= QUEUE_CLAIM_STALE_MS;
}

function claimQueueItem(store, item, job, nowMs) {
  if (item.claimToken && !claimIsStale(item, nowMs)) return null;
  if (item.claimToken) {
    const staleRun = item.runId && store.runs.find((run) => run.id === item.runId);
    if (staleRun) {
      staleRun.state = "queued";
      staleRun.message = "Requeued after an interrupted worker.";
    }
  }
  const claimToken = randomUUID();
  item.claimToken = claimToken;
  item.claimedAt = new Date(nowMs).toISOString();
  if (!item.runId || !isSafeScheduledId(item.runId)) item.runId = randomUUID();
  const run = store.runs.find((candidate) => candidate.id === item.runId);
  if (run) {
    run.state = "running";
    run.at = new Date(nowMs).toISOString();
    run.attempt = (run.attempt || 0) + 1;
  } else {
    store.runs.unshift({ id: item.runId, jobId: job.id, at: new Date(nowMs).toISOString(), state: "running", attempt: 1, engine: job.engine || "full" });
  }
  return { job: structuredClone(job), queueId: item.id, runId: item.runId, claimToken };
}

export function claimDueJob(store, nowMs = Date.now()) {
  for (const item of store.queue) {
    const job = store.jobs.find((candidate) => candidate.id === item.jobId && candidate.status === "active");
    if (!job) continue;
    const claim = claimQueueItem(store, item, job, nowMs);
    if (claim) return claim;
  }
  return null;
}

export function claimManualJob(store, jobId, nowMs = Date.now()) {
  const job = store.jobs.find((candidate) => candidate.id === jobId && candidate.status !== "deleted");
  if (!job) return null;
  let item = store.queue.find((candidate) => candidate.jobId === jobId);
  if (!item) {
    item = { id: randomUUID(), jobId, queuedAt: new Date(nowMs).toISOString() };
    store.queue.push(item);
  }
  return claimQueueItem(store, item, job, nowMs);
}

export const runnerResourcePath = scheduledRunnerResourcePath;

function numericFilter(value, fallback, minimum, maximum = Number.POSITIVE_INFINITY) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

export function buildScanCommand(job) {
  const filters = job.filters || {};
  const sinceDays = numericFilter(filters.sinceDays, 7, 1);
  if (job.engine === "portals") {
    return {
      script: "scan.mjs",
      args: ["--since", String(sinceDays), "--quiet"],
    };
  }

  const ats = Array.isArray(filters.ats) && filters.ats.length
    ? filters.ats.join(",")
    : "greenhouse,lever,ashby,workday";
  const limit = numericFilter(filters.limitPerAts, 150, 50, 500);
  return {
    script: "scan-ats-full.mjs",
    args: ["--since", String(sinceDays), "--ats", ats, "--limit", String(limit), "--json"],
  };
}

export function extractRolesFound(engine, stdout) {
  if (engine === "full") {
    try {
      const result = JSON.parse(stdout);
      return Number.isFinite(Number(result.postingsKept)) ? Number(result.postingsKept) : 0;
    } catch {
      return 0;
    }
  }
  const match = stdout.match(/New offers added:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function writeJobPortals(root, job) {
  if (!isSafeScheduledId(job.id)) throw new Error("Invalid scheduled job identifier.");
  const portalsPath = path.join(root, "portals.yml");
  const base = yaml.load(fs.readFileSync(portalsPath, "utf8"));
  if (!base || typeof base !== "object") throw new Error("portals.yml must contain a mapping");

  const filters = job.filters || {};
  base.title_filter = {
    ...(base.title_filter || {}),
    positive: Array.isArray(filters.positive) ? filters.positive : [],
    negative: Array.isArray(filters.negative) ? filters.negative : [],
  };
  base.location_filter = {
    ...(base.location_filter || {}),
    allow: Array.isArray(filters.allow) ? filters.allow : [],
    block: Array.isArray(filters.block) ? filters.block : [],
    always_allow: Array.isArray(filters.alwaysAllow) ? filters.alwaysAllow : [],
  };

  const tempDir = path.join(root, "data", "tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `scheduled-${job.id}-${randomUUID()}.yml`);
  fs.writeFileSync(tempPath, yaml.dump(base, { lineWidth: 120, noRefs: true }), "utf8");
  return tempPath;
}

function firstErrorLine(result) {
  const raw = result.stderr || result.error?.message || `scanner exit ${result.status ?? "unknown"}`;
  return String(raw).split(/\r?\n/).find(Boolean)?.slice(0, 300) || "Scan failed";
}

/*
 * Keep the temporary portal overlay scoped to each retry. A thrown setup or
 * spawn error is retryable just like a non-zero scanner exit, while cleanup
 * still runs before the next attempt.
 */

export function executeJob(root, job, options = {}) {
  const spawnFn = options.spawnFn || spawnSync;
  const startedAt = Date.now();
  let lastError = "Scan failed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let tempPortals = null;
    try {
      tempPortals = writeJobPortals(root, job);
      const command = buildScanCommand(job);
      const result = spawnFn(
        process.execPath,
        [command.script, ...command.args],
        {
          cwd: root,
          env: { ...process.env, CAREER_OPS_PORTALS: tempPortals },
          encoding: "utf8",
          timeout: SCAN_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
      );

      if (result.status === 0) {
        const rolesFound = extractRolesFound(job.engine || "full", result.stdout || "");
        return {
          state: "success",
          attempt,
          rolesFound,
          durationMs: Date.now() - startedAt,
          message: `Scan finished with ${rolesFound} matching role${rolesFound === 1 ? "" : "s"}.`,
        };
      }
      lastError = firstErrorLine(result);
    } catch (error) {
      lastError = firstErrorLine({ error });
    } finally {
      if (tempPortals) {
        try {
          fs.rmSync(tempPortals, { force: true });
        } catch {
          // Temporary filter cleanup is best effort.
        }
      }
    }
  }

  return {
    state: "failed",
    attempt: MAX_ATTEMPTS,
    rolesFound: 0,
    durationMs: Date.now() - startedAt,
    message: lastError,
  };
}

export async function recordCompletion(storePath, claim, result, inMemoryStore = null) {
  const at = nowIso();
  const apply = (store) => {
    const job = claim.job;
    const queueItem = claim.queueId && store.queue.find((item) => item.id === claim.queueId && item.claimToken === claim.claimToken);
    // A stale worker may finish after another worker reclaimed the item. Its
    // result must not overwrite the newer claim's run or job metadata.
    if (claim.queueId && !queueItem) return;
    const current = store.jobs.find((item) => item.id === job.id);
    if (current) {
      current.lastRunAt = at;
      current.rolesFoundCount = result.rolesFound;
      current.updatedAt = at;
      if (result.state === "failed") current.lastError = result.message;
      else delete current.lastError;
    }

    const run = store.runs.find((item) => item.id === claim.runId && item.jobId === job.id);
    if (run) Object.assign(run, { at, durationMs: result.durationMs, state: result.state, attempt: result.attempt, message: result.message, rolesFound: result.rolesFound, engine: job.engine || "full" });
    else store.runs.unshift({ id: claim.runId || randomUUID(), jobId: job.id, at, durationMs: result.durationMs, state: result.state, attempt: result.attempt, message: result.message, rolesFound: result.rolesFound, engine: job.engine || "full" });
    store.queue = store.queue.filter((item) => !(item.id === claim.queueId && item.claimToken === claim.claimToken));
    if (store.runs.length > MAX_RUNS) store.runs = store.runs.slice(0, MAX_RUNS);
  };
  if (inMemoryStore) apply(inMemoryStore);
  else await withScheduledStore(storePath, apply);
}

function appendFailureNotice(noticePath, job, message) {
  let notices = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(noticePath, "utf8"));
    if (Array.isArray(parsed)) notices = parsed;
  } catch {
    // A missing or malformed notification file starts a fresh bounded list.
  }
  notices.push({
    id: randomUUID(),
    jobId: job.id,
    at: nowIso(),
    kind: "scheduled-job-failed",
    message,
    read: false,
  });
  writeScheduledStoreAtomic(noticePath, notices.slice(-MAX_NOTICES));
}

async function takeDueJob(storePath) {
  return withScheduledStore(storePath, (store) => {
    enqueueDueJobs(store);
    return claimDueJob(store);
  });
}

function requestedJobId(args) {
  const index = args.indexOf("--job");
  return index >= 0 ? args[index + 1] || null : null;
}

async function main() {
  const root = process.env.CAREER_OPS_ROOT
    ? path.resolve(process.env.CAREER_OPS_ROOT)
    : DEFAULT_ROOT;
  const storePath = scheduledStorePath(root);
  const noticePath = path.join(root, "data", "scheduled-job-notifications.json");
  const runnerResource = runnerResourcePath(storePath);
  const manualJobId = requestedJobId(process.argv.slice(2));

  return withResourceLock(
    runnerResource,
    async () => {
      let claim;
      if (manualJobId) {
        if (!isSafeScheduledId(manualJobId)) throw new Error("Invalid scheduled job identifier.");
        claim = await withScheduledStore(storePath, (store) => {
          const job = store.jobs.find((item) => item.id === manualJobId && item.status !== "deleted");
          if (!job) throw new Error("Scheduled job not found.");
          const manualClaim = claimManualJob(store, manualJobId);
          if (!manualClaim) throw new Error("Scheduled job is already running.");
          return manualClaim;
        });
      } else {
        claim = await takeDueJob(storePath);
      }

      if (!claim) return { status: "idle" };

      const result = executeJob(root, claim.job);
      await recordCompletion(storePath, claim, result);
      if (result.state === "failed") appendFailureNotice(noticePath, claim.job, result.message);
      if (result.state === "failed") throw new Error(result.message);
      return { status: "success", jobId: claim.job.id, ...result };
    },
    { timeoutMs: 1_000, staleMs: SCAN_TIMEOUT_MS * MAX_ATTEMPTS + 60_000 },
  );
}

if (isMainModule(import.meta.url)) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
