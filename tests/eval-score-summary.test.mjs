// tests/eval-score-summary.test.mjs: openai-eval and ollama-eval read the
// model's SCORE_SUMMARY block, and write no tracker row they cannot fill.
//
// Both evaluators read each key with `KEY:\s*(.+)`. A local model that bolds
// the keys (`**COMPANY:** Marrowfield Grocers`) produced the company
// "** Marrowfield Grocers" and the score "** 4.3/5/5". A model that skipped the
// block produced a tracker addition for company "unknown", role "unknown",
// which merge-tracker then adds as a real row.
//
// Run:  node --test tests/eval-score-summary.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseScoreSummary } from '../lib/tracker-addition.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sandboxes = [];
after(() => { for (const d of sandboxes) rmSync(d, { recursive: true, force: true, maxRetries: 10 }); });

const BLOCKS = 'A) Role summary\nB) CV match\nC) Level\nD) Comp\nE) Personalization\nF) Interview\nG) Legitimacy\n';
const PLAIN = `${BLOCKS}
---SCORE_SUMMARY---
COMPANY: Marrowfield Grocers
ROLE: Senior Data Analyst
SCORE: 4.3
ARCHETYPE: Data Analyst
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
const BOLD = `${BLOCKS}
---SCORE_SUMMARY---
**COMPANY:** Marrowfield Grocers
**ROLE:** Senior Data Analyst
- **SCORE**: 4.3/5
**ARCHETYPE:** Data Analyst
**LEGITIMACY:** High Confidence
---END_SUMMARY---
`;
const NO_BLOCK = `${BLOCKS}\n**Overall score: 4.3/5.** Worth applying.\n`;

test('parseScoreSummary reads plain keys', () => {
  assert.deepEqual(parseScoreSummary(PLAIN), {
    company: 'Marrowfield Grocers', role: 'Senior Data Analyst', score: '4.3',
    archetype: 'Data Analyst', legitimacy: 'High Confidence',
  });
});

test('parseScoreSummary drops bold and bullet marks and a trailing /5', () => {
  assert.deepEqual(parseScoreSummary(BOLD), parseScoreSummary(PLAIN));
});

test('parseScoreSummary drops a /5 that ends the sentence, and keeps any other scale', () => {
  const score = (line) => parseScoreSummary(`---SCORE_SUMMARY---\nSCORE: ${line}\n---END_SUMMARY---`).score;
  assert.equal(score('4.3/5.'), '4.3');
  assert.equal(score('4.3 / 5 (strong fit)'), '4.3 (strong fit)');
  assert.equal(score('4.2/10'), '4.2/10');
  assert.equal(score('4.2/5.5'), '4.2/5.5');
});

test('parseScoreSummary returns null without a block and empty strings for absent keys', () => {
  assert.equal(parseScoreSummary(NO_BLOCK), null);
  const partial = parseScoreSummary('---SCORE_SUMMARY---\nSCORE: 3.1\n---END_SUMMARY---');
  assert.equal(partial.company, '');
  assert.equal(partial.role, '');
  assert.equal(partial.score, '3.1');
});

const hook = (dir) => {
  const file = join(dir, 'fetch.mjs');
  writeFileSync(file, `
globalThis.fetch = async (url) => {
  const text = process.env.MODEL_REPLY;
  if (String(url).endsWith('/api/tags')) return Response.json({ models: [] });
  if (String(url).endsWith('/api/chat')) {
    return new Response(JSON.stringify({ message: { content: text } }) + '\\n' + JSON.stringify({ done: true }) + '\\n');
  }
  return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\\n\\ndata: [DONE]\\n\\n');
};
`);
  return file;
};

function evaluate(script, reply) {
  const dir = mkdtempSync(join(tmpdir(), 'co-summary-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'reports'), { recursive: true });
  const args = script === 'openai-eval.mjs' ? ['--url', 'http://localhost:1234/v1'] : [];
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(hook(dir)).href, join(ROOT, script), ...args,
    'Fictional job description for a Senior Data Analyst at Marrowfield Grocers.',
  ], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000,
    env: {
      PATH: process.env.PATH, HOME: dir, CAREER_OPS_ROOT: dir, MODEL_REPLY: reply,
      CAREER_OPS_REPORTS_DIR: join(dir, 'reports'),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const additionsDir = join(dir, 'batch', 'tracker-additions');
  const additions = existsSync(additionsDir) ? readdirSync(additionsDir).filter((f) => f.endsWith('.tsv')) : [];
  const reports = readdirSync(join(dir, 'reports')).filter((f) => f.endsWith('.md') && !f.endsWith('-RESERVED.md'));
  return {
    out: r.stdout + r.stderr,
    reports,
    tsv: additions.length ? readFileSync(join(additionsDir, additions[0]), 'utf-8') : null,
  };
}

for (const script of ['openai-eval.mjs', 'ollama-eval.mjs']) {
  test(`${script} reads a bolded summary into clean tracker cells`, () => {
    const { tsv, reports } = evaluate(script, BOLD);
    assert.ok(tsv, 'no tracker addition was written');
    const [labels, row] = tsv.trim().split('\n').map((l) => l.split('\t'));
    const cell = (name) => row[labels.indexOf(name)];
    assert.equal(cell('company'), 'Marrowfield Grocers');
    assert.equal(cell('role'), 'Senior Data Analyst');
    assert.equal(cell('score'), '4.3/5');
    assert.match(reports[0], /-marrowfield-grocers-/);
  });

  test(`${script} keeps the report but writes no tracker row without a summary`, () => {
    const { tsv, reports, out } = evaluate(script, NO_BLOCK);
    assert.equal(reports.length, 1, 'the report should still be saved');
    assert.equal(tsv, null, `a tracker addition was written:\n${tsv}`);
    assert.match(out, /no tracker row/i);
  });
}
