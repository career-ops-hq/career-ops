import assert from "node:assert/strict";
import { test } from "node:test";
import { pipelineFindRolesHref, shouldStartScanOnLoad } from "../../src/lib/scan-on-load.mjs";

test("opening Pipeline does not start a scan, even with run=1 on the query", () => {
  assert.equal(shouldStartScanOnLoad("/pipeline", ""), false);
  assert.equal(shouldStartScanOnLoad("/pipeline", "run=1"), false);
  assert.equal(shouldStartScanOnLoad("/pipeline/", "?run=1"), false);
  assert.equal(shouldStartScanOnLoad("/pipeline/15", "run=1"), false);
});

test("Explore starts a scan on load only for the explicit run=1 hand-off", () => {
  assert.equal(shouldStartScanOnLoad("/explore", ""), false);
  assert.equal(shouldStartScanOnLoad("/explore", "?tab=inbox"), false);
  assert.equal(shouldStartScanOnLoad("/explore", "run=1"), true);
  assert.equal(shouldStartScanOnLoad("/explore", "run=1&preset=china-employers"), false);
});

test("the Pipeline find-roles link does not ask Explore to scan on arrival", () => {
  const href = pipelineFindRolesHref();
  assert.equal(href, "/explore");
  assert.equal(href.includes("run=1"), false);
  assert.equal(shouldStartScanOnLoad(href, ""), false);
});
