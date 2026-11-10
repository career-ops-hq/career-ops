// tests/openai-tailor-endpoint-headers.test.mjs — openai-tailor sends OpenCode
// Go the session id and user agent it asks for, as openai-eval does (#5825).
//
// OpenCode Go (https://opencode.ai/zen/go/v1) answers HTTP 400
// MissingSessionID to a request with no `x-opencode-session` header.
// openai-eval.mjs merges lib/endpoint-headers.mjs into its request, but
// openai-tailor.mjs, run against the same gateway for the CV that follows the
// evaluation, sent only Content-Type and Authorization.
//
// This drives the real CLI against a mock endpoint that records each request's
// headers. opencode.ai cannot be reached over loopback (the CLI refuses a
// non-HTTPS remote), so a preload rewrites that base URL to the mock: the CLI
// still sees opencode.ai as its host, which is what the headers are keyed on.
import { createServer } from 'http';
import { execFile } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nopenai-tailor.mjs — sends the session id and user agent OpenCode Go asks for');

const HTML = '<!DOCTYPE html><html><body><h1>Test Candidate</h1></body></html>';
const requests = [];
const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    requests.push(req.headers);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: HTML }, finish_reason: 'stop' }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;

// The data root and the children's cwd, so a developer's own CV, profile and
// .env stay out of the run.
const scratch = mkdtempSync(join(tmpdir(), 'cops-openai-tailor-headers-'));
mkdirSync(join(scratch, 'config'), { recursive: true });
writeFileSync(join(scratch, 'cv.md'), '# Test Candidate\n\n## Experience\n');
writeFileSync(join(scratch, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Candidate\n');
writeFileSync(join(scratch, 'jd.txt'), 'Senior Platform Engineer at Acme. Build and run the payments APIs.');
writeFileSync(join(scratch, 'report.md'), '# Acme: Senior Platform Engineer\n');
const redirect = join(scratch, 'redirect-opencode.mjs');
writeFileSync(redirect, `
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) =>
  realFetch(String(url).replace('https://opencode.ai/zen/go/v1', ${JSON.stringify(base)}), init);
`);

/** Run openai-tailor once; resolves with the exit code, output and the request's headers. */
function run({ url, preload = null }) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OPENAI_|CAREER_OPS_)/.test(k)));
  Object.assign(env, { CAREER_OPS_ROOT: scratch, OPENAI_API_KEY: 'test-key-not-real' });
  const before = requests.length;
  const argv = [
    ...(preload ? ['--import', pathToFileURL(preload).href] : []),
    join(ROOT, 'openai-tailor.mjs'),
    '--url', url, '--model', 'test/model',
    '--jd', join(scratch, 'jd.txt'), '--report', join(scratch, 'report.md'),
  ];
  return new Promise((resolve) => {
    execFile(NODE, argv, { cwd: scratch, timeout: 30000, env }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: stdout + stderr, headers: requests.length > before ? requests[requests.length - 1] : null });
    });
  });
}

try {
  const version = readFileSync(join(ROOT, 'VERSION'), 'utf-8').trim().split(/\s+/)[0];

  const go = await run({ url: 'https://opencode.ai/zen/go/v1', preload: redirect });
  const h = go.headers ?? {};
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(h['x-opencode-session'] ?? '')) {
    pass('opencode.ai gets an x-opencode-session id');
  } else {
    fail(`opencode.ai request has no session id: ${JSON.stringify(h['x-opencode-session'])} (exit ${go.code})\n${go.out.slice(-300)}`);
  }
  if (h['user-agent'] === `career-ops/${version}`) pass(`opencode.ai gets the User-Agent career-ops/${version}`);
  else fail(`opencode.ai User-Agent: ${JSON.stringify(h['user-agent'])}`);
  if (go.code === 0) pass('the tailoring run completes');
  else fail(`tailoring against opencode.ai exited ${go.code}\n${go.out.slice(-300)}`);

  const other = await run({ url: base });
  if (other.headers && !('x-opencode-session' in other.headers) && other.headers['user-agent'] !== `career-ops/${version}`) {
    pass('any other host gets no extra headers');
  } else {
    fail(`other host headers: ${JSON.stringify(other.headers)} (exit ${other.code})`);
  }
} finally {
  server.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
}
