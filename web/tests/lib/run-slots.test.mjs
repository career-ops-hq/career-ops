// "Score shortlist" must not start every evaluation at once: heavy runs share
// a small pool of slots and the rest wait in order.
//
// Run (from web/): node --test tests/lib/run-slots.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunSlots, DEFAULT_MAX_PARALLEL_RUNS, parseMaxParallelRuns } from "../../src/lib/run-slots.mjs";

const tick = () => new Promise((r) => setImmediate(r));

test("parseMaxParallelRuns accepts 1-20 and falls back to the default", () => {
  assert.equal(parseMaxParallelRuns("5"), 5);
  assert.equal(parseMaxParallelRuns(1), 1);
  assert.equal(parseMaxParallelRuns("20"), 20);
  for (const bad of [null, "", "0", "-1", "21", "2.5", "abc", undefined]) {
    assert.equal(parseMaxParallelRuns(bad), DEFAULT_MAX_PARALLEL_RUNS, String(bad));
  }
});

test("at most `limit` heavy runs hold a slot; the rest start in FIFO order", async () => {
  const slots = createRunSlots(() => 2);
  const started = [];
  const releases = {};
  const queued = [];
  for (const name of ["a", "b", "c", "d"]) {
    slots.acquire("evaluate", (pos) => queued.push([name, pos])).then((release) => {
      started.push(name);
      releases[name] = release;
    });
  }
  await tick();
  assert.deepEqual(started, ["a", "b"]);
  assert.deepEqual(queued, [["c", 1], ["d", 2]]);
  assert.equal(slots.active, 2);
  assert.equal(slots.waiting, 2);

  releases.b();
  await tick();
  assert.deepEqual(started, ["a", "b", "c"]);

  releases.b(); // a second release of the same slot is a no-op
  await tick();
  assert.deepEqual(started, ["a", "b", "c"]);
  assert.equal(slots.active, 2);

  releases.a();
  await tick();
  assert.deepEqual(started, ["a", "b", "c", "d"]);
  releases.c();
  releases.d();
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
});

test("pdf runs share the pool; other kinds never wait", async () => {
  const slots = createRunSlots(() => 1);
  const order = [];
  const first = await slots.acquire("evaluate");
  slots.acquire("pdf").then(() => order.push("pdf"));
  slots.acquire("explore").then(() => order.push("explore"));
  slots.acquire("assistant").then(() => order.push("assistant"));
  await tick();
  assert.deepEqual(order, ["explore", "assistant"]);
  first();
  await tick();
  assert.deepEqual(order, ["explore", "assistant", "pdf"]);
});

test("a raised limit lets waiting runs start at the next release", async () => {
  let limit = 1;
  const slots = createRunSlots(() => limit);
  const started = [];
  const first = await slots.acquire("evaluate");
  slots.acquire("evaluate").then(() => started.push("b"));
  slots.acquire("evaluate").then(() => started.push("c"));
  await tick();
  assert.deepEqual(started, []);
  limit = 3;
  first();
  await tick();
  assert.deepEqual(started, ["b", "c"]);
});
