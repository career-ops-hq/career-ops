import assert from "node:assert/strict";
import { test } from "node:test";
import { sentRateLabel } from "../../src/lib/analytics/sent-rate-label.mjs";

test("an insights rate is a share of applications sent, not of the row count", () => {
  assert.equal(sentRateLabel(21), "21% of sent");
  assert.equal(sentRateLabel(0), "0% of sent");
  assert.equal(sentRateLabel(null), "—");
  assert.equal(sentRateLabel(undefined), "—");
});
