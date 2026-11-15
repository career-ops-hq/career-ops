// tests/providers/themuse.test.mjs — The Muse reads the server-rendered
// /search HTML; the public JSON API was closed ~2026-11-09 (#6887).
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — themuse');

// Fixtures mirror the live markup (verified 2026-11-12 against
// https://www.themuse.com/search?location=Germany&posted=7): the h1 count,
// the article cards with data-job-id, the title link, the /profiles/
// company link, "Posted on <Mon> <day>", <!-- --> markers and &amp;
// entities. The first card on a page also carries sr-tile--selected.
const card = (o = {}) => {
  const {
    id = 'c2d60124-899e-4be4-bc93-12591616041c',
    title = 'Staff AI Engineer',
    href = '/jobs/acme/staff-ai-engineer',
    company = 'Acme Corp',
    profile = 'acme',
    location = 'Berlin',
    posted = 'Nov 10',
    selected = false,
  } = o;
  const cls = selected ? 'sr-tile sr-tile--selected' : 'sr-tile';
  return `<article class="${cls}" data-job-id="${id}" data-position="1"><a class="sr-tile__select" href="/search?location=Germany&amp;posted=7&amp;job=${id}"></a><div class="sr-tile__body"><h2 class="sr-tile__title"><a data-result-link="true" href="${href}">${title}</a></h2><div class="sr-tile__details"><p>At<!-- --> <a data-track-skip="true" href="/profiles/${profile}">${company}</a> - ${location}</p><p>Posted on <!-- -->${posted}</p></div></div></article>`;
};
const page = (total, cards) =>
  `<h1 class="sr-count"><strong>${total}</strong> <!-- -->jobs</h1>${cards.join('')}`;
// Fixed "today" for the postedAt assertions: 2026-11-12.
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

