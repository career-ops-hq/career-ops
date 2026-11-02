// tests/liveness-api-zoho-recruit.test.mjs — the Zoho Recruit rung of the
// liveness ladder.
//
// Zoho Recruit has no JSON endpoint. The posting page itself embeds the
// record, and Zoho answers 200 whether the posting is open or gone, so the
// verdict comes from the body:
//
//   record for this id, open                      -> active
//   record for this id, Is_Locked / Publish:false -> expired (shown as filled)
//   no record + "This job posting is no longer available." -> expired
//   anything else (another id, an error page)     -> null, the browser decides
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveAtsApi, checkLivenessViaApi, classifyZohoPostingPage, isAtsPosting } from '../liveness-api.mjs';
import { ROOT } from './helpers.mjs';

const fixture = (name) => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');
const ID = '100000000001853029';
const POSTING = `https://exampleco.zohorecruit.com/jobs/Careers/${ID}/Senior-DevOps-Engineer`;
const PAGE = `https://exampleco.zohorecruit.com/jobs/Careers/${ID}`;

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test('a Zoho Recruit posting URL resolves to its own page, with or without the slug', () => {
  const resolved = resolveAtsApi(POSTING);
  assert.equal(resolved.ats, 'zoho-recruit');
  assert.equal(resolved.apiUrl, PAGE);
  assert.deepEqual(resolved.parts, { tenant: 'exampleco', portal: 'Careers', id: ID });
  assert.equal(resolveAtsApi(PAGE).apiUrl, PAGE);
  assert.equal(resolveAtsApi(`https://exampleco.zohorecruit.com/jobs/Emplois/${ID}/`).apiUrl, `https://exampleco.zohorecruit.com/jobs/Emplois/${ID}`);
});

test('board pages, legacy pages and lookalike hosts do not resolve', () => {
  for (const url of [
    'https://exampleco.zohorecruit.com/jobs/Careers',
    'https://exampleco.zohorecruit.com/recruit/Portal.na',
    `https://exampleco.zohorecruit.com.evil.test/jobs/Careers/${ID}`,
    `https://exampleco.evilzohorecruit.com/jobs/Careers/${ID}`,
    `http://exampleco.zohorecruit.com/jobs/Careers/${ID}`,
    `https://exampleco.zohorecruit.com/jobs/%2e%2e/${ID}`,
    'https://exampleco.zohorecruit.com/jobs/Careers/not-an-id',
  ]) {
    assert.equal(isAtsPosting(url), false, url);
  }
});

test('an open posting page answers active; the request asks for HTML and refuses redirects', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect, opts.headers.accept]);
    return new Response(fixture('zoho-recruit-detail.html'), { status: 200 });
  }, () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'active');
  assert.equal(verdict.code, 'zoho_recruit_page_ok');
  assert.deepEqual(calls, [[PAGE, 'error', 'text/html']]);
});

test('a removed posting (200 with the "no longer available" notice) answers expired', async () => {
  const verdict = await withFetch(async () => new Response(fixture('zoho-recruit-detail-gone.html'), { status: 200 }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'zoho_recruit_unavailable');
});

test('a filled posting (Is_Locked, unpublished) answers expired', () => {
  const verdict = classifyZohoPostingPage(fixture('zoho-recruit-detail-locked.html'), '100000000009803001');
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'zoho_recruit_filled');
});

test('an unrecognised page stays inconclusive, never expired', () => {
  assert.equal(classifyZohoPostingPage(fixture('zoho-recruit-detail.html'), '999'), null);
  assert.equal(classifyZohoPostingPage(fixture('zoho-recruit-page-missing.html'), ID), null);
  assert.equal(classifyZohoPostingPage('', ID), null);
  assert.equal(classifyZohoPostingPage(null, ID), null);
});

test('a 5xx or a network error is inconclusive', async () => {
  assert.equal(await withFetch(async () => new Response('busy', { status: 503 }), () => checkLivenessViaApi(POSTING)), null);
  assert.equal(await withFetch(async () => { throw new TypeError('fetch failed'); }, () => checkLivenessViaApi(POSTING)), null);
});
