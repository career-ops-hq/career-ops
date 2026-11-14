// tests/openrouter-runner-finish-reason.test.mjs — openrouter-runner saves only
// a reply that finished, as openai-eval (#3949) and openai-tailor already do.
//
// The runner read choices[0].message.content and never looked at
// finish_reason. A reply cut off at max_tokens still carries the block
// headings and the score line that validateEvaluationResponse checks, so it
// was saved as the report, written to the tracker additions with that score,
// and its pipeline entry was checked off as evaluated. A reply with no
// finish_reason is still accepted: some servers omit the field, and nothing
// then says the reply stopped early.
//
// Run: node --test tests/openrouter-runner-finish-reason.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const MODEL_A = 'google/model-a:free';
const MODEL_B = 'qwen/model-b:free';

const EVALUATION = `**Score:** 4.2/5
**Decision:** Apply
**Legitimacy:** High Confidence

## A) Role Summary
Backend platform role focusing on distributed systems in Go and Node.js.

## B) Match with CV
| Requirement | Match | Evidence |
|---|---|---|
| Node.js | Strong | cv.md: five years of Node.js services |

## C) Level and Strategy
Targeted at senior level with solid engineering ownership.

## D) Comp and Demand
Salary benchmark 120-140k EUR, in line with the market.

## E) Customization Plan
Lead with backend scale and high-throughput queue work.

## F) Interview Plan
Prepare STAR stories on distributed systems troubleshooting.

## G) Posting Legitimacy
Verified direct company board with transparent company information.

## Verdict
Apply: strong match on the core stack.
`;

// The same reply, stopped mid-sentence in Block G the way one cut at
// max_tokens is: every heading and the score line are already there.
const CUT_OFF = EVALUATION.slice(0, EVALUATION.indexOf('transparent company'));

const JD = 'Acme is hiring a Senior Backend Engineer to build and run its payments APIs in Go and Node.js. '.repeat(3);
const CTX = { cv: '# Test Candidate', profile: '', shared: '', profileMode: '' };

/** A fetch that answers each chat request with the next scripted choice for its model. */
function replyFetch(models, replies) {
  const queues = Object.fromEntries(Object.entries(replies).map(([m, q]) => [m, [...q]]));
  return async (url, init) => {
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: models.map((id) => ({ id, pricing: { prompt: '0', completion: '0' } })) }),
      };
    }
    const { model } = JSON.parse(init.body);
    const choice = queues[model].shift();
    return { ok: true, status: 200, json: async () => ({ choices: [choice], usage: {} }) };
  };
}

const choice = (content, extra) => ({ index: 0, message: { role: 'assistant', content }, ...extra });

/**
 * Import a fresh copy of the runner with its data root in a throwaway
 * directory, run `body`, and restore fetch and the environment. The data root
 * is resolved at import time; the query string gives each call its own module
 * instance (own rotation index and model list).
 */
// Every CAREER_OPS_* variable is cleared for the run, not only the root: an
// inherited CAREER_OPS_TRACKER outranks the temporary root, so the report-number
// reservation would read and lock the developer's own tracker.
const isRunnerEnv = (n) => n.startsWith('CAREER_OPS_') || n === 'OPENROUTER_API_KEY';

async function withRunner(label, { pinned = null, fetchImpl }, body) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-or-finish-'));
  const inherited = Object.fromEntries(Object.keys(process.env).filter(isRunnerEnv).map((n) => [n, process.env[n]]));
  const realFetch = globalThis.fetch;
  try {
    for (const n of Object.keys(inherited)) delete process.env[n];
    process.env.CAREER_OPS_ROOT = dataRoot;
    process.env.OPENROUTER_API_KEY = 'test-key';
    const runner = await import(`${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?finish-reason=${label}`);
    if (pinned) process.env.CAREER_OPS_MODEL = pinned;
    globalThis.fetch = fetchImpl;
    await body(runner, dataRoot);
  } finally {
    globalThis.fetch = realFetch;
    for (const n of Object.keys(process.env).filter(isRunnerEnv)) delete process.env[n];
    Object.assign(process.env, inherited);
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const saved = (dataRoot, dir) => (existsSync(join(dataRoot, dir)) ? readdirSync(join(dataRoot, dir)).filter((f) => /\.(md|tsv)$/.test(f)) : []);

for (const reason of ['length', 'content_filter', 'error']) {
  test(`a reply that ends with finish_reason "${reason}" is not saved as the report`, async () => {
    const fetchImpl = replyFetch([MODEL_A], { [MODEL_A]: [choice(CUT_OFF, { finish_reason: reason })] });
    await withRunner(`pinned-${reason}`, { pinned: MODEL_A, fetchImpl }, async (runner, dataRoot) => {
      const res = await runner.cmdEvaluate(JD, CTX);
      assert.notEqual(res?.success, true, `a reply that stopped on "${reason}" was reported as a finished evaluation`);
      assert.deepEqual(saved(dataRoot, 'reports'), [], 'a report was saved from the cut-off reply');
      assert.deepEqual(saved(dataRoot, join('batch', 'tracker-additions')), [], 'a tracker addition was written from the cut-off reply');
    });
  });
}

test('the error names the finish reason', async () => {
  const fetchImpl = replyFetch([MODEL_A], { [MODEL_A]: [choice(CUT_OFF, { finish_reason: 'length' })] });
  await withRunner('pinned-message', { pinned: MODEL_A, fetchImpl }, async (runner) => {
    await assert.rejects(runner.callOpenRouter('system', 'user'), /finish_reason "length"/);
  });
});

test('in rotation, a cut-off reply moves on to the next model', async () => {
  const fetchImpl = replyFetch([MODEL_A, MODEL_B], {
    [MODEL_A]: [choice(CUT_OFF, { finish_reason: 'length' })],
    [MODEL_B]: [choice(EVALUATION, { finish_reason: 'stop' })],
  });
  await withRunner('rotation', { fetchImpl }, async (runner) => {
    const { content } = await runner.callOpenRouter('system', 'user');
    assert.equal(content, EVALUATION, 'the cut-off reply from the first model was returned');
  });
});

// A finished reply is saved, and so is one from a server that omits the field.
for (const [label, extra] of [['finish_reason "stop"', { finish_reason: 'stop' }], ['no finish_reason', {}], ['finish_reason null', { finish_reason: null }]]) {
  test(`a reply with ${label} is saved as the report`, async () => {
    const fetchImpl = replyFetch([MODEL_A], { [MODEL_A]: [choice(EVALUATION, extra)] });
    await withRunner(`pinned-ok-${label.replace(/\W+/g, '-')}`, { pinned: MODEL_A, fetchImpl }, async (runner, dataRoot) => {
      const res = await runner.cmdEvaluate(JD, CTX);
      assert.equal(res?.success, true, `a finished reply (${label}) was not saved`);
      const reports = saved(dataRoot, 'reports');
      assert.equal(reports.length, 1, 'expected exactly one report');
      // Numbered from the temporary data root alone: an inherited tracker would push it past 001.
      assert.match(reports[0], /^001-/, `report numbered from a tracker outside the data root: ${reports[0]}`);
    });
  });
}
