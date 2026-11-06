import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveHimalayasPosting, classifyHimalayasPosting, retrieveHimalayasPosting } from '../himalayas-posting.mjs';

// Public API field/status shapes verified 2026-11-04 against the official docs
// and single-job endpoint. All company, role text and IDs below are fictional.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/himalayas-job.json', import.meta.url), 'utf8'));
const source = fixture.job.applicationLink;
const endpoint = 'https://himalayas.app/jobs/api/companies/fixture-labs/jobs/product-manager';
const retrievedAt = '2026-11-04T20:00:00.000Z';
const now = () => Date.parse(retrievedAt);
const clone = () => structuredClone(fixture);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('only exact, safe Himalayas posting paths resolve; original tracking URL is retained', () => {
  const identity = resolveHimalayasPosting(source);
  assert.equal(identity.apiUrl, endpoint);
  assert.equal(identity.originalUrl, source);
  assert.equal(identity.guid, fixture.job.guid);
  assert.equal(resolveHimalayasPosting(fixture.job.guid + '/#apply').apiUrl, endpoint);
  for (const value of [source.replace('https:', 'http:'), source.replace('himalayas.app', 'himalayas.app.evil.test'),
    source.replace('himalayas.app', 'user:password@himalayas.app'), source.replace('/jobs/', '/jobs/%2e%2e/'),
    source.replace('/jobs/', '/jobs/../'), source.replace('/jobs/', '/jobs/%2f/'), source.replace('?utm_source=api', '?job=another'),
    fixture.job.guid + '/apply', 'https://himalayas.app/jobs', 'https://himalayas.app/companies/fixture-labs/jobs/product-manager\\x']) {
    assert.equal(resolveHimalayasPosting(value), null, value);
  }
});

