// tests/liveness-api-himalayas.test.mjs — the Himalayas rung of the liveness ladder.
//
// Himalayas pages sit behind a Cloudflare challenge, so the browser rung (and
// its headed retry) can only meet the challenge. checkLivenessViaApi reads the
// public single-job API through himalayas-posting.mjs instead:
//
//   200 for this exact posting  -> active
//   410 with the documented expired payload -> expired
//   404, 5xx, transport error, partial payload -> null, the browser decides
//   any other Himalayas URL (not a posting) -> null, no request
//
// The fixture is the fictional posting tests/himalayas-posting.test.mjs uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkLivenessViaApi } from '../liveness-api.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/himalayas-job.json', import.meta.url), 'utf8'));
const POSTING = fixture.job.applicationLink;
const ENDPOINT = 'https://himalayas.app/jobs/api/companies/fixture-labs/jobs/product-manager';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// The fixture's expiry is fixed; move it ahead of today so "open" does not depend on the run date.
const live = () => { const f = structuredClone(fixture); f.job.expiryDate = Math.floor(Date.now() / 1000) + 30 * 86400; return f; };

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push(String(url)); return mock(url, options); };
  try { return { result: await run(), calls }; } finally { globalThis.fetch = previous; }
}

test('a listed posting is active, read through the single-job API', async () => {
  const { result, calls } = await withFetch(() => json(live()), () => checkLivenessViaApi(POSTING));
  assert.deepEqual(calls, [ENDPOINT]);
  assert.equal(result.result, 'active');
  assert.equal(result.code, 'himalayas_publisher_open');
});

test('the documented 410 expired payload is expired', async () => {
  const past = Math.floor(Date.now() / 1000) - 86400;
  const { result } = await withFetch(() => json({ ok: false, errors: 'This job has expired.', expired: true, expiryDate: past }, 410), () => checkLivenessViaApi(POSTING));
  assert.equal(result.result, 'expired');
  assert.equal(result.code, 'himalayas_closed');
});

test('a 404, a server error or a broken payload stays inconclusive for the browser', async () => {
  for (const respond of [
    () => json({ ok: false, errors: 'Job not found.' }, 404),
    () => json(live(), 503),
    () => json({ job: { title: 'x' } }),
    () => { throw new TypeError('fetch failed'); },
  ]) {
    const { result } = await withFetch(respond, () => checkLivenessViaApi(POSTING));
    assert.equal(result, null);
  }
});

test('a Himalayas URL that is not a posting makes no request', async () => {
  const { result, calls } = await withFetch(() => assert.fail('no request expected'), () => checkLivenessViaApi('https://himalayas.app/jobs'));
  assert.equal(result, null);
  assert.deepEqual(calls, []);
});
