// tests/openrouter-runner-model-timeout.test.mjs — a single model call is
// given 120 s before it is aborted.
//
// MODEL_TIMEOUT_MS was 15 s. The system prompt has grown since then and
// max_tokens is 8192, so slow free models were cut off mid-answer. In free
// rotation a timeout is not a skip: the model is written to
// data/model-blacklist.json, so one slow answer banned a working model for every
// later run.
//
// The runner is imported under a throwaway data root, so no network is used and
// no real data is touched.
//
// Run:  node --test tests/openrouter-runner-model-timeout.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Import a fresh copy of the runner with the data root and the OpenRouter env
 * pointed at a throwaway directory. The blacklist path is resolved at import
 * time, so the environment has to be in place first.
 */
async function loadRunner(dataRoot) {
  const names = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_MODEL', 'OPENROUTER_API_KEY'];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.CAREER_OPS_ROOT = dataRoot;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_MODEL;
  process.env.OPENROUTER_API_KEY = 'test-key';
  try {
    const url = `${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?model-timeout`;
    return await import(url);
  } finally {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  }
}

test('a single model call is aborted after 120 s, not 15 s', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-timeout-'));
  try {
    const runner = await loadRunner(dataRoot);
    assert.equal(runner.MODEL_TIMEOUT_MS, 120_000);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
