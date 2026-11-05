// tests/providers/aldi-nord.test.mjs: ALDI Nord provider (providers/aldi-nord.mjs).
// Offline only. The response shape is the one www.aldi-nord.de/api/job/hr/query
// returns (page N cumulative: the first 10·N rows); titles, ids, slugs and
// places are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import provider, {
  SITES, buildQueryBody, formatLocation, parseQueryResponse, resolveConfig, resolveMaxPages, resolveSiteHost,
} from '../../providers/aldi-nord.mjs';

const DE = 'https://www.aldi-nord.de/karriere/jobs.html';

function row(n, extra = {}) {
  return {
    postingId: String(900000 + n),
    techId: 'EXAMPLETECHID',
    title: `Example Role ${n} (m/w/d)`,
    jobCategory: '10420',
    jobCategoryName: 'Tech & IT',
    onlineFrom: '2026-10-01',
    onlineUntil: '2026-12-01',
    jobType: '11721',
    jobTypeName: 'Vollzeit',
    careerLevel: '10410',
    careerLevelName: 'Berufseinsteiger / Berufserfahrene',
    applicationUrl: `https://apply.example.com/form?jobId=EXAMPLETECHID-${900000 + n}&langCode=de_DE`,
    locations: [{ zipCode: '12345', city: 'Musterstadt', street: 'Beispielweg 1', region: 'Example Region', country: 'Germany', longitude: 1, latitude: 2, name: 'DEX001' }],
    workingHours: 40,
    slugTitle: `example-role-${n}-m-w-d-musterstadt`,
    ...extra,
  };
}

/** A cumulative source of `total` rows: page N answers the first 10·N. */
function source(total, { locale = 'de-DE', make = row } = {}) {
  const all = Array.from({ length: total }, (_, i) => make(i + 1));
  return (body) => {
    const rows = all.slice(0, Math.min(total, body.page * 10));
    return { total, hasNextPage: rows.length < total, page: body.page, locale, results: rows };
  };
}

function makeCtx(handler, extra = {}) {
  const calls = [];
  const sleeps = [];
  return {
    calls,
    sleeps,
    ctx: {
      sleep: async (ms) => { sleeps.push(ms); },
      fetchJson: async (url, opts) => {
        const body = JSON.parse(opts.body);
        calls.push({ url, opts, body });
        const out = await handler(body, calls.length);
        if (out instanceof Error) throw out;
        return out;
      },
      ...extra,
    },
  };
}

async function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = orig;
  }
}

const entry = (extra = {}) => ({ name: 'ExampleCo', careers_url: DE, ...extra });

test('id is aldi-nord', () => {
  assert.equal(provider.id, 'aldi-nord');
});

test('detect() claims the confirmed country hosts only, anchored, and never throws', () => {
  for (const careers_url of [
    DE,
    'https://aldi-nord.de/karriere/jobs.html',
    'https://www.aldi.nl/carriere/vacatures.html',
    'https://www.aldi.be/fr/jobs/postuler.html',
    'https://www.aldi.lu/jobs/postuler.html',
    'https://www.aldi.fr/carriere/recherche-offres.html',
    'https://www.aldi.es/empleo/ofertas.html',
    'https://www.aldi.pt/carreira/ofertas-de-emprego.html',
    'https://WWW.ALDI.PL/praca/oferty-pracy.html',
  ]) {
    assert.deepEqual(provider.detect({ careers_url }), { url: careers_url }, careers_url);
  }
  assert.deepEqual(provider.detect({ api: 'https://www.aldi.nl/api/job/hr/query' }), { url: 'https://www.aldi.nl/api/job/hr/query' });
  for (const careers_url of [
    'http://www.aldi-nord.de/karriere/jobs.html',
    'https://www.aldi-nord.de.evil.example/karriere/jobs.html',
    'https://evilaldi-nord.de/karriere/jobs.html',
    'https://jobs.aldi-nord.de/',
    'https://evil.example/?u=www.aldi-nord.de',
    'https://www.aldi-nord.de@evil.example/',
    'https://www.aldi-sued.de/de/karriere.html',
    'https://www.aldi.dk/',
    'https://www.aldi.com/',
    '::',
    '',
  ]) {
    assert.equal(provider.detect({ careers_url }), null, careers_url);
  }
  assert.equal(provider.detect({}), null);
  assert.equal(provider.detect(null), null);
  assert.equal(provider.detect(undefined), null);
  assert.equal(provider.detect({ careers_url: ['x'] }), null);
  assert.equal(provider.detect({ careers_url: 42 }), null);
});

