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
const requests = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body);
  writeFileSync(process.env.REQUEST_CAPTURE, JSON.stringify(requests));
  const reject = process.env.REJECT_REPLY;
  if (reject && (body.stream_options || process.env.REJECT_ALWAYS)) return new Response(reject, { status: 422 });
  const chunks = [
    { choices: [{ delta: { content: 'Fixture evaluation.' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ...JSON.parse(process.env.USAGE_CHUNKS),
  ];
  const sse = chunks.map((c) => 'data: ' + JSON.stringify(c) + '\\n\\n').join('') + 'data: [DONE]\\n\\n';
  return new Response(sse);
};
`);

function evaluate(usageChunks, extraEnv = {}, expectStatus = 0) {
  const capture = join(work, 'request.json');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(hook).href, join(ROOT, 'openai-eval.mjs'),
    '--no-save', '--model', 'gpt-4o-mini', 'Fictional job description for Larchfield Co.',
  ], {
    cwd: work, encoding: 'utf-8', timeout: 30_000,
    env: {
      PATH: process.env.PATH, HOME: work, CAREER_OPS_ROOT: work,
      OPENAI_API_KEY: 'fixture-key', REQUEST_CAPTURE: capture,
      USAGE_CHUNKS: JSON.stringify(usageChunks), ...extraEnv,
    },
  });
  assert.equal(r.status, expectStatus, r.stderr);
  const requests = JSON.parse(readFileSync(capture, 'utf-8'));
  return { stdout: r.stdout, requests, request: requests[0] };
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

// Mistral answers an unknown request field with 422 and names it
// (openai/openai-agents-python#442).
const MISTRAL_422 = JSON.stringify({ detail: [{ type: 'extra_forbidden', loc: ['body', 'stream_options', 'include_usage'], msg: 'Extra inputs are not permitted' }] });

test('an endpoint that rejects stream_options gets the request again without it', () => {
  const { requests, stdout } = evaluate([], { REJECT_REPLY: MISTRAL_422 });
  assert.equal(requests.length, 2);
  assert.ok(requests[0].stream_options);
  assert.equal(requests[1].stream_options, undefined);
  assert.equal(requests[1].stream, true);
  assert.match(stdout, /Fixture evaluation\./);
});

test('any other 422 is reported once, with no retry', () => {
  const { requests } = evaluate([], { REJECT_REPLY: '{"error":"model not found"}', REJECT_ALWAYS: '1' }, 1);
  assert.equal(requests.length, 1);
});
