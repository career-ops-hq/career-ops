// questions.mjs turns a paste into the list of questions an employer asked, and
// re-validates whatever arrives at /api/answers. Both the panel and the route
// call it, which is the point: two implementations would eventually disagree
// about what a question is, and the disagreement would show up as a question the
// user typed and the report never stored.
//
// The splitting rule is the subtle one. A single question routinely wraps over
// several lines ("Describe a workflow you have changed using AI.\nUnder 150
// words."), so a paste that uses blank lines splits on blank lines, and only a
// paste without them splits per line. Getting that backwards silently shears
// every multi-line question in half, and the half carrying the word cap is the
// half that gets lost.
//
// Run:  node --test tests/lib/questions.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { splitQuestions, wordCapFrom, sanitizeQuestions, MAX_QUESTIONS } from "../../src/lib/apply/questions.mjs";

test("a blank-line-separated paste keeps each multi-line question whole", () => {
  const paste = "Describe a workflow you changed using AI.\nUnder 150 words.\n\nWhy us?";
  assert.deepEqual(splitQuestions(paste), [
    "Describe a workflow you changed using AI. Under 150 words.",
    "Why us?",
  ]);
});

test("a paste with no blank lines is one question per line", () => {
  assert.deepEqual(splitQuestions("Why us?\nWhy now?\nWhy you?"), ["Why us?", "Why now?", "Why you?"]);
});

test("list markers people paste out of a form are stripped", () => {
  assert.deepEqual(splitQuestions("1. Why us?\n- Why now?\n* Why you?\n2) Why here?"), [
    "Why us?",
    "Why now?",
    "Why you?",
    "Why here?",
  ]);
});

test("empty and whitespace-only pastes yield nothing rather than a blank question", () => {
  for (const empty of ["", "   \n\n  \n", null, undefined]) {
    assert.deepEqual(splitQuestions(empty), [], `${JSON.stringify(empty)} should split to []`);
  }
});

test("CRLF pastes split the same as LF", () => {
  assert.deepEqual(splitQuestions("Why us?\r\nWhy now?"), splitQuestions("Why us?\nWhy now?"));
});

test("a stated word cap is read out of the question, in the spellings forms actually use", () => {
  const capped = {
    "Describe it. Under 150 words.": 150,
    "Max 200 words please": 200,
    "Maximum of 250 words": 250,
    "No more than 300 words": 300,
    "Answer within 120 words": 120,
    "500 words or fewer": 500,
    "400 words or less": 400,
    "350 words maximum": 350,
  };
  for (const [text, expected] of Object.entries(capped)) {
    assert.equal(wordCapFrom(text), expected, `"${text}" should report a cap of ${expected}`);
  }
});

test("a question with no cap reports undefined, and an absurd cap is ignored", () => {
  assert.equal(wordCapFrom("Why us?"), undefined);
  // The counter is advisory. A five-digit "cap" is far likelier to be a stray
  // number in the question than a real limit, and showing it as one is worse
  // than showing none.
  assert.equal(wordCapFrom("Under 99999 words"), undefined);
});

test("the cap is never used to truncate: sanitize keeps the answer whole", () => {
  const long = "word ".repeat(300).trim();
  const [q] = sanitizeQuestions([{ question: "Under 150 words.", answer: long }]);
  assert.equal(q.maxWords, 150);
  assert.equal(q.answer, long, "the candidate's answer must survive intact, over the cap or not");
});

test("questions with no text are dropped rather than kept as empty prompts", () => {
  const out = sanitizeQuestions([{ question: "  ", answer: "orphan" }, { question: "Why us?", answer: "" }, null, "nope", 7]);
  assert.deepEqual(out, [{ question: "Why us?", answer: "" }]);
});

test("a missing answer becomes an empty string, not undefined", () => {
  const [q] = sanitizeQuestions([{ question: "Why us?" }]);
  assert.equal(q.answer, "");
});

test("one oversized paste cannot blow up a report", () => {
  const many = Array.from({ length: MAX_QUESTIONS + 25 }, (_, i) => ({ question: `Q${i}`, answer: "" }));
  assert.equal(sanitizeQuestions(many).length, MAX_QUESTIONS);

  const [huge] = sanitizeQuestions([{ question: "Q".repeat(9000), answer: "A".repeat(90_000) }]);
  assert.equal(huge.question.length, 2000);
  assert.equal(huge.answer.length, 20_000);
});

test("a non-array body yields no questions instead of throwing", () => {
  for (const bad of [null, undefined, "questions", 42, { question: "Why us?" }]) {
    assert.deepEqual(sanitizeQuestions(bad), [], `${JSON.stringify(bad)} should sanitize to []`);
  }
});

test("maxWords is omitted, not set to undefined, when the question states no cap", () => {
  // The key reaches the report payload; an explicit undefined would serialize
  // differently from an absent one across the JSON round trip.
  const [q] = sanitizeQuestions([{ question: "Why us?", answer: "" }]);
  assert.ok(!("maxWords" in q));
});
