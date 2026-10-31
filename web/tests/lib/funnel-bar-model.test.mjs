import assert from "node:assert/strict";
import { test } from "node:test";
import { funnelBarModel } from "../../src/lib/analytics-metrics.mjs";

test("the funnel bar is the share of tracked roles, not the conversion rate", () => {
  const bar = funnelBarModel({ count: 15, pct: (15 / 39) * 100 }, 400);
  assert.equal(bar.count, 15);
  assert.ok(Math.abs(bar.widthPct - (15 / 400) * 100) < 1e-9);
  assert.equal(Object.hasOwn(bar, "pct"), false);
  assert.equal(funnelBarModel({ count: 15, pct: 38 }, 0).widthPct, 0);
});
