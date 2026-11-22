// openai-eval.mjs must end a failed run by setting process.exitCode and letting
// the event loop drain, not by calling process.exit() after a request: on
// Windows, Node can abort in process.exit() after a request (nodejs/node#56645;
// the versions and the numbers are in ollama-eval.mjs, which #7096 fixed the
// same way). The preload stubs fetch and turns any process.exit() call into
// exit 99, which fails on every platform. One check per exit that runs after a
// request, one for the oversized stream record that aborted ollama-eval.mjs
// every time on those versions, and one that holds the event loop open and
// expects the backstop timer to end the run anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const URL_BASE = 'http://127.0.0.1:1234/v1';

// `answer(path)` in `preloadBody` returns the stub's Response for each request.
// The requests made are written to requests.txt, so a check can tell which exit
// the run reached. `passExit` lets a process.exit() call through with its own
// code instead of 99.
function runEval({ preloadBody, passExit = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'openai-eval-exit-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    mkdirSync(join(dir, 'modes'), { recursive: true });
    writeFileSync(join(dir, 'cv.md'), '# Synthetic Candidate\nWrites reliable software.\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'language:\n  output: en\n');
    writeFileSync(join(dir, 'modes', '_profile.md'), 'Synthetic profile: engineering roles.\n');
    const log = join(dir, 'requests.txt');
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `import { writeFileSync, writeSync } from 'node:fs';
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(${passExit ? 'code' : '99'}); };
const requests = [];
globalThis.fetch = async (input, init = {}) => {
  const path = new URL(String(input)).pathname;
  requests.push((init.method ?? 'GET') + ' ' + path);
  return answer(path);
};
process.on('exit', () => writeFileSync(${JSON.stringify(log)}, requests.join('\\n')));
${preloadBody}`);
    // Only the fixture above: no user override, .env, proxy or OpenAI setting
    // from the developer's shell reaches the run.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(CAREER_OPS_|OPENAI_|DOTENV_|NODE_OPTIONS$|NODE_PATH$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key)));
    // DOTENV_CONFIG_QUIET keeps dotenv's own banner out of the stderr checks.
    Object.assign(env, { CAREER_OPS_ROOT: dir, OPENAI_TIMEOUT_MS: '10000', DOTENV_CONFIG_QUIET: 'true' });
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'openai-eval.mjs'),
      '--url', URL_BASE, '--model', 'synthetic-test', '--no-save', 'Synthetic JD: build reliable software.'],
    { cwd: dir, encoding: 'utf8', timeout: 30000, env });
    let requests = [];
    try { requests = readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { /* the run never exited */ }
    return { ...result, requests };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const SSE = `const sse = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const event = (obj) => 'data: ' + JSON.stringify(obj) + '\\n\\n';`;
// One content event, then an error event, which the stream reader throws on.
const STREAM_ERROR = `${SSE}
const answer = () => sse(event({ choices: [{ delta: { content: 'Partial' }, finish_reason: null }] })
  + event({ error: { message: 'model crashed' } }));`;

test('an HTTP error from the chat request exits 1, without calling process.exit', () => {
  const result = runEval({ preloadBody: 'const answer = () => new Response(\'model not found\', { status: 404 });' });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.deepEqual(result.requests, ['POST /v1/chat/completions']);
  assert.equal(result.stderr, '❌  API error: HTTP 404\n    model not found\n'
    + '    → Check --url (it should include any /v1 segment) and --model id.\n');
});

test('a failed stream exits 1 with its error and nothing after it, without calling process.exit', () => {
  const result = runEval({ preloadBody: STREAM_ERROR });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.deepEqual(result.requests, ['POST /v1/chat/completions']);
  assert.equal(result.stderr, '❌  API call failed: model crashed\n');
  assert.doesNotMatch(result.stdout, /CAREER-OPS EVALUATION/);
});

test('a stream record over the size cap exits 1, without calling process.exit', () => {
  // The case that aborted ollama-eval.mjs on every run on the affected Windows
  // Node versions: tests/evaluator-stream-integrity.test.mjs runs it for both.
  const result = runEval({ preloadBody: `${SSE}
const answer = () => sse(event({ choices: [{ delta: { content: 'x'.repeat(1024 * 1024) }, finish_reason: null }] }));` });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.deepEqual(result.requests, ['POST /v1/chat/completions']);
  assert.equal(result.stderr, '❌  API call failed: Stream line exceeds the 1 Mi code-unit limit\n');
  assert.doesNotMatch(result.stdout, /CAREER-OPS EVALUATION/);
});

test('a failed run whose event loop stays open still exits 1 once the backstop fires', () => {
  // A ref'd interval that nothing clears holds the loop open after the error.
  // Without the backstop this run would last until the spawn timeout.
  const result = runEval({ preloadBody: `${STREAM_ERROR}\nsetInterval(() => {}, 1000);`, passExit: true });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stderr, '❌  API call failed: model crashed\nprocess.exit called with 1\n');
});
