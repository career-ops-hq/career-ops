import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerFeedback, workerIdentity, workerState, workerDetailsLabel, workerBatchSummary } from "../../src/lib/worker-feedback.mjs";

const job = (id, status = "done", title = "Evaluate · FixtureCo", subtitle = "Engineer") => ({ id, title, subtitle, status });
function fixture() {
  const notices = [];
  const timers = new Map();
  let next = 0;
  const feedback = createWorkerFeedback((text) => notices.push(text), {
    schedule(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    cancel(id) { timers.delete(id); },
  });
  return { feedback, notices, timers, flush() { const batch = [...timers.values()]; timers.clear(); batch.forEach(({ fn }) => fn()); } };
}

test("task identity includes role; detail names exclude ticking progress", () => {
  const task = { ...job("a", "running"), steps: ["WebFetch"], elapsed: 1 };
  assert.equal(workerIdentity(task), "Evaluate · FixtureCo · Engineer");
  assert.equal(workerIdentity({ title: "Draft CV" }), "Draft CV");
  assert.equal(workerDetailsLabel(task), "Open worker: Evaluate · FixtureCo · Engineer — Running");
  assert.equal(workerDetailsLabel({ ...task, elapsed: 60, steps: ["Write"] }), workerDetailsLabel(task));
  assert.equal(workerState("done"), "Completed");
  assert.equal(workerState("error"), "Failed");
});

test("batch outcomes distinguish failures, active work and unavailable history", () => {
  assert.equal(workerBatchSummary([job("a"), job("b", "error"), job("c", "running")], 4), "1 running, 1 completed, 1 failed, 1 unavailable");
  assert.equal(workerBatchSummary([job("a"), job("b", "error")]), "1 completed, 1 failed");
});

test("no initial/history notice; only terminal events schedule feedback", () => {
  const f = fixture();
  assert.deepEqual(f.notices, []);
  f.feedback.push(job("a", "running"));
  assert.equal(f.timers.size, 0);
  f.feedback.push(job("a"));
  f.flush();
  assert.deepEqual(f.notices, ["", "Evaluate · FixtureCo · Engineer: completed."]);
});

test("same terminal event is deduplicated across instances and later renders", () => {
  const f = fixture();
  f.feedback.push(job("a")); f.feedback.push(job("a"));
  f.flush(); f.feedback.push(job("a")); f.flush();
  assert.equal(f.notices.length, 2);
  f.feedback.push(job("b", "done", "Evaluate · FixtureCo", "Designer"));
  f.flush();
  assert.equal(f.notices.at(-1), "Evaluate · FixtureCo · Designer: completed.");
});

test("concurrent outcomes share a fixed window, including mixed success and failure", () => {
  const f = fixture();
  f.feedback.push(job("a"));
  const timer = [...f.timers.keys()][0];
  f.feedback.push(job("b", "error", "Evaluate · FixtureCo", "Designer"));
  assert.deepEqual([...f.timers.keys()], [timer], "new events must not restart or extend the window");
  assert.equal(f.timers.get(timer).delay, 500);
  f.flush();
  assert.deepEqual(f.notices, ["", "Evaluate · FixtureCo · Engineer: completed. Evaluate · FixtureCo · Designer: failed."]);
});

test("large bursts give bounded counts instead of reading every task", () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) f.feedback.push(job(String(i), i % 2 ? "error" : "done"));
  f.flush();
  assert.equal(f.notices.at(-1), "20 workers: 10 completed, 10 failed. Open Worker history for details.");
});

test("different tasks with identical labels still create separate mutations", () => {
  const f = fixture();
  f.feedback.push(job("a")); f.flush();
  f.feedback.push(job("b")); f.flush();
  assert.deepEqual(f.notices, ["", "Evaluate · FixtureCo · Engineer: completed.", "", "Evaluate · FixtureCo · Engineer: completed."]);
});

test("unmount cancels pending work and ignores late worker events", () => {
  const f = fixture();
  f.feedback.push(job("a")); f.feedback.dispose(); f.flush();
  f.feedback.push(job("b")); f.flush();
  assert.deepEqual(f.notices, [""]);
  assert.equal(f.timers.size, 0);
});
