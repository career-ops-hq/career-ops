#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import {
  isSafeScheduledId,
  readScheduledStore,
  withResourceLock,
  withScheduledStore,
} from "../src/lib/scheduled-jobs-store.mjs";
import { nextScheduledRun } from "../src/lib/scheduled-cadence.mjs";
import { isMainModule } from "../../lib/is-main-module.mjs";
import { scheduledRunnerResourcePath, scheduledStorePath } from "../src/lib/scheduled-runner-path.mjs";
import { getCareerOpsRoot } from "../../path-resolver.mjs";
import { getProfilePath } from "../src/lib/core/profile-path.mjs";
import { scanFailureMessage } from "../src/lib/scheduled-scan-error.mjs";
import { runDueMonitors } from "../../portal-monitor.mjs";
import { postingKey } from "../../url-key.mjs";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MAX_RUNS = 100;
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

    const nextRunAt = nextScheduledRun(job.startAt, job.every, job.unit, nowMs, job.timezone || "UTC");
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
  const positive = Array.isArray(filters.positive)
    ? filters.positive.filter((value) => typeof value === "string" && value.trim())
    : [];
  const fallbackPositive = Array.isArray(base.title_filter?.positive)
    ? base.title_filter.positive.filter((value) => typeof value === "string" && value.trim())
    : [];
  if (!positive.length && !fallbackPositive.length) {
    throw new Error("Scheduled scans require title keywords in the job or portals.yml title_filter.positive.");
  }
  base.title_filter = {
    ...(base.title_filter || {}),
    positive: positive.length ? positive : fallbackPositive,
    negative: Array.isArray(filters.negative) ? filters.negative : [],
  };
  if (base.title_filter_full) base.title_filter_full = { ...base.title_filter_full, ...base.title_filter };
  base.location_filter = {
    ...(base.location_filter || {}),
    allow: Array.isArray(filters.allow) ? filters.allow : [],
    block: Array.isArray(filters.block) ? filters.block : [],
    block_hard: Array.isArray(filters.blockHard) ? filters.blockHard : [],
    always_allow: Array.isArray(filters.alwaysAllow) ? filters.alwaysAllow : [],
  };

  const tempDir = path.join(root, "data", "tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `scheduled-${job.id}-${randomUUID()}.yml`);
  fs.writeFileSync(tempPath, yaml.dump(base, { lineWidth: 120, noRefs: true }), "utf8");
  return tempPath;
}

/*
 * Keep the temporary portal overlay scoped to each retry. A thrown setup or
 * spawn error is retryable just like a non-zero scanner exit, while cleanup
 * still runs before the next attempt. A scanner that ran into the timeout is
 * not retried: the same sweep would hit the same limit, three times over.
 */

