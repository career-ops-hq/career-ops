import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const form = read("../../src/components/manual-job-form.tsx");
const result = read("../../src/components/manual-job-result.tsx");
const jobStore = read("../../src/components/jobs/job-store.tsx");
const route = read("../../src/app/api/jobs/manual/preview/route.ts");
const runRoute = read("../../src/app/api/run/route.ts");
const documents = read("../../src/lib/documents.mjs");

test("Add Job Posting UI validates through the manual API then uses the existing evaluate worker", () => {
  assert.match(form, /\/api\/jobs\/manual\/preview/); assert.match(form, /kind: "evaluate"/); assert.match(form, /Evaluate Job/);
});
test("duplicate warnings require an explicit Evaluate Anyway action", () => assert.match(form, /Possible duplicate[\s\S]*Evaluate Anyway/));
test("manual evaluation does not expose submission or contact actions", () => {
  assert.doesNotMatch(form + result, /click Apply|submit application|contact recruiter|send email/i);
  assert.match(form, /never submits or contacts an employer/i);
});
test("successful manual evaluation uses canonical report and tracker readers", () => {
  assert.match(route, /readApplications/); assert.match(result, /\/api\/jobs\/manual\/result/); assert.match(result, /Full evaluation report/);
});
test("tailored resume uses the existing application pdf worker and explicit cover draft option", () => {
  assert.match(result, /kind: "pdf"/); assert.match(result, /prepareCoverLetter: cover/);
  assert.match(jobStore, /cover-letter\/init/); assert.match(jobStore, /explicit: opts\.prepareCoverLetter/);
});
test("fact-gated application PDF pipeline and Documents discovery remain canonical", () => {
  assert.match(runRoute, /createCvEnvelopeFilter/); assert.match(runRoute, /renderAndMarkPdf/);
  assert.match(documents, /cv\\\/tailored\\\/v\\d\+\\\/cv\\\.pdf/);
});
test("manual UI never supplies arbitrary paths or versions", () => {
  assert.doesNotMatch(form + result, /outputPath|filePath|version:/);
  assert.match(runRoute, /Invalid manual job payload/);
});
test("existing General Role kind is not used by manual job resumes", () => assert.doesNotMatch(result, /kind: "role-resume"/));
test("manual runtime proves the isolated prompt and stdin handoff without logging content", () => {
  assert.match(runRoute, /manualPromptIsolationPresent: prompt\.includes\("MANUAL WEB WORKER ISOLATION"\)/);
  assert.match(runRoute, /manualPromptHasDescription: prompt\.includes\("THE JOB DESCRIPTION IS PRESENT BELOW"\)/);
  assert.match(runRoute, /manualPromptBlocksCareerOpsSkill:/);
  assert.match(runRoute, /manualPromptSha256/);
  assert.match(runRoute, /promptWrittenToStdin/);
  assert.match(runRoute, /args\.at\(-1\) === "-"/);
  assert.match(runRoute, /args\.includes\(prompt\)/);
});
test("manual Codex runs outside the repository instruction chain while retaining canonical access", () => {
  assert.match(runRoute, /career-ops-manual-worker-/);
  assert.match(runRoute, /additionalWritableDir: isolatedManualCodex \? projectRoot/);
  assert.match(runRoute, /Manual job description was not included in the evaluation prompt/);
});
