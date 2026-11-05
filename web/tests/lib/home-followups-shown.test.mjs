import { test } from "node:test";
import assert from "node:assert/strict";
import { homeFollowupRemainder } from "../../src/lib/home/followups-shown.mjs";

test("a shorter home list than the due count still points at the rest", () => {
  assert.deepEqual(homeFollowupRemainder(8, 45), { shown: 8, hidden: 37, total: 45 });
});

test("the full due list does not invent a leftover", () => {
  assert.deepEqual(homeFollowupRemainder(3, 3), { shown: 3, hidden: 0, total: 3 });
});

test("a missing due count does not invent leftovers", () => {
  assert.deepEqual(homeFollowupRemainder(8, undefined), { shown: 8, hidden: 0, total: 8 });
  assert.deepEqual(homeFollowupRemainder(0, 0), { shown: 0, hidden: 0, total: 0 });
});
