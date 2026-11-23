// tests/gemini-eval-block-shape.test.mjs: gemini-eval refuses a reply that
// lacks one of the A-G evaluation blocks, even when a heading merely starts
// with that letter.
//
// validateEvaluationShape() matched each block with `#{1,3}\s*A[).:-]?` under
// the /i flag: the punctuation was optional and nothing followed the letter, so
// `## Analysis` counted as Block A, `## Background` as B ... `## Gaps` as G. A
// free-form reply with none of the blocks passed, and was saved as a report
// with a tracker row. openrouter-runner.mjs's validator has the guard
// (`A(?![A-Za-z0-9])`); gemini-eval now has it too.
//
// The run never leaves the machine: a preload answers the Gemini API request,
// and --no-save keeps the data root untouched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sandboxes = [];
after(() => { for (const d of sandboxes) rmSync(d, { recursive: true, force: true, maxRetries: 10 }); });

const SUMMARY = `---SCORE_SUMMARY---
COMPANY: Marrowfield Grocers
ROLE: Senior Data Analyst
SCORE: 4.1/5
ARCHETYPE: Data Analyst
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
const reply = (headings) => `${headings.map((h) => `## ${h}\nNotes.\n`).join('\n')}\n${SUMMARY}`;

const BLOCKS = ['A) Role Summary', 'B) Match with CV', 'C) Level and Strategy', 'D) Comp and Demand',
  'E) Customization Plan', 'F) Interview Plan', 'G) Posting Legitimacy'];

function runEval(modelReply) {
  const dir = mkdtempSync(join(tmpdir(), 'co-gemini-blocks-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# Test Candidate\n\n## Experience\n');
  writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Candidate\n');
  writeFileSync(join(dir, 'modes', '_profile.md'), '# Profile\n');
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
  return spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'gemini-eval.mjs'),
    '--no-save', 'Senior Data Analyst at Marrowfield Grocers. Own the pricing dashboards.'], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000,
    env: { PATH: process.env.PATH, HOME: dir, CAREER_OPS_ROOT: dir, GEMINI_API_KEY: 'test-key-not-real',
      DOTENV_CONFIG_QUIET: 'true', MODEL_REPLY: modelReply },
  });
}

test('a reply with all seven A-G blocks passes', () => {
  const r = runEval(reply(BLOCKS));
  assert.equal(r.status, 0, describeSpawn(r));
  assert.doesNotMatch(r.stderr, /failed validation/);
});

test('other heading spellings of the blocks still pass', () => {
  const r = runEval(reply(['A. Role Summary', 'Block B — Match with CV', 'C: Level and Strategy', 'D - Comp and Demand',
    'E) Customization Plan', 'F) Interview Plan', 'G) Posting Legitimacy']));
  assert.equal(r.status, 0, describeSpawn(r));
});

test('free-form headings that only start with A-G are not the blocks', () => {
  const r = runEval(reply(['Analysis', 'Background', 'Concerns', 'Details', 'Experience', 'Fit', 'Gaps']));
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /Gemini output failed validation: .*missing Block A; missing Block B; missing Block C; missing Block D; missing Block E; missing Block F; missing Block G/);
  assert.doesNotMatch(r.stdout, /CAREER-OPS EVALUATION/);
});

test('a reply missing only Block G is refused even with a "## Gaps" heading', () => {
  const r = runEval(reply([...BLOCKS.slice(0, 6), 'Gaps']));
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /Gemini output failed validation: .*missing Block G/);
  assert.doesNotMatch(r.stderr, /missing Block [A-F]/);
});
