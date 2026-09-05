import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cadenceMinimum, cadenceValueForUnit, createScheduledJobRequest, MIN_SCHEDULE_MINUTES, updateScheduledJobRequest } from "../../src/lib/scheduled-job-client.mjs";
import { runStatusTone } from "../../src/lib/scheduled-run-status.mjs";
import { isSchedulerStatusPayload } from "../../src/lib/scheduled-scheduler-status.mjs";
import { cycleFocusIndex } from "../../src/lib/scheduled-overlay-focus.mjs";
import { scheduledRunnerResourcePath, scheduledStorePath } from "../../src/lib/scheduled-runner-path.mjs";

test("scheduled-job client keeps one cadence minimum and preserves payload", async () => {
  assert.equal(cadenceMinimum("minutes"), MIN_SCHEDULE_MINUTES);
  assert.equal(cadenceMinimum("hours"), 1);
  let request;
  const result = await createScheduledJobRequest({ name: "Profile scan", every: 2, unit: "days", filters: { positive: [] } }, async (...args) => {
    request = args;
    return { ok: true, async json() { return { id: "job" }; } };
  });
  assert.deepEqual(result, { id: "job" });
  assert.equal(request[0], "/api/scheduled-jobs");
  assert.deepEqual(JSON.parse(request[1].body), { name: "Profile scan", every: 2, unit: "days", filters: { positive: [] } });
});

test("only failed runs use the failure tone", () => {
  assert.equal(runStatusTone("failed"), "failed");
  for (const state of ["queued", "running", "cancelled", "success"]) assert.notEqual(runStatusTone(state), "failed");
});

test("scheduled-job client updates by encoded id and preserves payload", async () => {
  let request;
  const result = await updateScheduledJobRequest("job/1", { status: "paused" }, async (...args) => {
    request = args;
    return { ok: true, async json() { return { id: "job/1", status: "paused" }; } };
  });
  assert.deepEqual(result, { id: "job/1", status: "paused" });
  assert.equal(request[0], "/api/scheduled-jobs/job%2F1");
  assert.deepEqual(JSON.parse(request[1].body), { status: "paused" });
});

test("scheduler payload and overlay focus helpers fail closed and wrap", () => {
  assert.equal(isSchedulerStatusPayload({ task: {} }), true);
  assert.equal(isSchedulerStatusPayload({ error: "offline" }), false);
  assert.equal(isSchedulerStatusPayload(null), false);
  assert.equal(cycleFocusIndex(0, 2, true), 1);
  assert.equal(cycleFocusIndex(1, 2, false), 0);
  assert.equal(cycleFocusIndex(0, 0), -1);
});

test("runner and scheduler-status derive the same default and custom lock path", () => {
  const root = path.resolve("career-ops");
  const defaultStore = scheduledStorePath(root, null);
  assert.equal(scheduledRunnerResourcePath(defaultStore), `${defaultStore}.runner`);
  const configuredStore = path.resolve("profile", "scheduled-jobs.json");
  const customStore = scheduledStorePath(root, configuredStore);
  assert.equal(customStore, configuredStore);
  assert.equal(scheduledRunnerResourcePath(customStore), `${configuredStore}.runner`);
});

test("relative configured store paths resolve against the supplied career-ops root", () => {
  const firstRoot = fs.mkdtempSync(path.join(process.env.TEMP || process.cwd(), "career-ops-store-root-a-"));
  const secondRoot = fs.mkdtempSync(path.join(process.env.TEMP || process.cwd(), "career-ops-store-root-b-"));
  try {
    const relative = "data/custom-scheduled-jobs.json";
    assert.equal(scheduledStorePath(firstRoot, relative), path.resolve(firstRoot, relative));
    assert.equal(scheduledStorePath(secondRoot, relative), path.resolve(secondRoot, relative));
    const absolute = path.join(firstRoot, "absolute-scheduled-jobs.json");
    assert.equal(scheduledStorePath(secondRoot, absolute), absolute);
  } finally {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  }
});

test("scheduled-job CRUD uses the shared store resolver", () => {
  const source = fs.readFileSync(new URL("../../src/lib/scheduled-jobs.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ scheduledStorePath \} from "\.\/scheduled-runner-path\.mjs"/);
  assert.match(source, /scheduledStorePath\(careerOpsRoot\(\)\)/);
});

test("minute cadence changes clamp to the shared minimum without shrinking larger values", () => {
  assert.equal(cadenceValueForUnit(6, "minutes"), MIN_SCHEDULE_MINUTES);
  assert.equal(cadenceValueForUnit(30, "minutes"), 30);
  assert.equal(cadenceValueForUnit(15, "hours"), 15);
});

test("scheduled run route has a bounded SIGKILL fallback and idempotent cleanup", () => {
  const source = fs.readFileSync(new URL("../../src/app/api/scheduled-jobs/[id]/run/route.ts", import.meta.url), "utf8");
  assert.match(source, /SIGKILL/);
  assert.match(source, /killTimer/);
  assert.match(source, /if \(settled\) return/);
  assert.match(source, /clearTimeout\(killTimer\)/);
});
