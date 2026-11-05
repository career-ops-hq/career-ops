import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { readEvaluationSource, evaluationSourceEvidence } from '../../src/lib/evaluation-source.mjs';

const ORIGINAL = 'https://jobs.ashbyhq.com/fictional/11111111-1111-4111-8111-111111111111';
const API = 'https://api.ashbyhq.com/posting-api/job-board/fictional';
const TEXT = 'Location: Fictional location\nWork model: Remote\n\n' + 'Own discovery, delivery and product measurement with engineering and customers. '.repeat(10);
const transport = (status = 200) => ({ fetchCallCount: 1, requests: [{ requestURL: API, method: 'GET', requestedAt: '2026-01-01T00:00:00.000Z', accept: 'application/json', userAgent: 'fictional-client', httpStatus: status, finalURL: API, redirected: false, respondedAt: '2026-01-01T00:00:01.000Z' }] });
const packet = (overrides = {}) => ({ version: 1, originalURL: ORIGINAL, textCap: 20_000, result: { url: ORIGINAL, ats: 'ashby', title: 'Fictional Product Manager', text: TEXT }, transport: transport(), ...overrides });

function childFactory(onInput, { closeOnKill = true } = {}) {
  const calls = [], children = [];
  const spawnFn = (bin, args, options) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.pid = 4321;
    child.stdout.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = input => { calls.at(-1).input = input; queueMicrotask(() => onInput?.(child, input)); };
    child.kills = [];
    child.kill = signal => { child.kills.push(signal); if (closeOnKill || signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null)); return true; };
    calls.push({ bin, args, options, input: null }); children.push(child); return child;
  };
  return { spawnFn, calls, children };
}

test('packet keeps actual transport separate from untrusted JD and never infers open status', () => {
  const unlisted = packet(); unlisted.result.text = 'Not currently listed (isListed: false)\n' + TEXT;
  const result = evaluationSourceEvidence(unlisted, ORIGINAL);
  assert.equal(result.outcome, 'available'); assert.match(result.jobData.text, /isListed: false/);
  assert.equal(result.transport.requests[0].httpStatus, 200);
  assert.equal('open' in result, false); assert.equal('isListed' in result, false);
  assert.equal(result.originalURL, ORIGINAL);
});

test('HTTP201/403/404/410, missing final URL and empty results remain inconclusive, never closed', () => {
  for (const status of [201, 403, 404, 410]) {
    const result = evaluationSourceEvidence(packet({ transport: transport(status) }), ORIGINAL);
    assert.equal(result.outcome, 'inconclusive'); assert.equal(result.transport.requests[0].httpStatus, status);
    assert.equal('jobData' in result, false); assert.equal('closed' in result, false);
  }
  const missing = packet(); missing.transport.requests[0].finalURL = null;
  assert.equal(evaluationSourceEvidence(missing, ORIGINAL).outcome, 'inconclusive');
  assert.equal(evaluationSourceEvidence(packet({ result: null }), ORIGINAL).outcome, 'inconclusive');
});

test('caps, native ellipsis, thin metadata and JS shells are not injected as substantive JD', () => {
  for (const text of [TEXT + '…', 'x'.repeat(20_000), 'Location: ' + 'Somewhere '.repeat(50), 'You need to enable JavaScript to run this app.', '   ']) {
    const p = packet(); p.result.text = text;
    const result = evaluationSourceEvidence(p, ORIGINAL);
    assert.equal(result.outcome, 'inconclusive'); assert.equal('jobData' in result, false);
  }
});

test('mismatched original URL, inconsistent counts and malformed provenance cannot be trusted', () => {
  assert.equal(evaluationSourceEvidence(packet(), 'https://example.invalid/other'), null);
  for (const mutate of [p => { p.transport.fetchCallCount = 0; }, p => { p.transport.requests[0].method = 'POST'; }, p => { p.transport.requests[0].httpStatus = '200'; }, p => { p.transport.requests[0].requestedAt = 'unknown'; }, p => { p.transport.requests[0].finalURL = 'file:///private'; }]) {
    const p = packet(); mutate(p); assert.equal(evaluationSourceEvidence(p, ORIGINAL), null);
  }
  const wrong = packet(); wrong.result.url = 'https://example.invalid/other';
  assert.equal(evaluationSourceEvidence(wrong, ORIGINAL).outcome, 'inconclusive');
  const extra = packet(); extra.transport.requests[0].authorization = 'secret-never-forwarded';
  assert.doesNotMatch(JSON.stringify(evaluationSourceEvidence(extra, ORIGINAL)), /secret-never-forwarded|authorization/);
});

test('backend runs one fixed Node argv and sends URL only as JSON stdin', async () => {
  const f = childFactory(child => { child.stdout.emit('data', JSON.stringify(packet())); child.emit('close', 0); });
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture/root', execPath: '/fixture/node', spawnFn: f.spawnFn });
  assert.equal(result.outcome, 'available'); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, [path.join('/fixture/root', 'read-known-jd.mjs'), '--request', '-']);
  assert.equal(f.calls[0].options.shell, false); assert.equal(f.calls[0].options.cwd, '/fixture/root');
  assert.deepEqual(JSON.parse(f.calls[0].input), { url: ORIGINAL });
  assert.equal(f.calls[0].args.some(arg => arg === ORIGINAL), false);
  assert.equal(f.children[0].listenerCount('close'), 0);
});

