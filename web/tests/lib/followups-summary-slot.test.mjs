import assert from "node:assert/strict";
import { test } from "node:test";
import { followupsSummarySlot } from "../../src/lib/followups-summary-slot.mjs";

test("a follow-up list with nothing due keeps the loading slot", () => {
  const loading = followupsSummarySlot({ pending: true, filtering: false, hasSummary: false, due: 0 });
  const quiet = followupsSummarySlot({ pending: false, filtering: false, hasSummary: true, due: 0 });
  assert.equal(loading, "reserved");
  assert.equal(quiet, "reserved");
});

test("due follow-ups show the narrative, and a filter or a missing cadence hides the slot", () => {
  assert.equal(followupsSummarySlot({ pending: false, filtering: false, hasSummary: true, due: 2 }), "narrative");
  assert.equal(followupsSummarySlot({ pending: true, filtering: true, hasSummary: false, due: 0 }), "hidden");
  assert.equal(followupsSummarySlot({ pending: false, filtering: false, hasSummary: false, due: 0 }), "hidden");
});
