// tests/liveness-api-workable.test.mjs — the Workable rung of the liveness ladder.
//
// Workable had no API rung, so every apply.workable.com URL fell through to
// Playwright. The posting pages render client-side, so a read before the app
// paints sees nav/footer only; classifyLiveness returned insufficient_content,
// which then read as expired — a live posting reported dead and written to
// scan-history as skipped (#5000, the costly direction).
//
// The rung reads the v2 JSON endpoint, which needs no browser:
//
//   GET /api/v2/accounts/{account}/jobs/{shortcode}
//   200 {"state":"published"} -> active
//   404 "Job not found"       -> expired (the endpoint is authoritative there)
//   any other readable state  -> uncertain, never expired
//
// The share link (apply.workable.com/j/{shortcode}) carries no account, so the
// account comes from the redirect the link already makes; the redirect target
// is validated before it can reach the API URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtsApi, checkLivenessViaApi, classifyWorkablePosting } from '../liveness-api.mjs';

const FULL = 'https://apply.workable.com/acme-corp/j/ABC12345';
const SHORT = 'https://apply.workable.com/j/ABC12345';
const API = 'https://apply.workable.com/api/v2/accounts/acme-corp/jobs/ABC12345';

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test('the two Workable URL shapes resolve, and only on the apply.workable.com host', () => {
  const full = resolveAtsApi(FULL);
  assert.equal(full.ats, 'workable');
  assert.equal(full.apiUrl, API);

  const short = resolveAtsApi(SHORT);
  assert.equal(short.ats, 'workable-short');
  assert.equal(short.apiUrl, SHORT);

  // A host that merely looks close, and a traversal attempt, must not resolve.
  assert.equal(resolveAtsApi('https://apply.workable.com.evil.test/acme-corp/j/ABC12345'), null);
  assert.equal(resolveAtsApi('https://apply.workable.com/acme-corp/j/%2e%2e'), null);
});

test('a published posting answers active from the v2 JSON', async () => {
  const calls = [];
  const verdict = await withFetch(async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ state: 'published', title: 'Engineer' }), { status: 200 });
  }, () => checkLivenessViaApi(FULL));
  assert.equal(verdict.result, 'active');
  assert.equal(verdict.code, 'workable_api_published');
  assert.deepEqual(calls, [API]);
});

test('a 404 from the v2 endpoint is authoritative: expired', async () => {
  const verdict = await withFetch(async () => new Response('Job not found', { status: 404 }),
    () => checkLivenessViaApi(FULL));
  assert.equal(verdict.result, 'expired');
});

test('a readable state this rung does not know stays uncertain, never expired', async () => {
  const verdict = await withFetch(async () => new Response(JSON.stringify({ state: 'closed' }), { status: 200 }),
    () => checkLivenessViaApi(FULL));
  assert.equal(verdict.result, 'uncertain');
  assert.equal(verdict.code, 'workable_state_unrecognised');
});

test('the share link follows its own redirect to the account API', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect]);
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/acme-corp/j/ABC12345' } });
    }
    return new Response(JSON.stringify({ state: 'published' }), { status: 200 });
  }, () => checkLivenessViaApi(SHORT));
  assert.equal(verdict.result, 'active');
  assert.deepEqual(calls, [[SHORT, 'manual'], [API, 'error']]);
});

test('a share-link redirect off apply.workable.com is refused', async () => {
  const calls = [];
  const verdict = await withFetch(async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/acme-corp/j/ABC12345' } });
  }, () => checkLivenessViaApi(SHORT));
  assert.equal(verdict, null);
  assert.equal(calls.length, 1);
});

test('a redirect naming a different shortcode is refused', async () => {
  const verdict = await withFetch(async () => new Response(null, { status: 302, headers: { location: '/acme-corp/j/OTHER999' } }),
    () => checkLivenessViaApi(SHORT));
  assert.equal(verdict, null);
});

test('classifyWorkablePosting is pure and conservative', () => {
  assert.equal(classifyWorkablePosting({ state: 'published' }).result, 'active');
  assert.equal(classifyWorkablePosting({ state: 'draft' }).result, 'uncertain');
  assert.equal(classifyWorkablePosting({}).result, 'uncertain');
  assert.equal(classifyWorkablePosting(null), null);
  assert.equal(classifyWorkablePosting('nope'), null);
});