test('one anonymous documented GET retains exact identity, full description and honest cache evidence', async () => {
  const calls = [];
  const result = await retrieveHimalayasPosting(source, { now, fetchFn: async (url, options) => {
    calls.push({ url, options });
    return json(fixture, 200, { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=300', age: '120' });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, endpoint);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.method, 'GET');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.equal(result.publisherStatus, 'open');
  assert.equal(result.originalUrl, source);
  assert.deepEqual(result.job, fixture.job);
  assert.equal(result.retrievedAt, retrievedAt);
  assert.equal(result.cache.documentedMaxAgeSeconds, 600);
  assert.equal(result.cache.ageSeconds, 120);
  assert.match(result.cache.cacheControl, /stale-while-revalidate=300/);
  assert.equal(result.employerVerified, false);
  assert.equal(result.applicationVerified, false);
  assert.equal(result.evaluationAllowed, false);
});

test('only documented 410 closure closes; API 404 and inconsistent 200 expiry remain unknown', () => {
  assert.equal(classifyHimalayasPosting(source, 410, { ok: false, errors: 'This job has expired.', expired: true, expiryDate: 1793664000 }, { retrievedAt }).publisherStatus, 'closed');
  for (const body of [null, {}, { expired: true }, { ok: false, expired: true, expiryDate: 1795046400 }, { ok: false, expired: true, expiryDate: 1793664000, guid: 'different-job' }]) {
    assert.equal(classifyHimalayasPosting(source, 410, body, { retrievedAt }).publisherStatus, 'unknown');
  }
  for (const body of [{ ok: false, errors: 'Job not found.' }, { expired: true }, fixture]) {
    assert.equal(classifyHimalayasPosting(source, 404, body, { retrievedAt }).publisherStatus, 'unknown');
  }
  const old = clone(); old.job.expiryDate = 1793664000;
  assert.equal(classifyHimalayasPosting(source, 200, old, { retrievedAt }).publisherStatus, 'unknown');
});

test('mismatched, partial or challenge payloads cannot establish publisher-open evidence', () => {
  for (const mutate of [
    value => { value.job.guid += '-another'; },
    value => { value.job.companySlug = 'another-company'; },
    value => { value.job.applicationLink = 'https://example.invalid/application'; },
    value => { value.job.applicationLink += '&job=another'; },
    value => { value.job.description = 'Short excerpt only.'; },
    value => { value.job.description = '<div id="cf-chl-123">' + value.job.description + '</div>'; },
    value => { value.job.title = 'Just a moment'; },
    value => { delete value.job.locationRestrictions; },
    value => { value.job.pubDate = 'yesterday'; },
  ]) {
    const changed = clone(); mutate(changed);
    assert.equal(classifyHimalayasPosting(source, 200, changed, { retrievedAt }).publisherStatus, 'unknown');
  }
  assert.equal(classifyHimalayasPosting(source, 200, fixture, { retrievedAt, ageSeconds: 601 }).publisherStatus, 'unknown');
});

test('HTML, malformed JSON, redirects, limits and network failure remain unknown without retries', async () => {
  const cases = [
    () => new Response('<html>Challenge</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => new Response('{broken', { status: 200, headers: { 'content-type': 'application/json' } }),
    () => Response.redirect('https://example.invalid/redirect', 302),
    () => json(fixture, 429), () => json(fixture, 503),
    () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    () => { throw new Error('unavailable'); },
  ];
  for (const response of cases) {
    let calls = 0;
    const result = await retrieveHimalayasPosting(source, { now, fetchFn: async () => { calls++; return response(); } });
    assert.equal(result.publisherStatus, 'unknown'); assert.equal(result.evaluationAllowed, false); assert.equal(calls, 1);
  }
  const result = await retrieveHimalayasPosting('https://example.invalid/job', { fetchFn: () => assert.fail('unsupported host must not fetch') });
  assert.equal(result.publisherStatus, 'unknown');
});

test('an unexpected final URL is refused and its unread response is released', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
  Object.defineProperty(response, 'url', { value: 'https://example.invalid/another-job' });
  const result = await retrieveHimalayasPosting(source, { now, fetchFn: async () => response });
  assert.equal(result.publisherStatus, 'unknown');
  assert.equal(result.code, 'response_url_mismatch');
  assert.equal(cancelled, true);
});

test('CLI reads only a scratch JSON request and never echoes rejected credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'himalayas-request-'));
  try {
    const file = path.join(root, 'request.json');
    fs.writeFileSync(file, JSON.stringify({ url: 'https://fixture:secret@himalayas.app/companies/fixture/jobs/role' }));
    const result = spawnSync(process.execPath, ['himalayas-posting.mjs', '--request', file], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).publisherStatus, 'unknown');
    assert.doesNotMatch(result.stdout + result.stderr, /fixture:secret/);
    assert.deepEqual(fs.readdirSync(root), ['request.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('CLI accepts bounded stdin JSON without needing or creating a request file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'himalayas-stdin-'));
  const script = fileURLToPath(new URL('../himalayas-posting.mjs', import.meta.url));
  try {
    const result = spawnSync(process.execPath, [script, '--request', '-'], { cwd: root, input: JSON.stringify({ url: 'https://fixture:secret@example.invalid/job' }), encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).publisherStatus, 'unknown');
    assert.doesNotMatch(result.stdout + result.stderr, /fixture:secret/);
    assert.deepEqual(fs.readdirSync(root), []);
    const large = spawnSync(process.execPath, [script, '--request', '-'], { cwd: root, input: 'x'.repeat(16 * 1024 + 1), encoding: 'utf8' });
    assert.equal(large.status, 2);
    assert.equal(large.stdout, '');
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI reached through a linked checkout still reads stdin instead of silently succeeding', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'himalayas-linked-'));
  try {
    const link = path.join(root, 'checkout');
    try { fs.symlinkSync(fileURLToPath(new URL('..', import.meta.url)), link, 'junction'); }
    catch (error) { return t.skip(`directory symlinks unavailable: ${error.code}`); }
    const result = spawnSync(process.execPath, [path.join(link, 'himalayas-posting.mjs'), '--request', '-'], {
      cwd: root, input: JSON.stringify({ url: 'https://example.invalid/unsupported' }), encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).publisherStatus, 'unknown');
    assert.deepEqual(fs.readdirSync(root), ['checkout']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI help is input-independent and refuses unknown combined flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'himalayas-help-'));
  const script = fileURLToPath(new URL('../himalayas-posting.mjs', import.meta.url));
  try {
    const run = args => spawnSync(process.execPath, [script, ...args], { cwd: root, input: 'not JSON', encoding: 'utf8' });
    const long = run(['--help']);
    const short = run(['-h']);
    assert.equal(long.status, 0);
    assert.equal(short.status, 0);
    assert.match(long.stdout, /^Usage:/);
    assert.equal(short.stdout, long.stdout);
    assert.equal(long.stderr + short.stderr, '');
    const invalid = run(['--help', '--bogus']);
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stdout, '');
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
