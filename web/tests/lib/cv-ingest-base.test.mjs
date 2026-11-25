import test from "node:test";
import assert from "node:assert/strict";
import { canReviewIngest, planIngestSave } from "../../src/lib/cv-ingest-base.mjs";

const opened = { content: "Jane Doe\n", exists: true };

test("review waits until the current CV has been read", () => {
  assert.equal(canReviewIngest(null), false);
  assert.equal(canReviewIngest(opened), true);
});

test("a save does not read the file again while review is open", () => {
  assert.deepEqual(planIngestSave(opened), { post: true, base: opened });
  assert.deepEqual(planIngestSave(null), { post: false, reason: "missing" });
  assert.deepEqual(planIngestSave(opened, { conflict: true }), { post: false, reason: "conflict" });
});

