// Tests for the cover letter answers a cover run keeps (#7441).
//
// Run:  node --test tests/lib/cover-answers.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COVER_QUESTIONS, coverAnswersText, storedCoverBrief } from "../../src/lib/cover-answers.mjs";
import { parseCoverRequest } from "../../src/lib/cover-brief.mjs";
import { restoreStoredJobs } from "../../src/lib/jobs-persist.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIEF = {
  why: "Their platform team runs the training cluster I want to own.",
  problem: "Model rollouts take days.",
  approach: "Map the rollout path in week one.",
  tone: "direct",
};

test("storedCoverBrief: reads back the answers a cover job kept", () => {
  assert.deepEqual(storedCoverBrief(BRIEF), BRIEF);
});

test("storedCoverBrief: a job saved before answers were kept has none", () => {
  for (const value of [undefined, null, "why", 42, [], {}]) {
    assert.equal(storedCoverBrief(value), null, `${JSON.stringify(value)} should have no answers`);
  }
});

test("storedCoverBrief: answers that are all blank are not shown", () => {
  assert.equal(storedCoverBrief({ why: " ", problem: "", approach: "\n", tone: "formal" }), null);
});

test("storedCoverBrief: a stored value that is not text reads as unanswered", () => {
  assert.deepEqual(storedCoverBrief({ ...BRIEF, problem: { text: "x" } }), { ...BRIEF, problem: "" });
});

test("storedCoverBrief: a tone the form does not offer is dropped, inherited keys included", () => {
  for (const tone of ["playful", "constructor", "toString", 3]) {
    assert.equal(storedCoverBrief({ ...BRIEF, tone })?.tone, null, `tone ${String(tone)}`);
  }
});

test("coverAnswersText: letters the answers as modes/cover.md Step 6 asks for them", () => {
  assert.equal(
    coverAnswersText(BRIEF),
    [
      "A. Why this role or company?\nTheir platform team runs the training cluster I want to own.",
      "B. What problem would you solve for them?\nModel rollouts take days.",
      "C. How would you approach it on day one?\nMap the rollout path in week one.",
      "D. Tone\nDirect",
    ].join("\n\n"),
  );
});

test("coverAnswersText: a blank answer is marked and an unknown tone is left out", () => {
  const text = coverAnswersText({ ...BRIEF, approach: "  ", tone: null });
  assert.match(text, /C\. How would you approach it on day one\?\n\(no answer\)$/);
  assert.doesNotMatch(text, /D\. Tone/);
});

test("COVER_QUESTIONS: the form's fields are the ones the route accepts", () => {
  // The form builds the brief from these names; parseCoverRequest refuses one
  // it does not recognise, so the two lists must not drift apart.
  const brief = Object.fromEntries([...COVER_QUESTIONS.map((q) => [q.name, `answer for ${q.name}`]), ["tone", "mirror"]]);
  const root = path.join(path.sep, "tmp", "career-ops");
  const result = parseCoverRequest({ input: "41", brief, root, findReportFile: () => path.join(root, "reports", "041-acme.md") });
  assert.equal(result.ok, true);
});

test("restoreStoredJobs: a cover run cut off by a reload keeps its answers", () => {
  const [job] = restoreStoredJobs([{ id: "job-1", kind: "cover", status: "running", steps: [], brief: BRIEF }], 1);
  assert.equal(job.status, "error");
  assert.deepEqual(storedCoverBrief(job.brief), BRIEF);
});

test("wiring: the job keeps the brief, the run page shows it and the form refills from it", () => {
  const store = readFileSync(path.join(webRoot, "src/components/jobs/job-store.tsx"), "utf8");
  assert.match(store, /brief: opts\.brief \? \{ \.\.\.opts\.brief \} : undefined/);

  const page = readFileSync(path.join(webRoot, "src/app/jobs/[id]/page.tsx"), "utf8");
  assert.match(page, /job\.kind === "cover" && <CoverAnswers brief=\{job\.brief\} \/>/);

  const form = readFileSync(path.join(webRoot, "src/components/cover-draft-button.tsx"), "utf8");
  assert.match(form, /savedBrief \?\? storedCoverBrief\(job\?\.brief\)/);
  assert.match(form, /defaultValue=\{prefill\?\.\[q\.name\]/);
});
