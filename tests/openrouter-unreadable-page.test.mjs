// tests/openrouter-unreadable-page.test.mjs — openrouter-runner evaluates only
// a page that holds a job description, and saves nothing when the model says it
// could not evaluate one (#5809).
//
// The runner sent whatever text a page had to the model: a 404, a bot wall, or
// a Workday posting that had not rendered yet (only its footer). Every reply
// became a report and a tracker row, and `pipeline` marked the row done, so the
// posting looked evaluated although nobody had read it.
//
// Run:  node --test tests/openrouter-unreadable-page.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unreadableJobPage } from '../openrouter-runner.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const URL_ = 'https://boards.example.com/acme/jobs/48213';

const JD = [
  'Senior Platform Engineer at Acme Corp.',
  'You will own the internal deploy pipeline across three regions, review infrastructure changes,',
  'and mentor two engineers. We are looking for five or more years of experience running',
  'production systems on Kubernetes, solid Go or Rust, and a habit of writing things down.',
  'The role is remote within Europe and reports to the Head of Infrastructure. Apply now.',
].join(' ');

test('a page with a job description is evaluated', () => {
  assert.equal(unreadableJobPage({ status: 200, requestedUrl: URL_, finalUrl: URL_, text: JD }), null);
});

test('error pages, bot walls and unrendered pages are not', () => {
  const cases = {
    'HTTP 404': { status: 404, text: 'Not Found' },
    'HTTP 403 bot wall': { status: 403, text: 'Just a moment... Checking your browser before accessing.' },
    'bot wall served as 200': { status: 200, text: 'Just a moment... Performing security verification. Ray ID: 8f2a1c' },
    'Workday footer only': { status: 200, text: 'Skip to main content Loading Follow Us © 2026 Workday, Inc. All rights reserved.' },
    'empty page': { status: 200, text: '' },
  };
  for (const [name, page] of Object.entries(cases)) {
    assert.ok(unreadableJobPage({ requestedUrl: URL_, finalUrl: URL_, ...page }), `${name} was treated as a job description`);
  }
});

function workdir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cops-or-unreadable-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n');
  writeFileSync(join(dir, 'cv.md'), '# Test Candidate\n');
  return dir;
}

// Answers every fetch, the OpenRouter call included, with `reply` as the model's text.
function writeFetchStub(dir, reply) {
  const stub = join(dir, 'fetch-stub.mjs');
  writeFileSync(stub, `
const TEXT = ${JSON.stringify(reply)};
globalThis.fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content: TEXT } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}), { status: 200, headers: { 'content-type': 'application/json' } });
`);
  return stub;
}

function evaluate(t, reply) {
  const dir = workdir(t);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(writeFetchStub(dir, reply)).href, join(ROOT, 'openrouter-runner.mjs'), 'evaluate', JD], {
    cwd: dir, encoding: 'utf-8', timeout: 90_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: dir,
      CAREER_OPS_DATA_DIR: dir,
      CAREER_OPS_REPORTS_DIR: join(dir, 'reports'),
      CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
      CAREER_OPS_BATCH_STATE: join(dir, 'batch-state.tsv'),
      OPENROUTER_API_KEY: 'test-key',
      CAREER_OPS_MODEL: 'test/model',
    },
  });
  const saved = readdirSync(join(dir, 'reports')).filter((f) => f.endsWith('.md') && !f.endsWith('-RESERVED.md'));
  let additions = [];
  try { additions = readdirSync(join(dir, 'batch', 'tracker-additions')); } catch { /* never created */ }
  return { saved, additions, log: `${r.stdout}${r.stderr}` };
}

for (const [name, reply] of Object.entries({
  'a dead-posting marker': 'The page has no job description.\n\n---DEAD_POSTING---\n',
  'a needs_confirmation line': 'I could not read a job description on this page.\n\nneeds_confirmation: jd_unavailable - paste the posting text and rerun',
})) {
  test(`a reply with ${name} saves no report or tracker row`, (t) => {
    const { saved, additions, log } = evaluate(t, reply);
    assert.deepEqual(saved, [], log);
    assert.deepEqual(additions, [], log);
    assert.match(log, /Not evaluated/);
  });
}

test('a scored reply is still saved', (t) => {
  const { saved, additions, log } = evaluate(t, '**Score:** 4.2/5\n\nA solid match.');
  assert.equal(saved.length, 1, log);
  assert.equal(additions.length, 1, log);
});
