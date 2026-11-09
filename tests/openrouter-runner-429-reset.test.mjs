// tests/openrouter-runner-429-reset.test.mjs — a model's 429 count is reset
// when it answers, so only CONSECUTIVE 429s blacklist it.
//
// openrouter-runner.mjs documents the rule ("auto-blacklist after 3 consecutive
// 429s") but rateLimitCounts[model] was only ever incremented. Three scattered
// 429s over a batch, with successful answers in between, blacklisted a model
// that was working, and the entry was persisted to data/model-blacklist.json for
// every later run.
//
// fetch() is scripted per model, so no network is used. The blacklist file is
// written under a throwaway data root.
//
// Run:  node --test tests/openrouter-runner-429-reset.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const MODEL_A = 'google/model-a:free';
const MODEL_B = 'qwen/model-b:free';

/** A scripted fetch: `script[model]` is the queue of statuses that model returns. */
function scriptedFetch(models, script) {
  const queues = Object.fromEntries(Object.entries(script).map(([m, q]) => [m, [...q]]));
  return async (url, init) => {
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: models.map((id) => ({ id, pricing: { prompt: '0', completion: '0' } })),
        }),
      };
    }
    const { model } = JSON.parse(init.body);
    const status = queues[model]?.shift() ?? 200;
    if (status !== 200) {
      return { ok: false, status, text: async () => (status === 429 ? 'rate limited' : 'server error') };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: `answer from ${model}` } }], usage: {} }),
    };
  };
}

/**
 * Import a fresh copy of the runner with the data root and the OpenRouter env
 * pointed at a throwaway directory. The blacklist path is resolved at import
 * time, so the environment has to be in place first; the query string keeps each
 * call on its own module instance (own rotation index, counters and model list).
 */
async function loadRunner(dataRoot, label) {
  const names = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_MODEL', 'OPENROUTER_API_KEY'];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.CAREER_OPS_ROOT = dataRoot;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_MODEL;
  process.env.OPENROUTER_API_KEY = 'test-key';
  try {
    const url = `${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?429-reset=${label}`;
    return await import(url);
  } finally {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  }
}

/** Call the runner once; return the error message, or null when it answered. */
async function callOnce(runner) {
  try {
    await runner.callOpenRouter('system', 'user');
    return null;
  } catch (e) {
    return e.message;
  }
}

async function withRunner(label, models, script, body) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-429-'));
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENROUTER_API_KEY;
  try {
    const runner = await loadRunner(dataRoot, label);
    globalThis.fetch = scriptedFetch(models, script);
    process.env.OPENROUTER_API_KEY = 'test-key';
    await body(runner, join(dataRoot, 'data', 'model-blacklist.json'));
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = realKey;
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('429, success, 429, success, 429 does not blacklist the model', async () => {
  await withRunner('scattered', [MODEL_A], { [MODEL_A]: [429, 200, 429, 200, 429] }, async (runner, file) => {
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await callOnce(runner));

    assert.deepEqual(outcomes.map((o) => o === null), [false, true, false, true, false]);
    assert.equal(runner.blacklistedModels.has(MODEL_A), false, 'three non-consecutive 429s blacklisted a working model');
    assert.equal(existsSync(file), false, 'the blacklist file was written');
  });
});

test('three consecutive 429s still blacklist the model and persist it', async () => {
  await withRunner('consecutive', [MODEL_A], { [MODEL_A]: [429, 429, 429] }, async (runner, file) => {
    await callOnce(runner);
    await callOnce(runner);
    assert.equal(runner.blacklistedModels.has(MODEL_A), false, 'blacklisted before the third 429');
    assert.equal(existsSync(file), false);

    await callOnce(runner);
    assert.equal(runner.blacklistedModels.has(MODEL_A), true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), [MODEL_A]);
  });
});

test('429, 500, 429, 429 does not blacklist the model', async () => {
  // The 500 breaks the run, so the last two 429s are only two in a row.
  await withRunner('other-failure', [MODEL_A], { [MODEL_A]: [429, 500, 429, 429] }, async (runner, file) => {
    for (let i = 0; i < 4; i++) assert.notEqual(await callOnce(runner), null);

    assert.equal(runner.blacklistedModels.has(MODEL_A), false, 'a 500 between 429s did not reset the count');
    assert.equal(existsSync(file), false, 'the blacklist file was written');
  });
});

test('a 500 after two 429s resets the count to the next 429', async () => {
  await withRunner('reset-by-500', [MODEL_A], { [MODEL_A]: [429, 429, 500, 429] }, async (runner, file) => {
    for (let i = 0; i < 4; i++) assert.notEqual(await callOnce(runner), null);

    assert.equal(runner.rateLimitCounts[MODEL_A], 1);
    assert.equal(runner.blacklistedModels.has(MODEL_A), false);
    assert.equal(existsSync(file), false);
  });
});

test('the 429 count is kept per model', async () => {
  // A answers 429 twice; B answers 429 once and then succeeds. Three 429s in
  // total, but no single model reaches three.
  await withRunner(
    'per-model',
    [MODEL_A, MODEL_B],
    { [MODEL_A]: [429, 429], [MODEL_B]: [429] },
    async (runner, file) => {
      assert.notEqual(await callOnce(runner), null, 'both models answer 429 on the first call');
      assert.equal(await callOnce(runner), null, 'B answers on the second call');

      assert.equal(runner.rateLimitCounts[MODEL_A], 2);
      assert.equal(runner.blacklistedModels.size, 0, '429s on one model counted toward another');
      assert.equal(existsSync(file), false);
    },
  );
});
