import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMatchScore, validatePatchPayload } from "../../src/lib/application-kit-contract.mjs";

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
