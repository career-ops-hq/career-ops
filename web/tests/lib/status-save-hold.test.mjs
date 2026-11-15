// A status save can outlive the virtualized row that started it.
// Run: node --test web/tests/lib/status-save-hold.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { clearHeldSaves, excludeInFlightStatusRows, offscreenStatusFailures, reduceHeldSave } from "../../src/lib/status-save-hold.mjs";

const key = JSON.stringify(["12", "Fixture Beta", "Engineer", "2026-10-02", ""]);

test("a started save remembers the chosen status until it finishes", () => {
  const started = reduceHeldSave(new Map(), { type: "start", key, status: "Applied", n: "12" });
  assert.deepEqual(started.get(key), { phase: "pending", status: "Applied", n: "12" });
  assert.equal(reduceHeldSave(started, { type: "clear", key }).has(key), false);
});

test("a failed save drops the optimistic status and keeps the error", () => {
  const started = reduceHeldSave(new Map(), { type: "start", key, status: "Applied", n: "12" });
  const failed = reduceHeldSave(started, { type: "fail", key, error: "Tracker is locked", n: "12" });
  assert.deepEqual(failed.get(key), { phase: "failed", error: "Tracker is locked", n: "12" });
  assert.equal("status" in failed.get(key), false);
});

test("starting again replaces an earlier error", () => {
  const failed = reduceHeldSave(new Map(), { type: "fail", key, error: "Tracker is locked", n: "12" });
  const started = reduceHeldSave(failed, { type: "start", key, status: "Rejected", n: "12" });
  assert.deepEqual(started.get(key), { phase: "pending", status: "Rejected", n: "12" });
});

test("an unchanged event keeps the same map", () => {
  const started = reduceHeldSave(new Map(), { type: "start", key, status: "Applied", n: "12" });
  assert.equal(reduceHeldSave(started, { type: "start", key, status: "Applied", n: "12" }), started);
  assert.equal(reduceHeldSave(started, { type: "clear", key: "missing" }), started);
});

test("only an unmounted row's failure is repeated above the table", () => {
  const other = JSON.stringify(["11", "Fixture Alpha", "Engineer", "2026-10-02", ""]);
  let holds = new Map();
  holds = reduceHeldSave(holds, { type: "fail", key, error: "Tracker is locked", n: "12" });
  holds = reduceHeldSave(holds, { type: "fail", key: other, error: "Could not save status. Please try again.", n: "11" });
  holds = reduceHeldSave(holds, { type: "start", key: "pending", status: "Applied", n: "13" });
  assert.deepEqual(offscreenStatusFailures(holds, [other]), [
    { key, n: "12", error: "Tracker is locked" },
  ]);
});

test("a bulk save leaves a row alone while that row's own save is still running", () => {
  const other = JSON.stringify(["11", "Fixture Alpha", "Engineer", "2026-10-02", ""]);
  const rows = [
    { n: "12", company: "Fixture Beta", role: "Engineer", date: "2026-10-02", report: "" },
    { n: "11", company: "Fixture Alpha", role: "Engineer", date: "2026-10-02", report: "" },
    { n: "10", company: "Fixture Gamma", role: "Engineer", date: "2026-10-01", report: "" },
  ];
  const keyOf = (row) => JSON.stringify([row.n, row.company, row.role, row.date, row.report]);
  let holds = new Map();
  holds = reduceHeldSave(holds, { type: "start", key, status: "Applied", n: "12" });
  holds = reduceHeldSave(holds, { type: "fail", key: other, error: "Tracker is locked", n: "11" });
  const { write, inFlight } = excludeInFlightStatusRows(rows, holds, keyOf);
  assert.deepEqual(inFlight.map((row) => row.n), ["12"]);
  assert.deepEqual(write.map((row) => row.n), ["11", "10"]);
  const after = clearHeldSaves(holds, [keyOf(write[0]), key]);
  assert.deepEqual(after.get(key), { phase: "pending", status: "Applied", n: "12" });
  assert.equal(after.has(other), false);
});

test("a bulk save clears earlier failures for the rows it saved", () => {
  const other = JSON.stringify(["11", "Fixture Alpha", "Engineer", "2026-10-02", ""]);
  let holds = new Map();
  holds = reduceHeldSave(holds, { type: "fail", key, error: "Tracker is locked", n: "12" });
  holds = reduceHeldSave(holds, { type: "fail", key: other, error: "Tracker is locked", n: "11" });
  const after = clearHeldSaves(holds, [key]);
  assert.equal(after.has(key), false);
  assert.equal(after.has(other), true);
  assert.equal(clearHeldSaves(holds, ["missing"]), holds);
});
