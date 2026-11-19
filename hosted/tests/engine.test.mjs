import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createEngine } from '../engine.mjs';
import { runProcess } from '../process.mjs';

const engineRevision = '3c15976d1c434403b73c5b6ca641101b85a30c65';

async function fixture(t, name = 'Synthetic Alpha') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-engine-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'config'));
  await fs.mkdir(path.join(root, 'modes'));
  await fs.mkdir(path.join(root, 'data'));
  await fs.writeFile(path.join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n');
  await fs.writeFile(path.join(root, 'cv.md'), `# ${name}\n\n## Experience\n\n### Software Engineer | Example Labs | 2022–2025\nBuilt internal reporting tools with Python.\n`);
  await fs.writeFile(path.join(root, 'config', 'profile.yml'), `name: ${name}\noutput_language: en\n`);
  await fs.writeFile(path.join(root, 'modes', '_profile.md'), 'Target: software engineer. Use only supplied facts.');
  return root;
}

async function mockProvider(t, response = null) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    const text = response ?? `## Block A — Fit\nSynthetic test report. Python experience matches the pasted posting.\n\n---SCORE_SUMMARY---\nCOMPANY: Example Employer\nROLE: Software Engineer\nSCORE: 4.1\nARCHETYPE: Engineering\nLEGITIMACY: Proceed with Caution\n---END_SUMMARY---`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { requests, provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'synthetic-fixture-model' } };
}

test('real evaluator and merge: concurrent workspaces stay separate; replay avoids a second model call', async t => {
  const a = await fixture(t), b = await fixture(t, 'Synthetic Beta');
  const { provider, requests } = await mockProvider(t);
  const engine = createEngine({ provider, engineRevision, allowLocalProvider: true });
  const inputA = { workspace: a, jobId: randomUUID(), postingText: 'Example Employer needs a Python Software Engineer.', postingUrl: 'https://example.org/jobs/alpha' };
  const inputB = { workspace: b, jobId: randomUUID(), postingText: 'Example Employer needs a Python Software Engineer.', postingUrl: 'https://example.org/jobs/beta' };
  const settled = await Promise.allSettled([engine.evaluate(inputA), engine.evaluate(inputB)]);
  for (const result of settled) if (result.status === 'rejected') throw result.reason;
  const [ra, rb] = settled.map(result => result.value);
  assert.equal(ra.score, '4.1/5');
  assert.equal(rb.company, 'Example Employer');
  assert.equal(requests.length, 2);
  const prompts = requests.map(r => JSON.stringify(r.messages));
  assert.ok(prompts.some(p => p.includes('Synthetic Alpha') && !p.includes('Synthetic Beta')));
  assert.ok(prompts.some(p => p.includes('Synthetic Beta') && !p.includes('Synthetic Alpha')));
  const trackerA = await fs.readFile(path.join(a, 'data', 'applications.md'), 'utf8');
  const trackerB = await fs.readFile(path.join(b, 'data', 'applications.md'), 'utf8');
  assert.ok(!trackerA.includes('/beta'));
  assert.ok(!trackerB.includes('/alpha'));
  assert.match(await fs.readFile(path.join(a, ra.report), 'utf8'), /example.org\/jobs\/alpha/);
  assert.equal((await engine.evaluate(inputA)).replayed, true);
  assert.equal(requests.length, 2);
  await assert.rejects(engine.evaluate({ ...inputA, postingText: 'Different posting' }), { code: 'idempotency_conflict' });
});

test('missing summary fails closed and a partial job requires recovery', async t => {
  const workspace = await fixture(t);
  const { provider } = await mockProvider(t, 'A plausible narrative without structured summary.');
  const engine = createEngine({ provider, engineRevision, allowLocalProvider: true });
  const input = { workspace, jobId: randomUUID(), postingText: 'Synthetic job' };
  await assert.rejects(engine.evaluate(input), { code: 'invalid_evaluation' });
  await assert.rejects(engine.evaluate(input), { code: 'job_needs_recovery' });
  assert.ok(!(await fs.readFile(path.join(workspace, 'data', 'applications.md'), 'utf8')).includes('Evaluated'));
});

test('rejects invalid input, ambient dotenv and concurrent workspace mutation', async t => {
  const workspace = await fixture(t);
  const { provider, requests } = await mockProvider(t);
  const engine = createEngine({ provider, engineRevision, allowLocalProvider: true });
  const input = { workspace, jobId: randomUUID(), postingText: 'Synthetic job' };
  await assert.rejects(engine.evaluate({ ...input, jobId: '../escape' }), { code: 'invalid_job_id' });
  await assert.rejects(engine.evaluate({ ...input, postingUrl: 'file:///secret' }), { code: 'invalid_posting_url' });
  await fs.writeFile(path.join(workspace, '.env'), 'OPENAI_BASE_URL=https://wrong.invalid');
  await assert.rejects(engine.evaluate(input), { code: 'workspace_configuration_forbidden' });
  await fs.unlink(path.join(workspace, '.env'));
  await fs.mkdir(path.join(workspace, '.hosted', 'mutation.lock'), { recursive: true });
  await assert.rejects(engine.evaluate(input), { code: 'workspace_busy' });
  assert.equal(requests.length, 0);
});

test('provider endpoints require HTTPS unless a local test endpoint is explicitly enabled', () => {
  assert.throws(() => createEngine({ engineRevision, provider: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'test' } }), { code: 'invalid_provider' });
  assert.throws(() => createEngine({ engineRevision, provider: { baseUrl: 'https://user:secret@example.org/v1', model: 'test', apiKey: 'test' } }), { code: 'invalid_provider' });
  assert.throws(() => createEngine({ provider: {} }), { code: 'engine_revision_required' });
});

test('tracker is required before a model call, and filesystem errors do not expose server paths', async t => {
  const workspace = await fixture(t);
  const { provider, requests } = await mockProvider(t);
  const engine = createEngine({ provider, engineRevision, allowLocalProvider: true });
  const input = { workspace, jobId: randomUUID(), postingText: 'Synthetic job' };
  await fs.unlink(path.join(workspace, 'data', 'applications.md'));
  await assert.rejects(engine.evaluate(input), { code: 'tracker_required' });
  await assert.rejects(engine.evaluate({ ...input, workspace: path.join(workspace, 'missing') }), error =>
    error.code === 'workspace_io_failed' && !error.message.includes(workspace));
  assert.equal(requests.length, 0);
});

test('process contract handles timeout, cancellation, output cap and nonzero exits without leaking output', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-process-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'child.mjs');
  await fs.writeFile(script, `if (process.argv[2] === 'wait') setInterval(() => {}, 1000);\nelse if (process.argv[2] === 'large') console.log('x'.repeat(10000));\nelse { console.error('private-provider-response'); process.exitCode = 1; }`);
  const run = (args, opts = {}) => runProcess({ script, args, cwd: root, env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows' }, ...opts });
  await assert.rejects(run(['wait'], { timeoutMs: 200 }), { code: 'timed_out' });
  await assert.rejects(run(['large'], { maxBytes: 100 }), { code: 'output_limit' });
  await assert.rejects(run([]), error => error.code === 'engine_failed' && !error.message.includes('private-provider-response'));
  const controller = new AbortController();
  const pending = run(['wait'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'cancelled' });
});
