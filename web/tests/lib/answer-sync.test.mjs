// Drafting is allowed up to 320 seconds. The answer boxes stay editable for all
// of it, so the response that comes back is an answer to a question the list may
// no longer be asking.
//
// The request carried a snapshot taken when the button was pressed. Assigning
// the response straight into state replaced every keystroke typed since with the
// older text - silently, all at once, at the moment the draft landed, which is
// exactly when the candidate has stopped watching the screen. Losing an answer
// someone wrote by hand is worse than not drafting one at all.
//
// sameAnswers is the other half of the same problem. "Saved" is a claim about a
// file on disk, and as a boolean flag it was one forgotten `setSaved(false)`
// away from being a lie. As a comparison it cannot drift.
//
// Run:  node --test tests/lib/answer-sync.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDraftedAnswers, sameAnswers } from "../../src/lib/apply/answer-sync.mjs";

const q = (question, answer = "") => ({ question, answer });

test("a blank answer takes the draft", () => {
  const sent = [q("Why us?"), q("What did you build?")];
  const out = mergeDraftedAnswers({
    sent,
    current: [q("Why us?"), q("What did you build?")],
    incoming: [q("Why us?", "Because of the platform work."), q("What did you build?", "A scanner.")],
  });
  assert.deepEqual(out.map((x) => x.answer), ["Because of the platform work.", "A scanner."]);
});

test("an answer typed while the draft ran is NOT overwritten", () => {
  const sent = [q("Why us?"), q("What did you build?")];
  const out = mergeDraftedAnswers({
    sent,
    // The candidate answered the second one by hand while waiting.
    current: [q("Why us?"), q("What did you build?", "My own words.")],
    incoming: [q("Why us?", "Because of the platform work."), q("What did you build?", "A scanner.")],
  });
  assert.deepEqual(out.map((x) => x.answer), ["Because of the platform work.", "My own words."]);
});

test("a question added while the request ran survives, unfilled", () => {
  const out = mergeDraftedAnswers({
    sent: [q("Why us?")],
    current: [q("Why us?"), q("Pasted mid-draft")],
    incoming: [q("Why us?", "Because of the platform work.")],
  });
  assert.deepEqual(out.map((x) => x.question), ["Why us?", "Pasted mid-draft"]);
  assert.equal(out[1].answer, "");
});

test("a question removed while the request ran stays removed", () => {
  // The response still carries it. The candidate deleted it on purpose, and a
  // merge that resurrects a deleted question is its own kind of data loss.
  const out = mergeDraftedAnswers({
    sent: [q("Why us?"), q("Delete me")],
    current: [q("Why us?")],
    incoming: [q("Why us?", "Because of the platform work."), q("Delete me", "Drafted anyway.")],
  });
  assert.deepEqual(out.map((x) => x.question), ["Why us?"]);
});

test("position is irrelevant; questions are paired by their text", () => {
  // The route re-validates through sanitizeQuestions, which can drop an entry, so
  // index i on one side is not index i on the other.
  const out = mergeDraftedAnswers({
    sent: [q("Dropped by the route"), q("Why us?")],
    current: [q("Dropped by the route"), q("Why us?")],
    incoming: [q("Why us?", "Because of the platform work.")],
  });
  assert.deepEqual(out.map((x) => x.answer), ["", "Because of the platform work."]);
});

test("two identical questions are paired in order, first with first", () => {
  const out = mergeDraftedAnswers({
    sent: [q("Tell us more"), q("Tell us more")],
    current: [q("Tell us more"), q("Tell us more", "typed by hand")],
    incoming: [q("Tell us more", "draft one"), q("Tell us more", "draft two")],
  });
  assert.deepEqual(out.map((x) => x.answer), ["draft one", "typed by hand"]);
});

test("fields the merge does not own are carried through untouched", () => {
  const out = mergeDraftedAnswers({
    sent: [{ question: "Why us?", answer: "", maxWords: 150 }],
    current: [{ question: "Why us?", answer: "", maxWords: 150 }],
    incoming: [{ question: "Why us?", answer: "Because of the platform work." }],
  });
  assert.equal(out[0].maxWords, 150, "the word counter must not reset when a draft lands");
});

test("missing arguments produce an empty list rather than a crash", () => {
  assert.deepEqual(mergeDraftedAnswers({}), []);
});

test("the inputs are not mutated", () => {
  const sent = [q("Why us?")];
  const current = [q("Why us?")];
  const incoming = [q("Why us?", "Because of the platform work.")];
  mergeDraftedAnswers({ sent, current, incoming });
  assert.deepEqual(sent, [q("Why us?")]);
  assert.deepEqual(current, [q("Why us?")]);
  assert.deepEqual(incoming, [q("Why us?", "Because of the platform work.")]);
});

test("after a clean merge the screen still matches what was written", () => {
  // The two functions have to agree: when nothing was edited in flight, the merge
  // returns the response, so the panel says Saved. This is the pairing the Save
  // button's honesty rests on.
  const incoming = [q("Why us?", "Because of the platform work.")];
  const merged = mergeDraftedAnswers({ sent: [q("Why us?")], current: [q("Why us?")], incoming });
  assert.equal(sameAnswers(incoming, merged), true);
});

test("after a merge that kept an edit, the screen does NOT match what was written", () => {
  const incoming = [q("Why us?", "Because of the platform work.")];
  const merged = mergeDraftedAnswers({ sent: [q("Why us?")], current: [q("Why us?", "mine")], incoming });
  assert.equal(sameAnswers(incoming, merged), false);
});

test("sameAnswers ignores maxWords, which is derived and never stored", () => {
  assert.equal(
    sameAnswers([{ question: "Why us?", answer: "a" }], [{ question: "Why us?", answer: "a", maxWords: 150 }]),
    true,
  );
});

test("sameAnswers is false on any real difference", () => {
  const base = [q("Why us?", "a"), q("And?", "b")];
  assert.equal(sameAnswers(base, [q("Why us?", "a"), q("And?", "CHANGED")]), false, "an edited answer");
  assert.equal(sameAnswers(base, [q("Why us?", "a")]), false, "a removed question");
  assert.equal(sameAnswers(base, [q("And?", "b"), q("Why us?", "a")]), false, "a reordered list");
  assert.equal(sameAnswers(base, [q("Why us?", "a"), q("Different?", "b")]), false, "an edited question");
});

test("sameAnswers with nothing on disk is false, not a crash", () => {
  // Nothing saved yet and "the screen has moved on" are the same answer for the
  // caller: do not claim this report holds what is on screen.
  assert.equal(sameAnswers(null, [q("Why us?")]), false);
  assert.equal(sameAnswers(undefined, []), false);
  assert.equal(sameAnswers([], []), true, "two empty lists genuinely do match");
});