test('shell-looking URL bytes remain literal stdin data and are never shell argv/code', async () => {
  const input = 'https://jobs.ashbyhq.com/fictional/$(touch-owned);`echo-owned`';
  const f = childFactory(child => child.emit('close', 1));
  await readEvaluationSource({ kind: 'evaluate', input, root: '/fixture/root', spawnFn: f.spawnFn });
  assert.equal(f.calls.length, 1); assert.deepEqual(JSON.parse(f.calls[0].input), { url: input });
  assert.ok(!f.calls[0].args.some(x => x.includes('touch-owned'))); assert.equal(f.calls[0].options.shell, false);
});

test('LinkedIn, non-evaluation and invalid input do not even spawn the reader', async () => {
  const f = childFactory();
  for (const [kind, input] of [['pdf', ORIGINAL], ['cover', ORIGINAL], ['research', ORIGINAL], ['evaluate', 'https://UK.LINKEDIN.COM./jobs/1'], ['evaluate', 'https://user:password@example.test/job'], ['evaluate', ORIGINAL + '\n'], ['evaluate', 'pasted job text'], ['evaluate', 'file:///etc/passwd']]) {
    assert.equal((await readEvaluationSource({ kind, input, root: '/fixture', spawnFn: f.spawnFn })).outcome, 'skipped');
  }
  assert.equal(f.calls.length, 0);
});

test('abort before launch spawns nothing; abort during source read waits for child close', async () => {
  const before = new AbortController(); before.abort(); const unused = childFactory();
  assert.equal((await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', signal: before.signal, spawnFn: unused.spawnFn })).outcome, 'aborted');
  assert.equal(unused.calls.length, 0);
  const during = new AbortController(); const f = childFactory(() => during.abort());
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', signal: during.signal, spawnFn: f.spawnFn });
  assert.equal(result.outcome, 'aborted'); assert.deepEqual(f.children[0].kills, ['SIGTERM']);
});

test('deadline escalates and waits for close; helper failure does not pretend zero API calls', async () => {
  const f = childFactory(null, { closeOnKill: false });
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn, timeoutMs: 5, killGraceMs: 5 });
  assert.equal(result.outcome, 'inconclusive'); assert.equal(result.reason, 'timeout');
  assert.deepEqual(f.children[0].kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.evidence.transport.fetchCallCount, null);
});

test('packet/stdout/stderr bounds fail before parsing or forwarding oversized data', async () => {
  for (const [stream, chunk, reason] of [['stdout', 'x'.repeat(128 * 1024 + 1), 'output_limit'], ['stderr', 'x'.repeat(4097), 'stderr_limit']]) {
    const f = childFactory(child => child[stream].emit('data', chunk));
    const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn });
    assert.equal(result.reason, reason); assert.equal(result.outcome, 'inconclusive'); assert.equal('jobData' in result.evidence, false);
    assert.deepEqual(f.children[0].kills, ['SIGTERM']);
  }
  const f = childFactory(child => { child.stdout.emit('data', '{invalid'); child.emit('close', 0); });
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn });
  assert.equal(result.reason, 'invalid_packet'); assert.equal(result.evidence.transport.fetchCallCount, null);
});

test('a started-child kill error cannot resolve the read or cancel escalation before close', async () => {
  const f = childFactory(null, { closeOnKill: false });
  const original = f.spawnFn;
  f.spawnFn = (...args) => {
    const child = original(...args);
    child.kill = signal => {
      child.kills.push(signal);
      if (signal === 'SIGTERM') queueMicrotask(() => child.emit('error', Error('fictional kill failure')));
      else queueMicrotask(() => child.emit('close', null));
      return true;
    };
    return child;
  };
  let settled = false;
  const promise = readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: f.spawnFn, timeoutMs: 5, killGraceMs: 30 }).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(settled, false, 'SIGTERM error alone is not closure');
  const result = await promise;
  assert.equal(result.reason, 'timeout'); assert.deepEqual(f.children[0].kills, ['SIGTERM', 'SIGKILL']);
});

test('setup/stdin exceptions stop an already-started reader and wait for its close', async () => {
  for (const point of ['setup', 'stdin']) {
    const f = childFactory(null, { closeOnKill: false });
    const spawnFn = (...args) => {
      const child = f.spawnFn(...args);
      if (point === 'setup') child.stdout.setEncoding = () => { throw Error('fixture setup'); };
      else child.stdin.end = () => { throw Error('fixture stdin'); };
      return child;
    };
    let settled = false;
    const pending = readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn, killGraceMs: 1000 }).then(result => { settled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.deepEqual(f.children[0].kills, ['SIGTERM']);
    f.children[0].emit('close', null);
    assert.equal((await pending).reason, 'helper_failed');
  }
  const result = await readEvaluationSource({ kind: 'evaluate', input: ORIGINAL, root: '/fixture', spawnFn: () => { throw Error('no child spawned'); } });
  assert.equal(result.reason, 'helper_failed');
});
