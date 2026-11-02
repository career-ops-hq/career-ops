// tests/direct-eval-jd-archive.test.mjs — the evaluators that call a model API
// directly write the verbatim JD archive into the report (#2789).
//
// gemini-eval.mjs, batch-evaluate-gemini.mjs and openrouter-runner.mjs built
// the report from a fixed header plus the model's text. The JD text was in
// scope in each one but never written, so check-jd-archive.mjs flagged every
// report from these paths as missing-jd-archive. They now append it through
// lib/jd-archive-section.mjs, deterministically rather than by asking the model.
//
// Each path is run for real with the model stubbed: batch-evaluate-gemini
// through its exported processOffer, the two CLIs through a preloaded fetch
// stub. Each resulting reports/ dir is then handed to check-jd-archive.mjs.
//
// Run:  node --test tests/direct-eval-jd-archive.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withJdArchiveSection, JD_ARCHIVE_HEADING } from '../lib/jd-archive-section.mjs';
import { hasEmbeddedJdArchive, extractStrippedJdSection } from '../check-jd-archive.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Carries its own "## " sub-heading: the archive must survive it verbatim.
const JD = [
  'Acme Corp is hiring a Senior Platform Engineer to own our deployment tooling.',
  '',
  '## Responsibilities',
  '- Build and run the internal deploy pipeline across three regions.',
  '- Mentor two engineers and review infrastructure changes.',
].join('\n');

const TRACKER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n';

const BLOCKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((b) => `## ${b}) Block ${b}\n\nNotes for block ${b}.`).join('\n\n');
const SUMMARY = '---SCORE_SUMMARY---\nCOMPANY: Acme Corp\nROLE: Senior Platform Engineer\nSCORE: 4.2\nARCHETYPE: Platform\nLEGITIMACY: High Confidence\n---END_SUMMARY---';

function workdir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cops-eval-jdarchive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'jds'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  writeFileSync(join(dir, 'cv.md'), '# Test Candidate\n\n## Experience\n\n### Example Co — Remote\n**Engineer**\n2020 – 2024\n');
  return dir;
}

// Every path the evaluators resolve, pinned to `dir`. CAREER_OPS_ROOT outranks
// CAREER_OPS_DATA_DIR, and test-all.mjs sets it in its own process, so an
// inherited value would send the report somewhere this test never looks.
function envFor(dir, extra) {
  return {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_DATA_DIR: dir,
    CAREER_OPS_REPORTS_DIR: join(dir, 'reports'),
    CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
    CAREER_OPS_BATCH_STATE: join(dir, 'batch-state.tsv'),
    ...extra,
  };
}

// A preload that answers every fetch with `text` as the model's reply, in the
// response shape of the API the URL names.
function writeFetchStub(dir, text) {
  const stub = join(dir, 'fetch-stub.mjs');
  writeFileSync(stub, `
const TEXT = ${JSON.stringify(text)};
globalThis.fetch = async (url) => {
  const body = String(url).includes('generateContent')
    ? { candidates: [{ content: { role: 'model', parts: [{ text: TEXT }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } }
    : { choices: [{ message: { role: 'assistant', content: TEXT } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
`);
  return stub;
}

function onlyReport(dir, log) {
  const reports = readdirSync(join(dir, 'reports')).filter((f) => f.endsWith('.md') && !/-RESERVED\.md$/.test(f));
  assert.equal(reports.length, 1, `expected one report:\n${log}`.slice(0, 1500));
  return readFileSync(join(dir, 'reports', reports[0]), 'utf-8');
}

