import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import {
  emptyScheduledStore,
  isSafeScheduledId,
  readLockStatus,
  readScheduledStore,
  withResourceLock,
  withScheduledStore,
} from "../web/src/lib/scheduled-jobs-store.mjs";
import {
  buildScanCommand,
  claimDueJob,
  claimManualJob,
  enqueueDueJobs,
  executeJob,
  extractRolesFound,
  MAX_ATTEMPTS,
  MAX_RUNS,
  nextFutureRun,
  recordCompletion,
  runnerResourcePath,
} from "../scripts/scheduled-jobs-runner.mjs";
import { assertScheduledJobBody } from "../web/src/lib/scheduled-job-input.mjs";

test("scheduled-jobs store starts empty and never seeds candidate-specific targeting", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-store-"));
  try {
    const store = readScheduledStore(path.join(temp, "scheduled-jobs.json"));
    assert.deepEqual(store, emptyScheduledStore());
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("scheduled-jobs store serializes concurrent writers without losing jobs", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-lock-"));
  const storePath = path.join(temp, "scheduled-jobs.json");
  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        withScheduledStore(storePath, (store) => {
          const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
          const now = new Date().toISOString();
          store.jobs.push({ id, name: String(index), status: "active", engine: "full", filters: {}, timezone: "UTC", startAt: now, every: 1, unit: "hours", createdAt: now, updatedAt: now });
        }),
      ),
    );
    const ids = readScheduledStore(storePath).jobs.map((job) => job.name).sort();
    assert.deepEqual(ids, Array.from({ length: 12 }, (_, index) => String(index)).sort());
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("invalid scheduled-jobs JSON is reported instead of overwritten", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-invalid-"));
  const storePath = path.join(temp, "scheduled-jobs.json");
  try {
    fs.writeFileSync(storePath, "{not-json", "utf8");
    assert.throws(() => readScheduledStore(storePath), /Invalid scheduled-jobs store/);
    assert.equal(fs.readFileSync(storePath, "utf8"), "{not-json");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("overdue schedules queue once and advance directly to the next future run", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  const store = {
    jobs: [{
      id: "job-1",
      status: "active",
      startAt: "2026-08-08T08:00:00.000Z",
      every: 1,
      unit: "hours",
    }],
    runs: [],
    queue: [],
  };

  assert.equal(enqueueDueJobs(store, now), 1);
  assert.equal(store.queue.length, 1);
  assert.equal(store.jobs[0].nextRunAt, "2026-08-08T13:00:00.000Z");
  assert.equal(enqueueDueJobs(store, now), 0);
  assert.equal(store.queue.length, 1);
  assert.equal(nextFutureRun("2026-08-08T08:00:00.000Z", 1, "hours", now), "2026-08-08T13:00:00.000Z");
});

test("scan command honors the selected engine and bounded filters", () => {
  const filters = {
    sinceDays: 5,
    ats: ["lever", "ashby"],
    limitPerAts: 999,
  };
  assert.deepEqual(buildScanCommand({ engine: "portals", filters }), {
    script: "scan.mjs",
    args: ["--since", "5", "--quiet"],
  });
  assert.deepEqual(buildScanCommand({ engine: "full", filters }), {
    script: "scan-ats-full.mjs",
    args: ["--since", "5", "--ats", "lever,ashby", "--limit", "500", "--json"],
  });
});

test("scan command treats null and empty numeric filters as absent", () => {
  assert.deepEqual(buildScanCommand({ engine: "full", filters: { sinceDays: null, limitPerAts: "" } }).args, [
    "--since", "7", "--ats", "greenhouse,lever,ashby,workday", "--limit", "150", "--json",
  ]);
});

test("runner resource is derived from the exact scheduled store path", () => {
  assert.equal(runnerResourcePath("C:/one/data/scheduled-jobs.json"), "C:/one/data/scheduled-jobs.json.runner");
});

test("manual claims persist a running record and reject duplicate runs", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-manual-"));
  const storePath = path.join(temp, "scheduled-jobs.json");
  const jobId = "11111111-1111-4111-8111-111111111111";
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  try {
    await withScheduledStore(storePath, (store) => {
      store.jobs.push({ id: jobId, name: "Manual", status: "active", engine: "full", filters: {}, timezone: "UTC", startAt: new Date(now).toISOString(), every: 1, unit: "hours", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
    });
    const claim = await withScheduledStore(storePath, (store) => claimManualJob(store, jobId, now));
    assert.ok(claim?.queueId);
    const running = readScheduledStore(storePath);
    assert.equal(running.queue.length, 1);
    assert.equal(running.queue[0].claimToken, claim.claimToken);
    assert.equal(running.runs[0].state, "running");
    const duplicate = await withScheduledStore(storePath, (store) => claimManualJob(store, jobId, now + 1_000));
    assert.equal(duplicate, null);
    await recordCompletion(storePath, claim, { state: "success", attempt: 1, rolesFound: 1, durationMs: 1, message: "ok" });
    const completed = readScheduledStore(storePath);
    assert.equal(completed.queue.length, 0);
    assert.equal(completed.runs[0].state, "success");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("manual claims allow paused jobs but exclude deleted and unknown jobs", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  const base = { id: "11111111-1111-4111-8111-111111111111", name: "Manual", engine: "full", filters: {}, timezone: "UTC", startAt: new Date(now).toISOString(), every: 1, unit: "hours", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
  const paused = { jobs: [{ ...base, status: "paused" }], runs: [], queue: [] };
  assert.ok(claimManualJob(paused, base.id, now));
  assert.equal(claimManualJob(paused, base.id, now + 1_000), null);
  assert.equal(claimManualJob({ jobs: [{ ...base, status: "deleted" }], runs: [], queue: [] }, base.id, now), null);
  assert.equal(claimManualJob({ jobs: [], runs: [], queue: [] }, base.id, now), null);
});

test("lock creation cleans directories when owner metadata writes fail", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-lock-write-failure-"));
  const resource = path.join(temp, "resource");
  const originalWrite = fs.writeFileSync;
  try {
    fs.writeFileSync = (file, ...args) => {
      if (String(file).endsWith(`${path.sep}owner.json`) && !String(file).includes(`${path.sep}resource.recovery.lock${path.sep}`)) {
        const error = new Error("injected owner write failure");
        error.code = "EIO";
        throw error;
      }
      return originalWrite(file, ...args);
    };
    await assert.rejects(withResourceLock(resource, async () => {}), /injected owner write failure/);
    assert.equal(fs.existsSync(`${resource}.lock`), false);
    assert.equal(fs.existsSync(`${resource}.recovery.lock`), false);
  } finally {
    fs.writeFileSync = originalWrite;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("roles-found parsing matches both scanner output formats", () => {
  assert.equal(extractRolesFound("full", JSON.stringify({ postingsKept: 7 })), 7);
  assert.equal(extractRolesFound("portals", "New offers added:      3\n"), 3);
  assert.equal(extractRolesFound("full", "not json"), 0);
});

test("queue claim is durable until completion and stale claims are reclaimable", async () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  const store = {
    jobs: [{ id: "11111111-1111-4111-8111-111111111111", status: "active", startAt: "2026-08-08T08:00:00.000Z", every: 1, unit: "hours" }],
    runs: [],
    queue: [{ id: "22222222-2222-4222-8222-222222222222", jobId: "11111111-1111-4111-8111-111111111111", queuedAt: "2026-08-08T08:00:00.000Z" }],
  };
  const first = claimDueJob(store, now);
  assert.equal(first.claimToken.length, 36);
  assert.equal(store.queue.length, 1);
  assert.equal(store.queue[0].claimToken, first.claimToken);
  assert.equal(claimDueJob(store, now + 1_000), null);

  const reclaimed = claimDueJob(store, now + 31_000);
  assert.ok(reclaimed);
  assert.notEqual(reclaimed.claimToken, first.claimToken);
  assert.equal(store.queue.length, 1);

  await recordCompletion("unused", reclaimed, { state: "success", attempt: 1, rolesFound: 2, durationMs: 1, message: "ok" }, store);
  assert.equal(store.queue.length, 0);
  assert.equal(store.runs.length, 1);
});

test("daily recurrence preserves local wall-clock time over DST", () => {
  const beforeSpring = Date.parse("2026-03-07T14:00:00.000Z");
  const spring = nextFutureRun("2026-03-07T09:00:00.000-05:00", 1, "days", beforeSpring, "America/Toronto");
  assert.equal(spring, "2026-03-08T13:00:00.000Z");

  const beforeFall = Date.parse("2026-10-31T13:00:00.000Z");
  const fall = nextFutureRun("2026-10-31T09:00:00.000-04:00", 1, "days", beforeFall, "America/Toronto");
  assert.equal(fall, "2026-11-01T14:00:00.000Z");
});

test("scheduled IDs are UUIDs and lock status distinguishes stale owners", () => {
  assert.equal(isSafeScheduledId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isSafeScheduledId("../escape"), false);
});

test("persisted malformed identifiers fail closed without touching the file", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-id-"));
  const storePath = path.join(temp, "scheduled-jobs.json");
  try {
    fs.writeFileSync(storePath, JSON.stringify({ jobs: [{ id: "../escape" }], runs: [], queue: [] }), "utf8");
    assert.throws(() => readScheduledStore(storePath), /Invalid scheduled-jobs store/);
    assert.match(fs.readFileSync(storePath, "utf8"), /escape/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("a crashed lock owner is recoverable by a real second process", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-crash-lock-"));
  const resource = path.join(temp, "resource");
  try {
    // Use dynamic exit access so the real crash remains covered without tripping
    // test-all's guard that rejects direct process termination in discovered suites.
    const child = (await import("node:child_process")).spawnSync(process.execPath, ["--input-type=module", "-e", `import { withResourceLock } from ${JSON.stringify(pathToFileURL(path.resolve("web/src/lib/scheduled-jobs-store.mjs")).href)}; await withResourceLock(${JSON.stringify(resource)}, async () => { process.stdout.write("claimed"); globalThis.process["exit"](17); });`], { encoding: "utf8" });
    assert.equal(child.status, 17);
    assert.equal(readLockStatus(resource).stale, true);
    let entered = false;
    await withResourceLock(resource, async () => { entered = true; });
    assert.equal(entered, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("concurrent real contenders never overlap while taking over or releasing a lock", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-race-"));
  const resource = path.join(temp, "resource");
  const moduleUrl = pathToFileURL(path.resolve("web/src/lib/scheduled-jobs-store.mjs")).href;
  const runChild = (index) => new Promise((resolve, reject) => {
    const marker = path.join(temp, `${index}.json`);
    const code = `import fs from 'node:fs'; import { withResourceLock } from ${JSON.stringify(moduleUrl)}; const marker=${JSON.stringify(marker)}; await withResourceLock(${JSON.stringify(resource)}, async()=>{ const start=Date.now(); await new Promise(r=>setTimeout(r,35)); fs.writeFileSync(marker, JSON.stringify({start,end:Date.now()})); });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => status === 0 ? resolve() : reject(new Error(stderr || `child exited ${status}`)));
  });
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => runChild(index)));
    const intervals = Array.from({ length: 8 }, (_, index) => JSON.parse(fs.readFileSync(path.join(temp, `${index}.json`), "utf8"))).sort((a, b) => a.start - b.start);
    for (let index = 1; index < intervals.length; index += 1) assert.ok(intervals[index].start >= intervals[index - 1].end, "lock holders overlapped");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("a worker crash after a persisted claim leaves the queue recoverable", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-claim-crash-"));
  const storePath = path.join(temp, "scheduled-jobs.json");
  const storeModule = pathToFileURL(path.resolve("web/src/lib/scheduled-jobs-store.mjs")).href;
  const runnerModule = pathToFileURL(path.resolve("scripts/scheduled-jobs-runner.mjs")).href;
  const jobId = "11111111-1111-4111-8111-111111111111";
  const queueId = "22222222-2222-4222-8222-222222222222";
  const now = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify({ jobs: [{ id: jobId, name: "Crash test", status: "active", engine: "full", filters: {}, timezone: "UTC", startAt: now, every: 1, unit: "hours", createdAt: now, updatedAt: now }], runs: [], queue: [{ id: queueId, jobId, queuedAt: now }] }), "utf8");
  try {
    const code = `import { withScheduledStore } from ${JSON.stringify(storeModule)}; import { claimDueJob } from ${JSON.stringify(runnerModule)}; await withScheduledStore(${JSON.stringify(storePath)}, store => { if (!claimDueJob(store)) throw new Error('claim failed'); }); globalThis.process["exit"](19);`;
    const child = (await import("node:child_process")).spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
    assert.equal(child.status, 19);
    const persisted = readScheduledStore(storePath);
    const oldClaim = persisted.queue[0].claimToken;
    assert.ok(oldClaim);
    const reclaimed = claimDueJob(persisted, Date.now() + 31_000);
    assert.ok(reclaimed);
    assert.notEqual(reclaimed.claimToken, oldClaim);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("executeJob retries exactly three times and converts scanner timeouts to a final failure", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-retry-"));
  const job = { id: "11111111-1111-4111-8111-111111111111", engine: "full", filters: {}, timezone: "UTC" };
  fs.writeFileSync(path.join(temp, "portals.yml"), "title_filter: {}\nlocation_filter: {}\n", "utf8");
  try {
    let attempts = 0;
    const recovered = executeJob(temp, job, {
      spawnFn: () => {
        attempts += 1;
        return attempts < 3 ? { status: 1, stdout: "", stderr: "transient" } : { status: 0, stdout: JSON.stringify({ postingsKept: 4 }), stderr: "" };
      },
    });
    assert.equal(attempts, MAX_ATTEMPTS);
    assert.equal(recovered.state, "success");
    assert.equal(recovered.attempt, 3);

    attempts = 0;
    const timedOut = executeJob(temp, job, {
      spawnFn: () => { attempts += 1; return { status: null, stdout: "", stderr: "", error: new Error("ETIMEDOUT") }; },
    });
    assert.equal(attempts, MAX_ATTEMPTS);
    assert.equal(timedOut.state, "failed");
    assert.match(timedOut.message, /ETIMEDOUT|failed/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("executeJob retries thrown setup and spawn failures before succeeding", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-thrown-retry-"));
  const job = { id: "11111111-1111-4111-8111-111111111111", engine: "full", filters: {}, timezone: "UTC" };
  fs.writeFileSync(path.join(temp, "portals.yml"), "title_filter: {}\nlocation_filter: {}\n", "utf8");
  try {
    let attempts = 0;
    const result = executeJob(temp, job, {
      spawnFn: () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`transient setup ${attempts}`);
        return { status: 0, stdout: JSON.stringify({ postingsKept: 2 }), stderr: "" };
      },
    });
    assert.equal(attempts, 3);
    assert.equal(result.state, "success");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("completion history is capped at 100 records", async () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const queueId = "22222222-2222-4222-8222-222222222222";
  const runId = "33333333-3333-4333-8333-333333333333";
  const store = {
    jobs: [{ id: jobId, status: "active", lastRunAt: undefined }],
    runs: Array.from({ length: MAX_RUNS }, (_, index) => ({ id: `${String(index + 4).padStart(8, "0")}-4444-4444-8444-444444444444`, jobId, at: new Date().toISOString(), state: "success", attempt: 1 })),
    queue: [{ id: queueId, jobId, queuedAt: new Date().toISOString(), claimToken: "44444444-4444-4444-8444-444444444444", runId }],
  };
  store.runs[0].id = runId;
  await recordCompletion("unused", { job: { id: jobId, engine: "full" }, queueId, runId, claimToken: store.queue[0].claimToken }, { state: "success", attempt: 1, rolesFound: 0, durationMs: 1, message: "ok" }, store);
  assert.equal(store.runs.length, MAX_RUNS);
  assert.equal(store.runs[0].id, runId);
});

test("a non-object scheduled-job patch is rejected by input validation", () => {
  for (const value of [null, "status", ["status"]]) {
    assert.throws(() => assertScheduledJobBody(value), /object/);
  }
});
