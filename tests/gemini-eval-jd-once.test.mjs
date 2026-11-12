// tests/gemini-eval-jd-once.test.mjs: gemini-eval sends the job description
// to Gemini once, as openai-eval and ollama-eval do since #3950.
//
// buildBudgetedPrompt() puts the JD in the context it returns unless told
// otherwise, and gemini-eval used that context as its systemInstruction while
// also sending the JD as the user turn. Every evaluation paid for the JD twice.
//
// A preload answers the Gemini API and writes the request it was sent to a
// file, so nothing leaves the machine and the test reads exactly what the SDK
// would have sent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sandboxes = [];
after(() => { for (const d of sandboxes) rmSync(d, { recursive: true, force: true, maxRetries: 10 }); });

const MARKER = 'JD-MARKER-7f3a9c: build the pricing dashboards behind every weekly grocery promotion.';
const REPLY = ['A) Role summary', 'B) CV match', 'C) Level', 'D) Comp', 'E) Personalization', 'F) Interview', 'G) Legitimacy']
  .map((h) => `## ${h}\nNotes.\n`).join('\n')
  + '\n---SCORE_SUMMARY---\nCOMPANY: Marrowfield Grocers\nROLE: Senior Data Analyst\nSCORE: 4.3\nARCHETYPE: Data Analyst\nLEGITIMACY: High Confidence\n---END_SUMMARY---\n';

test('gemini-eval sends the job description once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-gemini-jd-once-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# Test Candidate\n\n## Experience\n');
  writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Candidate\n');
  writeFileSync(join(dir, 'modes', '_profile.md'), '# Profile\n');
  writeFileSync(join(dir, 'jd.txt'), `Senior Data Analyst at Marrowfield Grocers.\n\n${MARKER}\n`);
  const captured = join(dir, 'request.json');
  const hook = join(dir, 'gemini-fetch.mjs');
  writeFileSync(hook, `
import { writeFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  if (String(url).includes(':countTokens')) return Response.json({ totalTokens: 1 });
  writeFileSync(process.env.CAPTURE, String(init?.body ?? ''));
  return Response.json({
    candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: process.env.MODEL_REPLY }] } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  });
};
`);
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(hook).href, join(ROOT, 'gemini-eval.mjs'), '--no-save', '--file', join(dir, 'jd.txt'),
  ], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000,
    env: {
      PATH: process.env.PATH, HOME: dir, CAREER_OPS_ROOT: dir, GEMINI_API_KEY: 'test-key-not-real',
      MODEL_REPLY: REPLY, CAPTURE: captured,
    },
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(-1200));
  const body = readFileSync(captured, 'utf-8');
  const count = body.split('JD-MARKER-7f3a9c').length - 1;
  assert.equal(count, 1, `the JD reached Gemini ${count} times`);
  const request = JSON.parse(body);
  const userText = (request.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? '').join('');
  assert.ok(userText.includes(MARKER), 'the user turn carries the JD');
});
