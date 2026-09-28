// Regression: concurrent evaluations must serialize on the write gate, or a
// run's "did a report appear?" check can be satisfied by the OTHER run's report
// (PolicyBazaar job-12, 2026-09-28: run A was SIGTERM'd with no report of its
// own, yet read a green "report saved" because run B's report landed mid-run).
import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireWriteGate, isTrackerWriting } from "../../src/lib/core/run-registry.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("acquireWriteGate serializes tracker-writing runs", async () => {
  const firstRelease = await acquireWriteGate();
  assert.equal(isTrackerWriting(), true, "holder must register as tracker-writing");

  let secondAcquired = false;
  let secondRelease;
  const second = acquireWriteGate().then((release) => {
    secondAcquired = true;
    secondRelease = release;
  });
  await sleep(30);
  assert.equal(secondAcquired, false, "second run must wait while the first holds the gate");

  firstRelease();
  await second;
  assert.equal(secondAcquired, true, "releasing the gate must let the next run through");

  secondRelease();
  assert.equal(isTrackerWriting(), false, "gate fully drained once every holder releases");
});

test("gate slots are handed out in FIFO order", async () => {
  const releaseA = await acquireWriteGate();
  const order = [];
  const second = acquireWriteGate().then((release) => { order.push("2nd"); return release; });
  const third = acquireWriteGate().then((release) => { order.push("3rd"); return release; });
  await sleep(20);
  releaseA();
  const releaseSecond = await second;
  assert.deepEqual(order, ["2nd"], "2nd acquires as soon as the first holder releases");
  await sleep(20);
  assert.deepEqual(order, ["2nd"], "3rd must NOT acquire while the 2nd slot is still held");
  releaseSecond();
  await third;
  assert.deepEqual(order, ["2nd", "3rd"], "later acquirers must not jump the queue");
});