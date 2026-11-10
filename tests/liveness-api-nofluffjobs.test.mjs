// tests/liveness-api-nofluffjobs.test.mjs — the No Fluff Jobs rung of the liveness ladder.
//
// No Fluff Jobs had no API rung, so every posting fell through to Playwright,
// which reads this board backwards (#4832): a live posting's "Aplikuj" sits in a
// <header> the control walk skips (no_apply_control, dropped by scan --verify),
// and a closed posting moves to a search page whose "APLIKUJ ›" promo link reads
// as an Apply control (active, added to the pipeline).
//
// The rung reads the per-posting API, which needs no browser:
//
//   GET https://nofluffjobs.com/api/posting/{slug}
//   200 {"status":"PUBLISHED"}                       -> active
//   200 {"status":"EXPIRED","expiredBeforeDays":N}  -> expired
//   404 {"status":"DOES_NOT_EXIST"}                 -> expired (gone)
//   any other status on a 200                       -> uncertain, never expired
//   no status, or a 404 saying anything else        -> null (the browser decides)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtsApi, checkLivenessViaApi, classifyNoFluffJobsPosting } from '../liveness-api.mjs';

const SLUG = 'senior-java-developer-acme-warszawa';
const POSTING = `https://nofluffjobs.com/pl/job/${SLUG}`;
const API = `https://nofluffjobs.com/api/posting/${SLUG}`;

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('the posting URL shapes resolve to the per-posting API, and only on nofluffjobs.com', () => {
  for (const url of [
    POSTING,
    `https://nofluffjobs.com/job/${SLUG}`,
    `https://nofluffjobs.com/en/job/${SLUG}/`,
    `https://nofluffjobs.com/pl/job/${SLUG}?utm_source=newsletter#apply`,
    `https://www.nofluffjobs.com/pl/job/${SLUG}`,
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'nofluffjobs', url);
    assert.equal(resolved.apiUrl, API, url);
  }

  // A look-alike host, a traversal attempt, the search page a closed posting
  // moves to, a listing page and a deeper path must not resolve.
  for (const url of [
    `https://nofluffjobs.com.evil.test/pl/job/${SLUG}`,
    'https://nofluffjobs.com/pl/job/%2e%2e',
    'https://nofluffjobs.com/pl/?criteria=category%3Dsales%20city%3Dwarszawa',
    'https://nofluffjobs.com/pl/praca-zdalna',
    `https://nofluffjobs.com/pl/job/${SLUG}/apply`,
  ]) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});

test('a published posting answers active, from one request to the fixed API host', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect]);
    return json({ id: SLUG, status: 'PUBLISHED', title: 'Senior Java Developer', expiresAt: '2026-10-30T23:59:59' });
  }, () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'active');
  assert.equal(verdict.code, 'nofluffjobs_api_published');
  assert.deepEqual(calls, [[API, 'error']]);
});

test('an expired posting answers expired, though the API says 200', async () => {
  const verdict = await withFetch(async () => json({ status: 'EXPIRED', city: 'warszawa', category: 'backend', expiredBeforeDays: 3 }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'nofluffjobs_api_expired');
  assert.match(verdict.reason, /3 day/);
});

test('a slug the board does not have (404 DOES_NOT_EXIST) is gone', async () => {
  const verdict = await withFetch(async () => json({ status: 'DOES_NOT_EXIST', expiredBeforeDays: 0 }, 404),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'nofluffjobs_api_gone');
  assert.match(verdict.reason, /DOES_NOT_EXIST/);
});

test('a 404 that does not say DOES_NOT_EXIST falls back to the browser (null), never expired', async () => {
  // Only DOES_NOT_EXIST says the posting is gone. Any other 404 must not close
  // a live posting: scan --verify would record that expired verdict for good.
  for (const response of [
    () => new Response('<!DOCTYPE html><html><body>Not Found</body></html>', { status: 404 }),
    () => json({ error: 'Not Found', path: `/api/posting/${SLUG}` }, 404),
    () => json({ status: 'EXPIRED', expiredBeforeDays: 3 }, 404),
  ]) {
    const verdict = await withFetch(async () => response(), () => checkLivenessViaApi(POSTING));
    assert.equal(verdict, null);
  }
});

test('a readable status this rung does not know stays uncertain, never expired', async () => {
  const verdict = await withFetch(async () => json({ status: 'SUSPENDED' }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'uncertain');
  assert.equal(verdict.code, 'nofluffjobs_status_unrecognised');
});

test('an unreadable body or a rate limit falls back to the browser (null)', async () => {
  const html = await withFetch(async () => new Response('<!DOCTYPE html><html></html>', { status: 200 }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(html, null);
  const limited = await withFetch(async () => new Response('', { status: 429 }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(limited, null);
});

test('classifyNoFluffJobsPosting is pure and conservative', () => {
  assert.equal(classifyNoFluffJobsPosting({ status: 'PUBLISHED' }).result, 'active');
  assert.equal(classifyNoFluffJobsPosting({ status: 'EXPIRED' }).result, 'expired');
  assert.equal(classifyNoFluffJobsPosting({ status: 'EXPIRED' }).reason, 'No Fluff Jobs reports the posting expired');
  assert.equal(classifyNoFluffJobsPosting({ status: 'published' }).result, 'uncertain');
  assert.equal(classifyNoFluffJobsPosting({ status: 'DOES_NOT_EXIST' }, 404).result, 'expired');
  // On a 404 only DOES_NOT_EXIST is a verdict; a body with no status is no answer.
  assert.equal(classifyNoFluffJobsPosting({ status: 'PUBLISHED' }, 404), null);
  assert.equal(classifyNoFluffJobsPosting({}), null);
  assert.equal(classifyNoFluffJobsPosting({ status: '' }), null);
  assert.equal(classifyNoFluffJobsPosting({ status: 42 }), null);
  assert.equal(classifyNoFluffJobsPosting(null), null);
  assert.equal(classifyNoFluffJobsPosting('nope'), null);
});
