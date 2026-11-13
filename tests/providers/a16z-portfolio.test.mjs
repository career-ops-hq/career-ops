// tests/providers/a16z-portfolio.test.mjs — provider-contract tests for the
// a16z portfolio jobs board (providers/a16z-portfolio.mjs): action-id
// discovery from the board's chunks, the RSC load-more payload, pagination
// stops, the stale-id 404 recovery and probe cooperation.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — a16z-portfolio');

const ACTION = '60aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW_ACTION = '60bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BOARD = 'https://jobs.a16z.com/jobs';

const boardHtml = [
  '<html><head>',
  '<script src="/_next/static/chunks/main-app.js" async=""></script>',
  '<script src="/_next/static/chunks/page-jobs.js" async=""></script>',
  '<link rel="preload" href="https://cdn.example.com/_next/static/chunks/offsite.js"/>',
  '</head><body></body></html>',
].join('');

const chunkWith = (id) =>
  `var c=require(1);let x=(0,c.createServerReference)("${id}",c.callServer,void 0,c.findSourceMapURL,"loadMorePublicJobs");` +
  `let y=(0,c.createServerReference)("00cccccccccccccccccccccccccccccccccccccccc",c.callServer,void 0,c.findSourceMapURL,"listLocationsWithJobsAction");`;

function row(i, over = {}) {
  return {
    id: `ats:${i}`,
    title: `Engineer ${i}`,
    apply_url: `https://jobs.ashbyhq.com/exampleco/${i}/application`,
    location: 'Berlin, Germany',
    locations: ['Berlin, Germany'],
    remote: false,
    posted_at: new Date(Date.now() - i * 3_600_000).toISOString(),
    active: true,
    company_name: 'ExampleCo',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    ...over,
  };
}

const rsc = (payload) => `0:{"a":"$@1","f":"","b":"build"}\n1:${JSON.stringify(payload)}\n`;
const fullPage = (page, start = page * 100) => rsc({ jobs: Array.from({ length: 25 }, (_, k) => row(start + k)), total: 1000, page, perPage: 25, isDone: false });

/**
 * Stub ctx: serves the board page and chunks, and answers POSTs from `pages`
 * (page number → body string, or an Error to throw). Records every call.
 */
function makeCtx({ pages, chunks = { '/_next/static/chunks/page-jobs.js': chunkWith(ACTION), '/_next/static/chunks/main-app.js': 'nothing here' }, validIds = [ACTION], maxPages, cache } = {}) {
  const calls = [];
  const ctx = {
    calls,
    sleep: async () => {},
    async fetchText(url, opts = {}) {
      calls.push({ url, opts });
      if (opts.method === 'POST') {
        const id = opts.headers?.['next-action'];
        if (!validIds.includes(id)) {
          const err = new Error('HTTP 404'); err.status = 404; throw err;
        }
        const page = JSON.parse(opts.body)[1].page;
        const body = pages[page];
        if (body instanceof Error) throw body;
        if (body === undefined) throw Object.assign(new Error(`no fixture for page ${page}`), { status: 400 });
        return body;
      }
      if (url === BOARD) return boardHtml;
      const path = url.replace('https://jobs.a16z.com', '');
      if (path in chunks) return chunks[path];
      throw Object.assign(new Error(`unexpected GET ${url}`), { status: 400 });
    },
    async fetchJson() { throw new Error('fetchJson not used'); },
  };
  if (maxPages) ctx.maxPages = maxPages;
  if (cache) ctx.idCache = cache;
  return ctx;
}

