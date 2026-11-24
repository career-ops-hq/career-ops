// tests/openrouter-runner-max-tokens.test.mjs — openrouter-runner reads its output
// cap from CAREER_OPS_MAX_TOKENS, as openai-eval.mjs and openai-tailor.mjs do.
//
// The runner sent a fixed max_tokens of 8192. A reasoning model pinned with
// CAREER_OPS_MODEL (z-ai/glm-5.3-flash, for one) spends that much thinking
// through a full A-G evaluation and answers with empty content and
// finish_reason "length". The runner checked the content first, so every
// evaluation failed as "Empty response", with nothing to say that a larger cap
// fixes it and no way to set one. The same model evaluates the same posting
// through openai-eval.mjs, whose cap defaults to 32768.
//
// Run: node --test tests/openrouter-runner-max-tokens.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const MODEL_A = 'google/model-a:free';
const MODEL_B = 'qwen/model-b:free';
const REPLY = '**Score:** 4.0/5\n\n## A) Role Summary\nok\n';

const choice = (content, finish_reason = 'stop') => ({ index: 0, message: { role: 'assistant', content }, finish_reason });

/** A fetch that records each chat request body and answers with the next scripted choice for its model. */
function recordingFetch(models, replies, requests) {
  const queues = Object.fromEntries(Object.entries(replies).map(([m, q]) => [m, [...q]]));
  return async (url, init) => {
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: models.map((id) => ({ id, pricing: { prompt: '0', completion: '0' } })) }),
      };
    }
    const body = JSON.parse(init.body);
    requests.push(body);
    return { ok: true, status: 200, json: async () => ({ choices: [queues[body.model].shift()], usage: {} }) };
  };
}

// Every CAREER_OPS_* variable is cleared for the run, as in
// openrouter-runner-finish-reason.test.mjs: an inherited one would leak the
// developer's own cap, model or data root into the test.
const isRunnerEnv = (n) => n.startsWith('CAREER_OPS_') || n === 'OPENROUTER_API_KEY';

async function withRunner(label, { pinned = null, maxTokens, fetchImpl }, body) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-or-max-tokens-'));
  const inherited = Object.fromEntries(Object.keys(process.env).filter(isRunnerEnv).map((n) => [n, process.env[n]]));
  const realFetch = globalThis.fetch;
  try {
    for (const n of Object.keys(inherited)) delete process.env[n];
    process.env.CAREER_OPS_ROOT = dataRoot;
    process.env.CAREER_OPS_BATCH_STATE = join(dataRoot, 'batch-state.tsv');
    process.env.OPENROUTER_API_KEY = 'test-key';
    const runner = await import(`${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?max-tokens=${label}`);
    // Set after the import: the runner loads .env after its own import, so the
    // cap has to be read on each call, not once at module load.
    if (pinned) process.env.CAREER_OPS_MODEL = pinned;
    if (maxTokens !== undefined) process.env.CAREER_OPS_MAX_TOKENS = maxTokens;
    globalThis.fetch = fetchImpl;
    await body(runner);
  } finally {
    globalThis.fetch = realFetch;
    for (const n of Object.keys(process.env).filter(isRunnerEnv)) delete process.env[n];
    Object.assign(process.env, inherited);
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

for (const mode of ['pinned', 'rotation']) {
  const pinned = mode === 'pinned' ? MODEL_A : null;

  test(`${mode}: without CAREER_OPS_MAX_TOKENS the cap stays at 8192`, async () => {
    const requests = [];
    const fetchImpl = recordingFetch([MODEL_A], { [MODEL_A]: [choice(REPLY)] }, requests);
    await withRunner(`${mode}-default`, { pinned, fetchImpl }, async (runner) => {
      await runner.callOpenRouter('system', 'user');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].max_tokens, 8192);
    });
  });

  test(`${mode}: CAREER_OPS_MAX_TOKENS sets the max_tokens sent`, async () => {
    const requests = [];
    const fetchImpl = recordingFetch([MODEL_A], { [MODEL_A]: [choice(REPLY)] }, requests);
    await withRunner(`${mode}-override`, { pinned, maxTokens: ' 32768 ', fetchImpl }, async (runner) => {
      await runner.callOpenRouter('system', 'user');
      assert.equal(requests[0].max_tokens, 32768);
    });
  });
}

for (const bad of ['8k', '0', '-1', '1.5', '99999999999999999999']) {
  test(`an invalid CAREER_OPS_MAX_TOKENS ("${bad}") keeps the default and warns`, async () => {
    const requests = [];
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const fetchImpl = recordingFetch([MODEL_A], { [MODEL_A]: [choice(REPLY), choice(REPLY)] }, requests);
      await withRunner(`invalid-${bad}`, { pinned: MODEL_A, maxTokens: bad, fetchImpl }, async (runner) => {
        await runner.callOpenRouter('system', 'user');
        await runner.callOpenRouter('system', 'user');
      });
    } finally {
      console.warn = realWarn;
    }
    assert.deepEqual(requests.map((r) => r.max_tokens), [8192, 8192]);
    const hits = warnings.filter((w) => w.includes('CAREER_OPS_MAX_TOKENS'));
    assert.equal(hits.length, 1, `expected one warning for the same bad value, got: ${JSON.stringify(warnings)}`);
  });
}

test('an empty CAREER_OPS_MAX_TOKENS counts as unset', async () => {
  const requests = [];
  const fetchImpl = recordingFetch([MODEL_A], { [MODEL_A]: [choice(REPLY)] }, requests);
  await withRunner('empty', { pinned: MODEL_A, maxTokens: '  ', fetchImpl }, async (runner) => {
    await runner.callOpenRouter('system', 'user');
    assert.equal(requests[0].max_tokens, 8192);
  });
});

// The reasoning-model failure: all of the cap spent thinking, nothing left for the reply.
test('pinned: empty content cut off at the cap names the cap, not "Empty response"', async () => {
  const requests = [];
  const fetchImpl = recordingFetch([MODEL_A], { [MODEL_A]: [choice('', 'length')] }, requests);
  await withRunner('pinned-empty-length', { pinned: MODEL_A, maxTokens: '16384', fetchImpl }, async (runner) => {
    await assert.rejects(
      runner.callOpenRouter('system', 'user'),
      (e) => {
        assert.match(e.message, /finish_reason "length"/);
        assert.match(e.message, /max_tokens 16384/);
        assert.match(e.message, /CAREER_OPS_MAX_TOKENS/);
        assert.doesNotMatch(e.message, /Empty response/);
        return true;
      },
    );
  });
});

test('rotation: empty content cut off at the cap moves on and reports the cap', async () => {
  const requests = [];
  const fetchImpl = recordingFetch(
    [MODEL_A, MODEL_B],
    { [MODEL_A]: [choice('', 'length')], [MODEL_B]: [choice('', 'length')] },
    requests,
  );
  await withRunner('rotation-empty-length', { fetchImpl }, async (runner) => {
    await assert.rejects(runner.callOpenRouter('system', 'user'), /finish_reason "length".*CAREER_OPS_MAX_TOKENS/);
    assert.equal(requests.length, 2, 'the second model was not tried');
  });
});

test('empty content that finished normally is still "Empty response"', async () => {
  const fetchImpl = recordingFetch([MODEL_A], { [MODEL_A]: [choice('', 'stop')] }, []);
  await withRunner('pinned-empty-stop', { pinned: MODEL_A, fetchImpl }, async (runner) => {
    await assert.rejects(runner.callOpenRouter('system', 'user'), /Empty response/);
  });
});
