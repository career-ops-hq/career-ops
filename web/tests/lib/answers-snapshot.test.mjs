// The job page edits one of the four groups in `## Application Answers`. The
// other three are written by the CLI apply mode when it fills a real form: which
// options were selected, what went into the remaining fields, and which CV file
// was uploaded.
//
// upsertApplicationAnswersSection replaces the WHOLE section. So a save that
// sends only freeText deletes the other three, silently and permanently, and the
// loss surfaces much later: `apply` re-reads the report before the next
// application and the work-authorization selection and the attached CV are gone.
// It also silently downgrades a `submitted` section back to `filled`, which
// turns a sent application into an unsent-looking one.
//
// These are the assertions that stop that, so they are worth more than their
// size suggests. Verified against the real formatter before it was written:
// freeText-only round-trips to {sel:0, fv:0, files:0, state:"filled"} from a
// section that had one of each and was submitted.
//
// Run:  node --test tests/lib/answers-snapshot.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSavePayload, mayReplaceSection, resolveState } from "../../src/lib/apply/answers-snapshot.mjs";

const STORED = {
  state: "submitted",
  selections: [{ question: "Work authorization", selection: "Yes" }],
  fieldValues: [{ question: "Notice period", answer: "30 days" }],
  files: [{ field: "Resume", path: "output/cv.pdf", version: "v3" }],
};

test("the three groups the panel does not edit survive a save", () => {
  const payload = buildSavePayload({
    stored: STORED,
    questions: [{ question: "Why us?", answer: "Edited in the panel." }],
  });
  assert.deepEqual(payload.selections, STORED.selections);
  assert.deepEqual(payload.fieldValues, STORED.fieldValues);
  assert.deepEqual(payload.files, STORED.files);
  assert.deepEqual(payload.freeText, [{ question: "Why us?", answer: "Edited in the panel." }]);
});

test("a submitted section is not reopened by editing an answer", () => {
  assert.equal(buildSavePayload({ stored: STORED, questions: [] }).state, "submitted");
  assert.equal(resolveState(undefined, "submitted"), "submitted");
});

test("submitted is only ever set from an explicit request", () => {
  assert.equal(resolveState(undefined, "filled"), "filled");
  assert.equal(resolveState(undefined, ""), "filled");
  assert.equal(resolveState(undefined, undefined), "filled");
  assert.equal(resolveState("submitted", "filled"), "submitted");
  // An explicit `filled` is a real request to withdraw the claim, and is honoured.
  assert.equal(resolveState("filled", "submitted"), "filled");
  // Anything else is not a state.
  assert.equal(resolveState("SUBMITTED", "filled"), "filled");
  assert.equal(resolveState("whatever", "submitted"), "submitted");
});

test("a first save on a report with no section writes empty groups, not undefined", () => {
  const payload = buildSavePayload({ questions: [{ question: "Why us?", answer: "" }] });
  assert.deepEqual(payload.selections, []);
  assert.deepEqual(payload.fieldValues, []);
  assert.deepEqual(payload.files, []);
  assert.equal(payload.state, "filled");
});

test("a malformed stored snapshot degrades to empty groups rather than throwing", () => {
  const payload = buildSavePayload({
    stored: { selections: "not a list", fieldValues: null, files: 42 },
    questions: [],
  });
  assert.deepEqual(payload.selections, []);
  assert.deepEqual(payload.fieldValues, []);
  assert.deepEqual(payload.files, []);
});

test("maxWords is a UI concern and never reaches the report", () => {
  // It is derived from the question text for the word counter. Writing it into
  // the section would record it as something the employer asked for.
  const payload = buildSavePayload({
    questions: [{ question: "Under 150 words.", answer: "Short.", maxWords: 150 }],
  });
  assert.deepEqual(payload.freeText, [{ question: "Under 150 words.", answer: "Short." }]);
});

test("a missing answer is written as an empty string, not undefined", () => {
  const payload = buildSavePayload({ questions: [{ question: "Why us?" }] });
  assert.equal(payload.freeText[0].answer, "");
});

// mayReplaceSection guards the one path that got past everything above.
//
// buildSavePayload can only carry across what the reader handed it. When the
// reader was unavailable - an older application-answers.mjs that can still be
// written to but exports no parseApplicationAnswersSection, which the route
// treats as a normal expected state - it hands back empty lists that look
// exactly like a genuinely empty section. Writing those deletes the selections,
// the field values and the uploaded CV, and drops a submitted section back to
// filled. The same loss, arriving through the door that skipped the lock.

test("a section that was read is safe to replace", () => {
  assert.equal(mayReplaceSection({ readable: true, present: true }), true);
});

test("a report with no section yet is safe to write for the first time", () => {
  // Nothing to destroy, so an unavailable reader must not block the first save.
  assert.equal(mayReplaceSection({ readable: false, present: false }), true);
  assert.equal(mayReplaceSection({ readable: true, present: false }), true);
});

test("a section that exists and was NOT read must not be replaced", () => {
  assert.equal(
    mayReplaceSection({ readable: false, present: true }),
    false,
    "saving here would write empty selections, field values and files over real ones",
  );
});

test("only a literal true counts as readable", () => {
  // The route builds this object by hand. A missing or truthy-ish flag must fail
  // closed, the same way needs_confirmation is tested strictly elsewhere.
  for (const sloppy of [undefined, null, 1, "true", {}]) {
    assert.equal(
      mayReplaceSection({ readable: sloppy, present: true }),
      false,
      `readable: ${JSON.stringify(sloppy)} must not be read as "we know what is there"`,
    );
  }
});
