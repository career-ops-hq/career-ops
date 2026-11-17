// gemini-eval.mjs must end a failed run by setting process.exitCode and
// letting the event loop drain, not by calling process.exit() after its
// request: on Windows, Node can abort in process.exit() after a request
// (nodejs/node#56645; the versions and the numbers are in ollama-eval.mjs,
// which #7096 fixed the same way). The preload stubs fetch, which the Gemini
// SDK calls, and turns any process.exit() call into exit 99, which fails on
// every platform. One check per exit that runs after the request, and one that
// holds the event loop open and expects the backstop timer to end the run
// anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// `answer(path)` in `preloadBody` returns the stub's Response for each request.
// The requests made are written to requests.txt, so a check can tell which exit
// the run reached. `passExit` lets a process.exit() call through with its own
// code instead of 99.
function runEval({ preloadBody, passExit = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-eval-exit-'));
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
  requests.push((init.method ?? 'GET') + ' ' + path.replace(/models\\/[^:]+/, 'models/MODEL'));
  return answer(path);
};
const reply = (text) => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
}), { status: 200, headers: { 'content-type': 'application/json' } });
process.on('exit', () => writeFileSync(${JSON.stringify(log)}, requests.join('\\n')));
${preloadBody}`);
    // Only the fixture above: no user override, .env, proxy or Gemini setting
    // from the developer's shell reaches the run.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(CAREER_OPS_|GEMINI_|GOOGLE_|DOTENV_|NODE_OPTIONS$|NODE_PATH$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key)));
    // DOTENV_CONFIG_QUIET keeps dotenv's own banner out of the stderr checks.
    Object.assign(env, { CAREER_OPS_ROOT: dir, GEMINI_API_KEY: 'synthetic-test-key', DOTENV_CONFIG_QUIET: 'true' });
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'gemini-eval.mjs'),
      '--no-save', 'Synthetic JD: build reliable software.'],
    { cwd: dir, encoding: 'utf8', timeout: 30000, env });
    let requests = [];
    try { requests = readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { /* the run never exited */ }
    return { ...result, requests };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const REQUEST = 'POST /v1beta/models/MODEL:generateContent';
const API_ERROR = `const answer = () => new Response(JSON.stringify({
  error: { code: 404, message: 'models/synthetic is not found', status: 'NOT_FOUND' },
}), { status: 404, headers: { 'content-type': 'application/json' } });`;

test('an API error exits 1, without calling process.exit', () => {
  const result = runEval({ preloadBody: API_ERROR });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.deepEqual(result.requests, [REQUEST]);
  assert.match(result.stderr, /❌ {2}Gemini API error: .*models\/synthetic is not found/);
  assert.doesNotMatch(result.stderr, /process\.exit called/);
  assert.doesNotMatch(result.stdout, /CAREER-OPS EVALUATION/);
});

test('a reply that fails validation exits 1, without calling process.exit', () => {
  const result = runEval({ preloadBody: 'const answer = () => reply(\'Not an evaluation.\');' });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.deepEqual(result.requests, [REQUEST]);
  assert.match(result.stderr, /❌ {2}Gemini output failed validation: /);
  assert.doesNotMatch(result.stderr, /process\.exit called/);
  assert.doesNotMatch(result.stdout, /CAREER-OPS EVALUATION/);
});

test('a failed run whose event loop stays open still exits 1 once the backstop fires', () => {
  // A ref'd interval that nothing clears holds the loop open after the error.
  // Without the backstop this run would last until the spawn timeout.
  const result = runEval({ preloadBody: `${API_ERROR}\nsetInterval(() => {}, 1000);`, passExit: true });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.ok(result.stderr.endsWith('process.exit called with 1\n'), describeSpawn(result));
});
