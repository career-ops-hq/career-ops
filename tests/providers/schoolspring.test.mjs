// tests/providers/schoolspring.test.mjs — SchoolSpring provider.
// The provider walks a public JSON API 100 postings per page under its own page
// ceiling, so this covers detect() host gating, the response parser, and the
// pagination contract (own ceiling, max_pages, ctx.maxPages probe cap, fail-loud
// on a transient failure that retry cannot clear).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — schoolspring');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/schoolspring.mjs')).href);
  const schoolspring = mod.default;
  const { parseSchoolSpringPage } = mod;

  if (schoolspring.id === 'schoolspring') pass('schoolspring.id is "schoolspring"');
  else fail(`schoolspring.id is ${JSON.stringify(schoolspring.id)}`);

  // ── detect() ──────────────────────────────────────────────────────
  for (const url of ['https://example.schoolspring.com/', 'https://Example.SchoolSpring.com/jobs?x=1']) {
    const hit = schoolspring.detect({ name: 'Acme', careers_url: url });
    if (hit && hit.url === 'https://example.schoolspring.com/') pass(`schoolspring.detect() resolves ${url}`);
    else fail(`schoolspring.detect(${url}) returned ${JSON.stringify(hit)}`);
  }
  const negatives = {
    'the platform www host': { careers_url: 'https://www.schoolspring.com/' },
    'the platform api host': { careers_url: 'https://api.schoolspring.com/' },
    'a non-schoolspring host': { careers_url: 'https://example.com/' },
    'a path-spoofed URL': { careers_url: 'https://evil.example/example.schoolspring.com/' },
    'a lookalike host': { careers_url: 'https://example.schoolspring.com.evil.example/' },
    'http': { careers_url: 'http://example.schoolspring.com/' },
    'a malformed URL': { careers_url: 'not a url' },
    'null careers_url': { careers_url: null },
    'a non-string careers_url': { careers_url: 7 },
    'no careers_url': {},
  };
  for (const [label, extra] of Object.entries(negatives)) {
    let got;
    try { got = schoolspring.detect({ name: 'X', ...extra }); } catch (e) { got = `threw ${e.message}`; }
    if (got === null) pass(`schoolspring.detect() returns null for ${label}`);
    else fail(`schoolspring.detect() for ${label} returned ${JSON.stringify(got)}`);
  }

  // ── parser ────────────────────────────────────────────────────────
  const ORIGIN = 'https://example.schoolspring.com';
  const page = {
    success: true,
    value: {
      page: 1,
      size: 100,
      jobsList: [
        { jobId: 5930050, employer: 'Gaiser Middle School', title: 'Head Coach', location: 'Exampleville, Washington', displayDate: '2026-09-16T07:00:00' },
        { jobId: 5791497, employer: 'Hudson&#x27;s Bay High School', title: 'Assistant Boys &amp; Girls Coach &#8211; Grade 5', location: 'Exampleville, Washington', displayDate: 'not a date' },
        { jobId: 'abc', employer: 'X', title: 'Non-numeric id', location: 'Y' },       // dropped
        { jobId: 7, employer: 'X', title: '', location: 'Y' },                          // no title → dropped
        { employer: 'X', title: 'No id', location: 'Y' },                               // no id → dropped
        null,                                                                            // junk row → dropped
      ],
    },
  };
  const { jobs, rawCount } = parseSchoolSpringPage(page, 'Acme', ORIGIN);
  if (jobs.length === 2 && rawCount === 6) pass('parseSchoolSpringPage keeps rows with a numeric id + title and reports the raw row count');
  else fail(`parseSchoolSpringPage returned ${jobs.length} jobs, rawCount ${rawCount}`);
  if (jobs[0]?.url === `${ORIGIN}/?jobid=5930050` && jobs[0]?.company === 'Acme') pass('parseSchoolSpringPage builds <origin>/?jobid=<id> and sets company');
  else fail(`parseSchoolSpringPage url/company was ${JSON.stringify(jobs[0])}`);
  if (jobs[0]?.location === 'Exampleville, Washington - Gaiser Middle School') pass('parseSchoolSpringPage joins location and employer');
  else fail(`parseSchoolSpringPage location was ${JSON.stringify(jobs[0]?.location)}`);
  if (jobs[1]?.title === 'Assistant Boys & Girls Coach \u2013 Grade 5' && jobs[1]?.location.endsWith("Hudson's Bay High School")) pass('parseSchoolSpringPage decodes the API\'s HTML entities through the shared decoder (&amp; &#x27; and numeric &#8211;)');
  else fail(`parseSchoolSpringPage entities: ${JSON.stringify(jobs[1])}`);
  if (typeof jobs[0]?.postedAt === 'number' && !('postedAt' in jobs[1])) pass('parseSchoolSpringPage sets postedAt from displayDate and omits it when unparseable');
  else fail(`parseSchoolSpringPage postedAt: ${jobs[0]?.postedAt} / ${jobs[1]?.postedAt}`);

  for (const [label, empty] of [['{}', {}], ['[]', []], ['null', null], ['{value: {jobsList: []}} (a real empty board)', { success: true, value: { jobsList: [] } }]]) {
    if (parseSchoolSpringPage(empty, 'X', ORIGIN).jobs.length === 0) pass(`parseSchoolSpringPage ${label} → empty`);
    else fail(`parseSchoolSpringPage ${label} should be empty`);
  }
  for (const [label, bad, re] of [
    ['success:false', { success: false, message: 'Domain not found' }, /Domain not found/],
    ['a bare string body ("unavailable")', 'unavailable', /unexpected response type string/],
    ['a bare number body', 503, /unexpected response type number/],
    ['a bare boolean body', true, /unexpected response type boolean/],
    ['an envelope that omits success', { value: { jobsList: [] } }, /did not report success:true/],
    ['success that is not true', { success: 'yes', value: { jobsList: [] } }, /did not report success:true/],
    ['jobsList of the wrong type', { success: true, value: { jobsList: 'oops', extra: 1 } }, /no jobsList array.*extra/],
    ['a value with no jobsList', { success: true, value: {} }, /no jobsList array/],
    ['value: null', { success: true, value: null }, /no jobsList array/],
    ['jobsList: null', { success: true, value: { page: 1, jobsList: null } }, /no jobsList array.*page/],
  ]) {
    try { parseSchoolSpringPage(bad, 'X', ORIGIN); fail(`parseSchoolSpringPage should throw for ${label}`); }
    catch (e) { if (re.test(e.message)) pass(`parseSchoolSpringPage throws a descriptive error for ${label}`); else fail(`parseSchoolSpringPage ${label} threw: ${e.message}`); }
  }

  // ── fetch() ───────────────────────────────────────────────────────
  const row = (n) => ({ jobId: 1000 + n, employer: 'E', title: `Job ${n}`, location: 'L', displayDate: '2026-09-01T07:00:00' });
  const fullPage = (start) => ({ success: true, value: { jobsList: Array.from({ length: 100 }, (_, i) => row(start + i)) } });
  const pageNo = (url) => Number(new URL(url).searchParams.get('page'));
  // a distinct full page per page number, as a real board returns
  const distinctPage = (url) => fullPage((pageNo(url) - 1) * 100);
  const noSleep = async () => {};
  const entry = { name: 'Acme', careers_url: 'https://example.schoolspring.com/' };
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));

  try {
    // short page → one request, redirect:'error', domainName pinned to the host
    let calls = [];
    let ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return page; }, sleep: noSleep };
    let out = await schoolspring.fetch(entry, ctx);
    if (out.length === 2 && calls.length === 1) pass('schoolspring.fetch() makes one request when the first page is short');
    else fail(`schoolspring.fetch() made ${calls.length} calls, ${out.length} jobs`);
    if (calls.every((c) => c.opts?.redirect === 'error')) pass("schoolspring.fetch() passes redirect: 'error' on every request");
    else fail(`schoolspring.fetch() redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);
    const u = new URL(calls[0].url);
    if (u.origin === 'https://api.schoolspring.com' && u.searchParams.get('domainName') === 'example.schoolspring.com' && u.searchParams.get('size') === '100') {
      pass('schoolspring.fetch() targets the fixed API host with the district as domainName');
    } else fail(`schoolspring.fetch() url was ${calls[0].url}`);

    // bad entry is refused BEFORE any request
    calls = [];
    try { await schoolspring.fetch({ name: 'Evil', careers_url: 'https://evil.example/' }, ctx); fail('schoolspring.fetch() should throw for a bad careers_url'); }
    catch (e) { if (calls.length === 0 && /cannot derive district host/.test(e.message)) pass('schoolspring.fetch() throws on a bad careers_url before any request'); else fail(`schoolspring.fetch() bad-url: ${calls.length} calls, ${e.message}`); }

    // source never says "no more": the provider's OWN ceiling (20) stops it and warns
    calls = [];
    warnings.length = 0;
    ctx = { fetchJson: async (url) => { calls.push(url); return distinctPage(url); }, sleep: noSleep };
    out = await schoolspring.fetch(entry, ctx);
    if (calls.length === 20 && out.length === 2000) pass("schoolspring.fetch() stops at its own DEFAULT_MAX_PAGES (20) even though every page is full");
    else fail(`schoolspring.fetch() ceiling: ${calls.length} calls, ${out.length} jobs`);
    if (warnings.some((w) => /raise max_pages/.test(w))) pass('schoolspring.fetch() warns "raise max_pages" when its ceiling truncated the board');
    else fail(`schoolspring.fetch() ceiling warning missing: ${JSON.stringify(warnings)}`);

    // an API that ignores `page` and repeats the same full page: no duplicates, stops early, no max_pages blame
    calls = [];
    warnings.length = 0;
    const repeating = { fetchJson: async (url) => { calls.push(url); return fullPage(0); }, sleep: noSleep };
    out = await schoolspring.fetch(entry, repeating);
    if (out.length === 100 && new Set(out.map((j) => j.url)).size === 100) pass('schoolspring.fetch() does not add the same postings twice when a page repeats');
    else fail(`schoolspring.fetch() repeated page: ${out.length} jobs, ${new Set(out.map((j) => j.url)).size} unique`);
    if (calls.length === 2) pass('schoolspring.fetch() stops as soon as a page adds no new postings');
    else fail(`schoolspring.fetch() repeated page made ${calls.length} calls (expected 2)`);
    if (!warnings.some((w) => /raise max_pages/.test(w))) pass('schoolspring.fetch() does not blame max_pages when the API just repeated itself');
    else fail('schoolspring.fetch() misfired the max_pages warning on a repeating API');

    // overlapping pages: only the new postings from page 2 are added
    calls = [];
    const overlapping = { fetchJson: async (url) => { calls.push(url); return pageNo(url) === 1 ? fullPage(0) : pageNo(url) === 2 ? fullPage(50) : { success: true, value: { jobsList: [] } }; }, sleep: noSleep };
    out = await schoolspring.fetch(entry, overlapping);
    if (out.length === 150 && new Set(out.map((j) => j.url)).size === 150) pass('schoolspring.fetch() keeps only the new postings when pages overlap');
    else fail(`schoolspring.fetch() overlapping pages: ${out.length} jobs, ${new Set(out.map((j) => j.url)).size} unique`);

    // entry max_pages lowers the ceiling; an absurd override is capped
    calls = [];
    await schoolspring.fetch({ ...entry, max_pages: 2 }, ctx);
    if (calls.length === 2) pass('schoolspring.fetch() honours entry.max_pages');
    else fail(`schoolspring.fetch() max_pages:2 made ${calls.length} calls`);
    calls = [];
    await schoolspring.fetch({ ...entry, max_pages: 1_000_000 }, ctx);
    if (calls.length === 100) pass('schoolspring.fetch() caps a user max_pages at MAX_PAGES_CAP (100)');
    else fail(`schoolspring.fetch() max_pages:1e6 made ${calls.length} calls`);

    // ctx.maxPages (health probe): one list request, and no "raise max_pages" warning
    calls = [];
    warnings.length = 0;
    out = await schoolspring.fetch(entry, { ...ctx, maxPages: 1 });
    if (calls.length === 1) pass('schoolspring.fetch() stops after ctx.maxPages (1) list request');
    else fail(`schoolspring.fetch() ctx.maxPages:1 made ${calls.length} calls`);
    if (!warnings.some((w) => /raise max_pages/.test(w))) pass('schoolspring.fetch() does not blame max_pages for a ctx.maxPages probe cap');
    else fail('schoolspring.fetch() warned about max_pages during a probe');

    // a ctx.fetch* rejection propagates UNWRAPPED (verify-portals matches the sentinel by identity)
    class ProbeSentinel extends Error {}
    const sentinel = new ProbeSentinel('budget');
    try {
      await schoolspring.fetch(entry, { fetchJson: async () => { throw sentinel; }, sleep: noSleep, maxPages: 1 });
      fail('schoolspring.fetch() should reject when ctx.fetchJson rejects');
    } catch (e) {
      if (e === sentinel) pass('schoolspring.fetch() propagates a ctx.fetchJson rejection unwrapped during a probe');
      else fail(`schoolspring.fetch() wrapped the rejection: ${e?.constructor?.name}: ${e?.message}`);
    }

    // transient failure on page 2 that retry cannot clear → fail loud, no partial board, no max_pages warning
    calls = [];
    warnings.length = 0;
    ctx = {
      fetchJson: async (url) => {
        calls.push(url);
        if (pageNo(url) === 1) return fullPage(0);
        const e = new Error('HTTP 503'); e.status = 503; throw e;
      },
      sleep: noSleep,
    };
    try { await schoolspring.fetch(entry, ctx); fail('schoolspring.fetch() should fail loudly when page 2 keeps failing'); }
    catch (e) {
      if (e.status === 503) pass('schoolspring.fetch() fails loud (no silent partial board) when a later page keeps failing');
      else fail(`schoolspring.fetch() page-2 failure threw ${e.message}`);
    }
    if (calls.length === 1 + 3) pass('schoolspring.fetch() retries the failing page (3 attempts) before giving up');
    else fail(`schoolspring.fetch() page-2 failure: ${calls.length} calls (expected 4)`);
    if (!warnings.some((w) => /raise max_pages/.test(w))) pass('schoolspring.fetch() does not print "raise max_pages" when it stopped on a fetch error');
    else fail('schoolspring.fetch() misfired the max_pages warning on a fetch error');
  } finally {
    console.warn = realWarn;
  }
} catch (e) {
  fail(`schoolspring provider tests crashed: ${e.stack || e.message}`);
}
