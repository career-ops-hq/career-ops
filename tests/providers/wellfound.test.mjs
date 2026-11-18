// tests/providers/wellfound.test.mjs — Wellfound: a company's jobs pages and
// the filtered board, both read from the Apollo cache in __NEXT_DATA__.
//
// The page builders below reproduce the cache shape of the live pages: a
// company page links ROOT_QUERY → Startup → jobListingsConnection.edges →
// JobListing (remoteConfig as a __ref), a board page links
// ROOT_QUERY.talent.seoLandingPageJobSearchResults → StartupResult →
// JobListingSearchResult (remoteConfig inline, full description).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — wellfound (company pages + filtered board, __NEXT_DATA__ Apollo cache)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/wellfound.mjs')).href);
const wf = mod.default;
const {
  companySlugFromUrl, wellfoundListingIdentity, parseCompensation, formatLocation,
  extractApolloState, parseCompanyPage, parseBoardPage, resolveBoardConfig, workplaceTypeOf, isPastEndRedirect,
} = mod;
const { isOfferSeen, markOfferSeen, listingIdentityToken } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

const check = (cond, okMsg, failMsg) => (cond ? pass(okMsg) : fail(failMsg));

// ── page builders ──

const html = (data) => `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${
  JSON.stringify({ props: { pageProps: { apolloState: { data } } }, page: '/company/jobs' })
}</script></body></html>`;

/** A JobListing as a company page carries it. */
const listing = (id, over = {}) => ({
  __typename: 'JobListing',
  id: String(id),
  public: true,
  title: `QA Engineer ${id}`,
  slug: `qa-engineer-${id}`,
  jobType: 'full_time',
  locationNames: ['Berlin'],
  acceptedRemoteLocationNames: [],
  remote: false,
  remoteConfig: { __ref: `JobListingRemoteConfig:${id}` },
  compensation: '',
  liveStartAt: 1792669151,
  descriptionSnippet: '<p>A teaser, not the description.</p>',
  atsSource: null,
  ...over,
});

/**
 * A company jobs page. `jobs` are the edges; `foreign` are JobListing records
 * of other companies that sit in the cache without an edge, as on a page past
 * the last one.
 */
function companyPage({ slug = 'acme', name = 'Acme', live = null, totalPageCount = 1, jobs = [], foreign = [], kinds = {} } = {}) {
  const data = {
    ROOT_QUERY: { __typename: 'Query', [`startup(${JSON.stringify({ slug })})`]: { __ref: 'Startup:1' } },
    'Startup:1': {
      __typename: 'Startup', id: '1', slug, name,
      liveJobListingsCount: live ?? jobs.length,
      'jobListingsConnection({"after":"MA==","filters":{"acceptedRemoteLocationIds":[],"jobSourceIds":[],"jobTypes":[],"locationIds":[],"roleIds":[]},"first":20})': {
        __typename: 'JobListingConnection',
        totalPageCount,
        pageSize: 20,
        edges: jobs.map((j) => ({ __typename: 'JobListingEdge', node: { __ref: `JobListing:${j.id}` } })),
      },
    },
    'Startup:2': { __typename: 'Startup', id: '2', slug: 'globex', name: 'Globex' },
  };
  for (const j of [...jobs, ...foreign]) {
    data[`JobListing:${j.id}`] = j;
    data[`JobListingRemoteConfig:${j.id}`] = { __typename: 'JobListingRemoteConfig', id: String(j.id), kind: kinds[j.id] ?? null };
  }
  return html(data);
}

/** A JobListingSearchResult as a board page carries it. */
const result = (id, over = {}) => ({
  __typename: 'JobListingSearchResult',
  id: String(id),
  title: `QA Engineer ${id}`,
  slug: `qa-engineer-${id}`,
  jobType: 'full-time',
  locationNames: ['Berlin'],
  acceptedRemoteLocationNames: [],
  remote: false,
  remoteConfig: null,
  compensation: '€70k – €90k',
  liveStartAt: 1793924801,
  description: `Full description of job ${id}.`,
  atsSource: 'AtsIntegration::Ashby::Listing',
  ...over,
});

/** A board page: `companies` is [{ slug, name, jobs: [result…] }]. */
function boardPage({ total = null, pageCount = 1, companies = [] } = {}) {
  const shown = companies.reduce((n, c) => n + c.jobs.length, 0);
  const data = {
    ROOT_QUERY: {
      __typename: 'Query',
      talent: {
        __typename: 'Talent',
        'seoLandingPageJobSearchResults({"location":"germany","page":1,"role":"qa-engineer"})': {
          __typename: 'Results',
          totalStartupCount: companies.length,
          totalJobCount: total ?? shown,
          perPage: 20,
          pageCount,
          startups: companies.map((c, i) => ({ __ref: `StartupResult:${100 + i}` })),
        },
      },
    },
  };
  companies.forEach((c, i) => {
    data[`StartupResult:${100 + i}`] = {
      __typename: 'StartupResult', id: String(100 + i), slug: c.slug, name: c.name,
      highlightedJobListings: c.jobs.map((j) => ({ __ref: `JobListingSearchResult:${j.id}` })),
    };
    for (const j of c.jobs) data[`JobListingSearchResult:${j.id}`] = j;
  });
  return html(data);
}

