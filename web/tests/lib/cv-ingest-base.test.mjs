import test from "node:test";
import assert from "node:assert/strict";
import { canReviewIngest, nextIngestBase, planIngestSave } from "../../src/lib/cv-ingest-base.mjs";

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

test("start over forgets the old file, and accepting the current file replaces it", () => {
  assert.equal(nextIngestBase(opened, { forget: true }), null);
  const current = { content: "Edited elsewhere.", exists: true };
  assert.deepEqual(nextIngestBase(opened, { accept: current }), current);
  assert.equal(nextIngestBase(opened), opened);
});
