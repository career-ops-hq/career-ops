// tests/providers/hirehive.test.mjs — providers/hirehive.mjs (tenant jobs API).
//
// Run:  node --test tests/providers/hirehive.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import hirehive, {
  resolveOrigin,
  buildLocation,
  parseHireHiveJob,
  parseHireHivePage,
  parseSalary,
  PAGE_SIZE,
} from '../../providers/hirehive.mjs';

const ORIGIN = 'https://acme.hirehive.com';
const API = `${ORIGIN}/api/v2/jobs`;

/** One item in the shape `/api/v2/jobs` returns. */
function item(over = {}) {
  return {
    id: 'job_Ab12Cd',
    title: 'Backend Engineer',
    location: 'Berlin',
    state_code: null,
    country: { name: 'Germany', code: 'DE' },
    salary: null,
    description: { html: '<p>Build <strong>APIs</strong> &amp; tools.</p>', text: 'Build APIs & tools.' },
    category: { id: 'cat_x', name: 'Engineering' },
    type: { type: 'FullTime', name: 'Full Time' },
    experience: { type: 'MidLevel', name: 'Mid Level' },
    language: { name: 'German', code: 'de-DE' },
    published_date: '2026-10-20T09:30:00.12Z',
    created_date: '2026-10-19T09:30:00Z',
    hosted_url: `${ORIGIN}/backend-engineer-berlin-Ab12Cd`,
    compensation_tiers: [],
    ...over,
  };
}

function envelope(items, { hasNext = false, page = 1 } = {}) {
  return {
    meta: { page_size: PAGE_SIZE, page, total_items: items.length, total_pages: 1, has_next_page: hasNext, has_previous_page: page > 1 },
    links: { first: '/api/v2/jobs?page=1', next: hasNext ? `/api/v2/jobs?page=${page + 1}` : null },
    items,
  };
}

/** A ctx whose fetchJson answers from `pages` (by `page=` param) and records calls. */
function makeCtx(pages, extra = {}) {
  const calls = [];
  const ctx = {
    calls,
    sleep: async () => {},
    async fetchJson(url, opts) {
      calls.push({ url, opts });
      const page = Number(new URL(url).searchParams.get('page'));
      const answer = typeof pages === 'function' ? pages(page, url) : pages[page - 1];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async fetchText() { throw new Error('fetchText must not be called'); },
    ...extra,
  };
  return ctx;
}

const fullPage = (prefix, n = PAGE_SIZE) =>
  Array.from({ length: n }, (_, i) => item({ title: `${prefix} ${i}`, hosted_url: `${ORIGIN}/${prefix}-${i}-x${i}` }));

test('id is "hirehive"', () => {
  assert.equal(hirehive.id, 'hirehive');
});

test('detect() claims the board root and both posting forms, rebuilt to the tenant API', () => {
  const urls = [
    'https://acme.hirehive.com/',
    'https://acme.hirehive.com',
    'https://ACME.hirehive.com/?countrycode=de',
    'https://acme.hirehive.com/backend-engineer-berlin-Ab12Cd',
    'https://acme.hirehive.com/job/214176/backend-engineer',
    'https://acme.hirehive.com:8443/anything#frag',
  ];
  for (const careers_url of urls) {
    assert.deepEqual(hirehive.detect({ name: 'Acme', careers_url }), { url: API }, careers_url);
  }
  assert.deepEqual(
    hirehive.detect({ name: 'Acme', careers_url: 'https://acme.example/careers', api: 'https://acme.hirehive.com/api/v2/jobs' }),
    { url: API },
  );
  assert.deepEqual(hirehive.detect({ name: 'Multi', careers_url: 'https://multi-word-co.hirehive.com/' }), {
    url: 'https://multi-word-co.hirehive.com/api/v2/jobs',
  });
});

test('detect() returns null on junk and untrusted input, never throws', () => {
  const rejected = [
    'http://acme.hirehive.com/',
    'https://acme.hirehive.com.evil.example/',
    'https://evilhirehive.com/',
    'https://hirehive.com/',
    'https://a.b.hirehive.com/',
    'https://evil.example/acme.hirehive.com/',
    'https://-acme.hirehive.com/',
    'https://www.hirehive.com/',
    'https://app.hirehive.com/',
    'https://apply.hirehive.com/214176/apply',
    'https://accounts.hirehive.com/',
    'not a url',
    '',
  ];
  for (const careers_url of rejected) {
    assert.equal(hirehive.detect({ name: 'Acme', careers_url }), null, careers_url);
  }
  for (const entry of [{ name: 'Acme' }, { name: 'Acme', careers_url: null }, { name: 'Acme', careers_url: 42 }, null, undefined]) {
    assert.equal(hirehive.detect(/** @type {any} */ (entry)), null);
  }
  assert.equal(resolveOrigin({ name: 'Acme', careers_url: 'https://acme.hirehive.com/x' }), ORIGIN);
});

test('fetch() normalizes the API item shape', async () => {
  const ctx = makeCtx([envelope([item()])]);
  const jobs = await hirehive.fetch({ name: 'Acme', careers_url: `${ORIGIN}/` }, /** @type {any} */ (ctx));
  assert.deepEqual(jobs, [{
    title: 'Backend Engineer',
    url: `${ORIGIN}/backend-engineer-berlin-Ab12Cd`,
    company: 'Acme',
    location: 'Berlin, Germany',
    postedAt: Date.parse('2026-10-20T09:30:00.12Z'),
    language: 'de-DE',
    description: 'Build APIs & tools.',
  }]);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].url, `${API}?page=1&page_size=${PAGE_SIZE}`);
  assert.equal(ctx.calls[0].opts.redirect, 'error');
  assert.equal(ctx.calls[0].opts.headers, undefined, 'no extra header is sent');
});