test('resolveSiteHost rebuilds the www host and drops port, credentials and path', () => {
  assert.equal(resolveSiteHost('https://u:p@aldi.be:8443/fr/jobs/postuler.html?x=1'), 'www.aldi.be');
  assert.equal(resolveSiteHost('https://www.aldi.dk/'), null);
});

test('fetch() refuses a foreign host or a bad aldi_nord block before any request', async () => {
  for (const bad of [
    { careers_url: 'https://evil.example/karriere/jobs.html' },
    { careers_url: 'http://www.aldi-nord.de/karriere/jobs.html' },
    { careers_url: undefined },
    { aldi_nord: { locales: ['nl-NL'] } },
    { aldi_nord: { locales: [] } },
    { aldi_nord: { locales: 'de-DE' } },
    { aldi_nord: { categories: ['Tech & IT'] } },
    { aldi_nord: { categories: '10420' } },
    { aldi_nord: ['x'] },
  ]) {
    const { ctx, calls } = makeCtx(() => { throw new Error('fetch must not be called'); });
    await assert.rejects(provider.fetch(entry(bad), ctx), /aldi-nord:/, JSON.stringify(bad));
    assert.equal(calls.length, 0, JSON.stringify(bad));
  }
});

test('resolveConfig: host locales by default, validated overrides, ids as strings', () => {
  assert.deepEqual(resolveConfig({}, 'www.aldi.be'), { locales: ['nl-BE', 'fr-BE'], categories: [] });
  assert.deepEqual(resolveConfig({ aldi_nord: { locales: ['FR-be', 'fr-BE'] } }, 'www.aldi.be'), { locales: ['fr-BE'], categories: [] });
  assert.deepEqual(resolveConfig({ aldi_nord: { categories: [10420, ' 19000 ', '10420'] } }, 'www.aldi-nord.de'), { locales: ['de-DE'], categories: ['10420', '19000'] });
  assert.deepEqual(resolveConfig({ aldi_nord: null }, 'www.aldi-nord.de'), { locales: ['de-DE'], categories: [] });
});

test('resolveMaxPages: default, override, ceiling', () => {
  assert.equal(resolveMaxPages({}), 500);
  assert.equal(resolveMaxPages({ max_pages: 3 }), 3);
  assert.equal(resolveMaxPages({ max_pages: 99999 }), 1000);
  assert.equal(resolveMaxPages({ max_pages: 0 }), 500);
  assert.equal(resolveMaxPages({ max_pages: '7' }), 500);
});

test('buildQueryBody is the shape the site sends', () => {
  assert.deepEqual(JSON.parse(buildQueryBody('de-DE', ['10420'], 3)), {
    careerLevelIds: [], jobTypeParams: { jobTypeIds: [] }, jobCategoryIds: ['10420'],
    title: '', location: { searchPhrase: '' }, page: 3, locale: 'de-DE',
  });
});

test('formatLocation: distinct cities and one country, or City, Country per place', () => {
  assert.equal(formatLocation([{ city: 'Musterstadt', country: 'Germany' }]), 'Musterstadt, Germany');
  assert.equal(formatLocation([
    { city: 'Kamen', country: 'Germany', zipCode: '1' },
    { city: 'Bergdorf', country: 'Germany' },
    { city: 'Kamen', country: 'Germany', zipCode: '2' },
  ]), 'Kamen / Bergdorf, Germany');
  assert.equal(formatLocation([{ city: 'Lille', country: 'France' }, { city: 'Mons', country: 'Belgium' }]), 'Lille, France; Mons, Belgium');
  assert.equal(formatLocation([{ country: 'Luxembourg' }]), 'Luxembourg');
  assert.equal(formatLocation([{ city: '  ', country: '' }, null]), '');
  assert.equal(formatLocation(undefined), '');
});

