import test from "node:test";
import assert from "node:assert/strict";
import { CV_CONFLICT_ERROR, cvIngestSaveBody, decideCvWrite } from "../../src/lib/cv-write.mjs";

const disk = { exists: true, content: "Jane Doe\n" };
const expected = { exists: true, content: "Jane Doe\n" };

test("a save of the text the editor last saw is allowed", () => {
  const decision = decideCvWrite(disk, { content: "Jane Doe\n\nTuesday.", backup: false, expected });
  assert.deepEqual(decision, { ok: true, backup: false });
});

test("a save is refused when cv.md changed after the editor read it", () => {
  const decision = decideCvWrite(
    { exists: true, content: "Jane Doe\n\nEdited elsewhere." },
    { content: "Jane Doe\n\nTuesday.", backup: false, expected },
  );
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.status, 409);
    assert.equal(decision.error, CV_CONFLICT_ERROR);
  }
});

test("a save is refused when a file appeared after the editor saw none", () => {
  const decision = decideCvWrite(disk, { content: "Tuesday.", expected: { exists: false, content: "" } });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 409);
});

test("a first save is allowed when both sides see no file", () => {
  const decision = decideCvWrite({ exists: false, content: "" }, { content: "Tuesday.", expected: { exists: false, content: "" } });
  assert.deepEqual(decision, { ok: true, backup: true });
});

test("an ingest save names the file it read before editing", () => {
  const body = cvIngestSaveBody("Jane Doe\n\nTuesday.", { content: "Jane Doe\n", exists: true });
  assert.deepEqual(decideCvWrite(disk, body), { ok: true, backup: true });
  const changed = decideCvWrite({ exists: true, content: "Edited elsewhere." }, body);
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.status, 409);
});

test("a save that does not name its base is refused", () => {
  const decision = decideCvWrite(disk, { content: "Tuesday." });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 409);
});