/** Twenty companies with one job each, ids from `start`: a full board page. */
const fullBoardCompanies = (start) => Array.from({ length: 20 }, (_, i) => ({
  slug: `co-${start + i}`, name: `Co ${start + i}`, jobs: [result(start + i)],
}));

// What ctx.fetchText throws for a 3xx under redirect: 'error' (refused) and
// under redirect: 'manual' (inspected: status and Location kept).
const redirectError = () => new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
const manualRedirect = (status, location) => Object.assign(new Error(`HTTP ${status}`), { status, location });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/** A ctx whose fetchText answers from `route(url, n)`; records every call. */
function makeCtx(route, extra = {}) {
  const ctx = {
    calls: [],
    sleeps: [],
    fetchText: async (url, opts) => {
      ctx.calls.push({ url, opts });
      const out = await route(url, ctx.calls.length);
      if (out instanceof Error) throw out;
      return out;
    },
    fetchJson: async () => { throw new Error('wellfound must not call fetchJson'); },
    sleep: async (ms) => { ctx.sleeps.push(ms); },
    ...extra,
  };
  return ctx;
}

/** Run `fn` with console.error captured. */
async function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    return { value: await fn(), lines };
  } catch (err) {
    return { error: err, lines };
  } finally {
    console.error = orig;
  }
}

const allRedirectError = (ctx) => ctx.calls.every((c) => c.opts?.redirect === 'error');
const companyEntry = { name: 'Acme', careers_url: 'https://wellfound.com/company/acme' };
const boardEntry = (wellfound, extra = {}) => ({ name: 'WF board', provider: 'wellfound', wellfound, ...extra });

