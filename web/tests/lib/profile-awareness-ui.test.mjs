import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docs = readFileSync(new URL("../../src/components/documents-view.tsx", import.meta.url), "utf8");
const review = readFileSync(new URL("../../src/components/resume-update-review.tsx", import.meta.url), "utf8");
const cvRoute = readFileSync(new URL("../../src/app/api/cv/route.ts", import.meta.url), "utf8");
const profileRoute = readFileSync(new URL("../../src/app/api/profile-update/apply/route.ts", import.meta.url), "utf8");
const runRoute = readFileSync(new URL("../../src/app/api/run/route.ts", import.meta.url), "utf8");

test("Documents banner is conditional and links to review", () => { assert.match(docs, /staleCount > 0/); assert.match(docs, /Career Profile Updated/); assert.match(docs, /documents\/review-updates/); });
test("review requires preview and explicit approval", () => { assert.match(review, /update-preview/); assert.match(review, /Approve &amp; Generate/); assert.match(review, /Cancel/); assert.match(review, /no relevant resume changes/i); });
test("skip is session-only state", () => { assert.match(review, /useState<string\[\]>\(\[\]\)/); assert.doesNotMatch(review, /localStorage|\/api\/.*skip/); });
test("both approved structured updates and manual CV saves advance profile state", () => { assert.match(profileRoute, /advanceProfileState/); assert.match(cvRoute, /advanceProfileState/); });
test("resume generation still uses existing fact-gated workers", () => { assert.match(review, /kind: "role-resume" \| "pdf"/); assert.match(runRoute, /validateRoleResumeHtml/); assert.match(runRoute, /renderAndMarkPdf/); });
test("Ready-to-Apply and cover workflows are not called by update review", () => { assert.doesNotMatch(review, /ready-to-apply|documents\/copy|cover-letter/); });
test("Review Resumes regeneration uses the same role-resume source-loading path", () => { assert.match(review, /kind: "role-resume" \| "pdf"/); assert.match(runRoute, /loadRoleResumeSource\(careerOpsRoot\(\)\)/); assert.match(runRoute, /roleSourceCv: roleSource\?\.cv/); });
test("Review Resume Updates reaches the corrected Codex stdin transport", () => { assert.match(review, /startJob\(/); assert.match(runRoute, /promptViaStdin/); assert.match(runRoute, /stdinMode: "pipe"/); });