test('buildLocation appends the country only when the text lacks it', () => {
  assert.equal(buildLocation(item({ location: 'Dublin', country: { name: 'Ireland', code: 'IE' } })), 'Dublin, Ireland');
  assert.equal(buildLocation(item({ location: 'Draper, UT', state_code: 'UT', country: { name: 'United States', code: 'US' } })), 'Draper, UT, United States');
  assert.equal(buildLocation(item({ location: 'Sydney, Australia', country: { name: 'Australia', code: 'AU' } })), 'Sydney, Australia');
  assert.equal(buildLocation(item({ location: '', country: { name: 'Ireland', code: 'IE' } })), 'Ireland');
  assert.equal(buildLocation(item({ location: 'Remote', country: null })), 'Remote');
  assert.equal(buildLocation(item({ location: null, country: null })), '');
});

test('parseHireHiveJob drops rows without a title or a trusted posting URL, keeps optional fields NaN-safe', () => {
  assert.equal(parseHireHiveJob(null, 'Acme'), null);
  assert.equal(parseHireHiveJob(item({ title: '   ' }), 'Acme'), null);
  assert.equal(parseHireHiveJob(item({ hosted_url: undefined }), 'Acme'), null);
  assert.equal(parseHireHiveJob(item({ hosted_url: 'https://evil.example/x' }), 'Acme'), null);
  assert.equal(parseHireHiveJob(item({ hosted_url: 'http://acme.hirehive.com/x' }), 'Acme'), null);
  assert.equal(parseHireHiveJob(item({ hosted_url: 'https://www.hirehive.com/x' }), 'Acme'), null);
  assert.equal(parseHireHiveJob(item({ hosted_url: 'not a url' }), 'Acme'), null);

  const bare = parseHireHiveJob(item({ published_date: 'not a date', language: null, description: null }), 'Acme');
  assert.ok(bare);
  assert.equal('postedAt' in bare, false);
  assert.equal('language' in bare, false);
  assert.equal('description' in bare, false);
  assert.equal('requisitionId' in bare, false, 'the posting id is never a requisition id');

  const epoch = parseHireHiveJob(item({ published_date: '1970-01-01T00:00:00Z' }), 'Acme');
  assert.equal(epoch?.postedAt, 0);

  const textOnly = parseHireHiveJob(item({ description: { html: '', text: 'Plain text body' } }), 'Acme');
  assert.equal(textOnly?.description, 'Plain text body');
});

test('a group board keeps a posting hosted on another tenant', () => {
  const job = parseHireHiveJob(item({ hosted_url: 'https://acme-france.hirehive.com/role-paris-Zz99Yy' }), 'Acme Group');
  assert.equal(job?.url, 'https://acme-france.hirehive.com/role-paris-Zz99Yy');
});

test('description HTML is reduced to text with its entities decoded', () => {
  // The API sends titles as plain JSON strings; the description HTML is the
  // only markup in the payload.
  const job = parseHireHiveJob(item({ title: 'R&D Engineer', description: { html: '<p>R&amp;D &#252;ber alles</p>' } }), 'Acme');
  assert.equal(job?.title, 'R&D Engineer');
  assert.equal(job?.description, 'R&D über alles');
});

test('a present-and-empty items[] is an empty board', async () => {
  const ctx = makeCtx([envelope([])]);
  assert.deepEqual(await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx)), []);
});

