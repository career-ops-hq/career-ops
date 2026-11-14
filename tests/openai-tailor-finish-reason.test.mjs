// tests/openai-tailor-finish-reason.test.mjs — openai-tailor saves only a reply
// that finished, as openai-eval does since #3949.
//
// The tailor refused finish_reason "length" (#6762) and saved every other
// reply. A reply that ends on "content_filter" or "error" (both on OpenRouter's
// normalized list) stopped part-way, so its HTML is a CV with sections
// missing, and saving it hands that to generate-pdf as the tailored CV. A
// server that omits finish_reason is not refused: nothing says the reply
// stopped early.
//
// This drives the real CLI against a mock endpoint, the same way
// tests/openai-tailor-max-tokens.test.mjs does.
import { createServer } from 'http';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nopenai-tailor.mjs — saves only a reply that finished (finish_reason "stop")');

// A reply cut off before its last sections: no closing tags.
const PARTIAL_HTML = '<!DOCTYPE html><html><body><h1>Test Candidate</h1><h2>Experience</h2><ul><li>Built the';
const HTML = '<!DOCTYPE html><html><body><h1>Test Candidate</h1></body></html>';

/** @type {{ finish_reason?: unknown }} */
let choiceExtra = { finish_reason: 'stop' };
let content = HTML;
const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content }, ...choiceExtra }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;

// openai-tailor loads .env from its cwd and reads the CV and profile from the
// data root, so a developer's own files must not decide what this test sees.
const scratch = mkdtempSync(join(tmpdir(), 'cops-openai-tailor-finish-'));
mkdirSync(join(scratch, 'config'), { recursive: true });
writeFileSync(join(scratch, 'cv.md'), '# Test Candidate\n\n## Experience\n');
writeFileSync(join(scratch, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Candidate\n');
writeFileSync(join(scratch, 'jd.txt'), 'Senior Platform Engineer at Acme. Build and run the payments APIs.');
writeFileSync(join(scratch, 'report.md'), '# Acme: Senior Platform Engineer\n');
const outputDir = join(scratch, 'output');
const savedHtml = () => (existsSync(outputDir) ? readdirSync(outputDir).filter((f) => f.endsWith('.html')) : []);

/** Run openai-tailor once against the mock; resolves with the exit code, stderr and saved files. */
function run() {
  rmSync(outputDir, { recursive: true, force: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OPENAI_|CAREER_OPS_)/.test(k)));
  env.CAREER_OPS_ROOT = scratch;
  const argv = [
    join(ROOT, 'openai-tailor.mjs'),
    '--url', base, '--model', 'test/model',
    '--jd', join(scratch, 'jd.txt'), '--report', join(scratch, 'report.md'),
  ];
  return new Promise((resolve) => {
    execFile(NODE, argv, { cwd: scratch, timeout: 30000, env }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: stdout + stderr, stderr, saved: savedHtml() });
    });
  });
}

try {
  // A reply that stopped part-way is not saved, and the error names the reason.
  for (const reason of ['content_filter', 'error']) {
    choiceExtra = { finish_reason: reason };
    content = PARTIAL_HTML;
    const r = await run();
    if (r.code !== 0 && r.saved.length === 0 && r.stderr.includes(`finish_reason "${reason}"`) && /Nothing was saved/.test(r.stderr)) {
      pass(`a reply that ends with finish_reason "${reason}" is not saved`);
    } else {
      fail(`finish_reason "${reason}": exit ${r.code}, saved ${JSON.stringify(r.saved)}, stderr: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
    }
  }

  // A finished reply is saved, and so is one from a server that omits the field.
  for (const [label, extra] of [['finish_reason "stop"', { finish_reason: 'stop' }], ['no finish_reason', {}], ['finish_reason null', { finish_reason: null }]]) {
    choiceExtra = extra;
    content = HTML;
    const r = await run();
    if (r.code === 0 && r.saved.length === 1) pass(`a reply with ${label} is saved as the tailored CV`);
    else fail(`${label}: exit ${r.code}, saved ${JSON.stringify(r.saved)}\n${r.out.slice(-400)}`);
  }
} finally {
  server.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
}
