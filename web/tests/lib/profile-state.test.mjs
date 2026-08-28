import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advanceProfileState, classifyResumeFreshness, readProfileState } from "../../src/lib/profile-state.mjs";

test("approved profile state increments deterministically", () => {
  const root = mkdtempSync(join(tmpdir(), "co-profile-state-"));
  try {
    assert.deepEqual(readProfileState(root), { version: 0, updatedAt: null });
    assert.deepEqual(advanceProfileState(root, new Date("2026-08-27T10:00:00Z")), { version: 1, updatedAt: "2026-08-27T10:00:00.000Z" });
    assert.equal(advanceProfileState(root, new Date("2026-08-27T11:00:00Z")).version, 2);
    assert.equal(JSON.parse(readFileSync(join(root, "data", "profile-state.json"))).version, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("freshness uses profile version first", () => {
  const state = { version: 4, updatedAt: "2026-08-27T10:00:00Z" };
  assert.equal(classifyResumeFreshness({ profileVersion: 4, createdAt: "2020-01-01" }, state), "current");
  assert.equal(classifyResumeFreshness({ profileVersion: 3, createdAt: "2030-01-01" }, state), "stale");
});

test("legacy freshness falls back to dates and unknown remains unknown", () => {
  const state = { version: 2, updatedAt: "2026-08-27T10:00:00Z" };
  assert.equal(classifyResumeFreshness({ createdAt: "2026-08-26T10:00:00Z" }, state), "stale");
  assert.equal(classifyResumeFreshness({ createdAt: "2026-08-28T10:00:00Z" }, state), "current");
  assert.equal(classifyResumeFreshness({}, state), "unknown");
});