function makeCache(initial) {
  const m = new Map(initial ? [['jobs.a16z.com', initial]] : []);
  return { m, get: (k) => m.get(k), set: (k, v) => m.set(k, v), delete: (k) => m.delete(k) };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/a16z-portfolio.mjs')).href);
  const provider = mod.default;
  const { extractChunkPaths, extractActionId, parseActionResponse, toJob } = mod;

  if (provider.id === 'a16z-portfolio') pass('id is "a16z-portfolio"');
  else fail(`id is ${JSON.stringify(provider.id)}`);

  // detect(): explicit-only
  const hit = provider.detect({ name: 'X', provider: 'a16z-portfolio' });
  if (hit?.url === BOARD) pass('detect() resolves provider: a16z-portfolio with no careers_url');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (provider.detect({ name: 'X', careers_url: 'https://jobs.a16z.com/jobs' }) === null
    && provider.detect({ name: 'X', provider: 'getro' }) === null
    && provider.detect(null) === null && provider.detect(undefined) === null) {
    pass('detect() returns null without provider: a16z-portfolio (no URL auto-claim, no throw on junk)');
  } else fail('detect() should be explicit-only');

  // extractChunkPaths / extractActionId
  const paths = extractChunkPaths(boardHtml + '<script src="/_next/static/chunks/page-jobs.js"></script>');
  if (JSON.stringify(paths) === JSON.stringify(['/_next/static/chunks/page-jobs.js', '/_next/static/chunks/main-app.js'])) {
    pass('extractChunkPaths: same-origin chunks only, de-duplicated, page chunks first');
  } else fail(`extractChunkPaths returned ${JSON.stringify(paths)}`);
  if (extractChunkPaths(null).length === 0) pass('extractChunkPaths(null) → []');
  else fail('extractChunkPaths(null) should be []');
  if (extractActionId(chunkWith(ACTION)) === ACTION) pass('extractActionId finds the loadMorePublicJobs id, not a sibling action');
  else fail(`extractActionId returned ${extractActionId(chunkWith(ACTION))}`);
  if (extractActionId('createServerReference)("00dd",c.callServer,"other")') === null && extractActionId(42) === null) {
    pass('extractActionId → null when the action is absent');
  } else fail('extractActionId should return null when absent');

  // parseActionResponse: documented shape, empty, broken
  const parsed = parseActionResponse(fullPage(1));
  if (parsed.jobs.length === 25 && parsed.page === 1 && parsed.total === 1000 && parsed.isDone === false) {
    pass('parseActionResponse reads jobs/page/total/isDone from the RSC line');
  } else fail(`parseActionResponse returned ${JSON.stringify({ n: parsed.jobs.length, page: parsed.page })}`);
  const empty = parseActionResponse(rsc({ jobs: [], total: 0, page: 1, isDone: true }));
  if (empty.jobs.length === 0) pass('parseActionResponse: present-and-empty jobs[] → empty list');
  else fail('empty jobs[] should parse to an empty list');
  for (const [label, body] of [['no jobs key', rsc({ results: [] })], ['jobs not an array', rsc({ jobs: {} })], ['blank body', ''], ['HTML error page', '<html>Server action not found</html>']]) {
    try {
      parseActionResponse(body);
      fail(`parseActionResponse should throw on ${label}`);
    } catch (e) {
      if (/a16z-portfolio/.test(e.message)) pass(`parseActionResponse throws a descriptive error on ${label}`);
      else fail(`parseActionResponse threw an undescriptive error on ${label}: ${e.message}`);
    }
  }

  // toJob normalization
  const j1 = toJob(row(1, { title: '$$100K Sales Lead', company_name: 'Acme', remote: true, salary_min: 150000, salary_max: 200000, salary_currency: 'USD', salary_period: 'year' }));
  if (j1?.url === 'https://jobs.ashbyhq.com/exampleco/1') pass('toJob strips Ashby\'s /application suffix (dedups with the ashby provider)');
  else fail(`toJob url = ${j1?.url}`);
  if (j1?.title === '$100K Sales Lead' && j1?.company === 'Acme') pass('toJob undoes the RSC "$$" string escape');
  else fail(`toJob title/company = ${JSON.stringify([j1?.title, j1?.company])}`);
  if (j1?.location === 'Berlin, Germany · Remote') pass('toJob appends Remote when the row is remote');
  else fail(`toJob location = ${j1?.location}`);
  if (j1?.salary?.min === 150000 && j1?.salary?.max === 200000 && j1?.salary?.currency === 'USD') pass('toJob maps a yearly salary range');
  else fail(`toJob salary = ${JSON.stringify(j1?.salary)}`);
  const gh = toJob(row(2, { apply_url: 'https://boards.greenhouse.io/bigco/jobs/123?gh_src=x' }));
  if (gh?.url === 'https://boards.greenhouse.io/bigco/jobs/123?gh_src=x') pass('toJob keeps a non-Ashby employer URL as given');
  else fail(`toJob greenhouse url = ${gh?.url}`);
  if (toJob(row(3, { apply_url: 'http://insecure.example/job' })) === null
    && toJob(row(4, { apply_url: null })) === null
    && toJob(row(5, { title: '' })) === null
    && toJob(row(6, { active: false })) === null
    && toJob(null) === null) {
    pass('toJob drops rows with no https link, no title, or active: false');
  } else fail('toJob should drop malformed/inactive rows');
  if (toJob(row(7, { posted_at: 'not a date' }))?.postedAt === undefined) pass('toJob: unparseable posted_at → no postedAt (NaN-safe)');
  else fail('toJob should leave postedAt unset for a bad date');
  if (toJob(row(8, { salary_min: 20, salary_max: 30, salary_period: 'hour' }))?.salary === undefined) pass('toJob ignores a non-yearly salary');
  else fail('toJob should ignore an hourly salary');

  // fetch(): discovery + pagination to a short page; redirect:'error' everywhere
  {
    const lastPage = rsc({ jobs: [row(200), row(201)], total: 27, page: 2, perPage: 25, isDone: true });
    const ctx = makeCtx({ pages: { 1: fullPage(1, 0), 2: lastPage } });
    const jobs = await provider.fetch({ name: 'Acme board', provider: 'a16z-portfolio' }, ctx);
    if (jobs.length === 27) pass('fetch() walks pages until the short last page (27 jobs)');
    else fail(`fetch() returned ${jobs.length} jobs, expected 27`);
    if (ctx.calls.every((c) => c.opts.redirect === 'error')) pass('every request (page, chunk, load-more) passes redirect: "error"');
    else fail(`a request lacked redirect:'error': ${JSON.stringify(ctx.calls.map((c) => [c.url, c.opts.redirect]))}`);
    const chunkCalls = ctx.calls.filter((c) => c.url.includes('/_next/'));
    if (chunkCalls.length === 1 && chunkCalls[0].url === 'https://jobs.a16z.com/_next/static/chunks/page-jobs.js') {
      pass('discovery reads chunks from the fixed origin and stops at the first that carries the action');
    } else fail(`chunk calls: ${JSON.stringify(chunkCalls.map((c) => c.url))}`);
    const posts = ctx.calls.filter((c) => c.opts.method === 'POST');
    const body = JSON.parse(posts[0].opts.body);
    if (posts.every((c) => c.url === BOARD && c.opts.headers['next-action'] === ACTION) && body[1].limit === 25 && body[1].page === 1 && body[0].sort === 'recent') {
      pass('load-more POSTs go to the board with the action id, newest-first, 25 per page');
    } else fail(`POST shape: ${JSON.stringify(posts.map((c) => [c.url, c.opts.headers, c.opts.body]))}`);
  }

  // A board with no action in any chunk → descriptive throw, no POST
  {
    const ctx = makeCtx({ pages: {}, chunks: { '/_next/static/chunks/page-jobs.js': 'x', '/_next/static/chunks/main-app.js': 'y' } });
    try {
      await provider.fetch({ name: 'Acme', provider: 'a16z-portfolio' }, ctx);
      fail('fetch() should throw when no chunk carries the action');
    } catch (e) {
      if (/loadMorePublicJobs action was not found/.test(e.message) && !ctx.calls.some((c) => c.opts.method === 'POST')) pass('fetch() throws a descriptive error when the action id cannot be found');
      else fail(`unexpected: ${e.message}`);
    }
  }

  // Stale cached id → 404 → rediscover once → success, cache updated
  {
    const cache = makeCache({ id: ACTION, checkedAt: new Date().toISOString() });
    const ctx = makeCtx({
      pages: { 1: rsc({ jobs: [row(1)], total: 1, page: 1, perPage: 25, isDone: true }) },
      chunks: { '/_next/static/chunks/page-jobs.js': chunkWith(NEW_ACTION), '/_next/static/chunks/main-app.js': '' },
      validIds: [NEW_ACTION],
      cache,
    });
    const jobs = await provider.fetch({ name: 'Acme', provider: 'a16z-portfolio' }, ctx);
    if (jobs.length === 1 && cache.m.get('jobs.a16z.com')?.id === NEW_ACTION) pass('a 404 on a cached action id re-reads the id from the board and retries');
    else fail(`stale-id recovery: jobs=${jobs.length}, cached=${JSON.stringify(cache.m.get('jobs.a16z.com'))}`);
  }

  // A fresh cached id is used without touching the board page
  {
    const cache = makeCache({ id: ACTION, checkedAt: new Date().toISOString() });
    const ctx = makeCtx({ pages: { 1: rsc({ jobs: [row(1)], total: 1, page: 1, perPage: 25, isDone: true }) }, cache });
    await provider.fetch({ name: 'Acme', provider: 'a16z-portfolio' }, ctx);
    if (ctx.calls.length === 1 && ctx.calls[0].opts.method === 'POST') pass('a fresh cached action id skips discovery');
    else fail(`cached id: ${ctx.calls.length} calls`);
  }

  // Age cutoff ends the walk
  {
    const old = rsc({ jobs: Array.from({ length: 25 }, (_, k) => row(k, { posted_at: new Date(Date.now() - (k < 10 ? 1 : 40) * 86_400_000).toISOString() })), total: 1000, page: 1, perPage: 25, isDone: false });
    const ctx = makeCtx({ pages: { 1: old, 2: fullPage(2) } });
    const { result: jobs, errors } = await captureConsoleErrors(() => provider.fetch({ name: 'Acme', provider: 'a16z-portfolio', a16z_max_age_days: 14 }, ctx));
    const posts = ctx.calls.filter((c) => c.opts.method === 'POST').length;
    if (jobs.length === 10 && posts === 1 && errors.length === 0) pass('a16z_max_age_days stops paging once postings cross the cutoff (no warning)');
    else fail(`age stop: jobs=${jobs.length}, posts=${posts}, errors=${JSON.stringify(errors)}`);
  }

  // Result-window clamp: the board answers an earlier page → stop, no warning
  {
    const ctx = makeCtx({ pages: { 1: fullPage(1), 2: fullPage(1) } });
    const { result: jobs, errors } = await captureConsoleErrors(() => provider.fetch({ name: 'Acme', provider: 'a16z-portfolio', a16z_max_age_days: 0 }, ctx));
    if (jobs.length === 25 && errors.length === 0) pass('a response for a different page (backend result window) ends the walk without a max_pages warning');
    else fail(`window stop: jobs=${jobs.length}, errors=${JSON.stringify(errors)}`);
  }

  // max_pages cap with a full last page → warning
  {
    const ctx = makeCtx({ pages: { 1: fullPage(1), 2: fullPage(2), 3: fullPage(3) } });
    const { result: jobs, errors } = await captureConsoleErrors(() => provider.fetch({ name: 'Acme', provider: 'a16z-portfolio', max_pages: 2, a16z_max_age_days: 0 }, ctx));
    const posts = ctx.calls.filter((c) => c.opts.method === 'POST').length;
    if (jobs.length === 50 && posts === 2 && errors.some((m) => /raise max_pages/.test(m))) pass('entry max_pages caps the walk and warns to raise it');
    else fail(`cap: jobs=${jobs.length}, posts=${posts}, errors=${JSON.stringify(errors)}`);
  }

  // A page-2 failure keeps page 1 and warns, without the max_pages hint
  {
    const ctx = makeCtx({ pages: { 1: fullPage(1), 2: Object.assign(new Error('HTTP 400'), { status: 400 }) } });
    const { result: jobs, errors } = await captureConsoleErrors(() => provider.fetch({ name: 'Acme', provider: 'a16z-portfolio', a16z_max_age_days: 0 }, ctx));
    if (jobs.length === 25 && errors.some((m) => /truncated at page 2/.test(m)) && !errors.some((m) => /raise max_pages/.test(m))) {
      pass('a later-page failure keeps earlier pages and warns (no "raise max_pages")');
    } else fail(`page-2 failure: jobs=${jobs.length}, errors=${JSON.stringify(errors)}`);
  }

  // A page-1 failure is fatal
  {
    const ctx = makeCtx({ pages: { 1: Object.assign(new Error('HTTP 400'), { status: 400 }) } });
    try {
      await provider.fetch({ name: 'Acme', provider: 'a16z-portfolio' }, ctx);
      fail('a first-page failure should throw');
    } catch (e) {
      if (e.status === 400) pass('a first-page failure throws (an unreachable board is not an empty one)');
      else fail(`unexpected first-page error: ${e.message}`);
    }
  }

  // Probe: ctx.maxPages: 1 → one load-more request; rejection propagates unwrapped
  {
    const ctx = makeCtx({ pages: { 1: fullPage(1), 2: fullPage(2) }, maxPages: 1 });
    const jobs = await provider.fetch({ name: 'Acme', provider: 'a16z-portfolio', a16z_max_age_days: 0 }, ctx);
    const posts = ctx.calls.filter((c) => c.opts.method === 'POST').length;
    if (posts === 1 && jobs.length === 25) pass('ctx.maxPages: 1 → exactly one load-more request');
    else fail(`probe: posts=${posts}, jobs=${jobs.length}`);

    class ProbeBudget extends Error {}
    const sentinel = new ProbeBudget('budget');
    const ctx2 = makeCtx({ pages: { 1: sentinel }, maxPages: 1 });
    try {
      await provider.fetch({ name: 'Acme', provider: 'a16z-portfolio' }, ctx2);
      fail('probe rejection should propagate');
    } catch (e) {
      if (e === sentinel) pass('a ctx.fetch* rejection during a probe propagates unwrapped');
      else fail(`probe rejection was rewrapped: ${e?.message}`);
    }
    const sentinel2 = new ProbeBudget('budget');
    const ctx3 = makeCtx({ pages: {} , maxPages: 1 });
    const orig = ctx3.fetchText.bind(ctx3);
    ctx3.fetchText = async (url, opts) => { if (url.includes('page-jobs')) throw sentinel2; return orig(url, opts); };
    try {
      await provider.fetch({ name: 'Acme', provider: 'a16z-portfolio' }, ctx3);
      fail('probe rejection during discovery should propagate');
    } catch (e) {
      if (e === sentinel2) pass('a chunk-fetch rejection during a probe propagates unwrapped (not skipped)');
      else fail(`discovery probe rejection was swallowed/rewrapped: ${e?.message}`);
    }
  }
} catch (e) {
  fail(`a16z-portfolio provider tests crashed: ${e.stack || e.message}`);
}
