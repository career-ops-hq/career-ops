// tests/liveness-api-ultipro.test.mjs — the UltiPro (UKG Pro Recruiting) rung
// of the liveness ladder.
//
// UKG has no per-posting JSON endpoint. The detail page itself embeds the
// record, and UKG answers 200 whether the posting is open, closed or gone, so
// the verdict comes from the body:
//
//   record for this id, OpportunityIsClosed false     -> active
//   record for this id, OpportunityIsClosed true      -> expired (the page stays, with no Apply)
//   no record + the "opportunity unavailable" notice  -> expired (the board's empty page)
//   anything else (another id, the internal-only notice, an error page) -> null, the browser decides
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveAtsApi, checkLivenessViaApi, classifyUltiproDetailPage, isAtsPosting } from '../liveness-api.mjs';
import { ROOT } from './helpers.mjs';

const fixture = (name) => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');
const ID = '5e0c2b9a-7f41-4d2e-8b6a-1c9d3e7f2a10';
const BOARD_ID = '0c8a6f9e-2b1d-4e57-9a3c-5d7f1e2b4c60';
const BOARD = `/EXA1000EXCO/JobBoard/${BOARD_ID}`;
const POSTING = `https://recruiting2.ultipro.com${BOARD}/OpportunityDetail?opportunityId=${ID}`;

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test('an UltiPro detail URL resolves to its own page on each UKG host', () => {
  for (const host of ['recruiting.ultipro.com', 'recruiting2.ultipro.com', 'recruiting.ultipro.ca']) {
    const url = `https://${host}${BOARD}/OpportunityDetail?opportunityId=${ID}`;
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'ultipro', host);
    assert.equal(resolved.apiUrl, url, host);
  }
  assert.deepEqual(resolveAtsApi(POSTING).parts, { host: 'recruiting2.ultipro.com', tenant: 'EXA1000EXCO', boardId: BOARD_ID, id: ID });
});

test('the request keeps only the posting id, in lower case', () => {
  assert.equal(resolveAtsApi(`${POSTING}&source=LinkedIn`).apiUrl, POSTING);
  assert.equal(resolveAtsApi(`https://recruiting2.ultipro.com${BOARD}/OpportunityDetail/?opportunityId=${ID}`).apiUrl, POSTING);
  assert.equal(resolveAtsApi(`https://recruiting2.ultipro.com${BOARD}/OpportunityDetail?opportunityId=${ID.toUpperCase()}`).apiUrl, POSTING);
});

test('board pages, ids that are not UUIDs, lookalike hosts and unsafe segments do not resolve', () => {
  for (const url of [
    `https://recruiting2.ultipro.com${BOARD}/`,
    `https://recruiting2.ultipro.com${BOARD}/OpportunityDetail`,
    `https://recruiting2.ultipro.com${BOARD}/OpportunityDetail?opportunityId=12345`,
    `https://recruiting2.ultipro.com${BOARD}/OpportunityDetail?opportunityId=${ID}0`,
    `https://recruiting.ultipro.com.evil.example${BOARD}/OpportunityDetail?opportunityId=${ID}`,
    `https://ultipro.example.com${BOARD}/OpportunityDetail?opportunityId=${ID}`,
    `http://recruiting2.ultipro.com${BOARD}/OpportunityDetail?opportunityId=${ID}`,
    `https://recruiting2.ultipro.com/EXA%2F..%2FX/JobBoard/${BOARD_ID}/OpportunityDetail?opportunityId=${ID}`,
  ]) {
    assert.equal(isAtsPosting(url), false, url);
  }
});

test('an open posting answers active; the request asks for HTML and refuses redirects', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect, opts.headers.accept]);
    return new Response(fixture('ultipro-detail-open.html'), { status: 200 });
  }, () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'active');
  assert.equal(verdict.code, 'ultipro_api_open');
  assert.deepEqual(calls, [[POSTING, 'error', 'text/html']]);
});

test('a closed posting that keeps its page (OpportunityIsClosed true) answers expired', async () => {
  const verdict = await withFetch(async () => new Response(fixture('ultipro-detail-closed.html'), { status: 200 }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'ultipro_api_closed');
});

test('the board\'s empty page with the "unavailable" notice answers expired', async () => {
  const verdict = await withFetch(async () => new Response(fixture('ultipro-detail-unavailable.html'), { status: 200 }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'ultipro_api_unavailable');
});

test('an unrecognised page stays inconclusive, never expired', () => {
  // No record, but the internal-only sign-in notice instead of "unavailable".
  assert.equal(classifyUltiproDetailPage(fixture('ultipro-detail-internal.html'), ID), null);
  // A record for another id, open or closed.
  assert.equal(classifyUltiproDetailPage(fixture('ultipro-detail-open.html'), '00000000-0000-4000-8000-000000000000'), null);
  assert.equal(classifyUltiproDetailPage(fixture('ultipro-detail-closed.html'), '00000000-0000-4000-8000-000000000000'), null);
  // A record whose flag is not a boolean.
  const stringFlag = fixture('ultipro-detail-open.html').replace('"OpportunityIsClosed":false', '"OpportunityIsClosed":"false"');
  assert.equal(classifyUltiproDetailPage(stringFlag, ID), null);
  // A 200 that is not UKG's page at all, such as a maintenance page.
  assert.equal(classifyUltiproDetailPage('<html><body>Service temporarily unavailable</body></html>', ID), null);
  assert.equal(classifyUltiproDetailPage('', ID), null);
  assert.equal(classifyUltiproDetailPage(null, ID), null);
});

test('a 5xx or a network error is inconclusive', async () => {
  assert.equal(await withFetch(async () => new Response('busy', { status: 503 }), () => checkLivenessViaApi(POSTING)), null);
  assert.equal(await withFetch(async () => { throw new TypeError('fetch failed'); }, () => checkLivenessViaApi(POSTING)), null);
});
