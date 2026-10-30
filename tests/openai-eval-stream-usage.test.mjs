// tests/openai-eval-stream-usage.test.mjs: openai-eval reports the tokens its
// evaluation call spent.
//
// Streaming (#3501) replaced the buffered response that carried `usage`, and the
// token footer has printed "evaluation: (zero-token by design)" with a $0.0000
// total ever since, on paid endpoints too. A streamed chat completion only
// carries usage when the request sets stream_options.include_usage, and then on
// a last chunk whose `choices` is empty.
//
// Run:  node --test tests/openai-eval-stream-usage.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'co-openai-usage-'));
after(() => rmSync(work, { recursive: true, force: true, maxRetries: 10 }));

const hook = join(work, 'fetch.mjs');
writeFileSync(hook, `
import { writeFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  writeFileSync(process.env.REQUEST_CAPTURE, JSON.stringify(JSON.parse(init.body)));
  const chunks = [
    { choices: [{ delta: { content: 'Fixture evaluation.' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ...JSON.parse(process.env.USAGE_CHUNKS),
  ];
  const sse = chunks.map((c) => 'data: ' + JSON.stringify(c) + '\\n\\n').join('') + 'data: [DONE]\\n\\n';
  return new Response(sse);
};
`);

function evaluate(usageChunks) {
  const capture = join(work, 'request.json');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(hook).href, join(ROOT, 'openai-eval.mjs'),
    '--no-save', '--model', 'gpt-4o-mini', 'Fictional job description for Larchfield Co.',
  ], {
    cwd: work, encoding: 'utf-8', timeout: 30_000,
    env: {
      PATH: process.env.PATH, HOME: work, CAREER_OPS_ROOT: work,
      OPENAI_API_KEY: 'fixture-key', REQUEST_CAPTURE: capture,
      USAGE_CHUNKS: JSON.stringify(usageChunks),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return { stdout: r.stdout, request: JSON.parse(readFileSync(capture, 'utf-8')) };
}

test('the streamed request asks the endpoint to report usage', () => {
  const { request } = evaluate([]);
  assert.equal(request.stream, true);
  assert.deepEqual(request.stream_options, { include_usage: true });
});

test('the usage chunk reaches the token footer and the cost estimate', () => {
  const { stdout } = evaluate([
    { choices: [], usage: { prompt_tokens: 12000, completion_tokens: 3000, total_tokens: 15000 } },
  ]);
  assert.match(stdout, /evaluation:\s+12\.0k prompt \/ 3\.0k completion/);
  assert.match(stdout, /total:\s+15\.0k tokens/);
  assert.doesNotMatch(stdout, /total:.*\(\$0\.0000\)/);
});

test('usage repeated on every chunk counts once, from the last chunk', () => {
  // llama.cpp's server has sent a running total on each chunk (ggml-org/llama.cpp#12102).
  const { stdout } = evaluate([
    { choices: [], usage: { prompt_tokens: 12000, completion_tokens: 1000, total_tokens: 13000 } },
    { choices: [], usage: { prompt_tokens: 12000, completion_tokens: 3000, total_tokens: 15000 } },
  ]);
  assert.match(stdout, /evaluation:\s+12\.0k prompt \/ 3\.0k completion/);
});

test('an endpoint that sends no usage still finishes and prints the footer', () => {
  const { stdout } = evaluate([]);
  assert.match(stdout, /evaluation:\s+\(zero-token by design\)/);
});