try {
  const museModule = await import(pathToFileURL(join(ROOT, 'providers/themuse.mjs')).href);
  const themuse = museModule.default;
  const { parseSearchPage, parsePostedOn } = museModule;

  if (themuse.id === 'themuse') pass('themuse.id is "themuse"');
  else fail(`themuse.id is ${JSON.stringify(themuse.id)}`);

  // parsePostedOn — "Posted on Nov 10" carries no year.
  if (parsePostedOn('Posted on Nov 10', NOW) === Date.UTC(2026, 10, 10))
    pass('parsePostedOn uses the current year for a past date');
  else fail(`parsePostedOn Nov 10 = ${parsePostedOn('Posted on Nov 10', NOW)}`);

  if (parsePostedOn('Posted on Dec 30', Date.UTC(2027, 0, 5)) === Date.UTC(2026, 11, 30))
    pass('parsePostedOn rolls back to the previous year when the date would be in the future');
  else fail(`parsePostedOn Dec 30 (now Jan 5 2027) = ${parsePostedOn('Posted on Dec 30', Date.UTC(2027, 0, 5))}`);

  if (parsePostedOn('Posted on Jan 4', Date.UTC(2027, 0, 5)) === Date.UTC(2027, 0, 4))
    pass('parsePostedOn keeps a January date in the current year');
  else fail(`parsePostedOn Jan 4 (now Jan 5 2027) = ${parsePostedOn('Posted on Jan 4', Date.UTC(2027, 0, 5))}`);

  if (parsePostedOn('Posted on Foo 10', NOW) === undefined && parsePostedOn('no date here', NOW) === undefined)
    pass('parsePostedOn returns undefined for an unparseable date');
  else fail('parsePostedOn should return undefined for an unparseable date');

  // parseSearchPage — normal page: entities, <!-- --> markers, Remote /
  // Flexible, two same-title cards with different UUIDs.
  const normal = parseSearchPage(page(2, [
    card({ title: 'R&amp;D Engineer', href: '/jobs/acme/r-d-engineer' }),
    card({
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      title: 'Software Build Engineer, Software Delivery',
      href: '/jobs/acme/software-build-engineer-software-delivery',
      company: 'Acme', profile: 'acme', location: 'Remote / Flexible',
    }),
    card({
      id: 'bbbbbbbb-1111-2222-3333-444444444444',
      title: 'Software Build Engineer, Software Delivery',
      href: '/jobs/acme/software-build-engineer-software-delivery-58562d',
      company: 'Acme', profile: 'acme', location: 'Munich',
    }),
  ]), { now: NOW });
  if (normal.total === 2 && normal.layoutError === null && normal.jobs.length === 3)
    pass('parseSearchPage parses a normal page (3 cards, no layout error)');
  else fail(`parseSearchPage normal = ${JSON.stringify({ total: normal.total, jobs: normal.jobs.length, layoutError: normal.layoutError })}`);

  if (normal.jobs[0]?.title === 'R&D Engineer')
    pass('parseSearchPage decodes HTML entities in the title');
  else fail(`parseSearchPage title = ${JSON.stringify(normal.jobs[0]?.title)}`);

  if (normal.jobs[0]?.url === 'https://www.themuse.com/jobs/acme/r-d-engineer'
      && normal.jobs[0]?.company === 'Acme Corp'
      && normal.jobs[0]?.location === 'Berlin'
      && normal.jobs[0]?.externalId === 'c2d60124-899e-4be4-bc93-12591616041c'
      && normal.jobs[0]?.postedAt === Date.UTC(2026, 10, 10))
    pass('parseSearchPage maps title, url, company, location, externalId and postedAt');
  else fail(`parseSearchPage row 0 = ${JSON.stringify(normal.jobs[0])}`);

  if (normal.jobs[1]?.title === normal.jobs[2]?.title
      && normal.jobs[1]?.externalId !== normal.jobs[2]?.externalId
      && normal.jobs[1]?.url !== normal.jobs[2]?.url)
    pass('parseSearchPage keeps two same-title cards with different UUIDs (no title dedup)');
  else fail(`parseSearchPage same-title rows = ${JSON.stringify(normal.jobs.slice(1, 3))}`);

  if (normal.jobs[1]?.location === 'Remote / Flexible')
    pass('parseSearchPage keeps "Remote / Flexible" as-is without a location parameter');
  else fail(`parseSearchPage remote location = ${JSON.stringify(normal.jobs[1]?.location)}`);

  const scoped = parseSearchPage(page(1, [
    card({ location: 'Remote / Flexible' }),
  ]), { location: 'Germany', now: NOW });
  if (scoped.jobs[0]?.location === 'Remote / Flexible, Germany')
    pass('parseSearchPage completes "Remote / Flexible" from the location parameter');
  else fail(`parseSearchPage scoped remote location = ${JSON.stringify(scoped.jobs[0]?.location)}`);

  // parseSearchPage — a selected first card parses like any other.
  const selected = parseSearchPage(page(1, [card({ selected: true })]), { now: NOW });
  if (selected.jobs.length === 1 && selected.jobs[0]?.title === 'Staff AI Engineer')
    pass('parseSearchPage parses the sr-tile--selected first card');
  else fail(`parseSearchPage selected card = ${JSON.stringify(selected.jobs)}`);

  // parseSearchPage — empty result (count 0, no cards) is valid, not a layout error.
  const empty = parseSearchPage(page(0, []), { now: NOW });
  if (empty.total === 0 && empty.jobs.length === 0 && empty.layoutError === null)
    pass('parseSearchPage returns an empty result for count 0 with no cards');
  else fail(`parseSearchPage empty = ${JSON.stringify({ total: empty.total, jobs: empty.jobs.length, layoutError: empty.layoutError })}`);

  // parseSearchPage — layout changes are reported, not thrown.
  const noCount = parseSearchPage('<html><body>no count here</body></html>', { now: NOW });
  if (noCount.layoutError && /no h1\.sr-count/.test(noCount.layoutError))
    pass('parseSearchPage reports a layout error when h1.sr-count is missing');
  else fail(`parseSearchPage no-count layoutError = ${JSON.stringify(noCount.layoutError)}`);

  const noCards = parseSearchPage(page(5, []), { now: NOW });
  if (noCards.layoutError && /no job cards/.test(noCards.layoutError))
    pass('parseSearchPage reports a layout error when the count is above 0 but no cards are found');
  else fail(`parseSearchPage no-cards layoutError = ${JSON.stringify(noCards.layoutError)}`);

  const noTitleLink = parseSearchPage(page(2, [
    card(),
    '<article class="sr-tile" data-job-id="deadbeef-0000-0000-0000-000000000000"><div class="sr-tile__body"><h2 class="sr-tile__title">No link here</h2></div></article>',
  ]), { now: NOW });
  if (noTitleLink.layoutError && /no title link/.test(noTitleLink.layoutError) && noTitleLink.jobs.length === 1)
    pass('parseSearchPage reports a layout error for a card without a title link, keeping the cards before it');
  else fail(`parseSearchPage no-title-link = ${JSON.stringify({ jobs: noTitleLink.jobs.length, layoutError: noTitleLink.layoutError })}`);

  // parseSearchPage — a card whose link is not a /jobs/{company}/{slug}
  // path is dropped, not fatal to the page.
  const badHref = parseSearchPage(page(2, [
    card(),
    card({ id: 'badbad00-0000-0000-0000-000000000000', href: '/search?job=bad' }),
  ]), { now: NOW });
  if (badHref.jobs.length === 1 && badHref.layoutError === null)
    pass('parseSearchPage drops a card whose link is not a job URL');
  else fail(`parseSearchPage bad-href = ${JSON.stringify({ jobs: badHref.jobs.length, layoutError: badHref.layoutError })}`);

  // fetch() — mock ctx
  const samplePage = page(2, [
    card({ title: 'R&amp;D Engineer', href: '/jobs/acme/r-d-engineer' }),
    card({
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      title: 'Platform Engineer',
      href: '/jobs/beta/platform-engineer',
      company: 'Beta Inc', profile: 'beta', location: 'Remote / Flexible',
    }),
  ]);

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse' },
    {
      fetchText: async (url, opts) => {
        capturedUrl = url; capturedOpts = opts;
        return samplePage;
      },
    },
  );

  if (capturedUrl === 'https://www.themuse.com/search')
    pass('themuse.fetch() requests the /search page without a page parameter on page 1');
  else fail(`themuse.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('themuse.fetch() passes redirect:"error" to fetchText');
  else fail(`themuse.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('themuse.fetch() normalizes 2 valid jobs');
  else fail(`themuse.fetch() returned ${fetched.length} jobs (expected 2)`);

  if (fetched[0]?.title === 'R&D Engineer' && fetched[0]?.company === 'Acme Corp'
      && fetched[0]?.url === 'https://www.themuse.com/jobs/acme/r-d-engineer'
      && fetched[0]?.location === 'Berlin'
      && fetched[0]?.externalId === 'c2d60124-899e-4be4-bc93-12591616041c'
      && Number.isInteger(fetched[0]?.postedAt))
    pass('themuse.fetch() returns correct title, url, company, location, externalId and postedAt');
  else fail(`themuse.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.location === 'Remote / Flexible')
    pass('themuse.fetch() keeps "Remote / Flexible" without a location parameter');
  else fail(`themuse.fetch() row 1 location = ${JSON.stringify(fetched[1]?.location)}`);

  // fetch() — entry search fields become URL parameters.
  let paramsUrl = null;
  const paramsJobs = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse', location: 'Germany', query: 'engineer', category: 'software-engineering', remote: true, posted: 30 },
    { fetchText: async (url) => { paramsUrl = url; return page(0, []); } },
  );
  if (paramsUrl === 'https://www.themuse.com/search?location=Germany&q=engineer&category=software-engineering&remote=1&posted=30')
    pass('themuse.fetch() maps location/query/category/remote/posted to URL parameters');
  else fail(`themuse.fetch() params URL = ${JSON.stringify(paramsUrl)}`);

  if (paramsJobs.length === 0 && paramsJobs.truncated === undefined)
    pass('themuse.fetch() returns [] (not a throw) for a well-formed empty result');
  else fail(`themuse.fetch() empty result = ${JSON.stringify({ length: paramsJobs.length, truncated: paramsJobs.truncated })}`);

  let remoteLocUrl = null;
  const remoteJobs = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse', location: 'Germany' },
    {
      fetchText: async (url) => {
        remoteLocUrl = url;
        return page(1, [card({ location: 'Remote / Flexible' })]);
      },
    },
  );
  if (remoteLocUrl === 'https://www.themuse.com/search?location=Germany'
      && remoteJobs[0]?.location === 'Remote / Flexible, Germany')
    pass('themuse.fetch() scopes the search by location and completes remote locations from it');
  else fail(`themuse.fetch() remote/location = ${JSON.stringify({ url: remoteLocUrl, location: remoteJobs[0]?.location })}`);

  // fetch() — parameter validation throws before any request.
  async function expectInvalid(entry, pattern, label) {
    let calls = 0;
    let message = '';
    try {
      await themuse.fetch(entry, {
        fetchText: async () => { calls++; return page(0, []); },
        sleep: async () => {},
      });
    } catch (e) { message = e.message; }
    if (calls === 0 && pattern.test(message)) pass(`themuse.fetch() rejects ${label} without fetching`);
    else fail(`themuse.fetch() ${label}: calls=${calls}, message=${JSON.stringify(message)}`);
  }
  await expectInvalid({ name: 'X', provider: 'themuse', posted: 5 }, /`posted` must be 1, 7 or 30/, 'posted: 5');
  await expectInvalid({ name: 'X', provider: 'themuse', posted: 'week' }, /`posted` must be 1, 7 or 30/, 'posted: "week"');
  await expectInvalid({ name: 'X', provider: 'themuse', remote: 'yes' }, /`remote` must be true or false/, 'remote: "yes"');
  await expectInvalid({ name: 'X', provider: 'themuse', category: 'Software Engineering' }, /`category` must be a lowercase slug/, 'category with spaces/caps');
  await expectInvalid({ name: 'X', provider: 'themuse', location: '' }, /`location` must be a non-empty string/, 'location: ""');
  await expectInvalid({ name: 'X', provider: 'themuse', location: '   ' }, /`location` must be a non-empty string/, 'location: whitespace');
  await expectInvalid({ name: 'X', provider: 'themuse', query: 42 }, /`query` must be a non-empty string/, 'query: 42');

  // Pagination: total 45 -> 3 pages; page 1 has no page param, later pages do.
  const paginationCalls = [];
  const paginationOpts = [];
  const paginatedJobs = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse' },
    {
      fetchText: async (url, opts) => {
        paginationCalls.push(url);
        paginationOpts.push(opts);
        const pageParam = new URL(url).searchParams.get('page');
        if (pageParam === null) return page(45, [card({ title: 'Page One' })]);
        if (pageParam === '2') return page(45, [card({ id: '22222222-0000-0000-0000-000000000000', title: 'Page Two', href: '/jobs/acme/page-two' })]);
        return page(45, [card({ id: '33333333-0000-0000-0000-000000000000', title: 'Page Three', href: '/jobs/acme/page-three' })]);
      },
      // no-op so the inter-page delay doesn't slow the test suite down
      sleep: async () => {},
    },
  );
  if (paginationCalls.length === 3
      && paginationCalls[0] === 'https://www.themuse.com/search'
      && paginationCalls[1] === 'https://www.themuse.com/search?page=2'
      && paginationCalls[2] === 'https://www.themuse.com/search?page=3')
    pass('themuse.fetch() iterates pages 1..pageCount from the h1 total (no page param on page 1)');
  else fail(`themuse.fetch() pagination calls = ${JSON.stringify(paginationCalls)}`);

  if (paginatedJobs.length === 3 && paginatedJobs[2]?.title === 'Page Three')
    pass('themuse.fetch() aggregates results from all pages');
  else fail(`themuse.fetch() paginated results = ${JSON.stringify(paginatedJobs.map(j => j.title))}`);

  if (paginationOpts.length === 3 && paginationOpts.every(o => o?.redirect === 'error'))
    pass('themuse.fetch() passes redirect:"error" on every page request, not just page 1');
  else fail(`themuse.fetch() pagination opts = ${JSON.stringify(paginationOpts)}`);

  // Page cap: a huge total must be clamped to 100 pages, not cause unbounded requests.
  let cappedCalls = 0;
  const { result: cappedJobs, errors: cappedErrors } = await captureConsoleErrors(() =>
    themuse.fetch(
      { name: 'X', provider: 'themuse' },
      {
        fetchText: async () => { cappedCalls++; return page(122312, [card()]); },
        // no-op so 99 inter-page delays don't slow the test suite down
        sleep: async () => {},
      },
    ),
  );
  if (cappedCalls === 100) pass('themuse.fetch() clamps the walk to 100 pages (prevents unbounded requests)');
  else fail(`themuse.fetch() made ${cappedCalls} requests for total=122312 (expected 100)`);
  if (cappedJobs.truncated?.reason === 'page-cap' && cappedJobs.truncated?.fetched === 100 && cappedJobs.truncated?.total === 122312)
    pass('themuse.fetch() marks a page-cap stop with fetched/total counts');
  else fail(`themuse.fetch() page-cap marker = ${JSON.stringify(cappedJobs.truncated)}`);
  if (cappedErrors.some(e => /raise max_pages on this entry/.test(e) && /100-page cap/.test(e)))
    pass('themuse.fetch() tells the user to raise max_pages when the page cap truncates the list');
  else fail(`themuse.fetch() page-cap warning = ${JSON.stringify(cappedErrors)}`);

  // entry.max_pages raises the ceiling (and an invalid value falls back to the default).
  let maxPagesCalls = 0;
  const { result: maxPagesJobs, errors: maxPagesErrors } = await captureConsoleErrors(() =>
    themuse.fetch(
      { name: 'X', provider: 'themuse', max_pages: 2 },
      {
        fetchText: async () => { maxPagesCalls++; return page(122312, [card()]); },
        sleep: async () => {},
      },
    ),
  );
  if (maxPagesCalls === 2 && maxPagesJobs.truncated?.reason === 'page-cap' && maxPagesJobs.truncated?.fetched === 2)
    pass('themuse.fetch() honors entry.max_pages (2 pages, page-cap marker)');
  else fail(`themuse.fetch() max_pages: 2: calls=${maxPagesCalls}, truncated=${JSON.stringify(maxPagesJobs.truncated)}`);
  if (maxPagesErrors.some(e => /raise max_pages on this entry/.test(e) && /2-page cap/.test(e)))
    pass('themuse.fetch() names the raised ceiling in the max_pages warning');
  else fail(`themuse.fetch() max_pages warning = ${JSON.stringify(maxPagesErrors)}`);

  let invalidMaxPagesCalls = 0;
  await captureConsoleErrors(() =>
    themuse.fetch(
      { name: 'X', provider: 'themuse', max_pages: 'many' },
      {
        fetchText: async () => { invalidMaxPagesCalls++; return page(122312, [card()]); },
        sleep: async () => {},
      },
    ),
  );
  if (invalidMaxPagesCalls === 100) pass('themuse.fetch() falls back to the 100-page default for a non-integer max_pages');
  else fail(`themuse.fetch() invalid max_pages: expected 100 calls, got ${invalidMaxPagesCalls}`);

  // ctx.maxPages (health probe): exactly one list request.
  let probeCalls = 0;
  await themuse.fetch(
    { name: 'X', provider: 'themuse', location: 'Germany' },
    {
      maxPages: 1,
      fetchText: async () => { probeCalls++; return page(2075, [card()]); },
      sleep: async () => {},
    },
  );
  if (probeCalls === 1) pass('themuse.fetch() makes exactly one list request under ctx.maxPages: 1');
  else fail(`themuse.fetch() probe made ${probeCalls} requests (expected 1)`);

  // Probe: a ctx.fetchText rejection propagates unwrapped (so
  // verify-portals can recognise its ProbePageBudgetReached by identity).
  {
    class ProbePageBudgetReached extends Error {}
    const sentinel = new ProbePageBudgetReached('budget');
    let failingCalls = 0;
    let thrown = null;
    try {
      await themuse.fetch(
        { name: 'X', provider: 'themuse' },
        {
          maxPages: 1,
          fetchText: async () => { failingCalls++; throw sentinel; },
          sleep: async () => {},
        },
      );
    } catch (e) { thrown = e; }
    if (thrown === sentinel) pass('themuse.fetch() propagates a probe fetch rejection unwrapped');
    else fail(`themuse.fetch() probe rejection: expected the sentinel, got ${thrown?.constructor?.name}: ${thrown?.message}`);
    if (failingCalls === 1) pass('themuse.fetch() does not retry while probing');
    else fail(`themuse.fetch() probe retry: expected 1 fetchText call, got ${failingCalls}`);
  }

  // fetch() retry — a 429 that succeeds on a later attempt is transparent to
  // the caller (no jobs lost, no error surfaced) and respects Retry-After.
  {
    let attempts = 0;
    const sleepCalls = [];
    const jobs = await themuse.fetch(
      { name: 'The Muse Board', provider: 'themuse' },
      {
        fetchText: async () => {
          attempts++;
          if (attempts === 1) { const err = new Error('HTTP 429'); err.status = 429; err.retryAfter = '1'; throw err; }
          return page(1, [card()]);
        },
        sleep: async (ms) => { sleepCalls.push(ms); },
      },
    );
    if (attempts === 2 && jobs.length === 1 && jobs[0].title === 'Staff AI Engineer') {
      pass('themuse.fetch() retries a 429 and recovers transparently');
    } else {
      fail(`themuse 429 retry: attempts=${attempts}, jobs=${JSON.stringify(jobs)}`);
    }
    if (sleepCalls[0] === 1000) {
      pass('themuse.fetch() honors Retry-After header for backoff delay');
    } else {
      fail(`themuse retry-after: expected first backoff delay 1000ms, got ${JSON.stringify(sleepCalls)}`);
    }
  }

  // fetch() retry exhaustion — a page that fails every retry attempt must
  // NOT discard jobs already gathered from earlier pages, and must warn
  // rather than throw.
  {
    let calls = 0;
    const { result: jobs, errors } = await captureConsoleErrors(() =>
      themuse.fetch(
        { name: 'The Muse Board', provider: 'themuse' },
        {
          fetchText: async (url) => {
            calls++;
            const pageParam = new URL(url).searchParams.get('page');
            if (pageParam === null) return page(60, [card()]);
            const err = new Error('HTTP 503'); err.status = 503; throw err; // every page 2+ call fails
          },
          sleep: async () => {},
        },
      ),
    );
    // page 1 (1 call) + page 2 retried MAX_RETRIES+1=4 times, then truncates before page 3
    if (calls === 5) pass('themuse.fetch() stops retrying a page after exhausting attempts');
    else fail(`themuse retry exhaustion: expected 5 fetchText calls, got ${calls}`);
    if (jobs.length === 1 && jobs[0].title === 'Staff AI Engineer') {
      pass('themuse.fetch() preserves jobs already gathered when a later page exhausts retries');
    } else {
      fail(`themuse retry exhaustion: expected 1 preserved job, got ${JSON.stringify(jobs.map(j => j.title))}`);
    }
    if (errors.some(e => /truncated at page 2 of 3/.test(e) && /after 4 attempts/.test(e) && /1 jobs gathered so far/.test(e))) {
      pass('themuse.fetch() warns (does not throw) with the real exhausted attempt count (4) when a page exhausts retries');
    } else {
      fail(`themuse retry exhaustion: expected a truncation warning, got ${JSON.stringify(errors)}`);
    }
    if (jobs.truncated?.reason === 'fetch-error') pass('themuse.fetch() marks a fetch-error stop on the returned jobs');
    else fail(`themuse.fetch() fetch-error marker = ${JSON.stringify(jobs.truncated)}`);
    if (!errors.some(e => /raise max_pages/.test(e))) {
      pass('themuse.fetch() does not fire the "raise max_pages" warning on a fetch-error stop');
    } else {
      fail(`themuse fetch-error stop: the raise max_pages warning must not fire, got ${JSON.stringify(errors)}`);
    }
  }

  // fetch() retry — a non-retryable error (e.g. 404) breaks immediately
  // without wasting retry attempts, but still preserves earlier pages. The
  // truncation warning must report the real attempt count (1), not the
  // fixed MAX_RETRIES+1 ceiling that only applies to exhausted retries.
  // (This is the "page after the last page 404s" shape from #6887.)
  {
    let calls = 0;
    const { result: jobs, errors } = await captureConsoleErrors(() =>
      themuse.fetch(
        { name: 'The Muse Board', provider: 'themuse' },
        {
          fetchText: async (url) => {
            calls++;
            const pageParam = new URL(url).searchParams.get('page');
            if (pageParam === null) return page(40, [card()]);
            const err = new Error('HTTP 404'); err.status = 404; throw err;
          },
          sleep: async () => {},
        },
      ),
    );
    if (calls === 2 && jobs.length === 1) {
      pass('themuse.fetch() does not retry a non-retryable error, but preserves earlier pages');
    } else {
      fail(`themuse non-retryable: calls=${calls}, jobs=${JSON.stringify(jobs.map(j => j.title))}`);
    }
    if (errors.some(e => /after 1 attempt /.test(e) && !/attempts/.test(e))) {
      pass('themuse.fetch() reports the real attempt count (1) for a non-retryable error, not the retry ceiling');
    } else {
      fail(`themuse non-retryable attempt count: expected "after 1 attempt", got ${JSON.stringify(errors)}`);
    }
  }

  // fetch() page 1 is NOT in the tolerant loop — a completely dead board
  // (every attempt on page 1 fails) must throw, not resolve to []. A caught
  // page-1 failure would be indistinguishable from a healthy "0 jobs today"
  // result to scan.mjs's consecutive-failure detector.
  {
    let calls = 0;
    let threw = false;
    let thrownMessage = '';
    try {
      await themuse.fetch(
        { name: 'X', provider: 'themuse' },
        {
          fetchText: async () => {
            calls++;
            const err = new Error('HTTP 503'); err.status = 503; throw err; // every call fails, including page 1
          },
          sleep: async () => {},
        },
      );
    } catch (err) {
      threw = true;
      thrownMessage = err.message;
    }
    if (threw) pass('themuse.fetch() throws (does not return []) when page 1 fails every retry attempt');
    else fail('themuse.fetch() should throw on a total page-1 failure, not resolve to an empty array');
    if (thrownMessage === 'HTTP 503') {
      pass('themuse.fetch() propagates the real page-1 error rather than swallowing it');
    } else {
      fail(`themuse page-1 failure: expected the propagated error message "HTTP 503", got ${JSON.stringify(thrownMessage)}`);
    }
    // page 1 retried MAX_RETRIES+1=4 times, then threw -- no page 2 was ever attempted
    if (calls === 4) pass('themuse.fetch() exhausts retries on page 1 before giving up (4 attempts)');
    else fail(`themuse page-1 failure: expected 4 fetchText calls, got ${calls}`);
  }

  // fetch() layout change on page 1 — a page with no h1.sr-count must throw,
  // not read as "0 jobs today".
  {
    let threw = false;
    let thrownMessage = '';
    try {
      await themuse.fetch(
        { name: 'X', provider: 'themuse' },
        { fetchText: async () => '<html><body>challenge or redesign</body></html>' },
      );
    } catch (e) {
      threw = true;
      thrownMessage = e.message;
    }
    if (threw && /layout change/.test(thrownMessage)) {
      pass('themuse.fetch() throws on a page-1 layout change (no h1.sr-count)');
    } else {
      fail(`themuse page-1 layout change: threw=${threw}, message=${JSON.stringify(thrownMessage)}`);
    }
  }

  // fetch() layout change on page 1 — a count above 0 with no cards must
  // throw, not read as "0 jobs today" (the throwing fixture carries the
  // listing signal with zero rows parsed).
  {
    let threw = false;
    let thrownMessage = '';
    try {
      await themuse.fetch(
        { name: 'X', provider: 'themuse' },
        { fetchText: async () => page(5, []) },
      );
    } catch (e) {
      threw = true;
      thrownMessage = e.message;
    }
    if (threw && /layout change/.test(thrownMessage) && /no job cards/.test(thrownMessage)) {
      pass('themuse.fetch() throws on a page-1 layout change (count above 0, no cards)');
    } else {
      fail(`themuse page-1 layout change (no cards): threw=${threw}, message=${JSON.stringify(thrownMessage)}`);
    }
  }

  // fetch() layout change on a later page — truncate with a warning and
  // keep the jobs already gathered, plus the cards parsed before the bad one.
  {
    const { result: jobs, errors } = await captureConsoleErrors(() =>
      themuse.fetch(
        { name: 'The Muse Board', provider: 'themuse' },
        {
          fetchText: async (url) => {
            const pageParam = new URL(url).searchParams.get('page');
            if (pageParam === null) return page(40, [card()]);
            return page(40, [
              card({ id: '22222222-0000-0000-0000-000000000000', title: 'Page Two', href: '/jobs/acme/page-two' }),
              '<article class="sr-tile" data-job-id="deadbeef-0000-0000-0000-000000000000"><div class="sr-tile__body"><h2 class="sr-tile__title">No link here</h2></div></article>',
            ]);
          },
          sleep: async () => {},
        },
      ),
    );
    if (jobs.length === 2 && jobs[1]?.title === 'Page Two') {
      pass('themuse.fetch() preserves jobs already gathered when a later page changes layout');
    } else {
      fail(`themuse later-page layout change: expected 2 jobs, got ${JSON.stringify(jobs.map(j => j.title))}`);
    }
    if (errors.some(e => /layout change/.test(e) && /page 2/.test(e))) {
      pass('themuse.fetch() warns when a later page changes layout');
    } else {
      fail(`themuse later-page layout change: expected a layout warning, got ${JSON.stringify(errors)}`);
    }
    if (jobs.truncated?.reason === 'layout-change') pass('themuse.fetch() marks a layout-change stop on the returned jobs');
    else fail(`themuse.fetch() layout-change marker = ${JSON.stringify(jobs.truncated)}`);
  }

} catch (e) {
  fail(`themuse provider tests crashed: ${e.message}`);
}
