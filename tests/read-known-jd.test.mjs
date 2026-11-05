import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recordedGetFetch, knownJdInput, KNOWN_JD_REQUEST_LIMIT } from '../read-known-jd.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ORIGINAL = 'https://jobs.ashbyhq.com/fictional/11111111-1111-4111-8111-111111111111';
const API = 'https://api.ashbyhq.com/posting-api/job-board/fictional';
const JD = 'Own the product roadmap, discovery and delivery. Partner with engineering and customers, define success measures, and validate product decisions against research. '.repeat(8);

test('metadata observer preserves the exact response/options without reading or cloning the body', async () => {
  const records = [], options = { headers: { accept: 'application/json', 'user-agent': 'fictional-client', authorization: 'private-not-recorded', cookie: 'private-not-recorded' }, redirect: 'error', signal: new AbortController().signal };
  const response = { status: 200, url: API, redirected: false,
    get clone() { throw Error('must not clone'); }, get json() { throw Error('must not consume'); }, get text() { throw Error('must not consume'); } };
  const wrapped = recordedGetFetch(async (url, init) => { assert.equal(url, API); assert.equal(init, options); return response; }, records, () => '2026-01-01T00:00:00.000Z');
  assert.equal(await wrapped(API, options), response);
  assert.equal(records.length, 1);
  assert.equal(records[0].httpStatus, 200);
  assert.equal(records[0].finalURL, API);
  assert.equal(records[0].accept, 'application/json');
  assert.equal(records[0].userAgent, 'fictional-client');
  assert.doesNotMatch(JSON.stringify(records), /private-not-recorded|authorization|cookie/);
});

test('metadata observer rejects non-GET before a request and records network failure without inventing status', async () => {
  const records = []; let calls = 0;
  const wrapped = recordedGetFetch(async () => { calls++; throw Error('fictional network failure'); }, records);
  await assert.rejects(wrapped(API, { method: 'POST' }));
  assert.equal(calls, 0); assert.equal(records.length, 0);
  await assert.rejects(wrapped(API));
  assert.equal(calls, 1); assert.equal(records[0].httpStatus, null); assert.equal(records[0].finalURL, null);
});

test('URL boundary preserves the literal URL but rejects userinfo, control characters and non-web inputs', () => {
  assert.equal(knownJdInput(ORIGINAL).originalURL, ORIGINAL);
  for (const input of ['not a URL', 'file:///etc/passwd', 'https://user:password@example.test/job', ORIGINAL + '\n', ' https://example.test/job', 'https://example.test/\u0000']) assert.equal(knownJdInput(input), null);
  for (const url of ['https://linkedin.com/jobs/1', 'https://uk.linkedin.com/jobs/1', 'https://LINKEDIN.COM./jobs/1']) assert.equal(knownJdInput(url).linkedIn, true);
});

function fixture(t, { status = 200, description = JD, isListed = true, url = ORIGINAL } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'known-jd-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = path.join(root, 'fetch-calls.jsonl');
  const preload = path.join(root, 'fetch-preload.mjs');
  const json = { jobs: [{ id: ORIGINAL.split('/').at(-1), title: 'Fictional Product Manager', descriptionPlain: description, location: 'Fictional location', workplaceType: 'Remote', employmentType: 'FullTime', isListed }] };
  fs.writeFileSync(preload, `import fs from 'node:fs'; globalThis.fetch=async(url,options)=>{fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({url,headers:Object.fromEntries(new Headers(options?.headers))})+'\\n');return {status:${status},ok:${status >= 200 && status < 300},url:String(url),redirected:false,json:async()=>(${JSON.stringify(json)})};};`);
  const run = (args = ['--request', '-'], input = JSON.stringify({ url }), script = path.join(ROOT, 'read-known-jd.mjs')) => spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script, ...args], { cwd: root, input, encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root } });
  const requests = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { root, run, requests };
}

test('actual isolated CLI delegates native Ashby normalization once and records actual transport separately', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.originalURL, ORIGINAL); assert.equal(packet.result.url, ORIGINAL);
  assert.equal(packet.result.ats, 'ashby'); assert.equal(packet.result.title, 'Fictional Product Manager');
  assert.ok(packet.result.text.includes(JD.trim()));
  assert.equal(packet.transport.fetchCallCount, 1); assert.equal(f.requests().length, 1);
  assert.equal(packet.transport.requests[0].requestURL, API); assert.equal(packet.transport.requests[0].finalURL, API);
  assert.equal(packet.transport.requests[0].httpStatus, 200);
  assert.equal(packet.transport.requests[0].accept, 'application/json');
  assert.match(packet.transport.requests[0].userAgent, /career-ops\/1\.0/);
  assert.equal(packet.textCap, 20_000); assert.ok(!('open' in packet)); assert.ok(!('isListed' in packet));
});

test('native unlisted marker survives without a fabricated open verdict', t => {
  const f = fixture(t, { isListed: false }), packet = JSON.parse(f.run().stdout);
  assert.match(packet.result.text, /Not currently listed \(isListed: false\)/);
  assert.ok(!('open' in packet)); assert.ok(!('isListed' in packet));
});

test('actual non-200 and any-2xx facts are not rewritten as HTTP200', t => {
  for (const status of [201, 403, 404, 410]) {
    const f = fixture(t, { status }), packet = JSON.parse(f.run().stdout);
    assert.equal(packet.transport.requests[0].httpStatus, status);
    assert.equal(packet.result !== null, status === 201);
  }
});

test('core LinkedIn precedence and unsupported URLs cause zero fetch calls', t => {
  for (const url of ['https://linkedin.com/jobs/1', 'https://UK.LINKEDIN.COM./jobs/1', 'https://example.invalid/job/1']) {
    const f = fixture(t, { url }), packet = JSON.parse(f.run().stdout);
    assert.equal(packet.result, null); assert.equal(packet.transport.fetchCallCount, 0); assert.deepEqual(f.requests(), []);
  }
});

test('request bound is checked before JSON parse; help/import never reads input or fetches', async t => {
  const f = fixture(t);
  assert.equal(f.run(['--request', '-'], ' '.repeat(KNOWN_JD_REQUEST_LIMIT + 1)).status, 2);
  for (const flag of ['--help', '-h']) {
    const run = f.run([flag], '{not json'); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Usage:/);
  }
  assert.equal(f.run(['--help', '--unexpected']).status, 2);
  const before = globalThis.fetch;
  await import(pathToFileURL(path.join(ROOT, 'read-known-jd.mjs')).href + '?import-safe');
  assert.equal(globalThis.fetch, before);
  assert.deepEqual(f.requests(), []);
});

test('CLI invocation through a linked checkout still reads the request', t => {
  const f = fixture(t); const link = path.join(f.root, 'linked');
  try { fs.symlinkSync(ROOT, link, 'junction'); } catch (error) { if (['EPERM','EACCES','ENOSYS'].includes(error.code)) { t.skip('directory links unavailable'); return; } throw error; }
  const result = f.run(['--request', '-'], JSON.stringify({ url: ORIGINAL }), path.join(link, 'read-known-jd.mjs'));
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).result.ats, 'ashby');
});
