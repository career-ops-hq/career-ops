import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunOwner } from "../../src/lib/explore-run.mjs";

test("setMode retires the scan, and the AI hunt that starts next is the one that may publish", () => {
  const runs = createRunOwner();
  const scan = runs.start();
  runs.invalidate();
  const ai = runs.start();

  assert.equal(runs.owns(scan), false);
  assert.equal(runs.owns(ai), true);
  assert.equal(ai, 3);
});

test("starting a run retires the previous generation", () => {
  const runs = createRunOwner();
  const first = runs.start();
  const second = runs.start();

  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(runs.owns(first), false);
  assert.equal(runs.owns(second), true);
});
