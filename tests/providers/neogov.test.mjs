// tests/providers/neogov.test.mjs — NEOGOV (schooljobs.com / governmentjobs.com) provider.
// Pages the HTML list endpoint 10 at a time under its own ceiling; covers detect()
// host/path gating, the HTML parser (entities, off-site links, empty-vs-wrong-page),
// and the pagination contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — neogov');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/neogov.mjs')).href);
  const neogov = mod.default;
  const { parseNeogovPage } = mod;

  if (neogov.id === 'neogov') pass('neogov.id is "neogov"');
  else fail(`neogov.id is ${JSON.stringify(neogov.id)}`);

  // ── detect() ──────────────────────────────────────────────────────
  const detectCases = [
    ['https://www.schooljobs.com/careers/exampleco', 'https://www.schooljobs.com/careers/home/index?agency=exampleco&sort=PostingDate&isDescendingSort=true&page=1'],
    ['https://www.schooljobs.com/careers/exampleco/facultypositions', 'https://www.schooljobs.com/careers/home/index?agency=exampleco&departmentFolder=facultypositions&sort=PostingDate&isDescendingSort=true&page=1'],
    ['https://schooljobs.com/careers/ExampleCo/', 'https://www.schooljobs.com/careers/home/index?agency=exampleco&sort=PostingDate&isDescendingSort=true&page=1'],
    ['https://www.governmentjobs.com/careers/exampleco', 'https://www.governmentjobs.com/careers/home/index?agency=exampleco&sort=PostingDate&isDescendingSort=true&page=1'],
  ];
  for (const [url, expected] of detectCases) {
    const hit = neogov.detect({ name: 'Acme', careers_url: url });
    if (hit && hit.url === expected) pass(`neogov.detect() resolves ${url}`);
    else fail(`neogov.detect(${url}) returned ${JSON.stringify(hit)}`);
  }
  const negatives = {
    'a non-NEOGOV host': { careers_url: 'https://example.com/careers/exampleco' },
    'a path-spoofed URL': { careers_url: 'https://evil.example/www.schooljobs.com/careers/exampleco' },
    'a lookalike host': { careers_url: 'https://www.schooljobs.com.evil.example/careers/exampleco' },
    'http': { careers_url: 'http://www.schooljobs.com/careers/exampleco' },
    'a non-/careers path': { careers_url: 'https://www.schooljobs.com/jobs/exampleco' },
    'no agency': { careers_url: 'https://www.schooljobs.com/careers' },
    "the site's own /careers/home path": { careers_url: 'https://www.schooljobs.com/careers/home/index' },
    'an agency with illegal characters': { careers_url: 'https://www.schooljobs.com/careers/a%20b' },
    'a malformed URL': { careers_url: 'not a url' },
    'null careers_url': { careers_url: null },
    'a non-string careers_url': { careers_url: 7 },
    'no careers_url': {},
  };
  for (const [label, extra] of Object.entries(negatives)) {
    let got;
    try { got = neogov.detect({ name: 'X', ...extra }); } catch (e) { got = `threw ${e.message}`; }
    if (got === null) pass(`neogov.detect() returns null for ${label}`);
    else fail(`neogov.detect() for ${label} returned ${JSON.stringify(got)}`);
  }

  // ── parser ────────────────────────────────────────────────────────
  const ORIGIN = 'https://www.schooljobs.com';
  const item = (id, slug, title, loc, folder = '') => `
    <li class="list-item" data-job-id="${id}">
      <h3 class="job-item-link-container">
        <a aria-label="${title}" class="item-details-link" data-department-name="X" href="/careers/exampleco/${folder}jobs/${id}/${slug}" rel="">${title}</a>
      </h3>
      <ul class="list-meta">
        <li>${loc}</li>
        <li>Part-time Hourly <span>-</span> $93.18 Hourly</li>
      </ul>
    </li>`;
  const listHtml = `<div class="listing-title"></div><ul class="unstyled search-results-listing-container job-listing-container ">`
    + item(11, 'math-professor', 'Part-time Math &amp; Science Professor &#8211; Pool', 'Vancouver, WA', 'faculty/')
    + item(12, 'it-professor', 'IT Professor', 'Ridgefield, WA')
    + `<li class="list-item"><a class="item-details-link" href="https://evil.example/careers/exampleco/jobs/13/x">Off-site</a></li>`
    + `<li class="list-item"><a class="item-details-link" href="/careers/exampleco/about">Not a job path</a></li>`
    + `<li class="list-item"><span>no link at all</span></li>`
    + `</ul>`;
  const jobs = parseNeogovPage(listHtml, 'Acme', ORIGIN);
  if (jobs.length === 2) pass('parseNeogovPage keeps on-site /jobs/<id> links, drops off-site, non-job and link-less items');
  else fail(`parseNeogovPage returned ${jobs.length} jobs (expected 2): ${JSON.stringify(jobs)}`);
  if (jobs[0]?.url === `${ORIGIN}/careers/exampleco/faculty/jobs/11/math-professor` && jobs[0]?.company === 'Acme') pass('parseNeogovPage resolves the relative href against the origin and sets company');
  else fail(`parseNeogovPage url/company was ${JSON.stringify(jobs[0])}`);
  if (jobs[0]?.title === 'Part-time Math & Science Professor – Pool') pass('parseNeogovPage decodes entities in the title before returning it (&amp; and &#8211;)');
  else fail(`parseNeogovPage title was ${JSON.stringify(jobs[0]?.title)}`);
  if (jobs[0]?.location === 'Vancouver, WA' && jobs[1]?.location === 'Ridgefield, WA') pass('parseNeogovPage takes the first <li> of list-meta as the location');
  else fail(`parseNeogovPage locations were ${jobs[0]?.location} / ${jobs[1]?.location}`);

  for (const empty of ['', '  \n', null, undefined]) {
    if (parseNeogovPage(empty, 'X', ORIGIN).length === 0) pass(`parseNeogovPage ${JSON.stringify(empty)} → []`);
    else fail(`parseNeogovPage ${JSON.stringify(empty)} should be []`);
  }
  const notFound = '<div class="jobs-not-found-container"><h2 class="not-found-text">No jobs at this time.</h2></div>';
  if (parseNeogovPage(notFound, 'X', ORIGIN).length === 0) pass('parseNeogovPage "No jobs" page → [] (empty board / past the last page)');
  else fail('parseNeogovPage should treat the not-found page as empty');
  try { parseNeogovPage('<html><body>Please sign in</body></html>', 'X', ORIGIN); fail('parseNeogovPage should throw on a page that is not the job list'); }
  catch (e) { if (/not a NEOGOV job list/.test(e.message)) pass('parseNeogovPage throws a descriptive error on an unrecognised page'); else fail(`parseNeogovPage threw: ${e.message}`); }

  // ── fetch() ───────────────────────────────────────────────────────
  const pageOf = (start, n) => `<ul class="search-results-listing-container">${Array.from({ length: n }, (_, i) => item(start + i, `job-${start + i}`, `Job ${start + i}`, 'Vancouver, WA')).join('')}</ul>`;
  const noSleep = async () => {};
  const entry = { name: 'Acme', careers_url: 'https://www.schooljobs.com/careers/exampleco' };
  const pageNo = (url) => Number(new URL(url).searchParams.get('page'));
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));

  try {
    // 10 + 10 + 3 then stops on the short/empty page
    let calls = [];
    let ctx = {
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        const p = pageNo(url);
        return p === 1 ? pageOf(0, 10) : p === 2 ? pageOf(10, 10) : p === 3 ? pageOf(20, 3) : notFound;
      },
      sleep: noSleep,
    };
    let out = await neogov.fetch(entry, ctx);
    if (out.length === 23) pass('neogov.fetch() walks pages until one adds nothing and returns every posting');
    else fail(`neogov.fetch() returned ${out.length} jobs (expected 23)`);
    if (calls.every((c) => c.opts?.redirect === 'error' && c.opts?.headers?.['X-Requested-With'] === 'XMLHttpRequest')) pass("neogov.fetch() passes redirect: 'error' (and the XHR header) on every request");
    else fail(`neogov.fetch() request opts: ${JSON.stringify(calls.map((c) => c.opts))}`);
    if (calls.every((c) => new URL(c.url).origin === 'https://www.schooljobs.com')) pass('neogov.fetch() only ever requests the entry\'s own www host');
    else fail(`neogov.fetch() urls: ${calls.map((c) => c.url).join(' ')}`);

    // bad entry is refused BEFORE any request
    calls = [];
    try { await neogov.fetch({ name: 'Evil', careers_url: 'https://evil.example/careers/exampleco' }, ctx); fail('neogov.fetch() should throw for a bad careers_url'); }
    catch (e) { if (calls.length === 0 && /cannot derive agency/.test(e.message)) pass('neogov.fetch() throws on a bad careers_url before any request'); else fail(`neogov.fetch() bad-url: ${calls.length} calls, ${e.message}`); }

    // a site that ignores `page` and repeats page 1 must not loop
    calls = [];
    ctx = { fetchText: async (url) => { calls.push(url); return pageOf(0, 10); }, sleep: noSleep };
    out = await neogov.fetch(entry, ctx);
    if (out.length === 10 && calls.length === 2) pass('neogov.fetch() stops when a page repeats what it already has (no runaway loop)');
    else fail(`neogov.fetch() repeating page: ${calls.length} calls, ${out.length} jobs`);

    // every page brings new postings forever → the provider's OWN ceiling (30) stops it and warns
    calls = [];
    warnings.length = 0;
    ctx = { fetchText: async (url) => { calls.push(url); return pageOf(pageNo(url) * 10, 10); }, sleep: noSleep };
    out = await neogov.fetch(entry, ctx);
    if (calls.length === 30 && out.length === 300) pass('neogov.fetch() stops at its own DEFAULT_MAX_PAGES (30) even though every page has new postings');
    else fail(`neogov.fetch() ceiling: ${calls.length} calls, ${out.length} jobs`);
    if (warnings.some((w) => /raise max_pages/.test(w))) pass('neogov.fetch() warns "raise max_pages" when its ceiling truncated the board');
    else fail(`neogov.fetch() ceiling warning missing: ${JSON.stringify(warnings)}`);
    calls = [];
    await neogov.fetch({ ...entry, max_pages: 2 }, ctx);
    if (calls.length === 2) pass('neogov.fetch() honours entry.max_pages');
    else fail(`neogov.fetch() max_pages:2 made ${calls.length} calls`);
    calls = [];
    await neogov.fetch({ ...entry, max_pages: 1_000_000 }, ctx);
    if (calls.length === 200) pass('neogov.fetch() caps a user max_pages at MAX_PAGES_CAP (200)');
    else fail(`neogov.fetch() max_pages:1e6 made ${calls.length} calls`);

    // ctx.maxPages (health probe): one list request, and no max_pages blame
    calls = [];
    warnings.length = 0;
    await neogov.fetch(entry, { ...ctx, maxPages: 1 });
    if (calls.length === 1) pass('neogov.fetch() stops after ctx.maxPages (1) list request');
    else fail(`neogov.fetch() ctx.maxPages:1 made ${calls.length} calls`);
    if (!warnings.some((w) => /raise max_pages/.test(w))) pass('neogov.fetch() does not blame max_pages for a ctx.maxPages probe cap');
    else fail('neogov.fetch() warned about max_pages during a probe');

    // unwrapped rejection while probing
    class ProbeSentinel extends Error {}
    const sentinel = new ProbeSentinel('budget');
    try {
      await neogov.fetch(entry, { fetchText: async () => { throw sentinel; }, sleep: noSleep, maxPages: 1 });
      fail('neogov.fetch() should reject when ctx.fetchText rejects');
    } catch (e) {
      if (e === sentinel) pass('neogov.fetch() propagates a ctx.fetchText rejection unwrapped during a probe');
      else fail(`neogov.fetch() wrapped the rejection: ${e?.constructor?.name}: ${e?.message}`);
    }

    // transient failure on page 2 that retry cannot clear → fail loud, no max_pages warning
    calls = [];
    warnings.length = 0;
    ctx = {
      fetchText: async (url) => {
        calls.push(url);
        if (pageNo(url) === 1) return pageOf(0, 10);
        const e = new Error('HTTP 503'); e.status = 503; throw e;
      },
      sleep: noSleep,
    };
    try { await neogov.fetch(entry, ctx); fail('neogov.fetch() should fail loudly when page 2 keeps failing'); }
    catch (e) { if (e.status === 503 && calls.length === 4) pass('neogov.fetch() retries the failing page then fails loud (no silent partial board)'); else fail(`neogov.fetch() page-2 failure: status ${e.status}, ${calls.length} calls`); }
    if (!warnings.some((w) => /raise max_pages/.test(w))) pass('neogov.fetch() does not print "raise max_pages" when it stopped on a fetch error');
    else fail('neogov.fetch() misfired the max_pages warning on a fetch error');

    // a wrong agency slug is answered with a redirect, which redirect:'error' turns into a failure
    try {
      await neogov.fetch(entry, { fetchText: async () => { const e = new TypeError('fetch failed'); e.cause = new Error('unexpected redirect'); throw e; }, sleep: noSleep });
      fail('neogov.fetch() should fail on a refused redirect');
    } catch (e) { pass('neogov.fetch() surfaces a refused redirect (wrong agency slug) as an error, not an empty board'); }
  } finally {
    console.warn = realWarn;
  }
} catch (e) {
  fail(`neogov provider tests crashed: ${e.stack || e.message}`);
}
