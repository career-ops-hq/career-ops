// The Today hero must never claim "all caught up" it cannot back up.
//
// The headline used to be a count comparison over client state seeded at 0, so
// the first paint — and, because both fetches ended `.catch(() => {})`, every
// paint after a failed request — told a user with overdue follow-ups that they
// were caught up. These assertions pin the distinction the counts could not
// make: zero-because-not-loaded and zero-because-nothing-is-due.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveHeroState, mayClaimAllClear } from "../../src/lib/home/hero-state.mjs";

test("pending loops never read as all clear", () => {
  const state = resolveHeroState({ loops: "pending" });
  assert.equal(state, "loading");
  assert.equal(mayClaimAllClear(state), false);

  // The exact shape of the old bug: every counter is 0 because nothing has
  // loaded. The old expression `newThisWeek === 0 && overdue === 0 &&
  // awaiting.length === 0` was true here, which is what shipped the false
  // all-clear.
  assert.equal(
    resolveHeroState({ loops: "pending", newThisWeek: 0, overdue: 0, awaitingCount: 0 }),
    "loading",
  );
});

test("a failed loop is unavailable, not all clear — the permanent-false-all-clear case", () => {
  const state = resolveHeroState({ loops: "failed", newThisWeek: 0, overdue: 0, awaitingCount: 0 });
  assert.equal(state, "unavailable");
  assert.equal(mayClaimAllClear(state), false);
});

test("settled with nothing to do is the only all clear", () => {
  const state = resolveHeroState({ loops: "settled", newThisWeek: 0, overdue: 0, awaitingCount: 0 });
  assert.equal(state, "all-clear");
  assert.equal(mayClaimAllClear(state), true);
});

test("work outranks loading, so a known row shows immediately", () => {
  // awaitingCount is a server prop: trustworthy on first paint, and a scored row
  // awaiting a decision should not sit behind a spinner.
  assert.equal(resolveHeroState({ loops: "pending", awaitingCount: 2 }), "queue");
  assert.equal(resolveHeroState({ loops: "failed", awaitingCount: 2 }), "queue");
  assert.equal(resolveHeroState({ loops: "settled", overdue: 1 }), "queue");
  assert.equal(resolveHeroState({ loops: "settled", newThisWeek: 5 }), "queue");
});

test("counters that are not positive integers cannot invent work", () => {
  // /api/whats-new and /api/followups are read straight off JSON, so a missing
  // or malformed field must read as 0 rather than as "something to do" — the
  // mirror of the `?? d.entries?.length` fallback the dashboard already removed.
  for (const bad of [undefined, null, NaN, -3, "7", {}]) {
    assert.equal(
      resolveHeroState({ loops: "settled", overdue: /** @type {never} */ (bad) }),
      "all-clear",
      `overdue=${String(bad)} must not count as work`,
    );
  }
});

test("mayClaimAllClear is closed against new states", () => {
  // Adding a state must not become an all-clear by omission.
  for (const s of ["loading", "unavailable", "queue"]) {
    assert.equal(mayClaimAllClear(/** @type {never} */ (s)), false);
  }
});
