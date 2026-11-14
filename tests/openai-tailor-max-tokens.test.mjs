// tests/openai-tailor-max-tokens.test.mjs — openai-tailor caps the completion
// it asks for, as openai-eval does since #6676.
//
// The request carried no output limit. OpenRouter then budgets each call for
// the model's whole output window (prompt + max output, at the model's price)
// and answers HTTP 402 when the balance cannot cover that reservation, even
// when the tailored CV would have cost cents. The limit comes from
// CAREER_OPS_MAX_TOKENS (default 32768) and is sent as `max_tokens`, except to
// api.openai.com, which takes `max_completion_tokens`. A reply that stops at
// the limit is a CV cut short, so it is not saved.
//
// This drives the real CLI against a mock endpoint that captures the request.
// The api.openai.com case cannot be reached over loopback (the CLI refuses a
// non-HTTPS remote), so a preload rewrites that one base URL to the mock: the
// CLI still sees api.openai.com as its host, which is what the branch reads.
import { createServer } from 'http';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nopenai-tailor.mjs — caps the completion with max_tokens (CAREER_OPS_MAX_TOKENS)');

const DEFAULT_MAX_TOKENS = 32768;
const HTML = '<!DOCTYPE html><html><body><h1>Test Candidate</h1></body></html>';

let finishReason = 'stop';
let status = 200;
const requests = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = null;
    try { body = JSON.parse(raw); } catch { /* recorded as null */ }
    requests.push({ path: req.url, body });
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Insufficient credits' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: HTML }, finish_reason: finishReason }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;

// The data root and the children's cwd: openai-tailor loads .env from its cwd
// and reads the CV and profile from the data root, so a developer's own files
// must not decide what this test sees.
const scratch = mkdtempSync(join(tmpdir(), 'cops-openai-tailor-max-tokens-'));
mkdirSync(join(scratch, 'config'), { recursive: true });
writeFileSync(join(scratch, 'cv.md'), '# Test Candidate\n\n## Experience\n');
writeFileSync(join(scratch, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Candidate\n');
writeFileSync(join(scratch, 'jd.txt'), 'Senior Platform Engineer at Acme. Build and run the payments APIs.');
writeFileSync(join(scratch, 'report.md'), '# Acme: Senior Platform Engineer\n');
const redirect = join(scratch, 'redirect-openai.mjs');
writeFileSync(redirect, `
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) =>
  realFetch(String(url).replace('https://api.openai.com/v1', ${JSON.stringify(base)}), init);
`);
const outputDir = join(scratch, 'output');
const savedHtml = () => (existsSync(outputDir) ? readdirSync(outputDir).filter((f) => f.endsWith('.html')) : []);

/** Run openai-tailor once; resolves with the exit code, output and captured request. */
function run({ env = {}, url = base, preload = null } = {}) {
  rmSync(outputDir, { recursive: true, force: true });
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OPENAI_|CAREER_OPS_)/.test(k)));
  Object.assign(childEnv, { CAREER_OPS_ROOT: scratch }, env);
  const before = requests.length;
  const argv = [
    ...(preload ? ['--import', pathToFileURL(preload).href] : []),
    join(ROOT, 'openai-tailor.mjs'),
    '--url', url, '--model', 'test/model',
    '--jd', join(scratch, 'jd.txt'), '--report', join(scratch, 'report.md'),
  ];
  return new Promise((resolve) => {
    execFile(NODE, argv, { cwd: scratch, timeout: 30000, env: childEnv }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        out: stdout + stderr,
        stderr,
        body: requests.length > before ? requests[requests.length - 1].body : null,
        saved: savedHtml(),
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
    else fail(`default request has no max_tokens = ${DEFAULT_MAX_TOKENS}: ${JSON.stringify({ max_tokens: b.max_tokens, max_completion_tokens: b.max_completion_tokens })} (exit ${r.code})\n${r.out.slice(-400)}`);
    if (!('max_completion_tokens' in b)) pass('does not also send max_completion_tokens to a gateway');
    else fail(`gateway request also carries max_completion_tokens: ${b.max_completion_tokens}`);
    if (r.code === 0 && r.saved.length === 1) pass('a complete reply is saved as the tailored CV');
    else fail(`complete reply: exit ${r.code}, saved ${JSON.stringify(r.saved)}\n${r.out.slice(-400)}`);
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

  // 5. A reply cut off by the limit is not saved, and the error names the variable.
  {
    finishReason = 'length';
    const r = await run({ env: { CAREER_OPS_MAX_TOKENS: '4096' } });
    finishReason = 'stop';
    if (r.code !== 0 && r.saved.length === 0 && /4096-token output cap/.test(r.stderr) && /CAREER_OPS_MAX_TOKENS/.test(r.stderr)) {
      pass('a reply that stops at the cap (finish_reason "length") is not saved');
    } else {
      fail(`finish_reason "length": exit ${r.code}, saved ${JSON.stringify(r.saved)}, stderr: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
    }
  }

  // 6. A 402 says which variable lowers the reservation.
  {
    status = 402;
    const r = await run();
    status = 200;
    if (r.code !== 0 && /HTTP 402/.test(r.stderr) && /lower CAREER_OPS_MAX_TOKENS/.test(r.stderr)) pass('an HTTP 402 names CAREER_OPS_MAX_TOKENS');
    else fail(`HTTP 402 without the hint: exit ${r.code}, stderr: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`);
  }
} finally {
  server.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
}
