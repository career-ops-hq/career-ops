// tests/providers/bulldogjob.test.mjs — Bulldogjob (bulldogjob.pl) provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — bulldogjob');

/** A listing page as the site serves it: Next.js HTML with an embedded __NEXT_DATA__ blob. */
function page(jobs, totalCount = jobs.length) {
  const data = { props: { pageProps: { country: 'PL', slugState: { page: 1, perPage: 50 }, totalCount, jobs } }, page: '/companies/jobs/[[...slug]]' };
  return `<!DOCTYPE html><html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

/** n well-formed postings with ids offset by `start`. */
function postings(n, start = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${100000 + start + i}-devops-engineer-acme`,
    position: `DevOps Engineer ${start + i}`,
    company: { name: 'Acme' },
    city: 'Warszawa',
    remote: false,
    locale: 'pl',
    redirectTo: null,
  }));
}

/** A ctx whose fetchText serves pages from `pages` (1-based) and records every call. */
function makeCtx(pages, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async () => { throw new Error('fetchJson must not be used'); },
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        const n = Number(/\/page,(\d+)$/.exec(url)?.[1]);
        const body = pages[n];
        if (body instanceof Error) throw body;
        if (body === undefined) throw Object.assign(new Error(`no fixture for ${url}`), { status: 404 });
        return body;
      },
      ...extra,
    },
  };
}

