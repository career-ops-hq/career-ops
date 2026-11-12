// tests/gemini-score-summary.test.mjs: gemini-eval and batch-evaluate-gemini
// read a SCORE_SUMMARY whose keys the model bolded, as openai-eval and
// ollama-eval do since #6332.
//
// Both read each key with `^KEY:`, so `**COMPANY:** Marrowfield Grocers` was
// no key at all. gemini-eval's shape check then reported every field missing
// and threw the evaluation away (exit 1, no report), and the batch wrote a
// tracker row for company and role "unknown". Both now read the block with
// lib/tracker-addition.mjs's parseScoreSummary().
//
// Neither run leaves the machine: gemini-eval gets a preload that answers the
// Gemini API's request, and the batch's processOffer() is given a fake browser
// and the model reply directly.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sandboxes = [];
after(() => { for (const d of sandboxes) rmSync(d, { recursive: true, force: true, maxRetries: 10 }); });

const BLOCKS = ['A) Role summary', 'B) CV match', 'C) Level', 'D) Comp', 'E) Personalization', 'F) Interview', 'G) Legitimacy']
  .map((h) => `## ${h}\nNotes.\n`).join('\n');
const BOLD = `${BLOCKS}
---SCORE_SUMMARY---
**COMPANY:** Marrowfield Grocers
**ROLE:** Senior Data Analyst
- **SCORE**: 4.3/5
**ARCHETYPE:** Data Analyst
**LEGITIMACY:** High Confidence
---END_SUMMARY---
`;
const JD = 'Senior Data Analyst at Marrowfield Grocers. Own the pricing dashboards and the forecasting models behind them.';

/** A data root with what the evaluators read before calling the model. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'co-gemini-summary-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# Test Candidate\n\n## Experience\n');
  writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Candidate\n');
  writeFileSync(join(dir, 'modes', '_profile.md'), '# Profile\n');
  writeFileSync(join(dir, 'jd.txt'), JD);
  return dir;
}

const env = (dir, extra = {}) => ({
  PATH: process.env.PATH, HOME: dir, CAREER_OPS_ROOT: dir, MODEL_REPLY: BOLD, ...extra,
});

/** The one tracker addition a run wrote, as { label: value }. */
function addition(dir) {
  const additionsDir = join(dir, 'batch', 'tracker-additions');
  const files = existsSync(additionsDir) ? readdirSync(additionsDir).filter((f) => f.endsWith('.tsv')) : [];
  if (files.length !== 1) return null;
  const [labels, row] = readFileSync(join(additionsDir, files[0]), 'utf-8').trim().split('\n').map((l) => l.split('\t'));
  return Object.fromEntries(labels.map((label, i) => [label, row[i]]));
}

test('gemini-eval keeps an evaluation whose summary keys are bolded, with clean tracker cells', () => {
  const dir = sandbox();
  const hook = join(dir, 'gemini-fetch.mjs');
  writeFileSync(hook, `
globalThis.fetch = async (url) => {
  if (String(url).includes(':countTokens')) return Response.json({ totalTokens: 1 });
  return Response.json({
    candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: process.env.MODEL_REPLY }] } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  });
};
`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'gemini-eval.mjs'), '--file', join(dir, 'jd.txt')], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000, env: env(dir, { GEMINI_API_KEY: 'test-key-not-real' }),
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(-1200));
  const reports = readdirSync(join(dir, 'reports')).filter((f) => f.endsWith('.md') && !f.endsWith('-RESERVED.md'));
  assert.equal(reports.length, 1, 'the report should be saved');
  assert.match(reports[0], /-marrowfield-grocers-/);
  assert.match(readFileSync(join(dir, 'reports', reports[0]), 'utf-8'), /\*\*Score:\*\* 4\.3\/5\n/);
  const row = addition(dir);
  assert.deepEqual({ company: row?.company, role: row?.role, score: row?.score },
    { company: 'Marrowfield Grocers', role: 'Senior Data Analyst', score: '4.3/5' });
});

test('batch-evaluate-gemini reads a bolded summary into clean tracker cells', () => {
  const dir = sandbox();
  const runner = join(dir, 'run-offer.mjs');
  writeFileSync(runner, `
const { processOffer } = await import(process.argv[2]);
const url = 'https://jobs.example.com/marrowfield/42';
const page = {
  route: async () => {}, goto: async () => {}, url: () => url, waitForTimeout: async () => {},
  evaluate: async () => ${JSON.stringify(JD)}.repeat(3), close: async () => {},
};
const result = await processOffer({ newPage: async () => page }, '- [ ] ' + url + ' | Marrowfield Grocers | Senior Data Analyst', 1,
  async () => process.env.MODEL_REPLY, async () => ({ result: 'active' }));
process.stdout.write('RESULT ' + JSON.stringify(result) + '\\n');
`);
  const r = spawnSync(process.execPath, [runner, pathToFileURL(join(ROOT, 'batch-evaluate-gemini.mjs')).href], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000, env: env(dir),
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(-1200));
  assert.match(r.stdout, /RESULT \{"line":"- \[x\]/, `the offer was not processed:\n${r.stdout.slice(-600)}`);
  const row = addition(dir);
  assert.deepEqual({ company: row?.company, role: row?.role, score: row?.score },
    { company: 'Marrowfield Grocers', role: 'Senior Data Analyst', score: '4.3/5' });
});