test('a body that is not the documented envelope throws, naming what it got', () => {
  assert.throws(() => parseHireHivePage({}, 'Acme'), /expected items\[\], got: \[\]/);
  assert.throws(() => parseHireHivePage({ jobs: [] }, 'Acme'), /got: \[jobs\]/);
  assert.throws(() => parseHireHivePage({ items: null, meta: {} }, 'Acme'), /got: \[items, meta\]/);
  assert.throws(() => parseHireHivePage({ items: {} }, 'Acme'), /expected items\[\]/);
  assert.throws(() => parseHireHivePage('', 'Acme'), /got: \[string\]/);
  assert.throws(() => parseHireHivePage(null, 'Acme'), /got: \[object\]/);
  assert.throws(() => parseHireHivePage(7, 'Acme'), /got: \[number\]/);
});

test('one malformed row is skipped and the rest of the board stands', () => {
  const { jobs, rawCount } = parseHireHivePage(envelope([item(), null, 'x', item({ title: '' }), item({ title: 'Second', hosted_url: `${ORIGIN}/second-Qq11Qq` })]), 'Acme');
  assert.equal(rawCount, 5);
  assert.deepEqual(jobs.map((j) => j.title), ['Backend Engineer', 'Second']);
});

test('the host guard fires before any request', async () => {
  for (const careers_url of ['https://evil.example/', 'http://acme.hirehive.com/', 'https://www.hirehive.com/', 'nonsense']) {
    const ctx = makeCtx(() => { throw new Error('fetch must not be called'); });
    await assert.rejects(() => hirehive.fetch({ name: 'Acme', careers_url }, /** @type {any} */ (ctx)), /no <tenant>\.hirehive\.com board/);
    assert.equal(ctx.calls.length, 0, careers_url);
  }
});

test('pagination walks until has_next_page is false, every request with redirect: error', async () => {
  const pages = [envelope(fullPage('a'), { hasNext: true }), envelope(fullPage('b'), { hasNext: true, page: 2 }), envelope([item()], { page: 3 })];
  const ctx = makeCtx(pages);
  const jobs = await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx));
  assert.equal(jobs.length, PAGE_SIZE * 2 + 1);
  assert.deepEqual(ctx.calls.map((c) => new URL(c.url).searchParams.get('page')), ['1', '2', '3']);
  for (const c of ctx.calls) assert.equal(c.opts.redirect, 'error');
});

test('a short page ends the walk even when has_next_page says otherwise', async () => {
  const ctx = makeCtx([envelope([item()], { hasNext: true }), envelope([item()])]);
  await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx));
  assert.equal(ctx.calls.length, 1);
});

test('the same posting on two pages is returned once', async () => {
  const first = fullPage('a');
  const ctx = makeCtx([envelope(first, { hasNext: true }), envelope([first[0], item()], { page: 2 })]);
  const jobs = await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx));
  assert.equal(jobs.length, PAGE_SIZE + 1);
});

test('max_pages stops the walk and warns; the source cannot extend it', async () => {
  const ctx = makeCtx((page) => envelope(fullPage(`p${page}`), { hasNext: true, page }));
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const jobs = await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN, max_pages: 2 }, /** @type {any} */ (ctx));
    assert.equal(jobs.length, PAGE_SIZE * 2);
  } finally {
    console.warn = orig;
  }
  assert.equal(ctx.calls.length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /raise max_pages/);
});

test('a full last page at the max_pages boundary does not warn', async () => {
  const ctx = makeCtx([envelope(fullPage('a'), { hasNext: false })]);
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const jobs = await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN, max_pages: 1 }, /** @type {any} */ (ctx));
    assert.equal(jobs.length, PAGE_SIZE);
  } finally {
    console.warn = orig;
  }
  assert.equal(ctx.calls.length, 1);
  assert.deepEqual(warnings, []);
});

test('a full page with no has_next_page flag does not end the walk', async () => {
  const ctx = makeCtx([{ items: fullPage('a') }, { items: [item()] }]);
  const jobs = await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx));
  assert.equal(ctx.calls.length, 2);
  assert.equal(jobs.length, PAGE_SIZE + 1);
});

test('the provider page ceiling stops an endless board, with or without max_pages', async () => {
  const orig = console.warn;
  console.warn = () => {};
  try {
    const unset = makeCtx((page) => envelope(fullPage(`p${page}`), { hasNext: true, page }));
    await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (unset));
    assert.equal(unset.calls.length, 20);
    const huge = makeCtx((page) => envelope(fullPage(`p${page}`), { hasNext: true, page }));
    await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN, max_pages: 100000 }, /** @type {any} */ (huge));
    assert.equal(huge.calls.length, 100);
  } finally {
    console.warn = orig;
  }
});

