// tests/openai-eval-max-tokens.test.mjs — openai-eval caps the completion it
// asks for, so a gateway never reserves the model's whole output window.
//
// The request carried no output limit. OpenRouter then budgets each call for
// the model's maximum output (prompt + max output, at the model's price) and
// answers HTTP 402 when the balance cannot cover that reservation, even when
// the report itself would have cost cents. The limit comes from
// CAREER_OPS_MAX_TOKENS (default 32768) and is sent as `max_tokens`, except to
// api.openai.com, whose reasoning models reject `max_tokens` and take
// `max_completion_tokens` instead.
//
// This drives the real CLI against a mock endpoint that captures the request.
// The api.openai.com case cannot be reached over loopback (the CLI refuses a
// non-HTTPS remote), so a preload rewrites that one base URL to the mock: the
// CLI still sees api.openai.com as its host, which is what the branch reads.
import { createServer } from 'http';
import { execFile } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nopenai-eval.mjs — caps the completion with max_tokens (CAREER_OPS_MAX_TOKENS)');

const DEFAULT_MAX_TOKENS = 32768;

let finishReason = 'stop';
const requests = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = null;
    try { body = JSON.parse(raw); } catch { /* recorded as null */ }
    requests.push({ path: req.url, body });
    const event = (delta, finish_reason = null) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(event({ content: 'Evaluation body.\n' }) + event({}, finishReason) + 'data: [DONE]\n\n');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;

// cwd for the children: openai-eval loads .env from its cwd, and a developer's
// own .env must not decide what this test sees.
const scratch = mkdtempSync(join(tmpdir(), 'cops-openai-max-tokens-'));
const redirect = join(scratch, 'redirect-openai.mjs');
writeFileSync(redirect, `
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) =>
  realFetch(String(url).replace('https://api.openai.com/v1', ${JSON.stringify(base)}), init);
`);

/** Run openai-eval once; resolves with the exit code, output and captured request. */
function run({ env = {}, url = base, preload = null } = {}) {
  const childEnv = { ...process.env };
  for (const k of ['CAREER_OPS_MAX_TOKENS', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) delete childEnv[k];
  Object.assign(childEnv, env);
  const before = requests.length;
  const argv = [
    ...(preload ? ['--import', pathToFileURL(preload).href] : []),
    join(ROOT, 'openai-eval.mjs'),
    '--url', url, '--model', 'test/model', '--no-save', 'Some job description text.',
  ];
  return new Promise((resolve) => {
    execFile(NODE, argv, { cwd: scratch, timeout: 30000, env: childEnv }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        out: stdout + stderr,
        stderr,
        body: requests.length > before ? requests[requests.length - 1].body : null,
      });
    });
  });
}

try {
  // 1. Default: a bounded max_tokens goes to an OpenAI-compatible gateway.
  {
    const r = await run();
    const b = r.body ?? {};
    if (b.max_tokens === DEFAULT_MAX_TOKENS) pass(`sends max_tokens = ${DEFAULT_MAX_TOKENS} by default`);
    else fail(`default request has no max_tokens = ${DEFAULT_MAX_TOKENS}: ${JSON.stringify({ max_tokens: b.max_tokens, max_completion_tokens: b.max_completion_tokens })} (exit ${r.code})`);
    if (!('max_completion_tokens' in b)) pass('does not also send max_completion_tokens to a gateway');
    else fail(`gateway request also carries max_completion_tokens: ${b.max_completion_tokens}`);
  }

  // 2. CAREER_OPS_MAX_TOKENS overrides the default.
  {
    const r = await run({ env: { CAREER_OPS_MAX_TOKENS: '4096' } });
    if (r.body?.max_tokens === 4096) pass('CAREER_OPS_MAX_TOKENS=4096 sends max_tokens = 4096');
    else fail(`CAREER_OPS_MAX_TOKENS=4096 not honoured: max_tokens=${r.body?.max_tokens} (exit ${r.code})`);
  }

  // 3. An invalid value stops before any request is made, naming the variable.
  for (const bad of ['abc', '0', '-5', '8k']) {
    const r = await run({ env: { CAREER_OPS_MAX_TOKENS: bad } });
    if (r.code !== 0 && r.body === null && /CAREER_OPS_MAX_TOKENS/.test(r.stderr)) {
      pass(`CAREER_OPS_MAX_TOKENS=${JSON.stringify(bad)} is refused before any request`);
    } else {
      fail(`CAREER_OPS_MAX_TOKENS=${JSON.stringify(bad)}: exit ${r.code}, request ${r.body ? 'sent' : 'not sent'}, stderr: ${r.stderr.trim().split('\n').pop()}`);
    }
  }

  // 4. api.openai.com takes the limit as max_completion_tokens.
  {
    const r = await run({ url: 'https://api.openai.com/v1', preload: redirect, env: { OPENAI_API_KEY: 'test-key-not-real' } });
    const b = r.body ?? {};
    if (b.max_completion_tokens === DEFAULT_MAX_TOKENS && !('max_tokens' in b)) {
      pass(`api.openai.com gets max_completion_tokens = ${DEFAULT_MAX_TOKENS} and no max_tokens`);
    } else {
      fail(`api.openai.com request: ${JSON.stringify({ max_tokens: b.max_tokens, max_completion_tokens: b.max_completion_tokens })} (exit ${r.code}, ${r.body ? 'request captured' : 'no request captured'})`);
    }
  }

  // 5. A reply cut off by the limit says so, and says which variable raises it.
  {
    finishReason = 'length';
    const r = await run({ env: { CAREER_OPS_MAX_TOKENS: '4096' } });
    finishReason = 'stop';
    if (/truncated/i.test(r.stderr) && /CAREER_OPS_MAX_TOKENS/.test(r.stderr)) pass('warns when the reply stops at the token limit (finish_reason "length")');
    else fail(`no truncation warning on finish_reason "length": ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);

    const ok = await run();
    if (!/truncated/i.test(ok.stderr)) pass('no truncation warning on a complete reply');
    else fail('truncation warning printed for a reply that finished normally');
  }
} finally {
  server.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
}