test('parseQueryResponse normalizes rows and skips bad ones', () => {
  const site = { host: 'www.aldi-nord.de', detailPath: '/karriere/detail/', locale: 'de-DE', company: 'ExampleCo' };
  const { jobs, rawCount, total, hasNextPage } = parseQueryResponse({
    total: 6, hasNextPage: false, page: 1, locale: 'de-DE',
    results: [
      row(1),
      row(2, { onlineFrom: 'not a date', title: '  Lead   Data & Analytics (m/w/d) ' }),
      row(3, { title: '' }),
      row(4, { slugTitle: undefined }),
      row(5, { postingId: null }),
      null,
    ],
  }, site);
  assert.equal(rawCount, 6);
  assert.equal(total, 6);
  assert.equal(hasNextPage, false);
  assert.deepEqual(jobs, [
    {
      title: 'Example Role 1 (m/w/d)',
      url: 'https://www.aldi-nord.de/karriere/detail/example-role-1-m-w-d-musterstadt-900001.html',
      company: 'ExampleCo',
      location: 'Musterstadt, Germany',
      language: 'de-DE',
      postedAt: Date.UTC(2026, 9, 1),
    },
    {
      title: 'Lead Data & Analytics (m/w/d)',
      url: 'https://www.aldi-nord.de/karriere/detail/example-role-2-m-w-d-musterstadt-900002.html',
      company: 'ExampleCo',
      location: 'Musterstadt, Germany',
      language: 'de-DE',
    },
  ]);
  assert.ok(!('requisitionId' in jobs[0]) && !('description' in jobs[0]));
});

test('empty documented container → []; any other envelope throws, naming what it got', async () => {
  const { ctx } = makeCtx(() => ({ total: 0, hasNextPage: false, page: 1, locale: 'de-DE', results: [] }));
  assert.deepEqual(await provider.fetch(entry(), ctx), []);
  for (const bad of [{}, { results: null }, { results: {} }, { jobs: [] }, '', 42, true, null]) {
    const { ctx: c } = makeCtx(() => bad);
    await assert.rejects(provider.fetch(entry(), c), /aldi-nord: unexpected response — expected results\[\]/, JSON.stringify(bad));
  }
});

test('a full scan is page 1 then the covering page, POST with redirect: error each time', async () => {
  const { ctx, calls, sleeps } = makeCtx(source(35));
  const jobs = await provider.fetch(entry(), ctx);
  assert.equal(jobs.length, 35);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.body.page), [1, 4]);
  for (const c of calls) {
    assert.equal(c.url, 'https://www.aldi-nord.de/api/job/hr/query');
    assert.equal(c.opts.redirect, 'error');
    assert.equal(c.opts.method, 'POST');
    assert.equal(c.opts.headers['content-type'], 'application/json');
    assert.equal(c.body.locale, 'de-DE');
  }
  assert.deepEqual(sleeps, [250]);
  assert.equal(new Set(jobs.map((j) => j.url)).size, 35);
});

test('a board of one page makes one request', async () => {
  const { ctx, calls } = makeCtx(source(7));
  assert.equal((await provider.fetch(entry(), ctx)).length, 7);
  assert.equal(calls.length, 1);
});

test('ctx.maxPages: 1 makes exactly one list request and does not warn', async () => {
  const { ctx, calls } = makeCtx(source(3478), { maxPages: 1 });
  const { result, lines } = await captureErrors(() => provider.fetch(entry({ max_pages: 1 }), ctx));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.page, 1);
  assert.equal(result.length, 10);
  assert.deepEqual(lines, []);
});

test('DEFAULT_MAX_PAGES stops the walk even when the source reports more, and warns', async () => {
  const { ctx, calls } = makeCtx(source(6000));
  const { result, lines } = await captureErrors(() => provider.fetch(entry(), ctx));
  assert.deepEqual(calls.map((c) => c.body.page), [1, 500]);
  assert.equal(result.length, 5000);
  assert.equal(result.aldiNordTruncated, 'cap');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /truncated at max_pages=500 \(5000 of 6000 postings\) — narrow aldi_nord.categories or raise max_pages/);
});

test('entry max_pages caps the covering page; a short final page wins over the cap', async () => {
  const capped = makeCtx(source(35));
  const c1 = await captureErrors(() => provider.fetch(entry({ max_pages: 2 }), capped.ctx));
  assert.deepEqual(capped.calls.map((c) => c.body.page), [1, 2]);
  assert.equal(c1.result.length, 20);
  assert.match(c1.lines.join('\n'), /truncated at max_pages=2/);

  const exact = makeCtx(source(35));
  const c2 = await captureErrors(() => provider.fetch(entry({ max_pages: 4 }), exact.ctx));
  assert.equal(c2.result.length, 35);
  assert.deepEqual(c2.lines, []);
  assert.equal(c2.result.aldiNordTruncated, undefined);
});

