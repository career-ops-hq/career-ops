// Tests for the cover-letter request a web user sends from the report page.
//
// Run:  node --test tests/lib/cover-brief.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseCoverRequest } from "../../src/lib/cover-brief.mjs";

const ROOT = path.join(path.sep, "tmp", "career-ops");
const REPORT = path.join(ROOT, "reports", "041-acme-2026-10-01.md");
const findReportFile = (n) => (Number(n) === 41 ? REPORT : null);
const BRIEF = {
  why: "  Their platform team runs the training cluster I want to own.  ",
  problem: "Model rollouts take days.",
  approach: "Map the rollout path in week one.",
  tone: "direct",
};

test("parseCoverRequest: a full brief for an evaluated row resolves its report and trims the answers", () => {
  const result = parseCoverRequest({ input: "041", brief: BRIEF, root: ROOT, findReportFile });

  assert.deepEqual(result, {
    ok: true,
    reportFile: "reports/041-acme-2026-10-01.md",
    brief: {
      why: "Their platform team runs the training cluster I want to own.",
      problem: "Model rollouts take days.",
      approach: "Map the rollout path in week one.",
      tone: "direct",
    },
  });
});

test("parseCoverRequest: a blank answer is refused, because cover.md drafts nothing until all four are in", () => {
  const result = parseCoverRequest({ input: "041", brief: { ...BRIEF, approach: "   " }, root: ROOT, findReportFile });

  assert.deepEqual(result, { ok: false, error: "Answer all four cover letter questions first." });
});

test("parseCoverRequest: a tone the mode does not offer is refused", () => {
  const result = parseCoverRequest({ input: "041", brief: { ...BRIEF, tone: "playful" }, root: ROOT, findReportFile });

  assert.deepEqual(result, { ok: false, error: "Answer all four cover letter questions first." });
});

test("parseCoverRequest: a missing brief is refused", () => {
  const result = parseCoverRequest({ input: "041", brief: undefined, root: ROOT, findReportFile });

  assert.deepEqual(result, { ok: false, error: "Answer all four cover letter questions first." });
});

test("parseCoverRequest: an answer past the length cap is refused, not cut", () => {
  const result = parseCoverRequest({ input: "041", brief: { ...BRIEF, why: "x".repeat(1001) }, root: ROOT, findReportFile });

  assert.deepEqual(result, { ok: false, error: "Keep each answer to 1000 characters or fewer." });
});

test("parseCoverRequest: a row with no report asks for an evaluation first", () => {
  const result = parseCoverRequest({ input: "7", brief: BRIEF, root: ROOT, findReportFile });

  assert.deepEqual(result, { ok: false, error: "No report #7 found. Evaluate this posting first." });
});

test("parseCoverRequest: a selector that is not a bare number never reaches the report lookup", () => {
  const seen = [];
  const result = parseCoverRequest({
    input: "41/../../etc/passwd",
    brief: BRIEF,
    root: ROOT,
    findReportFile: (n) => (seen.push(n), REPORT),
  });

  assert.deepEqual(result, { ok: false, error: 'Invalid report selector: "41/../../etc/passwd"' });
  assert.deepEqual(seen, []);
});

test("parseCoverRequest: a non-string input is refused before the selector regex runs", () => {
  const result = parseCoverRequest({
    input: { toString: null },
    brief: BRIEF,
    root: ROOT,
    findReportFile,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid report selector: expected a report number string/);
});

test("parseCoverRequest: a non-string tone is refused as incomplete", () => {
  const result = parseCoverRequest({
    input: "041",
    brief: { ...BRIEF, tone: { toString: null } },
    root: ROOT,
    findReportFile,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Answer all four cover letter questions first.");
});
