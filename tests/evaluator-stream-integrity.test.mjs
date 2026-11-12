import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { fail, linkRepoPackage, NODE, pass, rmSync, ROOT } from './helpers.mjs';

const exec = promisify(execFile);
const answer = 'Synthetic evaluation: caf\u00e9.';
const scoreSummary = '---SCORE_SUMMARY---\nCOMPANY: Example\nROLE: Engineer\nSCORE: 4.2\nARCHETYPE: IC\nLEGITIMACY: High Confidence\n---END_SUMMARY---';
const evaluation = `${answer}\n${scoreSummary}`;
const jd = 'Synthetic JD marker: build reliable software with a team of engineers.\n## Responsibilities\nWrite tests.';
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
      'tracker-utils.mjs', 'pipeline-lock.mjs', 'utils/token-tracker.mjs',
    ]) {
      const dest = join(code, file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(ROOT, file), dest);
    }
    cpSync(join(ROOT, 'lib'), join(code, 'lib'), { recursive: true });
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
    const nodeArgs = [];
    if (scenario.coalesce) {
      // Make the parser receive one transport chunk, even when HTTP splits the body.
      const preload = join(sandbox, 'coalesce.mjs');
      write(preload, `const fetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await fetch(...args);
  if (args[1]?.method !== 'POST') return response;
  return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
};\n`);
      nodeArgs.push('--import', pathToFileURL(preload).href);
    }
    server = createServer((req, res) => {
      if (req.url === '/api/tags') { res.end('{"models":[]}'); return; }
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        requests.push(JSON.parse(raw));
        if (scenario.reject && (requests.length === 1 || scenario.reject.always)) {
          res.writeHead(scenario.reject.status);
          res.end(scenario.reject.body);
          return;
        }
        res.setHeader('Content-Type', engine === 'openai' ? 'text/event-stream' : 'application/x-ndjson');
        const body = Buffer.from(scenario.body ?? complete(engine));
        if (scenario.disconnect) {
          res.write(body);
          setImmediate(() => res.destroy());
        } else if (scenario.fragment === 'bytes') {
          let offset = 0;
          const next = () => {
            if (offset === body.length) { res.end(); return; }
            res.write(body.subarray(offset, ++offset));
            setImmediate(next);
          };
          next();
        } else if (scenario.fragment) {
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
      output = { code: 0, ...await exec(NODE, [...nodeArgs, join(code, `${engine}-eval.mjs`), '--url',
        engine === 'openai' ? `${url}/v1` : url, '--model', scenario.model ?? 'synthetic-test',
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
    { name: 'transport interruption', body: content(engine), disconnect: true },
    { name: 'split bytes and CRLF', body: complete(engine).replace(/\n/g, '\r\n'), fragment: 'bytes', ok: true },
    { name: 'invalid UTF-8', body: Buffer.concat([Buffer.from(content(engine)), Buffer.from([0xc3]), Buffer.from(terminal(engine))]) },
    { name: 'EOF before terminal', body: content(engine) },
    { name: 'in-band error after content', body: content(engine) + error },
    { name: 'malformed middle record', body: content(engine) + (engine === 'openai' ? 'data: {broken}\n\n' : '{broken}\n') + terminal(engine) },
    { name: 'truncated final record', body: content(engine) + (engine === 'openai' ? 'data: {"choices":' : '{"done":') },
    { name: 'output limit reached', body: content(engine) + terminal(engine, 'length') },
    { name: 'empty completed response', body: terminal(engine) },
    { name: 'malformed record after successful finish', body: content(engine) + (engine === 'openai'
      ? 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {broken}\n\n'
      : terminal(engine) + '{broken}\n') },
  ]) {
    await fixture(engine, scenario, ({ code, stdout, stderr, data }) => {
      if (scenario.ok) {
        assert.equal(code, 0, stderr);
        assert.ok(stdout.includes(evaluation.split('\n')[0]));
        const reports = files(join(data, 'reports')).filter(f => f.endsWith('.md'));
        assert.equal(reports.length, 1);
        assert.ok(readFileSync(join(data, 'reports', reports[0]), 'utf8').includes(evaluation.split('\n')[0]));
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
    assert.deepEqual(requests[0].stream_options, { include_usage: true });
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

for (const engine of ['openai', 'ollama']) {
  const event = obj => engine === 'openai'
    ? `data: ${JSON.stringify(obj)}\n\n`
    : JSON.stringify(obj) + '\n';
  const measured = counts => engine === 'openai'
    ? content(engine) + event({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      + event({ choices: [], usage: counts }) + 'data: [DONE]\n\n'
    : content(engine) + event({ done: true, done_reason: 'stop',
      prompt_eval_count: counts?.prompt_tokens, eval_count: counts?.completion_tokens });
  for (const [name, counts, expected] of [
    ['genuine measured zero', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, /evaluation:\s+0\.0k prompt \/ 0\.0k completion/],
    ['missing counts', undefined, /evaluation:\s+usage unavailable/],
    ['partial counts', { prompt_tokens: 100 }, /evaluation:\s+usage unavailable/],
    ['invalid counts', { prompt_tokens: -1, completion_tokens: 10 }, /evaluation:\s+usage unavailable/],
    ['reported counts without total', { prompt_tokens: 300, completion_tokens: 100 }, /total:\s+0\.4k tokens/],
  ]) {
    await fixture(engine, { name, body: measured(counts), model: 'gpt-4o-mini' }, ({ code, stdout, stderr }) => {
      assert.equal(code, 0, stderr);
      assert.match(stdout, expected);
      if (/unavailable/.test(expected.source)) assert.doesNotMatch(stdout, /total:|\$0\.0000/);
      if (name === 'genuine measured zero') assert.match(stdout, /total:\s+0\.0k tokens \(\$0\.0000\)/);
    });
  }
  const thinking = engine === 'openai'
    ? { choices: [{ delta: { reasoning_content: 'Thinking without an answer' } }] }
    : { message: { thinking: 'Thinking without an answer', content: '' }, done: false };
  const toolCall = { id: 'fixture-call', type: 'function', function: { name: 'not_supported', arguments: '{}' } };
  const tools = engine === 'openai'
    ? { choices: [{ delta: { tool_calls: [toolCall] } }] }
    : { message: { tool_calls: [toolCall], content: '' }, done: false };
  for (const [name, body] of [
    ['thinking-only terminal response', event(thinking) + terminal(engine)],
    ['tool-only terminal response', event(tools) + terminal(engine)],
    ['tool call mixed with text', content(engine) + event(tools) + terminal(engine)],
  ]) {
    await fixture(engine, { name, body }, ({ code, data }) => {
      assert.equal(code, 1);
      assert.deepEqual(files(join(data, 'reports')), []);
      assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
    });
  }
}

await fixture('openai', { name: 'latest standard and Groq counts retained',
  body: content('openai') + 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":10}}\n\n'
    + 'data: {"choices":[],"x_groq":{"usage":{"prompt_tokens":400,"completion_tokens":200}}}\n\n'
    + terminal('openai'),
}, ({ code, stdout, stderr }) => {
  assert.equal(code, 0, stderr);
  assert.match(stdout, /evaluation:\s+0\.4k prompt \/ 0\.2k completion/);
  assert.match(stdout, /total:\s+0\.6k tokens/);
});
await fixture('openai', { name: 'simultaneous reasoning and answer',
  body: 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'Reasoning', content: evaluation } }] })
    + '\n\n' + terminal('openai'),
}, ({ code, stdout, stderr }) => {
  assert.equal(code, 0, stderr);
  assert.ok(stdout.includes('<think>\nReasoning\n</think>'));
  const answerAt = stdout.indexOf(answer);
  assert.ok(answerAt >= 0, 'the answer is displayed alongside reasoning');
  // Evidence normalization can insert a compensation caveat before the summary.
  assert.ok(stdout.indexOf(scoreSummary, answerAt + answer.length) > answerAt,
    'the complete score summary follows the answer');
});
for (const status of [400, 422]) {
  await fixture('openai', { name: `unsupported include_usage retry (${status})`,
    reject: { status, body: '{"error":"unsupported stream_options.include_usage"}' },
  }, ({ code, requests, stderr }) => {
    assert.equal(code, 0, stderr);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].stream_options, { include_usage: true });
    assert.equal(requests[1].stream_options, undefined);
    const { stream_options, ...first } = requests[0];
    assert.deepEqual(requests[1], first, 'retry changes only the rejected optional field');
  });
}
for (const [status, body] of [[422, '{"error":"unknown model"}'], [500, '{"error":"include_usage backend failure"}']]) {
  await fixture('openai', { name: `unrelated HTTP ${status} is not retried`, reject: { status, body, always: true } },
    ({ code, requests, data }) => {
      assert.equal(code, 1);
      assert.equal(requests.length, 1);
      assert.deepEqual(files(join(data, 'reports')), []);
      assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
    });
}

for (const engine of ['openai', 'ollama']) {
  await fixture(engine, { name: 'complete no-save response', args: ['--no-save'] }, ({ code, data, stderr }) => {
    assert.equal(code, 0, stderr);
    assert.deepEqual(files(join(data, 'reports')), []);
    assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
  });
}
await fixture('ollama', { name: 'done:true without optional reason',
  body: content('ollama') + '{"done":true,"prompt_eval_count":300,"eval_count":100}',
}, ({ code, stdout, stderr }) => {
  assert.equal(code, 0, stderr);
  assert.match(stdout, /total:\s+0\.4k tokens/);
});

const recordLimit = 1024 * 1024; // Decoded UTF-16 code units, not total stream bytes.
for (const engine of ['openai', 'ollama']) {
  const record = JSON.stringify({ padding: 'x'.repeat(recordLimit) });
  const framed = engine === 'openai' ? `data: ${record}` : record;
  for (const [name, suffix] of [['terminated oversized record', '\n\n'], ['unterminated oversized record', '']]) {
    await fixture(engine, { name, body: content(engine) + framed + suffix + (suffix ? terminal(engine) : ''), coalesce: true },
      ({ code, stderr, data }) => {
        assert.equal(code, 1);
        assert.match(stderr, /stream (line|record) exceeds/i);
        assert.deepEqual(files(join(data, 'reports')), []);
        assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
      });
  }
  // A single transport chunk can legitimately hold more than the per-record cap.
  const small = JSON.stringify({ padding: 'x'.repeat(2048) });
  const records = (engine === 'openai' ? `data: ${small}\n\n` : `${small}\n`).repeat(600);
  await fixture(engine, { name: 'many small records exceed cap in one transport chunk',
    body: content(engine) + records + terminal(engine), coalesce: true }, ({ code, stderr }) => {
    assert.equal(code, 0, stderr);
  });
  // More than 1 MiB of UTF-8 bytes is still below the decoded code-unit cap.
  const unicode = JSON.stringify({ padding: '\u00e9'.repeat(recordLimit / 2) });
  await fixture(engine, { name: 'record limit counts decoded code units', coalesce: true,
    body: content(engine) + (engine === 'openai' ? `data: ${unicode}\n\n` : `${unicode}\n`) + terminal(engine),
  }, ({ code, stderr }) => assert.equal(code, 0, stderr));
  const message = 'provider-error:'.padEnd(300, 'x') + 'PRIVATE_ERROR_TAIL';
  const error = engine === 'openai' ? { error: { message } } : { error: message };
  await fixture(engine, { name: 'provider error text is capped',
    body: content(engine) + (engine === 'openai' ? `data: ${JSON.stringify(error)}\n\n` : JSON.stringify(error) + '\n'),
  }, ({ code, stdout, stderr, data }) => {
    assert.equal(code, 1);
    assert.ok(stderr.includes(message.slice(0, 300)));
    assert.doesNotMatch(stdout + stderr, /PRIVATE_ERROR_TAIL/);
    assert.deepEqual(files(join(data, 'reports')), []);
    assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
  });
}
const halfData = 'data: ' + ' '.repeat(recordLimit / 2) + '\n';
await fixture('openai', { name: 'multiline SSE aggregate exceeds event cap', coalesce: true,
  body: content('openai') + halfData.repeat(2) + 'data: {}\n\n' + terminal('openai'),
}, ({ code, stderr, data }) => {
  assert.equal(code, 1);
  assert.match(stderr, /stream event exceeds/i);
  assert.deepEqual(files(join(data, 'reports')), []);
  assert.deepEqual(files(join(data, 'batch/tracker-additions')), []);
});
await fixture('openai', { name: 'SSE event cap resets between events', coalesce: true,
  body: content('openai') + (halfData + 'data: {}\n\n').repeat(3) + terminal('openai'),
}, ({ code, stderr }) => assert.equal(code, 0, stderr));
