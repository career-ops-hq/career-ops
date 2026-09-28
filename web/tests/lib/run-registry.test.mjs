// Regression: concurrent evaluations must serialize on the eval lane, or a
// run's "did a report appear?" check can be satisfied by the OTHER run's report
// (PolicyBazaar job-12, 2026-09-28: run A was SIGTERM'd with no report of its
// own, yet read a green "report saved" because run B's report landed mid-run).
// Evaluations and PDF generations use SEPARATE lanes: only an evaluate can fake
// the report check, and the CLI writers lock applications.md themselves
// (tracker-utils.mjs), so a CV generation must never wait on an evaluation (or
// vice versa).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acquireEvalGate,
  acquirePdfGate,
  isTrackerWriting,
} from "../../src/lib/core/run-registry.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("evaluate lane serializes tracker-writing runs", async () => {
  const firstRelease = await acquireEvalGate();
  assert.equal(isTrackerWriting(), true, "holder must register as tracker-writing");

  let secondAcquired = false;
  let secondRelease;
  const second = acquireEvalGate().then((release) => {
    secondAcquired = true;
    secondRelease = release;
  });
  await sleep(30);
  assert.equal(secondAcquired, false, "second eval must wait while the first holds the lane");

  firstRelease();
  await second;
  assert.equal(secondAcquired, true, "releasing the lane must let the next eval through");

  secondRelease();
  assert.equal(isTrackerWriting(), false, "lanes fully drained once every holder releases");
});

test("eval lane slots are handed out in FIFO order", async () => {
  const releaseA = await acquireEvalGate();
  const order = [];
  const second = acquireEvalGate().then((release) => { order.push("2nd"); return release; });
  const third = acquireEvalGate().then((release) => { order.push("3rd"); return release; });
  await sleep(20);
  releaseA();
  const releaseSecond = await second;
  assert.deepEqual(order, ["2nd"], "2nd acquires as soon as the first holder releases");
  await sleep(20);
  assert.deepEqual(order, ["2nd"], "3rd must NOT acquire while the 2nd slot is still held");
  releaseSecond();
  const releaseThird = await third;
  assert.deepEqual(order, ["2nd", "3rd"], "later acquirers must not jump the queue");
  releaseThird();
});

test("evaluate and pdf lanes drain independently — releasing one never advances the other", async () => {
  const holdEval = await acquireEvalGate();
  const holdPdf = await acquirePdfGate();

  let eval2Got = false;
  let pdf2Got = false;
  let relEval2, relPdf2;
  const queuedEval = acquireEvalGate().then((r) => { eval2Got = true; relEval2 = r; });
  const queuedPdf = acquirePdfGate().then((r) => { pdf2Got = true; relPdf2 = r; });
  await sleep(30);
  assert.equal(eval2Got, false, "queued eval must wait on the eval lane");
  assert.equal(pdf2Got, false, "queued pdf must wait on the pdf lane");

  holdEval();
  await sleep(20);
  assert.equal(eval2Got, true, "releasing the eval holder lets the queued eval through");
  assert.equal(pdf2Got, false, "pdf lane is untouched by the eval release — it drains on its own");

  holdPdf();
  await sleep(20);
  assert.equal(pdf2Got, true, "releasing the pdf holder lets the queued pdf through");

  relEval2();
  relPdf2();
  await Promise.all([queuedEval, queuedPdf]);
  assert.equal(isTrackerWriting(), false, "lanes fully drained after every holder releases");
});

test("a held pdf lane does not block the eval lane (generation never stalls evaluations)", async () => {
  const holdPdf = await acquirePdfGate();
  let evalAcquired = false;
  let evalRelease;
  const queuedEval = acquireEvalGate().then((release) => { evalAcquired = true; evalRelease = release; });
  await sleep(30);
  assert.equal(evalAcquired, true, "eval must acquire immediately while a pdf holds its own lane");
  evalRelease();
  holdPdf();
  await queuedEval;
  assert.equal(isTrackerWriting(), false, "drained");
});

test("a held eval lane does not block the pdf lane (evaluations never stall generation)", async () => {
  const holdEval = await acquireEvalGate();
  let pdfAcquired = false;
  let pdfRelease;
  const queuedPdf = acquirePdfGate().then((release) => { pdfAcquired = true; pdfRelease = release; });
  await sleep(30);
  assert.equal(pdfAcquired, true, "pdf must acquire immediately while an eval holds its own lane");
  pdfRelease();
  holdEval();
  await queuedPdf;
  assert.equal(isTrackerWriting(), false, "drained");
});