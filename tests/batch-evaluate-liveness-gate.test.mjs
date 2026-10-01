// tests/batch-evaluate-liveness-gate.test.mjs — the #4364 fix.
//
// modes/oferta.md's liveness gate tells the model to stop before Block A and
// emit no score at all for a dead posting. batch-evaluate-gemini.mjs's parser
// used to treat ANY missing ---SCORE_SUMMARY--- block as a hard error — so a
// legitimate liveness-gate exit never got its pipeline.md line resolved, and
// was retried (and re-billed) on every subsequent run, indefinitely.
//
// Same harness shape as tests/batch-evaluate.test.mjs (mock browser + a
// scripted _evaluate response), but scoped to this one behavior.

import { pass, fail, rmSync } from './helpers.mjs';
import { processOffer, PATHS } from '../batch-evaluate-gemini.mjs';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nbatch-evaluate-liveness-gate.test.mjs — dead posting is not a failure (#4364)');

const mockBrowser = {
  newPage: async () => ({
    url: () => 'https://example.com/job',
    route: async () => {},
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => 'Valid JD Text of sufficient length (more than 100 characters). '.repeat(5),
    close: async () => {},
  }),
};

async function withScratchPaths(fn) {
  const work = mkdtempSync(join(tmpdir(), 'cops-batcheval-liveness-'));
  const oldReports = PATHS.reports;
  const oldAdditions = PATHS.trackerAdditions;
  // Capture whether each var was set at all, not just its value: `delete`
  // unconditionally (the previous version of this fixture) clobbers a
  // pre-existing value from the environment or an earlier-run sibling
  // fixture with "unset" instead of putting back what was actually there.
  const hadReportsDirEnv = Object.prototype.hasOwnProperty.call(process.env, 'CAREER_OPS_REPORTS_DIR');
  const oldReportsDirEnv = process.env.CAREER_OPS_REPORTS_DIR;
  const hadTrackerEnv = Object.prototype.hasOwnProperty.call(process.env, 'CAREER_OPS_TRACKER');
  const oldTrackerEnv = process.env.CAREER_OPS_TRACKER;
  try {
    PATHS.reports = join(work, 'reports');
    PATHS.trackerAdditions = join(work, 'tracker-additions');
    mkdirSync(work, { recursive: true });
    writeFileSync(
      join(work, 'applications.md'),
      '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n',
    );
    process.env.CAREER_OPS_REPORTS_DIR = PATHS.reports;
    process.env.CAREER_OPS_TRACKER = join(work, 'applications.md');
    await fn(work);
  } finally {
    PATHS.reports = oldReports;
    PATHS.trackerAdditions = oldAdditions;
    if (hadReportsDirEnv) process.env.CAREER_OPS_REPORTS_DIR = oldReportsDirEnv;
    else delete process.env.CAREER_OPS_REPORTS_DIR;
    if (hadTrackerEnv) process.env.CAREER_OPS_TRACKER = oldTrackerEnv;
    else delete process.env.CAREER_OPS_TRACKER;
    rmSync(work, { recursive: true, force: true });
  }
}

// ── 1. The exact reported shape: the model's own liveness-gate narration ───
await withScratchPaths(async (work) => {
  // Verbatim (trimmed) from the issue's own reproduction log.
  const mockEvaluate = async () =>
    'The job posting at the provided URL (**Product Manager - AI Platform (m/f/x)** at **Scalable GmbH**) has expired and is no longer accepting applications\n'
    + '> **Notice on page:** *"This job has expired / Sorry, this job has expired"*\n'
    + 'Per the **Liveness Gate** rules, evaluation stops here before Block A. No evaluation, report, or CV customization will be generated for an expired posting.';

  const inputLine = '- [ ] https://example.com/job | Scalable GmbH | Product Manager - AI Platform';
  const result = await processOffer(mockBrowser, inputLine, 1, mockEvaluate);

  if (result.processed && result.line === '- [x] ~~Scalable GmbH | Product Manager - AI Platform~~ — oferta nieaktywna') {
    pass('a liveness-gate exit is processed (not retried) and marked with the oferta.md strikethrough convention');
  } else {
    fail(`#4364 case 1: expected processed strikethrough line, got ${JSON.stringify(result)}`);
  }

  // The success path's mkdirSync(PATHS.reports) never runs on this exit, so
  // an untouched scratch dir has no reports directory at all — the strongest
  // possible form of "no report or PDF is generated" (oferta.md's own words).
  const reports = existsSync(PATHS.reports)
    ? readdirSync(PATHS.reports).filter((f) => !f.includes('-RESERVED.md'))
    : [];
  if (reports.length === 0) {
    pass('no report or PDF is generated for a dead posting (oferta.md: "Do not generate an evaluation, report, or CV")');
  } else {
    fail(`#4364 case 1: expected no report written, got ${JSON.stringify(reports)}`);
  }
});

// ── 2. A genuinely malformed model response is STILL a real failure ────────
//    The regression this fix must not introduce: swallowing a real parse
//    error as if it were a liveness-gate exit just because it is also short.
await withScratchPaths(async () => {
  const mockEvaluate = async () => 'Sure, here is my analysis of the role.';
  const inputLine = '- [ ] https://example.com/job | Acme Corp | Backend Engineer';

  let threw = false;
  let result = null;
  try {
    result = await processOffer(mockBrowser, inputLine, 1, mockEvaluate);
  } catch {
    threw = true;
  }
  // processOffer itself catches internally and returns {processed:false} —
  // it never throws out to the caller — but the line must stay unmarked.
  if (!threw && result && result.processed === false && result.line === inputLine) {
    pass('a genuinely malformed response (no score, no expiry signal) is still reported as unprocessed');
  } else {
    fail(`#4364 case 2: expected {processed:false, line unchanged}, got threw=${threw} result=${JSON.stringify(result)}`);
  }
});

// ── 3. Ordinary prose that happens to be short is NOT a dead-posting signal ─
//    Guards the deliberate choice to use hasHardExpiredSignal(), not
//    classifyLiveness()'s MIN_CONTENT_CHARS heuristic — that heuristic is
//    valid for a scraped PAGE (a short page really is suspicious) but not for
//    an LLM response, which can be short for any number of unrelated reasons.
await withScratchPaths(async () => {
  const mockEvaluate = async () => 'Short reply with no expiry language at all.';
  const inputLine = '- [ ] https://example.com/job | Acme Corp | Backend Engineer';
  const result = await processOffer(mockBrowser, inputLine, 1, mockEvaluate);
  if (result.processed === false) {
    pass('a short-but-unrelated response is not misread as a liveness-gate exit');
  } else {
    fail(`#4364 case 3: expected processed:false, got ${JSON.stringify(result)}`);
  }
});
