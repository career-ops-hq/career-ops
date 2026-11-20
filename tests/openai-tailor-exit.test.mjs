// openai-tailor.mjs must end a failed run by setting process.exitCode and
// letting the event loop drain, not by calling process.exit() after its
// request: on Windows, Node can abort in process.exit() after a request
// (nodejs/node#56645; the versions and the numbers are in ollama-eval.mjs,
// which #7096 fixed the same way). The preload stubs fetch and turns any
// process.exit() call into exit 99, which fails on every platform. One check
// per exit that runs after the request, and one that holds the event loop open
// and expects the backstop timer to end the run anyway.
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
const HTML = '<!DOCTYPE html><html><body><h1>Synthetic Candidate</h1></body></html>';

// `answer(path)` in `preloadBody` returns the stub's Response for each request.
// The requests made are written to requests.txt, so a check can tell which exit
// the run reached. `passExit` lets a process.exit() call through with its own
// code instead of 99. `blockSave` puts a directory where the tailored CV is
// written (output/cv-candidate-report.html: no `name` in the profile, and the
// report is report.md), so saving it fails. A file in place of output/ would
// stop the run before the request: generate-pdf.mjs creates output/ on import.
function runTailor({ preloadBody, passExit = false, blockSave = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'openai-tailor-exit-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'cv.md'), '# Synthetic Candidate\n\n## Experience\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: Synthetic Candidate\n');
    writeFileSync(join(dir, 'jd.txt'), 'Synthetic JD: build reliable software.');
    writeFileSync(join(dir, 'report.md'), '# ExampleCo: Platform Engineer\n');
    if (blockSave) mkdirSync(join(dir, 'output', 'cv-candidate-report.html'), { recursive: true });
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
const reply = (content, finish_reason) => new Response(JSON.stringify({
  choices: [{ index: 0, message: { role: 'assistant', content }, ...(finish_reason ? { finish_reason } : {}) }],
}), { status: 200, headers: { 'content-type': 'application/json' } });
process.on('exit', () => writeFileSync(${JSON.stringify(log)}, requests.join('\\n')));
${preloadBody}`);
    // Only the fixture above: no user override, .env, proxy or OpenAI setting
    // from the developer's shell reaches the run.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(CAREER_OPS_|OPENAI_|DOTENV_|NODE_OPTIONS$|NODE_PATH$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key)));
    // DOTENV_CONFIG_QUIET keeps dotenv's own banner out of the stderr checks.
    Object.assign(env, { CAREER_OPS_ROOT: dir, OPENAI_TIMEOUT_MS: '10000', DOTENV_CONFIG_QUIET: 'true' });
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'openai-tailor.mjs'),
      '--url', URL_BASE, '--model', 'synthetic-test', '--jd', join(dir, 'jd.txt'), '--report', join(dir, 'report.md')],
    { cwd: dir, encoding: 'utf8', timeout: 30000, env });
    let requests = [];
    try { requests = readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { /* the run never exited */ }
    return { ...result, requests };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Exit 1 after exactly one request, with `message` in stderr and no process.exit() call. */
function assertFailedAfterRequest(result, message) {
  assert.equal(result.status, 1, describeSpawn(result));
  assert.deepEqual(result.requests, ['POST /v1/chat/completions']);
  assert.ok(result.stderr.includes(message), describeSpawn(result));
  assert.doesNotMatch(result.stderr, /process\.exit called/);
}

test('an HTTP error from the request exits 1, without calling process.exit', () => {
  const result = runTailor({ preloadBody: 'const answer = () => new Response(\'no credit\', { status: 402 });' });
  assertFailedAfterRequest(result, '❌  API error: HTTP 402\n    no credit\n');
});

test('a reply cut off at the output cap exits 1, without calling process.exit', () => {
  const result = runTailor({ preloadBody: `const answer = () => reply(${JSON.stringify(HTML)}, 'length');` });
  assertFailedAfterRequest(result, 'output cap, so the tailored CV is cut short. Nothing was saved.');
});

test('a reply that did not finish exits 1, without calling process.exit', () => {
  const result = runTailor({ preloadBody: `const answer = () => reply(${JSON.stringify(HTML)}, 'content_filter');` });
  assertFailedAfterRequest(result, 'finish_reason "content_filter", not "stop"');
});

test('an empty reply exits 1, without calling process.exit', () => {
  const result = runTailor({ preloadBody: 'const answer = () => reply(\'\', \'stop\');' });
  assertFailedAfterRequest(result, '❌  The endpoint returned an empty response.');
});

test('a reply that is not JSON exits 1, without calling process.exit', () => {
  const result = runTailor({ preloadBody: 'const answer = () => new Response(\'<html>gateway</html>\', { status: 200 });' });
  assertFailedAfterRequest(result, '❌  API call failed: ');
});

test('a tailored CV that cannot be saved exits 1, without calling process.exit', () => {
  const result = runTailor({ preloadBody: `const answer = () => reply(${JSON.stringify(HTML)}, 'stop');`, blockSave: true });
  assertFailedAfterRequest(result, '⚠️   Could not save HTML: ');
});

test('a failed run whose event loop stays open still exits 1 once the backstop fires', () => {
  // A ref'd interval that nothing clears holds the loop open after the error.
  // Without the backstop this run would last until the spawn timeout.
  const result = runTailor({
    preloadBody: 'const answer = () => new Response(\'no credit\', { status: 402 });\nsetInterval(() => {}, 1000);',
    passExit: true,
  });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.ok(result.stderr.endsWith('process.exit called with 1\n'), describeSpawn(result));
});
