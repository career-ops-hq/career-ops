// tests/providers/talents-connect.test.mjs — providers/talents-connect.mjs
// (Talents Connect JobShop career sites read through the search API the page
// itself calls).
//
// Fixtures follow the live payload shape: a search page whose __NUXT_DATA__
// (a devalue array) carries queryHeaders {tenantId, jobShopId, acceptLanguage}
// and the key under `typesenseApiKey-{jobShopId}`, and multi_search answers of
// {results: [{found, hits: [{document}]}]}.
//
// Run:  node --test tests/providers/talents-connect.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join as joinPath } from 'node:path';
import { pathToFileURL } from 'node:url';

import provider, { resolveShop, parseShopPage, parseSearchResponse, buildLocation } from '../../providers/talents-connect.mjs';
import { ROOT } from '../helpers.mjs';

const SITE = 'https://karriere.acme.example';
const SHOP_ID = '0b9413c4-a8c5-52cc-a116-f8cf6e7b6db7';
const OTHER_SHOP_ID = '2fdb1a42-45dd-5837-a02e-19672241b8fd';
const KEY = 'dCs0aEdET0RNbmVoUmk1cisrYk52bXZScldZMS9XT1IxSTBDWW10MHd1UT1MaVJpeyJmaWx0ZXJfYnki';
const API = 'https://api.my-job-shop.com/api/typesense/multi_search';

/**
 * A __NUXT_DATA__ array shaped like the live one: the state object maps each
 * key name to an index; the `once` object maps the same names to a sentinel
 * index that holds no string.
 */
function nuxtData({ tenant = 'acme', shop = SHOP_ID, key = KEY, lang = 'de', wrapKey = false } = {}) {
  return [
    ['ShallowReactive', 1],
    { data: 2, state: 9, once: 12 },
    ['ShallowReactive', 3],
    { [`typesenseApiKey-${shop}`]: wrapKey ? 13 : 4, [`typesenseApiKey-${shop}-acme-acme-en`]: 5, jobShopData: 6 },
    key,
    'aGVsbG8td29ybGQtdGhpcy1pcy10aGUtc2Vjb25kLWtleS1mb3ItYW5vdGhlci12YW5pdHk=',
    {},
    tenant,
    shop,
    { $squeryHeaders: 10 },
    { tenantId: 7, jobShopId: 8, jobShopVanity: 7, acceptLanguage: 11 },
    lang,
    { [`typesenseApiKey-${shop}`]: 14 },
    ['Reactive', 4],
    false,
  ];
}

const page = (data = nuxtData()) => `<!DOCTYPE html><html><head><title>Jobs</title></head><body><div id="__nuxt"></div>
<script type="application/json" data-nuxt-data="nuxt-app" data-ssr="true" id="__NUXT_DATA__">${JSON.stringify(data)}</script></body></html>`;