try {
  // ── id, detect() ──
  check(wf.id === 'wellfound', 'id is "wellfound"', `id = ${wf.id}`);

  {
    const hits = [
      ['https://wellfound.com/company/acme', 'acme'],
      ['https://wellfound.com/company/acme/jobs', 'acme'],
      ['https://wellfound.com/company/acme/jobs?page=2', 'acme'],
      ['https://www.wellfound.com/company/acme/', 'acme'],
      ['https://wellfound.com/company/example_co_', 'example_co_'],
      ['https://wellfound.com/company/Acme-1', 'acme-1'],
    ];
    const bad = hits.filter(([u, slug]) => companySlugFromUrl(u) !== slug
      || wf.detect({ careers_url: u })?.url !== `https://wellfound.com/company/${slug}/jobs`);
    check(bad.length === 0, 'detect() claims wellfound.com/company/{slug} and deeper paths, reading only the slug', `missed: ${JSON.stringify(bad)}`);
  }
  {
    const misses = [
      'http://wellfound.com/company/acme',
      'https://wellfound.com.evil.example/company/acme',
      'https://evilwellfound.com/company/acme',
      'https://wellfound.com/role/qa-engineer',
      'https://wellfound.com/jobs/4881145-qa-engineer',
      'https://wellfound.com/company/',
      'https://wellfound.com/company/acme%2Fx',
      'not a url',
      '',
    ];
    const wrong = misses.filter((u) => wf.detect({ careers_url: u }) !== null);
    let threw = false;
    for (const e of [null, undefined, {}, { careers_url: 42 }, { careers_url: null }]) {
      try { if (wf.detect(e) !== null) wrong.push(JSON.stringify(e)); } catch { threw = true; }
    }
    check(wrong.length === 0 && !threw, 'detect() returns null for other hosts, http, board/job paths, junk and missing input, without throwing', `wrong: ${JSON.stringify(wrong)} threw=${threw}`);
  }
  {
    const hit = wf.detect({ provider: 'wellfound', wellfound: { roles: ['qa-engineer'] } });
    const noBlock = wf.detect({ provider: 'wellfound' });
    const otherProvider = wf.detect({ provider: 'wttj', wellfound: { roles: ['qa-engineer'] } });
    check(hit?.url === 'https://wellfound.com' && noBlock === null && otherProvider === null,
      'detect() claims an explicit provider: wellfound board entry with a wellfound: block, and nothing else without a URL',
      `hit=${JSON.stringify(hit)} noBlock=${JSON.stringify(noBlock)} other=${JSON.stringify(otherProvider)}`);
  }
  check(wf.fetchHost() === 'wellfound.com', 'fetchHost() names wellfound.com for both branches', `fetchHost = ${wf.fetchHost()}`);

  // ── helpers ──
  {
    const cases = [
      ['$175k – $215k', { min: 175000, max: 215000, currency: 'USD' }],
      ['€80k – €100k', { min: 80000, max: 100000, currency: 'EUR' }],
      ['€80k – €100k • 0.1% – 0.5%', { min: 80000, max: 100000, currency: 'EUR' }],
      ['$100k – $130k • No equity', { min: 100000, max: 130000, currency: 'USD' }],
      ['$90k – $120k CAD', { min: 90000, max: 120000, currency: 'CAD' }],
      ['$90k – $120k CAD • No equity', { min: 90000, max: 120000, currency: 'CAD' }],
      ['₹10L – ₹25L • No equity', { min: 1000000, max: 2500000, currency: 'INR' }],
      ['$1.5k – $2k', { min: 1500, max: 2000, currency: 'USD' }],
    ];
    const none = ['', '0.5% – 1%', '$100k', '$100k – €120k', '$130k – $100k', 'Competitive', null, 42];
    const bad = cases.filter(([s, want]) => JSON.stringify(parseCompensation(s)) !== JSON.stringify(want))
      .concat(none.filter((s) => parseCompensation(s) !== undefined).map((s) => [s]));
    check(bad.length === 0, 'parseCompensation() reads $/€/₹ ranges, a trailing currency code and an equity tail; anything else has no salary', `wrong: ${JSON.stringify(bad)}`);
  }
  {
    const qase = formatLocation({ locationNames: ['Delaware'], acceptedRemoteLocationNames: ['Europe'], remote: true }, 'REMOTE');
    const either = formatLocation({ locationNames: ['Geneva'], acceptedRemoteLocationNames: ['Switzerland', 'Paris, France'], remote: true }, 'ONSITE_OR_REMOTE');
    const remoteNoList = formatLocation({ locationNames: ['Boston', 'Denver'], acceptedRemoteLocationNames: [], remote: true }, 'REMOTE');
    const onsite = formatLocation({ locationNames: ['Munich', ' Munich ', ''], remote: false }, 'ONSITE');
    const nothing = formatLocation({ remote: true }, null);
    check(
      qase.location === 'Remote (Europe)' && JSON.stringify(qase.locations) === '["Delaware"]'
      && either.location === 'Geneva; Remote (Switzerland, Paris, France)'
      && remoteNoList.location === 'Boston; Denver; Remote'
      && onsite.location === 'Munich' && JSON.stringify(onsite.locations) === '["Munich"]'
      && nothing.location === 'Remote' && nothing.locations.length === 0,
      'formatLocation(): a remote-only job with accepted regions is located there, not at its listed seat; others list places, then Remote (regions)',
      JSON.stringify({ qase, either, remoteNoList, onsite, nothing }),
    );
  }
  {
    const got = [
      workplaceTypeOf('REMOTE', true), workplaceTypeOf('ONSITE', false), workplaceTypeOf('ONSITE', undefined),
      workplaceTypeOf('ONSITE_OR_REMOTE', true), workplaceTypeOf('ONSITE', true), workplaceTypeOf('REMOTE', false),
      workplaceTypeOf(null, true), workplaceTypeOf(undefined, false),
    ];
    check(JSON.stringify(got) === JSON.stringify(['remote', 'onsite', 'onsite', undefined, undefined, undefined, undefined, undefined]),
      'workplaceTypeOf(): REMOTE and ONSITE when remote agrees; ONSITE_OR_REMOTE, a contradiction or no kind gives none',
      JSON.stringify(got));
  }
  {
    const ok = wellfoundListingIdentity('acme', '4881145');
    const bad = [['acme', 4881145], ['acme', '0123'], ['acme', ''], ['', '1'], [' acme', '1'], ['ac me', '1'], [null, '1']]
      .filter(([s, id]) => wellfoundListingIdentity(s, id) !== undefined);
    check(JSON.stringify(ok) === '{"ats_provider":"wellfound","board_slug":"acme","posting_id":"4881145"}' && bad.length === 0,
      'wellfoundListingIdentity() is the company slug + string job id, and nothing for an unusable part', `ok=${JSON.stringify(ok)} bad=${JSON.stringify(bad)}`);
  }

  // ── parsing: empty vs broken ──
  {
    const errors = [];
    for (const [label, page] of [
      ['no __NEXT_DATA__', '<html><body>nothing</body></html>'],
      ['malformed JSON', '<script id="__NEXT_DATA__" type="application/json">{not json</script>'],
      ['no apolloState', `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: {} } })}</script>`],
    ]) {
      try { extractApolloState(page, 'test page'); errors.push(`${label}: no throw`); } catch (err) {
        if (!/wellfound: test page/.test(err.message)) errors.push(`${label}: ${err.message}`);
      }
    }
    check(errors.length === 0, 'a page without __NEXT_DATA__ or apolloState throws a descriptive error', errors.join('; '));
  }
  {
    let missingStartup = null;
    try { parseCompanyPage(companyPage({ slug: 'acme' }), 'globex', 'Globex'); } catch (err) { missingStartup = err; }
    let missingBoard = null;
    try { parseBoardPage(html({ ROOT_QUERY: { talent: {} } }), 'board'); } catch (err) { missingBoard = err; }
    const empty = parseCompanyPage(companyPage({ jobs: [] }), 'acme', 'Acme');
    const emptyBoard = parseBoardPage(boardPage({ companies: [] }), 'board');
    check(/no startup record/.test(missingStartup?.message) && /seoLandingPageJobSearchResults/.test(missingBoard?.message)
      && empty.jobs.length === 0 && emptyBoard.jobs.length === 0,
      'a missing startup record or result set throws; a present, empty edges[] or startups[] is an empty list',
      `${missingStartup?.message} / ${missingBoard?.message} / ${empty.jobs.length} / ${emptyBoard.jobs.length}`);
  }

  // ── company branch ──
  {
    const jobs = [
      listing(4881145, {
        title: 'Senior Engineer, MCP & Developer Tools',
        slug: 'senior-engineer-mcp-developer-tools',
        locationNames: ['Delaware'], acceptedRemoteLocationNames: ['Europe'], remote: true,
        compensation: '€80k – €100k', jobType: 'full_time',
      }),
      listing(4756849, { title: 'Contract QA', slug: 'contract-qa', jobType: 'contract', liveStartAt: null }),
    ];
    const ctx = makeCtx(() => companyPage({ name: 'Acme Labs', jobs, kinds: { 4881145: 'REMOTE' } }));
    const out = await wf.fetch(companyEntry, ctx);
    const [a, b] = out;
    check(
      ctx.calls.length === 1 && ctx.calls[0].url === 'https://wellfound.com/company/acme/jobs' && allRedirectError(ctx)
      && out.length === 2
      && a.url === 'https://wellfound.com/jobs/4881145-senior-engineer-mcp-developer-tools'
      && a.title === 'Senior Engineer, MCP & Developer Tools' && a.company === 'Acme Labs'
      && a.location === 'Remote (Europe)' && JSON.stringify(a.locations) === '["Delaware"]'
      && a.postedAt === 1792669151000
      && JSON.stringify(a.salary) === '{"min":80000,"max":100000,"currency":"EUR"}'
      && a.employmentType === 'full_time'
      && JSON.stringify(a.listingIdentity) === '{"ats_provider":"wellfound","board_slug":"acme","posting_id":"4881145"}'
      && a.externalId === '4881145' && b.externalId === '4756849'
      && a.workplaceType === 'remote' && !('workplaceType' in b)
      && !('description' in a) && !('description' in b)
      && b.employmentType === 'contract' && !('postedAt' in b) && !('salary' in b) && b.location === 'Berlin',
      'company page: one request to /company/{slug}/jobs with redirect "error"; rows map to the Job shape; the teaser is not a description',
      JSON.stringify({ calls: ctx.calls, out }),
    );
  }
  {
    const p1 = Array.from({ length: 20 }, (_, i) => listing(1000 + i));
    const p2 = Array.from({ length: 20 }, (_, i) => listing(2000 + i));
    const p3 = [listing(3000), listing(3001), listing(3002)];
    const pages = { 1: p1, 2: p2, 3: p3 };
    const ctx = makeCtx((url) => {
      const n = Number(new URL(url).searchParams.get('page') || 1);
      return companyPage({ totalPageCount: 3, live: 43, jobs: pages[n] });
    });
    const out = await wf.fetch(companyEntry, ctx);
    check(out.length === 43 && ctx.calls.map((c) => c.url).join(' ') === [
      'https://wellfound.com/company/acme/jobs',
      'https://wellfound.com/company/acme/jobs?page=2',
      'https://wellfound.com/company/acme/jobs?page=3',
    ].join(' ') && JSON.stringify(ctx.sleeps) === '[250,250]' && allRedirectError(ctx) && out.truncated === undefined,
    'company pages: ?page=2…totalPageCount, 250 ms between requests, redirect "error" on every page',
    JSON.stringify({ n: out.length, urls: ctx.calls.map((c) => c.url), sleeps: ctx.sleeps }));
  }
  {
    // A page past the last one: 200, no edges, but other companies' JobListing
    // records in the cache. totalPageCount claims one more page than exists.
    const p1 = Array.from({ length: 20 }, (_, i) => listing(1000 + i));
    const foreign = [listing(9001, { startup: { __ref: 'Startup:2' } }), listing(9002, { startup: { __ref: 'Startup:2' } })];
    const ctx = makeCtx((url) => (url.includes('page=2')
      ? companyPage({ totalPageCount: 2, live: 20, jobs: [], foreign })
      : companyPage({ totalPageCount: 2, live: 20, jobs: p1 })));
    const out = await wf.fetch(companyEntry, ctx);
    check(out.length === 20 && !out.some((j) => /900[12]/.test(j.url)),
      'a page past the last one keeps no foreign JobListing from the cache: jobs come only through edges',
      `${out.length} jobs, foreign=${out.filter((j) => /900[12]/.test(j.url)).length}`);
  }
  {
    const jobs = [
      listing(1),
      listing(2, { public: false }),
      listing(3, { id: undefined }),
      listing(4, { slug: 'Bad Slug!' }),
      listing(5, { title: '  ' }),
      listing(6, { slug: 'bad-\uD800' }),
      listing(7, { id: '0007' }),
      listing(8),
    ];
    const out = await wf.fetch(companyEntry, makeCtx(() => companyPage({ jobs })));
    check(out.map((j) => j.url.match(/jobs\/(\d+)/)[1]).join(',') === '1,8',
      'a non-public row, or one without a usable id, slug or title, is skipped and the rest stands',
      JSON.stringify(out.map((j) => j.url)));
  }
  {
    const ctx = makeCtx(() => httpError(404));
    let err = null;
    try { await wf.fetch(companyEntry, ctx); } catch (e) { err = e; }
    check(err && /company "acme" not found/.test(err.message) && err.status === 404 && ctx.calls.length === 1,
      'an unknown company slug (404) throws a configuration error that keeps status 404',
      `${err?.message} status=${err?.status} calls=${ctx.calls.length}`);
  }
  {
    let err = null;
    const ctx = makeCtx(() => 'x');
    try { await wf.fetch({ name: 'NoUrl', careers_url: 'https://example.com/careers' }, ctx); } catch (e) { err = e; }
    check(/needs careers_url/.test(err?.message) && ctx.calls.length === 0,
      'an entry with neither a company URL nor a wellfound: block throws before any request', `${err?.message} calls=${ctx.calls.length}`);
  }
  {
    // A tall company: every page full, the source reports more pages than the cap.
    const full = (n) => Array.from({ length: 20 }, (_, i) => listing(n * 100 + i));
    const route = (url) => companyPage({ totalPageCount: 500, live: 10000, jobs: full(Number(new URL(url).searchParams.get('page') || 1)) });
    const ctx = makeCtx(route);
    const { value: out, lines } = await captureErrors(() => wf.fetch(companyEntry, ctx));
    const ctx2 = makeCtx(route);
    const { value: out2 } = await captureErrors(() => wf.fetch({ ...companyEntry, max_pages: 2 }, ctx2));
    const ctx3 = makeCtx(route);
    await captureErrors(() => wf.fetch({ ...companyEntry, max_pages: 100000 }, ctx3));
    check(ctx.calls.length === 25 && out.truncated?.reason === 'page-cap' && lines.some((l) => /raise max_pages/.test(l))
      && ctx2.calls.length === 2 && out2.length === 40 && ctx3.calls.length === 100,
      'company pages: the provider\'s own cap (25, max_pages, hard cap 100) bounds the walk whatever totalPageCount says, and warns',
      `default=${ctx.calls.length} trunc=${JSON.stringify(out.truncated)} max2=${ctx2.calls.length} huge=${ctx3.calls.length}`);
  }
  {
    // A short last page at the cap boundary is complete, not truncated.
    const ctx = makeCtx((url) => (url.includes('page=2')
      ? companyPage({ totalPageCount: 2, jobs: [listing(2)] })
      : companyPage({ totalPageCount: 2, jobs: Array.from({ length: 20 }, (_, i) => listing(100 + i)) })));
    const { value: out, lines } = await captureErrors(() => wf.fetch({ ...companyEntry, max_pages: 2 }, ctx));
    check(out.length === 21 && out.truncated === undefined && !lines.some((l) => /raise max_pages/.test(l)),
      'a short page at the max_pages boundary ends the walk as complete', `trunc=${JSON.stringify(out.truncated)} lines=${lines}`);
  }
  {
    // Page 2 fails after retries: page 1 is kept, the board is marked partial,
    // and the "raise max_pages" warning stays silent.
    const ctx = makeCtx((url) => (url.includes('page=2')
      ? httpError(500)
      : companyPage({ totalPageCount: 3, jobs: Array.from({ length: 20 }, (_, i) => listing(100 + i)) })));
    const { value: out, lines } = await captureErrors(() => wf.fetch(companyEntry, ctx));
    check(out?.length === 20 && out.truncated?.reason === 'fetch-error' && !lines.some((l) => /raise max_pages/.test(l))
      && lines.some((l) => /truncated at page 2/.test(l)),
      'a failed page 2 keeps page 1, marks the result fetch-error, and does not say "raise max_pages"',
      `n=${out?.length} trunc=${JSON.stringify(out?.truncated)} lines=${lines}`);
  }
  {
    // A later page that is not a jobs page (200, no __NEXT_DATA__): page 1 is
    // kept, for a tracked company and for a company the board expands.
    const route = (url) => (url.includes('page=2')
      ? '<html><body>Just a moment...</body></html>'
      : companyPage({ totalPageCount: 3, jobs: Array.from({ length: 20 }, (_, i) => listing(100 + i)) }));
    const { value: out, error } = await captureErrors(() => wf.fetch(companyEntry, makeCtx(route)));
    const board = boardPage({ total: 30, companies: [{ slug: 'acme', name: 'Acme', jobs: [result(100), result(101), result(102)] }] });
    const { value: boardOut } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'] }),
      makeCtx((url) => (url.includes('/company/') ? route(url) : board))));
    check(!error && out?.length === 20 && out.truncated?.reason === 'unrecognised-page'
      && boardOut?.length === 20 && boardOut.truncated?.reason === 'unrecognised-page',
      'company page: an unparseable later page keeps the pages read and marks unrecognised-page, also when the board expands the company',
      `error=${error?.message} n=${out?.length} trunc=${JSON.stringify(out?.truncated)} board=${boardOut?.length} ${JSON.stringify(boardOut?.truncated)}`);
  }
  {
    const ctx = makeCtx(() => companyPage({ totalPageCount: 1, live: 5, jobs: [listing(1), listing(2)] }));
    const { lines } = await captureErrors(() => wf.fetch(companyEntry, ctx));
    check(lines.some((l) => /read 2 of the 5 jobs/.test(l)), 'fewer jobs than liveJobListingsCount warns and does not fail', lines.join(' | '));
  }

  // ── board config ──
  {
    const errors = [];
    for (const [label, cfg] of [
      ['no block', undefined],
      ['empty block', {}],
      ['only remote', { remote: true }],
      ['remote without roles', { locations: ['germany'], remote: true }],
      ['unknown key', { roles: ['qa-engineer'], role: ['x'] }],
      ['uppercase slug', { roles: ['QA-Engineer'] }],
      ['slug with a slash', { locations: ['germany/berlin'] }],
      ['roles not a list', { roles: 'qa-engineer' }],
      ['remote not boolean', { roles: ['qa-engineer'], remote: 'yes' }],
      ['bad max_companies', { roles: ['qa-engineer'], max_companies: -1 }],
      ['too many pages', { roles: ['a', 'b', 'c', 'd', 'e'], locations: ['f', 'g', 'h', 'i', 'j'] }],
    ]) {
      const ctx = makeCtx(() => boardPage());
      const entry = cfg === undefined ? { name: 'WF board', provider: 'wellfound' } : boardEntry(cfg);
      try {
        await (cfg === undefined ? (() => resolveBoardConfig(entry))() : wf.fetch(entry, ctx));
        errors.push(`${label}: no throw`);
      } catch (err) {
        if (!/^wellfound: WF board — /.test(err.message) || ctx.calls.length !== 0) errors.push(`${label}: ${err.message} calls=${ctx.calls.length}`);
      }
    }
    check(errors.length === 0, 'board config: a missing, empty or malformed wellfound: block throws a named error before any request', errors.join('; '));
  }
  {
    const paths = (cfg) => resolveBoardConfig(boardEntry(cfg)).urls.map((u) => u.path).join(' ');
    const a = paths({ roles: ['qa-engineer', 'software-engineer'], locations: ['germany'], remote: true });
    const b = paths({ roles: ['qa-engineer'] });
    const c = paths({ locations: ['berlin', 'berlin'] });
    check(
      a === '/role/l/qa-engineer/germany /role/l/software-engineer/germany /role/r/qa-engineer /role/r/software-engineer'
      && b === '/role/qa-engineer' && c === '/location/berlin'
      && resolveBoardConfig(boardEntry({ roles: ['x'] })).maxCompanies === 25
      && resolveBoardConfig(boardEntry({ roles: ['x'], max_companies: 500 })).maxCompanies === 100,
      'board config: roles x locations, roles alone, locations alone, remote per role; max_companies defaults to 25, capped at 100',
      JSON.stringify({ a, b, c }),
    );
  }

  // ── board branch ──
  {
    const companies = [
      { slug: 'acme', name: 'Acme', jobs: [result(11, { remote: true, acceptedRemoteLocationNames: ['Germany'], remoteConfig: { __typename: 'JobListingRemoteConfig', kind: 'REMOTE' }, locationNames: ['Munich'] })] },
      { slug: 'globex', name: 'Globex', jobs: [result(21), result(22, { jobType: 'internship', compensation: '' })] },
    ];
    const ctx = makeCtx(() => boardPage({ companies }));
    const out = await wf.fetch(boardEntry({ roles: ['qa-engineer'], locations: ['germany'] }), ctx);
    const [a, b, c] = out;
    check(
      ctx.calls.length === 1 && ctx.calls[0].url === 'https://wellfound.com/role/l/qa-engineer/germany' && allRedirectError(ctx)
      && out.length === 3
      && a.company === 'Acme' && a.location === 'Remote (Germany)' && a.description === 'Full description of job 11.'
      && a.url === 'https://wellfound.com/jobs/11-qa-engineer-11' && a.employmentType === 'full_time'
      && a.externalId === '11' && a.workplaceType === 'remote'
      && JSON.stringify(a.listingIdentity) === '{"ats_provider":"wellfound","board_slug":"acme","posting_id":"11"}'
      && JSON.stringify(a.salary) === '{"min":70000,"max":90000,"currency":"EUR"}'
      && b.company === 'Globex' && c.employmentType === 'internship' && !('salary' in c) && out.truncated === undefined,
      'board page: one request per filter URL; jobs carry the company from StartupResult and the full description',
      JSON.stringify({ calls: ctx.calls.map((x) => x.url), out }),
    );
  }
  {
    // The same job on two filter URLs is one row.
    const companies = [{ slug: 'acme', name: 'Acme', jobs: [result(11)] }];
    const ctx = makeCtx(() => boardPage({ companies }));
    const out = await wf.fetch(boardEntry({ roles: ['qa-engineer'], locations: ['germany', 'berlin'] }), ctx);
    check(ctx.calls.length === 2 && out.length === 1 && JSON.stringify(ctx.sleeps) === '[250]',
      'board: a job listed on two filter URLs is returned once; requests are 250 ms apart', `calls=${ctx.calls.length} n=${out.length} sleeps=${ctx.sleeps}`);
  }
  {
    // Pages 1..pageCount, stopping there; a page past the end is never asked for.
    const ctx = makeCtx((url) => {
      const n = Number(new URL(url).searchParams.get('page') || 1);
      return boardPage({ total: 60, pageCount: 3, companies: fullBoardCompanies(n * 100) });
    });
    const out = await wf.fetch(boardEntry({ roles: ['qa-engineer'] }), ctx);
    check(ctx.calls.length === 3 && ctx.calls[2].url === 'https://wellfound.com/role/qa-engineer?page=3' && out.length === 60
      && ctx.calls.map((c) => c.opts?.redirect).join(',') === 'error,manual,manual',
      'board pages: ?page=2…pageCount, never past it; pages after the first inspect a redirect instead of refusing it',
      `calls=${ctx.calls.map((c) => `${c.url} ${c.opts?.redirect}`)} n=${out.length}`);
  }
  {
    const path = '/role/l/qa-engineer/germany';
    const yes = [manualRedirect(303, `https://wellfound.com${path}`), manualRedirect(303, path)];
    const no = [
      manualRedirect(302, `https://wellfound.com${path}`),
      manualRedirect(303, `https://wellfound.com${path}?page=1`),
      manualRedirect(303, 'https://wellfound.com/login'),
      manualRedirect(303, `https://evil.example${path}`),
      manualRedirect(303, null),
      redirectError(),
      httpError(500),
    ];
    check(yes.every((e) => isPastEndRedirect(e, path)) && no.every((e) => !isPastEndRedirect(e, path)),
      'isPastEndRedirect(): only a 303 back to page 1 of the same search on wellfound.com',
      JSON.stringify({ yes: yes.map((e) => isPastEndRedirect(e, path)), no: no.map((e) => isPastEndRedirect(e, path)) }));
  }
  {
    // pageCount shrank during the walk: page 2 answers 303 back to page 1.
    const ctx = makeCtx((url) => (url.includes('page=2')
      ? manualRedirect(303, 'https://wellfound.com/role/qa-engineer')
      : boardPage({ total: 40, pageCount: 2, companies: fullBoardCompanies(100) })));
    const { value: out, lines } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'] }), ctx));
    check(out?.length === 20 && out.truncated === undefined && lines.length === 0,
      'board: a 303 back to page 1 on a later page ends the walk as complete (the list shrank)', `n=${out?.length} trunc=${JSON.stringify(out?.truncated)} lines=${lines}`);
  }
  {
    // Any other redirect on a later page leaves the result partial.
    const ctx = makeCtx((url) => (url.includes('page=2')
      ? manualRedirect(302, 'https://wellfound.com/login')
      : boardPage({ total: 40, pageCount: 2, companies: fullBoardCompanies(100) })));
    const { value: out, lines } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'] }), ctx));
    check(out?.length === 20 && out.truncated?.reason === 'fetch-error' && lines.some((l) => /truncated at page 2/.test(l)),
      'board: another redirect on a later page keeps page 1 and marks fetch-error', `n=${out?.length} trunc=${JSON.stringify(out?.truncated)}`);
  }
  {
    // A later page that is not a results page (200, no __NEXT_DATA__).
    const ctx = makeCtx((url) => (url.includes('page=2')
      ? '<html><body>Just a moment...</body></html>'
      : boardPage({ total: 40, pageCount: 2, companies: fullBoardCompanies(100) })));
    const { value: out, error } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'] }), ctx));
    let firstPageError = null;
    try {
      await wf.fetch(boardEntry({ roles: ['qa-engineer'] }), makeCtx(() => '<html>no data</html>'));
    } catch (err) { firstPageError = err; }
    check(!error && out?.length === 20 && out.truncated?.reason === 'unrecognised-page' && /__NEXT_DATA__/.test(firstPageError?.message),
      'board: an unparseable later page keeps the pages read and marks unrecognised-page; an unparseable first page throws',
      `error=${error?.message} n=${out?.length} trunc=${JSON.stringify(out?.truncated)} first=${firstPageError?.message}`);
  }
  {
    const errs = [];
    for (const [label, answer] of [['303', redirectError()], ['404', httpError(404)]]) {
      const ctx = makeCtx(() => answer);
      try {
        await wf.fetch(boardEntry({ roles: ['qa-engineer'], locations: ['nowhere'] }), ctx);
        errs.push(`${label}: no throw`);
      } catch (err) {
        if (!/\/role\/l\/qa-engineer\/nowhere .*check the slugs/.test(err.message)) errs.push(`${label}: ${err.message}`);
        if (label === '404' && err.status !== 404) errs.push('404 status lost');
      }
    }
    check(errs.length === 0, 'board: a 303 or 404 on page 1 is a configuration error naming the path, never an empty or broader result', errs.join('; '));
  }
  {
    const ctx = makeCtx((url) => boardPage({ total: 2000, pageCount: 100, companies: fullBoardCompanies(Number(new URL(url).searchParams.get('page') || 1) * 100) }));
    const { value: out, lines } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'] }), ctx));
    const ctx2 = makeCtx((url) => boardPage({ total: 2000, pageCount: 100, companies: fullBoardCompanies(Number(new URL(url).searchParams.get('page') || 1) * 100) }));
    await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'] }, { max_pages: 3 }), ctx2));
    check(ctx.calls.length === 10 && out.truncated?.reason === 'page-cap' && lines.some((l) => /raise max_pages/.test(l)) && ctx2.calls.length === 3,
      'board pages: the provider\'s own cap (10, or max_pages) bounds the walk whatever pageCount says, and warns',
      `calls=${ctx.calls.length} trunc=${JSON.stringify(out.truncated)} max3=${ctx2.calls.length}`);
  }

  // ── board completeness ──
  {
    // Acme shows 3 jobs (the limit) and the board counts 5: Acme's company page
    // is read, and its 2 jobs the board did not show are added. Globex shows 1
    // and is not read.
    const board = boardPage({
      total: 6,
      companies: [
        { slug: 'acme', name: 'Acme', jobs: [result(1), result(2), result(3)] },
        { slug: 'globex', name: 'Globex', jobs: [result(9)] },
      ],
    });
    const acme = companyPage({ slug: 'acme', name: 'Acme', jobs: [listing(1), listing(2), listing(3), listing(4), listing(5)] });
    const ctx = makeCtx((url) => (url.includes('/company/') ? acme : board));
    const out = await wf.fetch(boardEntry({ roles: ['qa-engineer'], locations: ['germany'] }), ctx);
    const one = out.find((j) => j.url.includes('/jobs/1-'));
    check(
      ctx.calls.map((c) => c.url).join(' ') === 'https://wellfound.com/role/l/qa-engineer/germany https://wellfound.com/company/acme/jobs'
      && out.length === 6 && one?.description === 'Full description of job 1.' && out.truncated === undefined && allRedirectError(ctx),
      'board completeness: a company at the 3-job limit on an incomplete board is read in full; board rows keep their description',
      JSON.stringify({ calls: ctx.calls.map((c) => c.url), urls: out.map((j) => j.url) }),
    );
  }
  {
    // The board shows every job it counts: no company page is read.
    const ctx = makeCtx(() => boardPage({ companies: [{ slug: 'acme', name: 'Acme', jobs: [result(1), result(2), result(3)] }] }));
    const out = await wf.fetch(boardEntry({ roles: ['qa-engineer'], locations: ['germany'] }), ctx);
    check(ctx.calls.length === 1 && out.length === 3, 'board completeness: a complete board reads no company page', `calls=${ctx.calls.length}`);
  }
  {
    const companies = Array.from({ length: 4 }, (_, i) => ({ slug: `co-${i}`, name: `Co ${i}`, jobs: [result(i * 10 + 1), result(i * 10 + 2), result(i * 10 + 3)] }));
    const ctx = makeCtx((url) => (url.includes('/company/') ? companyPage({ slug: url.match(/company\/([^/]+)/)[1], jobs: [] }) : boardPage({ total: 100, companies })));
    const { value: out, lines } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'], max_companies: 2 }), ctx));
    check(ctx.calls.filter((c) => c.url.includes('/company/')).length === 2 && out.truncated?.reason === 'company-cap'
      && lines.some((l) => /raise wellfound\.max_companies/.test(l)),
      'board completeness: max_companies bounds the company reads, marks the result company-cap and warns',
      `companyCalls=${ctx.calls.filter((c) => c.url.includes('/company/')).length} trunc=${JSON.stringify(out.truncated)}`);
  }
  {
    // A company read that fails keeps the board rows and marks the result partial.
    const ctx = makeCtx((url) => (url.includes('/company/')
      ? httpError(500)
      : boardPage({ total: 10, companies: [{ slug: 'acme', name: 'Acme', jobs: [result(1), result(2), result(3)] }] })));
    const { value: out } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer'] }), ctx));
    check(out?.length === 3 && out.truncated?.reason === 'fetch-error',
      'board completeness: a failed company read keeps the board rows and marks fetch-error', `n=${out?.length} trunc=${JSON.stringify(out?.truncated)}`);
  }

  // ── health probe ──
  {
    const companyCtx = makeCtx(() => companyPage({ totalPageCount: 5, jobs: Array.from({ length: 20 }, (_, i) => listing(100 + i)) }), { maxPages: 1 });
    await wf.fetch(companyEntry, companyCtx);
    const board = boardPage({ total: 999, pageCount: 9, companies: [{ slug: 'acme', name: 'Acme', jobs: [result(1), result(2), result(3)] }, ...fullBoardCompanies(100).slice(1)] });
    const boardCtx = makeCtx(() => board, { maxPages: 1 });
    const { lines } = await captureErrors(() => wf.fetch(boardEntry({ roles: ['qa-engineer', 'product-manager'], locations: ['germany'], remote: true }), boardCtx));
    check(companyCtx.calls.length === 1 && boardCtx.calls.length === 1 && lines.length === 0,
      'probe (ctx.maxPages: 1): exactly one list request, no company reads, no warning',
      `company=${companyCtx.calls.length} board=${boardCtx.calls.length} lines=${lines}`);
  }
  {
    class FakeSentinel extends Error {}
    const errs = [];
    for (const [label, entry] of [['company', companyEntry], ['board', boardEntry({ roles: ['qa-engineer'] })]]) {
      const sentinel = new FakeSentinel('budget');
      try {
        await wf.fetch(entry, makeCtx(() => sentinel, { maxPages: 1 }));
        errs.push(`${label}: no throw`);
      } catch (err) {
        if (err !== sentinel) errs.push(`${label}: rewrapped as ${err?.message}`);
      }
    }
    check(errs.length === 0, 'probe: a ctx.fetchText rejection propagates unwrapped', errs.join('; '));
  }

  // ── listingIdentity across URLs ──
  {
    const [boardRow] = await wf.fetch(boardEntry({ roles: ['qa-engineer'] }), makeCtx(() => boardPage({ companies: [{ slug: 'acme', name: 'Acme', jobs: [result(4881145, { slug: 'qa-engineer' })] }] })));
    const [companyRow] = await wf.fetch(companyEntry, makeCtx(() => companyPage({ jobs: [listing(4881145, { slug: 'qa-engineer' })] })));
    // A renamed job keeps its id and gets a new slug, so URL dedup sees two URLs.
    const renamed = { ...companyRow, url: 'https://wellfound.com/jobs/4881145-senior-qa-engineer' };
    const seen = new Set();
    markOfferSeen(boardRow, seen);
    const [other] = await wf.fetch(companyEntry, makeCtx(() => companyPage({ jobs: [listing(4881146, { slug: 'qa-engineer' })] })));
    check(
      JSON.stringify(boardRow.listingIdentity) === JSON.stringify(companyRow.listingIdentity)
      && isOfferSeen(renamed, seen)
      && listingIdentityToken(other) !== listingIdentityToken(boardRow) && !isOfferSeen(other, seen),
      'listingIdentity: board and company rows of one job share it; the job under a new slug is already seen; another id is not',
      JSON.stringify({ b: boardRow.listingIdentity, c: companyRow.listingIdentity }),
    );
  }
} catch (err) {
  fail(`wellfound tests crashed: ${err?.stack || err}`);
}