// The validator itself, as CI and verify-pipeline run it, not just its export.
function assertCheckPasses(dir) {
  const r = spawnSync(process.execPath, [join(ROOT, 'check-jd-archive.mjs'), '--no-tracker',
    '--reports-dir', join(dir, 'reports'), '--jds-dir', join(dir, 'jds')], { encoding: 'utf-8', timeout: 30_000 });
  assert.equal(r.status, 0, `check-jd-archive.mjs failed:\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /missing-jd-archive/);
}

function assertArchivesJd(report, jd) {
  assert.ok(hasEmbeddedJdArchive(report), `no credited JD archive:\n${report}`);
  assert.equal(extractStrippedJdSection(report), jd.trim(), 'the archived section is not the JD verbatim');
  assert.equal(report.split(JD_ARCHIVE_HEADING).length, 2, 'expected exactly one archive heading');
}

test('withJdArchiveSection appends the JD when the model wrote no section', () => {
  const out = withJdArchiveSection('## A) Role\n\nFit is strong.', JD);
  assertArchivesJd(out, JD);
  assert.ok(out.startsWith('## A) Role\n\nFit is strong.\n\n'), 'the model text must come first, unchanged');
});

test('withJdArchiveSection replaces a model-written section in place', () => {
  const model = '## A) Role\n\nFit.\n\n## Job Description (archived verbatim)\n\nThis is a paraphrase of the posting, not the verbatim text.\n\n## Machine Summary\n\n```yaml\nscore: 4\n```';
  const out = withJdArchiveSection(model, JD);
  assertArchivesJd(out, JD);
  assert.doesNotMatch(out, /paraphrase/);
  assert.match(out, /## Machine Summary\n\n```yaml\nscore: 4\n```$/, 'the sections after it must survive');
});

test('withJdArchiveSection leaves the report alone when there is no JD text', () => {
  assert.equal(withJdArchiveSection('## A) Role', '  \n'), '## A) Role');
});

test('batch-evaluate-gemini writes the scraped JD into the report', (t) => {
  const dir = workdir(t);
  const driver = join(dir, 'driver.mjs');
  writeFileSync(driver, `
const { processOffer, PATHS } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'batch-evaluate-gemini.mjs')).href)});
PATHS.reports = ${JSON.stringify(join(dir, 'reports'))};
PATHS.trackerAdditions = ${JSON.stringify(join(dir, 'tracker-additions'))};
const browser = { newPage: async () => ({
  url: () => 'https://example.com/job', route: async () => {}, goto: async () => {},
  waitForTimeout: async () => {}, evaluate: async () => ${JSON.stringify(JD)}, close: async () => {},
}) };
const evaluate = async () => ${JSON.stringify(`${BLOCKS}\n\n${SUMMARY}`)};
const live = async () => ({ result: 'active' });
await processOffer(browser, '- [ ] https://example.com/job | Acme Corp | Senior Platform Engineer', 1, evaluate, live);
`);
  const r = spawnSync(process.execPath, [driver], {
    cwd: dir, encoding: 'utf-8', timeout: 90_000,
    env: envFor(dir, {}),
  });
  const report = onlyReport(dir, `${r.stdout}${r.stderr}`);
  assertArchivesJd(report, JD);
  assertCheckPasses(dir);
});

test('gemini-eval writes the JD it was given into the report', (t) => {
  const dir = workdir(t);
  const jdFile = join(dir, 'jd.txt');
  writeFileSync(jdFile, JD);
  const stub = writeFetchStub(dir, `${BLOCKS}\n\n${SUMMARY}`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, join(ROOT, 'gemini-eval.mjs'), '--file', jdFile], {
    cwd: dir, encoding: 'utf-8', timeout: 90_000,
    env: envFor(dir, { GEMINI_API_KEY: 'test-key' }),
  });
  const report = onlyReport(dir, `${r.stdout}${r.stderr}`);
  assertArchivesJd(report, JD);
  assertCheckPasses(dir);
});

test('openrouter-runner archives the pasted JD over a model-written paraphrase', (t) => {
  const dir = workdir(t);
  // modes/oferta.md, its system prompt, asks the model for this section; a
  // model that restates the posting there must not be what gets archived.
  const reply = `**Score:** 4.2/5\n\n${BLOCKS}\n\n## Job Description (archived verbatim)\n\nThis is a paraphrase of the posting, not the verbatim text.\n`;
  const stub = writeFetchStub(dir, reply);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, join(ROOT, 'openrouter-runner.mjs'), 'evaluate', JD], {
    cwd: dir, encoding: 'utf-8', timeout: 90_000,
    env: envFor(dir, { OPENROUTER_API_KEY: 'test-key', CAREER_OPS_MODEL: 'test/model' }),
  });
  const report = onlyReport(dir, `${r.stdout}${r.stderr}`);
  assertArchivesJd(report, JD);
  assert.doesNotMatch(report, /paraphrase/);
  assertCheckPasses(dir);
});