function doc(n, over = {}) {
  return {
    title: `Role ${n} (m/w/d)`,
    url: `${SITE}/jobs/role-${n}-m-w-d/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    offer_uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    location: ['Berlin'],
    country: ['Deutschland'],
    external_id: `R${n}`,
    create_date_timestamp: 1793181932,
    schema_values: { contract_types: [], location_types: [], working_time_types: ['FULL_TIME'] },
    introduction: '<p>Intro &amp; more</p>',
    description: '<ul><li>Build things</li></ul>',
    expectation: '<p>Know things</p>',
    offering: '',
    benefits: ['<p>Bike</p>'],
    additional: '',
    about: '<p>About ExampleCo</p>',
    ...over,
  };
}

const result = (docs, found = docs.length) => ({ results: [{ facet_counts: [], found, hits: docs.map((d) => ({ document: d })), page: 1 }] });
const docs = (from, count) => Array.from({ length: count }, (_, i) => doc(from + i));

function httpError(status) {
  const e = /** @type {any} */ (new Error(`HTTP ${status}`));
  e.status = status;
  return e;
}

/**
 * Stub ctx. `html` answers every page GET (a function gets the URL); `pages`
 * answers the search POSTs in order (an Error is thrown). Every call is
 * recorded with its options.
 */
function makeCtx({ html = page(), pages = [result([doc(1)])], maxPages } = {}) {
  const calls = [];
  let searchCalls = 0;
  const answer = (v) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  return {
    calls,
    ctx: {
      transport: 'http',
      maxPages,
      sleep: async () => {},
      async fetchText(url, opts) {
        calls.push({ url, opts });
        return answer(typeof html === 'function' ? html(url) : html);
      },
      async fetchJson(url, opts) {
        calls.push({ url, opts });
        return answer(pages[Math.min(searchCalls++, pages.length - 1)]);
      },
      async fetchResponse() { throw new Error('unused'); },
    },
  };
}

const entry = (over = {}) => ({ name: 'Acme', provider: 'talents-connect', careers_url: `${SITE}/`, ...over });
const searchCalls = (calls) => calls.filter((c) => c.url === API);

function quietWarn(fn) {
  return async () => {
    const orig = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    try { await fn(warnings); } finally { console.warn = orig; }
  };
}

test('id is "talents-connect" and there is no detect(): every tenant is on its own domain', () => {
  assert.equal(provider.id, 'talents-connect');
  assert.equal(provider.detect, undefined);
});

test('resolveShop() rebuilds the origin and keeps only a locale prefix', () => {
  assert.deepEqual(resolveShop('https://Karriere.Acme.example:8443/search?utm_source=x#top'), { origin: SITE, prefix: '' });
  assert.deepEqual(resolveShop(`${SITE}/en/`), { origin: SITE, prefix: '/en' });
  assert.deepEqual(resolveShop(`${SITE}/EN/offer/role/00000000-0000-4000-8000-000000000001`), { origin: SITE, prefix: '/en' });
  assert.deepEqual(resolveShop(`${SITE}/de-at/search`), { origin: SITE, prefix: '/de-at' });
  assert.deepEqual(resolveShop(`${SITE}/jobs/role/00000000-0000-4000-8000-000000000001`), { origin: SITE, prefix: '' });
  for (const raw of ['http://karriere.acme.example/', 'not a url', '', null, 42, undefined]) {
    assert.equal(resolveShop(raw), null, String(raw));
  }
});

test('parseShopPage() reads tenant, job shop and the key named after that shop', () => {
  assert.deepEqual(parseShopPage(page()), { tenantId: 'acme', jobShopId: SHOP_ID, apiKey: KEY, acceptLanguage: 'de' });
  // The key reached through a ["Reactive", i] wrapper still resolves.
  assert.equal(parseShopPage(page(nuxtData({ wrapKey: true }))).apiKey, KEY);
  // An accept language that is not a language tag is left out.
  assert.equal('acceptLanguage' in parseShopPage(page(nuxtData({ lang: 'de; drop' }))), false);
});

test('parseShopPage() throws a named error on a page that is not a job shop', () => {
  assert.throws(() => parseShopPage('<html><body>Welcome</body></html>'), /no __NUXT_DATA__/);
  assert.throws(() => parseShopPage('<script id="__NUXT_DATA__" type="application/json">{nope</script>'), /not valid JSON/);
  assert.throws(() => parseShopPage('<script id="__NUXT_DATA__" type="application/json">{"a":1}</script>'), /not an array/);
  assert.throws(() => parseShopPage(page([{ data: 1 }, 'x'])), /no tenantId \/ jobShopId/);
  assert.throws(() => parseShopPage(page(nuxtData({ tenant: 'a b' }))), /tenant id/);
  assert.throws(() => parseShopPage(page(nuxtData({ shop: 'not-a-uuid' }))), /job shop id/);
  assert.throws(() => parseShopPage(page(nuxtData({ key: 'short' }))), /no search key/);
  assert.throws(() => parseShopPage(null), /no __NUXT_DATA__/);
});

test('buildLocation() pairs cities with countries, and lists them apart when the lists differ', () => {
  assert.deepEqual(buildLocation(['Berlin', 'Hamburg'], ['Deutschland', 'Deutschland']), {
    location: 'Berlin, Deutschland / Hamburg, Deutschland',
    locations: ['Berlin', 'Hamburg'],
  });
  assert.deepEqual(buildLocation(['Prague'], ['Czechia', 'Germany']), { location: 'Prague / Czechia / Germany', locations: ['Prague'] });
  assert.deepEqual(buildLocation(['Berlin', 'Berlin'], ['Deutschland', 'Deutschland']), { location: 'Berlin, Deutschland', locations: ['Berlin'] });
  assert.deepEqual(buildLocation(undefined, null), { location: '', locations: [] });
});

test('fetch() normalizes the live document shape', async () => {
  const { ctx } = makeCtx({ pages: [result([doc(1, { title: 'QA &amp; Test Engineer (m/w/d)' })])] });
  const [job, ...rest] = await provider.fetch(entry(), ctx);
  assert.equal(rest.length, 0);
  assert.deepEqual(job, {
    title: 'QA & Test Engineer (m/w/d)',
    url: `${SITE}/jobs/role-1-m-w-d/00000000-0000-4000-8000-000000000001`,
    company: 'Acme',
    location: 'Berlin, Deutschland',
    locations: ['Berlin'],
    postedAt: 1793181932000,
    requisitionId: 'R1',
    employmentType: 'full_time',
    description: 'Intro & more Build things Know things Bike About ExampleCo',
    listingIdentity: { ats_provider: 'talents-connect', board_slug: `acme/${SHOP_ID}`, posting_id: '00000000-0000-4000-8000-000000000001' },
  });
});

test('fetch() keeps an offer-redirect link as given, and two of them stay two postings', async () => {
  const redirect = (id) => `${SITE}/offer-redirect/?offerApiId=${id}&showApplicationForm=false`;
  const { ctx } = makeCtx({
    pages: [result([
      doc(1, { url: redirect('UjQwMDE='), offer_uuid: undefined }),
      doc(2, { url: redirect('UjQwMzk='), offer_uuid: undefined }),
    ])],
  });
  const jobs = await provider.fetch(entry(), ctx);
  assert.deepEqual(jobs.map((j) => j.url), [redirect('UjQwMDE='), redirect('UjQwMzk=')]);
  const { isOfferSeen, markOfferSeen } = await import(pathToFileURL(joinPath(ROOT, 'scan.mjs')).href);
  const seen = new Set();
  markOfferSeen(jobs[0], seen);
  assert.equal(isOfferSeen(jobs[1], seen), false, 'the offerApiId query names the posting');
});

test('fetch() drops rows without a title or a link on the shop host, and leaves unknown fields off', async () => {
  const { ctx } = makeCtx({
    pages: [result([
      doc(1, { title: '  ' }),
      doc(2, { url: 'https://evil.example/jobs/x/1' }),
      doc(3, { url: 'http://karriere.acme.example/jobs/x/3' }),
      doc(4, { url: 'https://karriere.acme.example:8443/jobs/x/4' }),
      doc(5, { url: 'not a url' }),
      null,
      { document: null },
      doc(6, { location: [], country: [], external_id: '', create_date_timestamp: 0, schema_values: null, introduction: '', description: '', expectation: '', benefits: [], about: '', offer_uuid: ' padded ' }),
    ])],
  });
  const jobs = await provider.fetch(entry(), ctx);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], { title: 'Role 6 (m/w/d)', url: `${SITE}/jobs/role-6-m-w-d/00000000-0000-4000-8000-000000000006`, company: 'Acme', location: '' });
});

test('fetch() passes redirect: "error" on every request and sends the page\'s own headers', async () => {
  const { ctx, calls } = makeCtx({ pages: [result(docs(1, 250), 260), result(docs(251, 10), 260)] });
  await provider.fetch(entry(), ctx);
  assert.equal(calls.length, 3);
  for (const c of calls) assert.equal(c.opts?.redirect, 'error', c.url);
  assert.equal(calls[0].url, `${SITE}/search`);
  const [first, second] = searchCalls(calls);
  assert.equal(first.opts.method, 'POST');
  assert.equal(first.opts.headers['x-tenant-id'], 'acme');
  assert.equal(first.opts.headers['x-jobshop-id'], SHOP_ID);
  assert.equal(first.opts.headers['x-typesense-api-key'], KEY);
  assert.equal(first.opts.headers['accept-language'], 'de');
  const body = JSON.parse(first.opts.body);
  assert.deepEqual(
    { ...body.searches[0], include_fields: undefined },
    { collection: 'offers', q: '*', per_page: 250, page: 1, include_fields: undefined },
  );
  // Contact persons (names, e-mails, phone numbers) are never requested.
  assert.doesNotMatch(body.searches[0].include_fields, /contact/);
  assert.equal(JSON.parse(second.opts.body).searches[0].page, 2);
});

test('fetch() reads the locale shop the entry names and falls back to its home page when /search is 404', async () => {
  const { ctx, calls } = makeCtx({
    html: (url) => (url.endsWith('/search') ? Promise.reject(httpError(404)) : page(nuxtData({ shop: OTHER_SHOP_ID }))),
  });
  const jobs = await provider.fetch(entry({ careers_url: `${SITE}/en/offer/role/00000000-0000-4000-8000-000000000001` }), ctx);
  assert.deepEqual(calls.slice(0, 2).map((c) => c.url), [`${SITE}/en/search`, `${SITE}/en/`]);
  assert.equal(searchCalls(calls)[0].opts.headers['x-jobshop-id'], OTHER_SHOP_ID);
  assert.equal(jobs[0].listingIdentity.board_slug, `acme/${OTHER_SHOP_ID}`);
});

test('fetch() does not fall back on a non-404 page error, and a missing shop throws 404', async () => {
  const fail500 = makeCtx({ html: () => Promise.reject(httpError(500)) });
  await assert.rejects(provider.fetch(entry(), fail500.ctx), (err) => err.status === 500);
  assert.equal(fail500.calls.filter((c) => c.url === `${SITE}/`).length, 0);

  const gone = makeCtx({ html: () => Promise.reject(httpError(404)) });
  await assert.rejects(provider.fetch(entry(), gone.ctx), (err) => err.status === 404);
  assert.equal(searchCalls(gone.calls).length, 0);
});

test('fetch() throws on an entry with no https URL, before any request', async () => {
  const { ctx, calls } = makeCtx();
  await assert.rejects(provider.fetch(entry({ careers_url: 'http://karriere.acme.example/' }), ctx), /no https job shop URL/);
  await assert.rejects(provider.fetch({ name: 'Acme', provider: 'talents-connect' }, ctx), /no https job shop URL/);
  assert.equal(calls.length, 0);
});

test('an empty board is [], a changed envelope or a refused search throws', async () => {
  assert.deepEqual(await provider.fetch(entry(), makeCtx({ pages: [result([], 0)] }).ctx), []);
  for (const [body, re] of [
    [{}, /expected results\[0\]\.hits\[\], got: \[\]/],
    [{ results: [] }, /got: \[results\]/],
    [{ results: [{ found: 1, hits: null }] }, /got: \[results\[0\]: found, hits\]/],
    [{ results: [{ found: 1, hits: {} }] }, /expected results\[0\]\.hits\[\]/],
    ['', /got: \[string\]/],
    [null, /got: \[object\]/],
  ]) {
    await assert.rejects(provider.fetch(entry(), makeCtx({ pages: [body] }).ctx), re, JSON.stringify(body));
  }
  await assert.rejects(
    provider.fetch(entry(), makeCtx({ pages: [{ results: [{ code: 401, error: 'Forbidden - a valid `x-typesense-api-key` header must be sent.' }] }] }).ctx),
    (err) => err.status === 401 && /search refused \(401\)/.test(err.message),
  );
});

test('parseSearchResponse() reports the raw row count and the source total', () => {
  const parsed = parseSearchResponse(result([doc(1), { document: { title: '' } }], 7), { origin: SITE, company: 'Acme', tenantId: 'acme', jobShopId: SHOP_ID });
  assert.equal(parsed.rawCount, 2);
  assert.equal(parsed.total, 7);
  assert.equal(parsed.jobs.length, 1);
});

test('pagination: a short page ends the walk, and `found` ends it on a full page', async () => {
  const short = makeCtx({ pages: [result(docs(1, 250), 1000), result(docs(251, 3), 1000)] });
  assert.equal((await provider.fetch(entry(), short.ctx)).length, 253);
  assert.equal(searchCalls(short.calls).length, 2);

  const exact = makeCtx({ pages: [result(docs(1, 250), 500), result(docs(251, 250), 500), result(docs(501, 250), 500)] });
  const jobs = await provider.fetch(entry(), exact.ctx);
  assert.equal(jobs.length, 500);
  assert.equal(searchCalls(exact.calls).length, 2);
  assert.equal(jobs.truncated, undefined);

  const grown = makeCtx({ pages: [result(docs(1, 250), 500), result(docs(251, 250), 501), result(docs(501, 1), 501)] });
  assert.equal((await provider.fetch(entry(), grown.ctx)).length, 501, 'the `found` of the latest page decides the stop');
  assert.equal(searchCalls(grown.calls).length, 3);
});

test('pagination: DEFAULT_MAX_PAGES stops the walk even when the source reports more, and says so', quietWarn(async (warnings) => {
  let n = 0;
  const pages = Array.from({ length: 25 }, () => result(docs((n++) * 250 + 1, 250), 100_000));
  const { ctx, calls } = makeCtx({ pages });
  const jobs = await provider.fetch(entry(), ctx);
  assert.equal(searchCalls(calls).length, 20);
  assert.equal(jobs.length, 5000);
  assert.equal(jobs.truncated?.reason, 'page-cap');
  assert.ok(warnings.some((w) => /raise max_pages/.test(w)), warnings.join('\n'));
}));

test('pagination: max_pages lowers the cap, and a short last page at the cap is complete', quietWarn(async (warnings) => {
  const { ctx, calls } = makeCtx({ pages: [result(docs(1, 250), 1000), result(docs(251, 250), 1000), result(docs(501, 250), 1000)] });
  const capped = await provider.fetch(entry({ max_pages: 2 }), ctx);
  assert.equal(searchCalls(calls).length, 2);
  assert.equal(capped.truncated?.reason, 'page-cap');

  const atCap = makeCtx({ pages: [result(docs(1, 250), 1000), result(docs(251, 40), 1000)] });
  warnings.length = 0;
  const jobs = await provider.fetch(entry({ max_pages: 2 }), atCap.ctx);
  assert.equal(jobs.truncated, undefined);
  assert.equal(warnings.length, 0);
}));

test('probe: ctx.maxPages 1 sends exactly one search request and propagates its error unwrapped', async () => {
  const { ctx, calls } = makeCtx({ maxPages: 1, pages: [result(docs(1, 250), 1000), result(docs(251, 250), 1000)] });
  const jobs = await provider.fetch(entry(), ctx);
  assert.equal(searchCalls(calls).length, 1);
  assert.equal(jobs.length, 250);
  assert.equal(jobs.truncated, undefined);

  const budget = new Error('probe budget reached');
  const probe = makeCtx({ maxPages: 1, pages: [budget] });
  await assert.rejects(provider.fetch(entry(), probe.ctx), (err) => err === budget);
});

test('a failed page 2 keeps page 1, warns without blaming max_pages, and marks the board partial', quietWarn(async (warnings) => {
  const { ctx } = makeCtx({ pages: [result(docs(1, 250), 600), httpError(400)] });
  const jobs = await provider.fetch(entry(), ctx);
  assert.equal(jobs.length, 250);
  assert.equal(jobs.truncated?.reason, 'fetch-error');
  assert.ok(warnings.some((w) => /page 2 failed/.test(w)));
  assert.ok(!warnings.some((w) => /raise max_pages/.test(w)));
}));

test('a failed first search page fails the target', async () => {
  await assert.rejects(provider.fetch(entry(), makeCtx({ pages: [httpError(503)] }).ctx), (err) => err.status === 503);
});

test('listingIdentity: the same posting at a second URL is already seen; another id is not', async () => {
  const { isOfferSeen, markOfferSeen } = await import(pathToFileURL(joinPath(ROOT, 'scan.mjs')).href);
  const [row, other] = await provider.fetch(entry(), makeCtx({ pages: [result([doc(1), doc(2)])] }).ctx);
  const seen = new Set();
  markOfferSeen(row, seen);
  const elsewhere = { ...row, url: `${SITE}/offer-redirect/?offerApiId=UjE=&showApplicationForm=false` };
  assert.equal(isOfferSeen(elsewhere, seen), true);
  assert.equal(isOfferSeen(other, seen), false);
});
