import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fail, linkRepoPackage, NODE, pass, rmSync, ROOT } from './helpers.mjs';

const exec = promisify(execFile);
const evaluation = 'Synthetic evaluation: caf\u00e9.\n---SCORE_SUMMARY---\nCOMPANY: Example\nROLE: Engineer\nSCORE: 4.2\nARCHETYPE: IC\nLEGITIMACY: High Confidence\n---END_SUMMARY---';
const jd = 'Synthetic JD marker: build reliable software with a team of engineers.\n## Responsibilities\nWrite tests.';
const systemText = message => typeof message.content === 'string' ? message.content : message.content.map(p => p.text).join('');
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}
async function fixture(engine, scenario, check) {
  const sandbox = mkdtempSync(join(tmpdir(), 'co-eval-contract-'));
  const code = join(sandbox, 'code');
  const data = join(sandbox, 'data');
  let server;
  const requests = [];
  try {
    for (const file of [
      `${engine}-eval.mjs`, 'path-resolver.mjs', 'profile-language.mjs',
      'reserve-report-num.mjs', 'tracker-parse.mjs', 'tracker-aliases.json',
      'tracker-utils.mjs', 'pipeline-lock.mjs', 'lib/is-main-module.mjs',
      'lib/context-budget.mjs', 'utils/token-tracker.mjs',
    ]) {
      const dest = join(code, file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(ROOT, file), dest);
    }
    linkRepoPackage(code, 'js-yaml');
    write(join(code, 'modes/_shared.md'), '## Scoring System\nUse evidence.\n');
    write(join(code, 'modes/oferta.md'), 'Evaluate the job.\n');
    write(join(data, 'cv.md'), '# Synthetic Candidate\nWrites reliable software.\n');
    write(join(data, 'config/profile.yml'), 'language:\n  output: en\n');
    write(join(data, 'modes/_profile.md'), 'SYNTHETIC_PROFILE_TARGET: engineering roles.\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(CAREER_OPS_|OPENAI_|OLLAMA_|DOTENV_|NODE_OPTIONS$|NODE_PATH$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key)));
    Object.assign(env, { CAREER_OPS_ROOT: data, OPENAI_API_KEY: '', OPENAI_TIMEOUT_MS: '10000',
      OLLAMA_TIMEOUT_MS: '10000', OLLAMA_NUM_CTX: '32768' });
    await scenario.setup?.({ code, data, env });
    server = createServer((req, res) => {
      if (req.url === '/api/tags') { res.end('{"models":[]}'); return; }
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        requests.push(JSON.parse(raw));
        res.setHeader('Content-Type', engine === 'openai' ? 'text/event-stream' : 'application/x-ndjson');
        const body = Buffer.from(scenario.body ?? complete(engine));
        if (scenario.fragment) {
          // Separate writes across turns, including inside the two-byte UTF-8 e-acute.
          const split = body.indexOf(Buffer.from('\u00e9')) + 1;
          res.write(body.subarray(0, split));
          setImmediate(() => res.end(body.subarray(split)));
        } else res.end(body);
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    let output;
    try {
      output = { code: 0, ...await exec(NODE, [join(code, `${engine}-eval.mjs`), '--url',
        engine === 'openai' ? `${url}/v1` : url, '--model', 'synthetic-test',
        ...(scenario.args ?? []), jd], { cwd: sandbox, env, timeout: 20000, maxBuffer: 2 * 1024 * 1024 }) };
    } catch (error) {
      output = { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
    await check({ ...output, requests, codeRoot: code, data, env });
    pass(`${engine}: ${scenario.name}`);
  } catch (error) {
    fail(`${engine}: ${scenario.name}: ${error.message}`);
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    rmSync(sandbox, { recursive: true, force: true });
  }
}
function content(engine, text = evaluation) {
  return engine === 'openai'
    ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
    : JSON.stringify({ message: { content: text }, done: false }) + '\n';
}
function terminal(engine, reason = 'stop') {
  return engine === 'openai'
    ? `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`
    : JSON.stringify({ message: { content: '' }, done: true, done_reason: reason, prompt_eval_count: 321, eval_count: 123 }) + '\n';
}
function complete(engine) { return content(engine) + terminal(engine); }
function files(path) { return existsSync(path) ? readdirSync(path) : []; }

console.log('\nEvaluator stream completion contract');
for (const engine of ['openai', 'ollama']) {
  const error = engine === 'openai' ? 'data: {"error":{"message":"synthetic provider failure"}}\n\n' : '{"error":"synthetic provider failure"}\n';
  for (const scenario of [
    { name: 'complete stream', body: complete(engine), ok: true },
    { name: 'fragmented UTF-8', body: complete(engine), fragment: true, ok: true },
    { name: 'terminal without trailing newline', body: complete(engine).trimEnd(), ok: true },
    { name: 'empty stream', body: '' },
    { name: 'EOF before terminal', body: content(engine) },
    { name: 'in-band error after content', body: content(engine) + error },
    { name: 'malformed middle record', body: content(engine) + (engine === 'openai' ? 'data: {broken}\n\n' : '{broken}\n') + terminal(engine) },
    { name: 'truncated final record', body: content(engine) + (engine === 'openai' ? 'data: {"choices":' : '{"done":') },
    { name: 'output limit reached', body: content(engine) + terminal(engine, 'length') },
    { name: 'empty completed response', body: terminal(engine) },
  ]) {
    await fixture(engine, scenario, ({ code, stdout, stderr, data }) => {
      if (scenario.ok) {
        assert.equal(code, 0, stderr);
        assert.ok(stdout.includes(evaluation.split('\n')[0]));
        assert.equal(files(join(data, 'reports')).filter(f => f.endsWith('.md')).length, 1);
        assert.equal(files(join(data, 'batch/tracker-additions')).length, 1);
      } else {
        assert.equal(code, 1, 'generation failure must exit 1');
        assert.deepEqual(files(join(data, 'reports')), []);
        assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
        if (scenario.name.includes('in-band')) assert.match(stderr, /synthetic provider failure/);
      }
    });
  }
}
for (const [name, body, pattern] of [
  ['CRLF framing and SSE comment', ': keep-alive\r\n\r\n' + complete('openai').replace(/\n/g, '\r\n'), /Score: 4.2/],
  ['multiline SSE data', 'data: {"choices": [\n' + 'data: {"delta":{"content":"Synthetic answer"}}]}\n\n' + terminal('openai'), /Synthetic answer/],
  ['empty usage object is unavailable', content('openai') + 'data: {"choices":[],"usage":{}}\n\n' + terminal('openai'), /evaluation:\s+usage unavailable/],
  ['usage-only final event', content('openai') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
    + 'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":123,"total_tokens":444,"prompt_tokens_details":{"cached_tokens":200}}}\n\ndata: [DONE]\n\n', /evaluation:\s+0.3k prompt \/ 0.1k completion \(cached: 0.2k\)/],
  ['usage unavailable', complete('openai'), /evaluation:\s+usage unavailable/],
  ['finish reason without DONE', content('openai') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', /Score: 4.2/],
  ['DONE-only compatible endpoint', content('openai') + 'data: [DONE]', /Score: 4.2/],
]) {
  await fixture('openai', { name, body }, ({ code, stdout, stderr, requests }) => {
    assert.equal(code, 0, stderr);
    assert.match(stdout, pattern);
    assert.equal(requests[0].stream_options, undefined, 'do not force optional usage flags on compatible servers');
  });
}
for (const [name, body] of [
  ['filtered response', content('openai') + terminal('openai', 'content_filter')],
  ['unsupported tool call', content('openai') + terminal('openai', 'tool_calls')],
  ['reasoning is not an answer', 'data: {"choices":[{"delta":{"reasoning_content":"Still thinking"}}]}\n\n' + terminal('openai')],
]) {
  await fixture('openai', { name, body }, ({ code, data }) => {
    assert.equal(code, 1);
    assert.deepEqual(files(join(data, 'reports')), []);
    assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
  });
}