/** Run fn with console.error captured. */
async function captureStderr(fn) {
  const orig = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.error = orig;
  }
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/bulldogjob.mjs')).href);
  const bj = mod.default;
  const { parseBulldogjobPage, buildSearchPath, resolveMaxPages } = mod;

  // ── id ──
  if (bj.id === 'bulldogjob') pass('bulldogjob.id is "bulldogjob"');
  else fail(`bulldogjob.id is ${JSON.stringify(bj.id)}`);

  // ── detect() ──
  const positives = [
    'https://bulldogjob.pl/companies/jobs/s/role,devops/experienceLevel,medium/city,Remote',
    'https://bulldogjob.pl/companies/jobs',
    'https://bulldogjob.pl/companies/jobs/s/page,2',
    'https://www.bulldogjob.pl/companies/jobs/s/role,devops',
  ];
  for (const url of positives) {
    if (bj.detect({ name: 'Bulldogjob', careers_url: url })?.url) pass(`detect() claims ${url}`);
    else fail(`detect() should claim ${url}`);
  }
  if (bj.detect({ name: 'Bulldogjob', api: 'https://bulldogjob.pl/companies/jobs/s/role,devops' })?.url) pass('detect() reads entry.api too');
  else fail('detect() should read entry.api');

  const negatives = [
    ['untrusted host', 'https://evil.example/companies/jobs/s/role,devops'],
    ['look-alike host', 'https://bulldogjob.pl.evil.example/companies/jobs'],
    ['path-spoofed host', 'https://evil.example/bulldogjob.pl/companies/jobs'],
    ['non-HTTPS', 'http://bulldogjob.pl/companies/jobs/s/role,devops'],
    ['non-listing path', 'https://bulldogjob.pl/news'],
    ['prefix-only match', 'https://bulldogjob.pl/companies/jobsXYZ'],
    ['malformed URL', 'not a url'],
  ];
  for (const [label, url] of negatives) {
    let got;
    try { got = bj.detect({ name: 'X', careers_url: url }); } catch (e) { got = `threw ${e.message}`; }
    if (got === null) pass(`detect() rejects ${label}`);
    else fail(`detect() should reject ${label}, got ${JSON.stringify(got)}`);
  }
  for (const [label, entry] of [['null careers_url', { careers_url: null }], ['non-string careers_url', { careers_url: 42 }], ['missing careers_url', {}], ['null entry', null]]) {
    let got;
    try { got = bj.detect(entry); } catch (e) { got = `threw ${e.message}`; }
    if (got === null) pass(`detect() returns null for ${label}`);
    else fail(`detect() should return null for ${label}, got ${JSON.stringify(got)}`);
  }

  // ── search path rebuilt from the configured URL ──
  const pathCases = [
    ['https://bulldogjob.pl/companies/jobs/s/role,devops/city,Remote', '/companies/jobs/s/role,devops/city,Remote'],
    ['https://bulldogjob.pl/companies/jobs/s/role,devops/page,3', '/companies/jobs/s/role,devops'],
    ['https://bulldogjob.pl/companies/jobs', '/companies/jobs/s'],
    ['https://bulldogjob.pl/companies/jobs/257768-devops-engineer-acme', '/companies/jobs/s'],
    ['https://bulldogjob.pl/companies/jobs/s/role,devops/?x=1#frag', '/companies/jobs/s/role,devops'],
  ];
  for (const [url, expected] of pathCases) {
    const got = buildSearchPath(new URL(url));
    if (got === expected) pass(`buildSearchPath(${url}) → ${expected}`);
    else fail(`buildSearchPath(${url}) → ${got}, expected ${expected}`);
  }

  // ── parser: normalization and malformed rows ──
  const parsed = parseBulldogjobPage(page([
    { id: '259687-devops-engineer-acme', position: 'DevOps Engineer', company: { name: 'Acme' }, city: 'Rzeszów', remote: true, locale: 'pl', redirectTo: null },
    { id: '259688-sre-exampleco', position: 'SRE', company: { name: 'ExampleCo' }, city: '', remote: true, locale: 'en', redirectTo: 'https://careers.exampleco.example/jobs/42' },
    { id: '259689-platform-bigco', position: 'Platform Engineer', company: { name: 'BigCo' }, city: 'Kraków', remote: false, locale: 'en', redirectTo: 'http://insecure.example/apply' },
    { id: '', position: 'No Id', company: { name: 'Acme' } },
    { id: '259690-no-title-acme', position: '', company: { name: 'Acme' } },
    null,
    'not an object',
  ], 7));

  if (parsed.rows.length === 3 && parsed.rawCount === 7 && parsed.total === 7) pass('parser keeps well-formed rows, drops malformed ones, reports raw count and total');
  else fail(`parser returned ${parsed.rows.length} rows / raw ${parsed.rawCount} / total ${parsed.total}, expected 3 / 7 / 7`);

  const [r0, r1, r2] = parsed.rows;
  if (r0 && r0.title === 'DevOps Engineer' && r0.url === 'https://bulldogjob.pl/companies/jobs/259687-devops-engineer-acme'
    && r0.company === 'Acme' && r0.location === 'Remote, Rzeszów' && r0.language === 'pl') {
    pass('parser maps title, board URL, company, location and language');
  } else {
    fail(`parser mapped the first row incorrectly: ${JSON.stringify(r0)}`);
  }
  if (r1 && r1.url === 'https://careers.exampleco.example/jobs/42' && r1.location === 'Remote') pass('parser prefers an https employer apply link (redirectTo) over the board page');
  else fail(`parser should use the https redirectTo: ${JSON.stringify(r1)}`);
  if (r2 && r2.url === 'https://bulldogjob.pl/companies/jobs/259689-platform-bigco' && r2.location === 'Kraków') pass('parser ignores a non-https redirectTo and falls back to the board page');
  else fail(`parser should ignore a non-https redirectTo: ${JSON.stringify(r2)}`);
  if (!('postedAt' in (r0 || {}))) pass('parser sets no postedAt (the listing carries no date)');
  else fail('parser must not invent a postedAt');

  // ── empty vs broken ──
  const empty = parseBulldogjobPage(page([], 0));
  if (Array.isArray(empty.rows) && empty.rows.length === 0 && empty.rawCount === 0) pass('parser returns [] for a well-formed page with no postings');
  else fail(`parser should return [] for an empty board, got ${JSON.stringify(empty)}`);

  const broken = [
    ['page without __NEXT_DATA__', '<html><body><div class="job-card">DevOps</div></body></html>'],
    ['pageProps without jobs', '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"totalCount":3}}}</script>'],
    ['jobs not an array', '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"jobs":{}}}}</script>'],
    ['unparseable __NEXT_DATA__', '<script id="__NEXT_DATA__" type="application/json">{not json</script>'],
    ['non-string body', 42],
    ['empty body', ''],
  ];
  for (const [label, html] of broken) {
    let threw = false;
    try { parseBulldogjobPage(html); } catch (e) { threw = e.message.startsWith('bulldogjob: unexpected listing page'); }
    if (threw) pass(`parser throws a descriptive error for ${label}`);
    else fail(`parser should throw for ${label}`);
  }

  // ── fetch(): URLs, redirect:'error', pagination stops ──
  {
    const { ctx, calls } = makeCtx({ 1: page(postings(50, 0), 120), 2: page(postings(50, 50), 120), 3: page(postings(20, 100), 120) });
    const jobs = await bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs/s/role,devops/page,9' }, ctx);
    const urls = calls.map((c) => c.url);
    if (jobs.length === 120 && urls.length === 3) pass('fetch() walks every page of a 120-posting board');
    else fail(`fetch() returned ${jobs.length} jobs over ${urls.length} requests, expected 120 over 3`);
    if (urls[0] === 'https://bulldogjob.pl/companies/jobs/s/role,devops/page,1' && urls[2] === 'https://bulldogjob.pl/companies/jobs/s/role,devops/page,3') {
      pass('fetch() requests /page,N on the configured search path (copied page segment dropped)');
    } else {
      fail(`fetch() built unexpected URLs: ${JSON.stringify(urls)}`);
    }
    if (calls.every((c) => c.opts && c.opts.redirect === 'error')) pass('fetch() passes redirect:"error" on every request');
    else fail(`fetch() must pass redirect:"error" on every request: ${JSON.stringify(calls.map((c) => c.opts))}`);
    if (!jobs.bulldogjobTruncated) pass('fetch() does not tag a complete board as truncated');
    else fail('fetch() tagged a complete board as truncated');
  }

  {
    // Total reached on a full page: no request for a page past the end.
    const { ctx, calls } = makeCtx({ 1: page(postings(50, 0), 50) });
    const jobs = await bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs/s/role,devops' }, ctx);
    if (jobs.length === 50 && calls.length === 1) pass('fetch() stops when the reported total is reached');
    else fail(`fetch() should stop at the reported total: ${jobs.length} jobs, ${calls.length} requests`);
  }

  {
    // A short page wins even when the source still reports more.
    const { ctx, calls } = makeCtx({ 1: page(postings(50, 0), 999), 2: page(postings(10, 50), 999) });
    const jobs = await bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs/s/role,devops' }, ctx);
    if (jobs.length === 60 && calls.length === 2 && !jobs.bulldogjobTruncated) pass('fetch() stops on a short page without tagging the board truncated');
    else fail(`fetch() should stop on a short page: ${jobs.length} jobs, ${calls.length} requests, truncated=${jobs.bulldogjobTruncated}`);
  }

  {
    // The provider's own page ceiling bounds a board that keeps reporting more.
    const pages = {};
    for (let n = 1; n <= 200; n++) pages[n] = page(postings(50, (n - 1) * 50), 1_000_000);
    const { ctx, calls } = makeCtx(pages);
    const { result: jobs, lines } = await captureStderr(() => bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs' }, ctx));
    const cap = resolveMaxPages({});
    if (calls.length === cap && jobs.length === cap * 50) pass(`fetch() stops at its own DEFAULT_MAX_PAGES (${cap}) whatever the source reports`);
    else fail(`fetch() made ${calls.length} requests, expected ${cap}`);
    if (jobs.bulldogjobTruncated === true && lines.some((l) => l.includes('raise max_pages'))) pass('fetch() warns and tags the board when the page ceiling truncates it');
    else fail(`fetch() should warn + tag on the ceiling: ${JSON.stringify(lines)}`);
  }

  {
    // max_pages: positive integer honoured, capped; junk falls back to the default.
    if (resolveMaxPages({ max_pages: 3 }) === 3 && resolveMaxPages({ max_pages: 10_000 }) === 100
      && resolveMaxPages({ max_pages: 0 }) === resolveMaxPages({}) && resolveMaxPages({ max_pages: '5' }) === resolveMaxPages({})) {
      pass('resolveMaxPages honours a positive max_pages, caps it, ignores junk');
    } else {
      fail('resolveMaxPages mishandles max_pages');
    }
  }

  // ── probe cooperation ──
  {
    const { ctx, calls } = makeCtx({ 1: page(postings(50, 0), 900), 2: page(postings(50, 50), 900) }, { maxPages: 1 });
    const { result: jobs, lines } = await captureStderr(() => bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs' }, ctx));
    if (calls.length === 1 && jobs.length === 50) pass('fetch() issues exactly one list request under ctx.maxPages: 1');
    else fail(`fetch() under ctx.maxPages: 1 made ${calls.length} requests`);
    if (!jobs.bulldogjobTruncated && !lines.some((l) => l.includes('raise max_pages'))) pass('fetch() does not warn or tag a probe-capped walk');
    else fail('fetch() must not tie the max_pages warning to ctx.maxPages');
  }

  {
    const budget = Object.assign(new Error('probe budget reached'), { status: 404 });
    const { ctx } = makeCtx({ 1: page(postings(50, 0), 900), 2: budget }, { maxPages: 2 });
    let caught = null;
    try { await bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs' }, ctx); } catch (e) { caught = e; }
    if (caught === budget) pass('fetch() propagates a ctx.fetchText rejection unwrapped while probing');
    else fail(`fetch() must propagate the probe-time rejection unwrapped, got ${caught && caught.message}`);
  }

  // ── transient failure on a later page: keep what was collected, warn, no max_pages warning ──
  {
    const gone = Object.assign(new Error('HTTP 404'), { status: 404 });
    const { ctx } = makeCtx({ 1: page(postings(50, 0), 300), 2: gone });
    const { result: jobs, lines } = await captureStderr(() => bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs' }, ctx));
    if (jobs.length === 50 && jobs.bulldogjobTruncated === true) pass('fetch() keeps page 1 and tags the board when page 2 fails');
    else fail(`fetch() should keep page 1 on a page-2 failure: ${jobs.length} jobs, truncated=${jobs.bulldogjobTruncated}`);
    if (lines.some((l) => l.includes('stopped at page 2')) && !lines.some((l) => l.includes('raise max_pages'))) pass('fetch() warns about the fetch error, not about max_pages');
    else fail(`fetch() warning on a fetch-error stop is wrong: ${JSON.stringify(lines)}`);
  }

  {
    // The first page failing is the board's real state: it throws.
    const down = Object.assign(new Error('HTTP 403'), { status: 403 });
    const { ctx } = makeCtx({ 1: down });
    let caught = null;
    try { await bj.fetch({ name: 'Bulldogjob', careers_url: 'https://bulldogjob.pl/companies/jobs' }, ctx); } catch (e) { caught = e; }
    if (caught === down) pass('fetch() throws when the first page fails');
    else fail(`fetch() should throw on a first-page failure, got ${caught && caught.message}`);
  }

  // ── host allowlist runs before any request ──
  {
    const { ctx, calls } = makeCtx({});
    let threw = false;
    try { await bj.fetch({ name: 'Evil', careers_url: 'https://evil.example/companies/jobs/s/role,devops' }, ctx); } catch (e) { threw = e.message.includes('bulldogjob.pl'); }
    if (threw && calls.length === 0) pass('fetch() rejects an untrusted host before any request');
    else fail(`fetch() must reject an untrusted host before fetching (threw=${threw}, requests=${calls.length})`);
  }
} catch (e) {
  fail(`bulldogjob provider tests crashed: ${e.message}`);
}
