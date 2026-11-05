import assert from "node:assert/strict";
import { test } from "node:test";
import { missingTrackedJob, missingWorker } from "../../src/lib/job-route.mjs";

test("a tracker number with no row and no report is a 404", () => {
  assert.equal(missingTrackedJob({ hasApplication: false, hasReport: false }), true);
});

test("a non-numeric id is a 404 when neither record exists", () => {
  assert.equal(missingTrackedJob({ hasApplication: false, hasReport: false }), true);
});

test("an application or a report keeps the page", () => {
  assert.equal(missingTrackedJob({ hasApplication: true, hasReport: false }), false);
  assert.equal(missingTrackedJob({ hasApplication: false, hasReport: true }), false);
});

test("/jobs/abc is a 404 once the worker list has loaded and does not contain it", () => {
  assert.equal(missingWorker({ ready: true, ids: ["job-1"], id: "abc" }), true);
});

test("a worker that is in the list is not a 404", () => {
  assert.equal(missingWorker({ ready: true, ids: ["job-1"], id: "job-1" }), false);
});

test("the worker list has not loaded yet, so the page does not 404", () => {
  assert.equal(missingWorker({ ready: false, ids: [], id: "abc" }), false);
});