export function executeJob(root, job, options = {}) {
  const spawnFn = options.spawnFn || spawnSync;
  const startedAt = Date.now();
  let lastError = "Scan failed";
  let finalAttempt = MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let tempPortals = null;
    try {
      tempPortals = writeJobPortals(root, job);
      const command = buildScanCommand(job);
      const result = spawnFn(
        process.execPath,
        [command.script, ...command.args],
        {
          cwd: CODE_ROOT,
          env: {
            ...process.env,
            CAREER_OPS_ROOT: root,
            CAREER_OPS_PORTALS: tempPortals,
            // The scanner runs with cwd = the checkout; a relative override is
            // resolved here, the way the web resolves it, so both read one file.
            ...(process.env.CAREER_OPS_PROFILE?.trim() ? { CAREER_OPS_PROFILE: getProfilePath(root) } : {}),
          },
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
      lastError = scanFailureMessage(result, { timeoutMs: SCAN_TIMEOUT_MS });
      if (result.error?.code === "ETIMEDOUT") {
        finalAttempt = attempt;
        break;
      }
    } catch (error) {
      lastError = scanFailureMessage({ error });
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
    attempt: finalAttempt,
    rolesFound: 0,
    durationMs: Date.now() - startedAt,
    message: lastError,
  };
}

// The checkpoint belongs to a saved search, not to the source. A source may
// also have its own daily monitor with different title keywords; advancing its
// seenKeys after a filtered search would silently hide jobs from that monitor.
export function websiteCriteriaKey(filters = {}) {
  const fields = ["positive", "negative", "allow", "block", "blockHard", "alwaysAllow", "sinceDays"];
  const value = Object.fromEntries(fields.map((field) => [field, filters[field] ?? (field === "sinceDays" ? 7 : [])]));
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function selectedWebsiteIds(job) {
  return Array.isArray(job.filters?.websiteIds) ? [...new Set(job.filters.websiteIds)] : [];
}

/**
 * Run the existing scheduled ATS scan plus the explicitly selected websites.
 * The first successful search of each website records a per-search baseline;
 * changing search criteria establishes a fresh baseline as well. A failed or
 * disabled source never advances its checkpoint. Existing auto-monitors keep
 * their own timing, keyword filters, notices, and checkpoint entirely intact.
 *
 * Dependency seams keep tests free of network calls and real user data.
 */
export async function executeScheduledJob(root, job, options = {}) {
  const startedAt = Date.now();
  const websiteIds = selectedWebsiteIds(job);
  const ats = job.filters?.ats;
  const runAts = job.engine === "portals" || !Array.isArray(ats) || ats.length > 0;
  if (!runAts && !websiteIds.length) {
    return { state: "failed", attempt: 1, rolesFound: 0, durationMs: 0, message: "Select an ATS source or a saved website." };
  }

  const atsResult = runAts ? (options.executeAts || executeJob)(root, job, options.atsOptions) : null;
  if (!websiteIds.length) return atsResult;

  const core = options.core || await import("../../portal-monitor.mjs");
  const search = options.searchWebsites || core.searchMonitorSources;
  const deliver = options.deliverWebsites || core.deliverMonitorSearch;
  const readSources = options.readSources || ((r) => core.readMonitorStore(r).sources);
  const errors = [];
  const checkpointUpdates = {};
  const previous = job.websiteCheckpoints || {};
  const criteria = websiteCriteriaKey(job.filters);
  let baselined = 0;
  let added = 0;
  try {
    // Every source gets its own complete baseline, even when another source
    // lists the same job or that job already exists in the inbox.
    const result = await search(root, websiteIds, job.filters || {}, { dedupeAcrossSources: false, excludeSeen: false });
    errors.push(...(result.failures || []));
    const sourcesById = new Map(readSources(root).map((source) => [source.id, source]));
    const failedIds = new Set(errors.map((failure) => failure.id));
    const candidates = [];
    const candidatesById = new Set();
    for (const source of result.searched || []) {
      if (failedIds.has(source.id)) continue;
      const current = sourcesById.get(source.id);
      if (!current || !current.enabled) {
        errors.push({ id: source.id, name: source.name, error: "Source was paused or removed during the scan." });
        failedIds.add(source.id);
        continue;
      }
      const offers = (result.offers || []).filter((offer) => offer.sourceId === source.id);
      const keys = offers.map((offer) => postingKey(offer.url));
      const old = previous[source.id];
      const baseline = !old || old.criteria !== criteria || !Array.isArray(old.seenKeys);
      const seen = new Set(baseline ? [] : old.seenKeys);
      if (baseline) baselined += 1;
      else for (const offer of offers) {
        if (!seen.has(postingKey(offer.url))) { candidates.push(offer); candidatesById.add(source.id); }
      }
      checkpointUpdates[source.id] = { criteria, seenKeys: [...new Set([...seen, ...keys])], checkedAt: nowIso() };
    }

    if (options.isCurrent && !options.isCurrent()) {
      return { state: "failed", attempt: 1, rolesFound: atsResult?.rolesFound || 0,
        durationMs: Date.now() - startedAt, message: "The schedule changed during its scan. Website results were not saved; run it again." };
    }

    if (candidates.length) {
      try {
        const delivery = await deliver(root, candidates);
        added = Number(delivery.added) || 0;
        for (const failure of delivery.failures || []) {
          errors.push(failure);
          failedIds.add(failure.id);
        }
      } catch (error) {
        for (const id of candidatesById) {
          errors.push({ id, name: sourcesById.get(id)?.name || id, error: error instanceof Error ? error.message : String(error) });
          failedIds.add(id);
        }
      }
    }
    // Never checkpoint a source whose delivery failed: the next run retries it.
    for (const id of failedIds) delete checkpointUpdates[id];
    const parts = [];
    if (atsResult) parts.push(`ATS: ${atsResult.rolesFound || 0} matching roles`);
    parts.push(`Websites: ${added} new job${added === 1 ? "" : "s"} added`);
    if (baselined) parts.push(`${baselined} website${baselined === 1 ? "" : "s"} baselined`);
    const undated = Number(result.unknownDates) || 0;
    if (undated > 0) parts.push(`${undated} listing${undated === 1 ? "" : "s"} included with unknown posting dates`);
    if (atsResult?.state === "failed") parts.push(`ATS failed: ${atsResult.message}`);
    if (errors.length) parts.push(`Website check failed: ${errors.map((e) => `${e.name || e.id}: ${e.error}`).join("; ")}`);
    return {
      state: atsResult?.state === "failed" || errors.length ? "failed" : "success",
      attempt: atsResult?.attempt || 1,
      rolesFound: (atsResult?.rolesFound || 0) + added,
      durationMs: Date.now() - startedAt,
      message: parts.join(" · "),
      websiteCheckpoints: checkpointUpdates,
    };
  } catch (error) {
    return { state: "failed", attempt: atsResult?.attempt || 1, rolesFound: atsResult?.rolesFound || 0,
      durationMs: Date.now() - startedAt, message: `Website check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
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
      // Do not persist checkpoints produced by an outdated set of filters or
      // sources if the user edited the schedule while a network scan ran.
      if (result.websiteCheckpoints && websiteCriteriaKey(current.filters) === websiteCriteriaKey(job.filters)
          && JSON.stringify(selectedWebsiteIds(current)) === JSON.stringify(selectedWebsiteIds(job))) {
        current.websiteCheckpoints = { ...(current.websiteCheckpoints || {}), ...result.websiteCheckpoints };
      }
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
  const root = getCareerOpsRoot();
  const storePath = scheduledStorePath(root);
  const runnerResource = runnerResourcePath(storePath);
  const manualJobId = requestedJobId(process.argv.slice(2));

  return withResourceLock(
    runnerResource,
    async () => {
      // Website monitors share this installed OS worker. They have their own
      // per-source checkpoints and must also run when no broad scan is queued.
      // A broken source must not prevent other scheduled scans from running.
      let monitors;
      if (!manualJobId) {
        try { monitors = await runDueMonitors(root); }
        catch (error) { monitors = { error: error.message }; }
      }
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

      if (!claim) return { status: "idle", ...(monitors ? { monitors } : {}) };

      const result = await executeScheduledJob(root, claim.job, {
        isCurrent: () => {
          const current = readScheduledStore(storePath).jobs.find((item) => item.id === claim.job.id);
          return Boolean(current && current.status === claim.job.status
            && websiteCriteriaKey(current.filters) === websiteCriteriaKey(claim.job.filters)
            && JSON.stringify(selectedWebsiteIds(current)) === JSON.stringify(selectedWebsiteIds(claim.job)));
        },
      });
      await recordCompletion(storePath, claim, result);
      if (result.state === "failed") throw new Error(result.message);
      return { status: "success", jobId: claim.job.id, ...result, ...(monitors ? { monitors } : {}) };
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
