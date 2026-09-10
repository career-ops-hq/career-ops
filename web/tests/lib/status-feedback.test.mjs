// What the status control says after a successful write.
//
// The CLI seeds the follow-up itself since #3470 and reports it; the web's job
// is to not swallow that. These pin the cases where the louder message would
// be wrong, because "seeded" alone is not enough to promise a date.
//
// Run:  node --test tests/lib/status-feedback.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { statusFeedback } from "../../src/lib/status-feedback.mjs";

test("a real seed with a date announces the date", () => {
  assert.deepEqual(statusFeedback({ seeded: true, nextDate: "2026-09-09" }), { kind: "followup", date: "2026-09-09" });
});

test("no follow-up in the response falls back to the plain confirmation", () => {
  // Every transition that is not into Applied, which is most of them.
  for (const v of [undefined, null]) assert.deepEqual(statusFeedback(v), { kind: "saved" });
});

test("an idempotent re-run says saved, not a date it did not schedule", () => {
  // set-status is idempotent: a second Applied reports seeded:false with a
  // reason. Announcing a follow-up there would claim something just happened.
  assert.deepEqual(statusFeedback({ seeded: false, nextDate: null, reason: "already-seeded" }), { kind: "saved" });
});

test("a failed seed does not surface as a scheduled follow-up", () => {
  // The status change succeeded; the seed did not. Promising a date here is
  // the one outcome that would be a lie rather than an omission.
  assert.deepEqual(statusFeedback({ seeded: false, reason: "error", error: "EACCES" }), { kind: "saved" });
});

test("seeded true with no date never renders an undefined date", () => {
  // Defensive: the CLI sends nextDate: null when it has none. "follow-up
  // undefined" on screen is worse than no message at all.
  for (const bad of [{ seeded: true, nextDate: null }, { seeded: true }, { seeded: true, nextDate: "" }]) {
    assert.deepEqual(statusFeedback(bad), { kind: "saved" }, JSON.stringify(bad));
  }
});