test('a failed covering page keeps page 1 and warns, without the max_pages warning', async () => {
  const err = Object.assign(new Error('HTTP 503'), { status: 503 });
  const { ctx, calls } = makeCtx((body) => (body.page === 1 ? source(35)(body) : err));
  const { result, lines } = await captureErrors(() => provider.fetch(entry(), ctx));
  // Page 1, then the covering page and its two retries.
  assert.deepEqual(calls.map((c) => c.body.page), [1, 4, 4, 4]);
  assert.equal(result.length, 10);
  assert.equal(result.aldiNordTruncated, 'fetch-error');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /kept the first 10 of 35 postings: HTTP 503/);
  assert.doesNotMatch(lines[0], /max_pages/);
});

test('a fetch error in one locale takes precedence over a cap in the other, in either order', async () => {
  const err = Object.assign(new Error('HTTP 503'), { status: 503 });
  for (const locales of [['nl-BE', 'fr-BE'], ['fr-BE', 'nl-BE']]) {
    const { ctx } = makeCtx((body) => {
      if (body.locale === 'nl-BE') return body.page === 1 ? source(35, { locale: 'nl-BE' })(body) : err;
      return source(35, { locale: 'fr-BE' })(body);
    });
    const { result, lines } = await captureErrors(() => provider.fetch({ name: 'ExampleCo BE', careers_url: 'https://www.aldi.be/', max_pages: 2, aldi_nord: { locales } }, ctx));
    assert.equal(result.aldiNordTruncated, 'fetch-error', locales.join());
    assert.equal(lines.length, 2, locales.join());
  }
});

test('two capped locales keep the cap reason', async () => {
  const { ctx } = makeCtx((body) => source(35, { locale: body.locale })(body));
  const { result } = await captureErrors(() => provider.fetch({ name: 'ExampleCo BE', careers_url: 'https://www.aldi.be/', max_pages: 2 }, ctx));
  assert.equal(result.aldiNordTruncated, 'cap');
});

test('a covering page over the body cap points at max_response_mb', async () => {
  const err = Object.assign(new Error('HTTP body exceeded maxBytes'), { code: 'response_too_large' });
  const { ctx } = makeCtx((body) => (body.page === 1 ? source(35)(body) : err));
  const { lines } = await captureErrors(() => provider.fetch(entry(), ctx));
  assert.match(lines[0], /set max_response_mb on this entry/);
});

test('a failed first page is not swallowed', async () => {
  const err = Object.assign(new Error('HTTP 500'), { status: 500 });
  const { ctx } = makeCtx(() => err);
  await assert.rejects(provider.fetch(entry(), ctx), (e) => e === err);
});

test('a failed first page of a later locale fails the whole entry', async () => {
  const err = Object.assign(new Error('HTTP 500'), { status: 500 });
  const { ctx } = makeCtx((body) => (body.locale === 'nl-BE' ? source(3, { locale: 'nl-BE' })(body) : err));
  await assert.rejects(provider.fetch({ name: 'ExampleCo BE', careers_url: 'https://www.aldi.be/' }, ctx), (e) => e === err);
});

test('a list that grows between the two requests keeps the covering page and makes no third request', async () => {
  // Page 1 reports 35 rows, and the covering page reports the current 45.
  const { ctx, calls } = makeCtx((body) => (body.page === 1 ? { ...source(45)(body), total: 35 } : source(45)(body)));
  const { result, lines } = await captureErrors(() => provider.fetch(entry(), ctx));
  assert.deepEqual(calls.map((c) => c.body.page), [1, 4]);
  assert.equal(result.length, 40);
  assert.deepEqual(lines, []);
});

test('with no total the walk asks for the page budget, and the cap still warns', async () => {
  const noTotal = (size) => (body) => {
    const { total: _total, ...rest } = source(size)(body);
    return rest;
  };
  const whole = makeCtx(noTotal(35));
  const c1 = await captureErrors(() => provider.fetch(entry({ max_pages: 5 }), whole.ctx));
  assert.deepEqual(whole.calls.map((c) => c.body.page), [1, 5]);
  assert.equal(c1.result.length, 35);
  assert.deepEqual(c1.lines, []);

  const capped = makeCtx(noTotal(100));
  const c2 = await captureErrors(() => provider.fetch(entry({ max_pages: 5 }), capped.ctx));
  assert.equal(c2.result.length, 50);
  assert.equal(c2.result.aldiNordTruncated, 'cap');
  assert.match(c2.lines.join('\n'), /truncated at max_pages=5 \(50 of \? postings\)/);
});