test('ctx.maxPages: 1 issues exactly one list request and does not warn', async () => {
  const ctx = makeCtx((page) => envelope(fullPage(`p${page}`), { hasNext: true, page }), { maxPages: 1 });
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const jobs = await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx));
    assert.equal(jobs.length, PAGE_SIZE);
  } finally {
    console.warn = orig;
  }
  assert.equal(ctx.calls.length, 1);
  assert.deepEqual(warnings, []);
});

test('a fetch rejection while probing propagates unchanged', async () => {
  class ProbeBudget extends Error {}
  const boom = new ProbeBudget('budget');
  const ctx = makeCtx(() => boom, { maxPages: 1 });
  await assert.rejects(() => hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx)), (err) => err === boom);
});

test('a failed later page fails the fetch instead of returning a partial board', async () => {
  const err = Object.assign(new Error('HTTP 503'), { status: 503 });
  const ctx = makeCtx((page) => (page === 1 ? envelope(fullPage('a'), { hasNext: true }) : err));
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    await assert.rejects(() => hirehive.fetch({ name: 'Acme', careers_url: ORIGIN, max_pages: 2 }, /** @type {any} */ (ctx)), (e) => e === err);
  } finally {
    console.warn = orig;
  }
  assert.deepEqual(warnings, [], 'the max_pages warning does not fire on a fetch error');
});

test('a 404 on a later page is not reported as a missing tenant', async () => {
  const err = Object.assign(new Error('HTTP 404'), { status: 404 });
  const ctx = makeCtx((page) => (page === 1 ? envelope(fullPage('a'), { hasNext: true }) : err));
  await assert.rejects(() => hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx)), (e) => e === err);
});

test('an unknown tenant (404) is reported as a missing tenant with status 404', async () => {
  const notFound = Object.assign(new Error('HTTP 404'), { status: 404, body: '{"message":"Company not found"}' });
  const ctx = makeCtx(() => notFound);
  await assert.rejects(
    () => hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx)),
    (e) => e.status === 404 && /no such HireHive tenant/.test(e.message) && /acme\.hirehive\.com/.test(e.message),
  );
});

const tier = (over = {}) => ({
  label: null, type: 'range_salary', interval: 'year', currency_code: 'EUR', currency_symbol: null,
  min_value: 50000, max_value: 69000, information: null, ...over,
});

test('salary comes only from a displayed yearly tier', () => {
  assert.deepEqual(parseSalary([tier()]), { min: 50000, max: 69000, currency: 'EUR' });
  assert.deepEqual(parseSalary([tier({ type: 'fixed_salary', max_value: null, currency_code: 'usd' })]), { min: 50000, max: 50000, currency: 'USD' });
  assert.deepEqual(parseSalary([tier({ min_value: null, max_value: 80000, currency_code: null })]), { min: 80000, max: 80000 });
  assert.deepEqual(parseSalary([tier({ min_value: 90000, max_value: 70000 })]), { min: 70000, max: 90000, currency: 'EUR' });
  // A `none` tier is not shown on the posting page, whatever figure it holds.
  assert.equal(parseSalary([tier({ type: 'none', min_value: 32700, max_value: null })]), null);
  // Monthly and hourly figures are not annualized.
  assert.equal(parseSalary([tier({ type: 'fixed_salary', interval: 'month', min_value: 2550 })]), null);
  assert.equal(parseSalary([tier({ type: 'fixed_salary', interval: 'hour', min_value: 35 })]), null);
  assert.equal(parseSalary([tier({ min_value: null, max_value: null })]), null);
  assert.equal(parseSalary([tier({ min_value: 'abc', max_value: -5 })]), null);
  assert.deepEqual(parseSalary([null, tier({ type: 'none' }), tier({ min_value: 60000, max_value: 70000 })]), { min: 60000, max: 70000, currency: 'EUR' });
  assert.equal(parseSalary(null), null);
  assert.equal(parseSalary([]), null);
});

test('fetch() attaches the salary to the job and omits it when absent', async () => {
  const ctx = makeCtx([envelope([item({ compensation_tiers: [tier()] }), item({ title: 'No Pay', hosted_url: `${ORIGIN}/no-pay-Zz00Zz` })])]);
  const [paid, unpaid] = await hirehive.fetch({ name: 'Acme', careers_url: ORIGIN }, /** @type {any} */ (ctx));
  assert.deepEqual(paid.salary, { min: 50000, max: 69000, currency: 'EUR' });
  assert.equal('salary' in unpaid, false);
});
