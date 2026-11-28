import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMatchScore,
  validatePatchPayload,
  validateKitContent,
  MAX_COVER_LETTER,
} from "../../src/lib/application-kit-contract.mjs";

test("application-kit scores preserve missing values", () => {
  assert.equal(normalizeMatchScore(undefined), null);
  assert.equal(normalizeMatchScore("5"), null);
  assert.equal(normalizeMatchScore(0), 0);
  assert.equal(normalizeMatchScore(3.5), 3.5);
  assert.equal(normalizeMatchScore(8), 5);
});

test("application-kit PATCH validation accepts the editable kit shape", () => {
  const result = validatePatchPayload({
    id: "kit-1",
    coverLetter: "Hello",
    outreach: { postApplicationEmail: "Thanks" },
    answers: [{ question: "Why?", answer: "Because", needsConfirmation: false }],
    cvFile: "data/application-kits/kit-1-cv.md",
  });
  assert.deepEqual(result.value.id, "kit-1");
  assert.equal(result.value.answers[0].answer, "Because");
});

test("application-kit PATCH validation normalizes Windows backslashes in cvFile", () => {
  const result = validatePatchPayload({
    id: "kit-windows",
    cvFile: "data\\application-kits\\kit-windows-cv.md",
  });
  assert.equal(result.value.cvFile, "data/application-kits/kit-windows-cv.md");
});

test("application-kit PATCH validation rejects malformed, unexpected, and oversized values", () => {
  const cases = [
    {},
    { id: "kit-1", coverLetter: { text: "wrong" } },
    { id: "kit-1", outreach: { unexpected: "wrong" } },
    { id: "kit-1", answers: [{ question: "Why?", answer: 42 }] },
    { id: "kit-1", cvFile: "../../outside.md" },
    { id: "kit-1", extra: true },
    { id: "kit-1", coverLetter: "x".repeat(40_001) },
  ];
  for (const input of cases) assert.ok(validatePatchPayload(input).error);
});

test("validateKitContent validates generated kit against shared limits", () => {
  const valid = {
    coverLetter: "Truthful cover letter",
    outreach: { linkedinRecruiterNote: "Hello recruiter" },
    answers: [{ question: "Years of experience?", answer: "5 years", needsConfirmation: false }],
  };
  assert.equal(validateKitContent(valid).ok, true);

  const oversizedLetter = { coverLetter: "x".repeat(MAX_COVER_LETTER + 1) };
  assert.ok(validateKitContent(oversizedLetter).error);

  const invalidOutreach = { outreach: { unknownField: "bad" } };
  assert.ok(validateKitContent(invalidOutreach).error);

  const tooManyAnswers = {
    answers: Array.from({ length: 101 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` })),
  };
  assert.ok(validateKitContent(tooManyAnswers).error);
});
