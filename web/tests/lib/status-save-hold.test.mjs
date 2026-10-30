// A status save can outlive the virtualized row that started it.
// Run: node --test web/tests/lib/status-save-hold.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { offscreenStatusFailures, reduceHeldSave } from "../../src/lib/status-save-hold.mjs";

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
