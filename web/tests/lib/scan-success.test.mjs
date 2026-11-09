import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSuccessLabel } from "../../src/lib/scan-success.mjs";

test("no scheduled runs is not a 100% success rate", () => {
  assert.equal(scanSuccessLabel(0, 0), "—");
});

test("a real run history reports the rounded percent", () => {
  assert.equal(scanSuccessLabel(4, 3), "75%");
  assert.equal(scanSuccessLabel(3, 1), "33%");
  assert.equal(scanSuccessLabel(2, 2), "100%");
});
