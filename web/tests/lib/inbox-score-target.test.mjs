import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxScoreTarget } from "../../src/lib/inbox-score-target.mjs";

const base = { jobId: "job-1", running: false, score: null, reportN: null };

test("an unscored row is not evaluated", () => {
  assert.deepEqual(inboxScoreTarget(undefined), { evaluated: false, href: null, showScore: false });
  assert.deepEqual(inboxScoreTarget(base), { evaluated: false, href: null, showScore: false });
});

test("a running evaluation stays on the worker log", () => {
  assert.deepEqual(inboxScoreTarget({ ...base, running: true, score: 4, reportN: 21 }), {
    evaluated: true,
    href: "/jobs/job-1",
    showScore: false,
  });
});

test("a finished score without a report stays on the worker log", () => {
  assert.deepEqual(inboxScoreTarget({ ...base, score: 4 }), {
    evaluated: true,
    href: "/jobs/job-1",
    showScore: true,
  });
});

test("a saved report opens the pipeline page", () => {
  assert.deepEqual(inboxScoreTarget({ ...base, score: 4.2, reportN: 21 }), {
    evaluated: true,
    href: "/pipeline/21",
    showScore: true,
  });
});

test("a saved report with no parsed score still opens the pipeline page", () => {
  assert.deepEqual(inboxScoreTarget({ ...base, reportN: 21 }), {
    evaluated: true,
    href: "/pipeline/21",
    showScore: false,
  });
});
