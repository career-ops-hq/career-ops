import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

export const engineRevision = '3c15976d1c434403b73c5b6ca641101b85a30c65';
export const browserExecutable = process.env.HOSTED_TEST_CHROMIUM || chromium.executablePath();

async function removeFixture(root, prefix) {
  // Restrict recursive deletion to the exact temp directory created by this test.
  const temp = path.resolve(os.tmpdir());
  if (path.dirname(root) !== temp || !path.basename(root).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
  await fs.rm(root, { recursive: true, force: true });
}

export async function candidate(t, name = 'Synthetic Alpha') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-cv-'));
  t.after(() => removeFixture(root, 'hosted-cv-'));
  for (const dir of ['config', 'modes', 'data']) await fs.mkdir(path.join(root, dir));
  await fs.writeFile(path.join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n');
  await fs.writeFile(path.join(root, 'cv.md'), `# ${name}\n\n## Experience\n\n### Example Labs — Remote\n**Software Engineer**\n2022–2025\n\n- Built internal reporting tools with Python.\n- Led a team of 4 engineers.\n`);
  await fs.writeFile(path.join(root, 'config', 'profile.yml'), `name: ${name}\noutput_language: en\ncandidate:\n  full_name: ${name}\ncv:\n  page_format: a4\n`);
  await fs.writeFile(path.join(root, 'config', 'cv-facts.json'), JSON.stringify({ allow_metrics: [], allow_facts: [], allow_swaps: [], forbidden_phrases: [], warn_phrases: [] }));
  await fs.writeFile(path.join(root, 'modes', '_profile.md'), 'Target software engineering roles. Use only confirmed source facts.');
  return root;
}

export function cvHtml(name = 'Synthetic Alpha', extra = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:40px;color:#182536}h1{font-size:28px}h2{font-size:18px;border-bottom:1px solid #ccc}li{margin:8px 0}</style></head><body><main><h1>${name}</h1><section><h2 class="section-title">Experience</h2><div class="job"><div class="job-role">Software Engineer</div><div class="job-company">Example Labs</div><div class="job-period">2022–2025</div><ul><li>Built internal reporting tools with Python.</li><li>Led a team of 4 engineers.</li></ul></div></section>${extra}</main></body></html>`;
}

export async function modelServer(t, html = request => cvHtml(JSON.stringify(request.messages).includes('Synthetic Beta') ? 'Synthetic Beta' : 'Synthetic Alpha')) {
  const requests = [], unexpected = [];
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { unexpected.push(req.url); res.writeHead(204); res.end(); return; }
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      requests.push(input);
      if (!input.stream) {
        const content = typeof html === 'function' ? html(input) : html;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
        return;
      }
      const report = '## Block A — Fit\nSynthetic evaluation of Python experience.\n\n---SCORE_SUMMARY---\nCOMPANY: Example Employer\nROLE: Software Engineer\nSCORE: 4.1\nARCHETYPE: Engineering\nLEGITIMACY: Proceed with Caution\n---END_SUMMARY---';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: report }, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { provider: { baseUrl: `${origin}/v1`, model: 'synthetic-fixture-model' }, requests, unexpected, origin };
}