test('while probing, a fetch rejection propagates unchanged', async () => {
  class ProbeBudget extends Error {}
  const first = new ProbeBudget('budget');
  const p1 = makeCtx(() => first, { maxPages: 1 });
  await assert.rejects(provider.fetch(entry(), p1.ctx), (e) => e === first);

  const second = new ProbeBudget('budget');
  const p2 = makeCtx((body) => (body.page === 1 ? source(35)(body) : second), { maxPages: 2 });
  await assert.rejects(provider.fetch(entry(), p2.ctx), (e) => e === second);
  // The shared retry wrapper re-attempts a status-less error, then rethrows
  // the same instance.
  assert.deepEqual(p2.calls.map((c) => c.body.page), [1, 2, 2, 2]);
});

test('a non-cumulative covering page keeps page 1 and says why', async () => {
  // A source that pages by index: page N answers rows 10N-9..10N only.
  const all = Array.from({ length: 35 }, (_, i) => row(i + 1));
  const { ctx } = makeCtx((body) => ({
    total: 35, hasNextPage: body.page < 4, page: body.page, locale: 'de-DE', results: all.slice((body.page - 1) * 10, body.page * 10),
  }));
  const { result, lines } = await captureErrors(() => provider.fetch(entry(), ctx));
  assert.equal(result.length, 10);
  assert.equal(result.aldiNordTruncated, 'not-cumulative');
  assert.match(lines.join('\n'), /page 4 returned no more rows than page 1 — the API no longer treats page as cumulative/);
});

test('the categories filter reaches the request body', async () => {
  const { ctx, calls } = makeCtx(source(3));
  await provider.fetch(entry({ aldi_nord: { categories: ['10420', 19000] } }), ctx);
  assert.deepEqual(calls[0].body.jobCategoryIds, ['10420', '19000']);
  const all = makeCtx(source(3));
  await provider.fetch(entry(), all.ctx);
  assert.deepEqual(all.calls[0].body.jobCategoryIds, []);
});

test('Belgium reads both locales on its own host, each under its own posting path', async () => {
  const nl = source(12, { locale: 'nl-BE', make: (n) => row(n, { slugTitle: `vakkenvuller-${n}` }) });
  const fr = source(2, { locale: 'fr-BE', make: (n) => row(100 + n, { slugTitle: `vendeur-${n}` }) });
  const { ctx, calls, sleeps } = makeCtx((body) => (body.locale === 'nl-BE' ? nl(body) : fr(body)));
  const jobs = await provider.fetch({ name: 'ExampleCo BE', careers_url: 'https://www.aldi.be/jobs/solliciteren.html' }, ctx);
  assert.deepEqual(calls.map((c) => [c.body.locale, c.body.page]), [['nl-BE', 1], ['nl-BE', 2], ['fr-BE', 1]]);
  assert.ok(calls.every((c) => c.url === 'https://www.aldi.be/api/job/hr/query' && c.opts.redirect === 'error'));
  assert.deepEqual(sleeps, [250, 250]);
  assert.equal(jobs.length, 14);
  assert.equal(jobs[0].url, 'https://www.aldi.be/jobs/detail/vakkenvuller-1-900001.html');
  assert.equal(jobs[0].language, 'nl-BE');
  assert.equal(jobs.at(-1).url, 'https://www.aldi.be/fr/jobs/detail/vendeur-2-900102.html');
  assert.equal(jobs.at(-1).language, 'fr-BE');

  const probe = makeCtx((body) => (body.locale === 'nl-BE' ? nl(body) : fr(body)), { maxPages: 1 });
  await provider.fetch({ name: 'ExampleCo BE', careers_url: 'https://www.aldi.be/' }, probe.ctx);
  assert.deepEqual(probe.calls.map((c) => [c.body.locale, c.body.page]), [['nl-BE', 1]]);

  const onlyFr = makeCtx((body) => fr(body));
  await provider.fetch({ name: 'ExampleCo BE', careers_url: 'https://www.aldi.be/', aldi_nord: { locales: ['fr-BE'] } }, onlyFr.ctx);
  assert.deepEqual(onlyFr.calls.map((c) => c.body.locale), ['fr-BE']);
});

test('every confirmed site builds its posting URL on its own host', async () => {
  for (const [host, locales] of Object.entries(SITES)) {
    for (const [locale, path] of Object.entries(locales)) {
      const { ctx, calls } = makeCtx(source(1, { locale }));
      const jobs = await provider.fetch({ name: 'ExampleCo', careers_url: `https://${host}/`, aldi_nord: { locales: [locale] } }, ctx);
      assert.equal(calls[0].url, `https://${host}/api/job/hr/query`);
      assert.equal(jobs[0].url, `https://${host}${path}example-role-1-m-w-d-musterstadt-900001.html`);
    }
  }
});
