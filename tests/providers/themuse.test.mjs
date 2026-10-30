// tests/providers/themuse.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — themuse');


try {
  const museModule = await import(pathToFileURL(join(ROOT, 'providers/themuse.mjs')).href);
  const themuse = museModule.default;
  const { normalizeMuseJob } = museModule;

  if (themuse.id === 'themuse') pass('themuse.id is "themuse"');
  else fail(`themuse.id is ${JSON.stringify(themuse.id)}`);

  // normalizeMuseJob — field mapping
  const job = normalizeMuseJob({
    name: 'Staff AI Engineer',
    refs: { landing_page: 'https://www.themuse.com/jobs/acme/staff-ai-engineer' },
    company: { name: 'Acme Corp' },
    locations: [{ name: 'Remote' }],
  });
  if (job?.title === 'Staff AI Engineer') pass('normalizeMuseJob maps name → title');
  else fail(`normalizeMuseJob title = ${JSON.stringify(job?.title)}`);

  if (job?.url === 'https://www.themuse.com/jobs/acme/staff-ai-engineer')
    pass('normalizeMuseJob maps refs.landing_page → url');
  else fail(`normalizeMuseJob url = ${JSON.stringify(job?.url)}`);

  if (job?.company === 'Acme Corp') pass('normalizeMuseJob maps company.name → company');
  else fail(`normalizeMuseJob company = ${JSON.stringify(job?.company)}`);

  if (job?.location === 'Remote') pass('normalizeMuseJob maps locations[0].name → location');
  else fail(`normalizeMuseJob location = ${JSON.stringify(job?.location)}`);

  // Missing/invalid field handling
  if (normalizeMuseJob({ name: '', refs: { landing_page: 'https://www.themuse.com/jobs/x' }, company: { name: 'X' }, locations: [] }) === null)
    pass('normalizeMuseJob drops entries with empty title');
  else fail('normalizeMuseJob should return null for empty title');

  if (normalizeMuseJob({ name: 'Role', refs: { landing_page: '/relative' }, company: { name: 'X' }, locations: [] }) === null)
    pass('normalizeMuseJob drops entries with a non-absolute landing_page URL');
  else fail('normalizeMuseJob should return null for a relative URL');

  const noLoc = normalizeMuseJob({
    name: 'Role', refs: { landing_page: 'https://www.themuse.com/jobs/x' }, company: { name: 'X' }, locations: [],
  });
  if (noLoc?.location === '') pass('normalizeMuseJob returns empty location when locations array is empty');
  else fail(`normalizeMuseJob location for empty locations = ${JSON.stringify(noLoc?.location)}`);

  const noCompany = normalizeMuseJob({
    name: 'Role', refs: { landing_page: 'https://www.themuse.com/jobs/x' }, company: null, locations: [{ name: 'NYC' }],
  });
  if (noCompany?.company === 'The Muse') pass('normalizeMuseJob falls back to "The Muse" when company.name is missing');
  else fail(`normalizeMuseJob company fallback = ${JSON.stringify(noCompany?.company)}`);

  if (normalizeMuseJob(null) === null && normalizeMuseJob('string') === null)
    pass('normalizeMuseJob returns null for non-object inputs');
  else fail('normalizeMuseJob should return null for null/non-object input');

  // fetch() — mock ctx
  const sampleResults = [
    {
      name: 'Staff AI Engineer',
      refs: { landing_page: 'https://www.themuse.com/jobs/acme/staff-ai-engineer' },
      company: { name: 'Acme Corp' },
      locations: [{ name: 'Remote' }],
    },
    {
      name: 'Platform Engineer',
      refs: { landing_page: 'https://www.themuse.com/jobs/beta/platform-engineer' },
      company: { name: 'Beta Inc' },
      locations: [],
    },
    {
      name: '',
      refs: { landing_page: 'https://www.themuse.com/jobs/bad/role' },
      company: { name: 'Bad Co' },
      locations: [],
    },
  ];

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse' },
    {
      fetchJson: async (url, opts) => {
        capturedUrl = url; capturedOpts = opts;
        return { results: sampleResults, page: 0, page_count: 1 };
      },
    },
  );

  if (capturedUrl === 'https://www.themuse.com/api/public/jobs?page=0')
    pass('themuse.fetch() requests the correct API endpoint');
  else fail(`themuse.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('themuse.fetch() passes redirect:"error" to fetchJson');
  else fail(`themuse.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('themuse.fetch() normalizes 2 valid jobs (drops the empty-title entry)');
  else fail(`themuse.fetch() returned ${fetched.length} jobs (expected 2)`);

  if (fetched[0]?.title === 'Staff AI Engineer' && fetched[0]?.company === 'Acme Corp')
    pass('themuse.fetch() returns correct title and company for first result');
  else fail(`themuse.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  // Pagination: page_count > 1 causes all pages to be fetched and aggregated.
  const paginationCalls = [];
  const page1Result = { name: 'Data Engineer', refs: { landing_page: 'https://www.themuse.com/jobs/acme/de' }, company: { name: 'Acme' }, locations: [] };
  const paginatedJobs = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse' },
    {
      fetchJson: async (url, opts) => {
        paginationCalls.push(url);
        const page = parseInt(new URL(url).searchParams.get('page') ?? '0', 10);
        if (page === 0) return { results: [sampleResults[0]], page: 0, page_count: 2 };
        return { results: [page1Result], page: 1, page_count: 2 };
      },
      // no-op so the inter-page delay doesn't slow the test suite down
      sleep: async () => {},
    },
  );
  if (paginationCalls.length === 2 &&
      paginationCalls[0] === 'https://www.themuse.com/api/public/jobs?page=0' &&
      paginationCalls[1] === 'https://www.themuse.com/api/public/jobs?page=1')
    pass('themuse.fetch() iterates all pages when page_count > 1');
  else fail(`themuse.fetch() pagination calls = ${JSON.stringify(paginationCalls)}`);

  if (paginatedJobs.length === 2 && paginatedJobs[1]?.title === 'Data Engineer')
    pass('themuse.fetch() aggregates results from all pages');
  else fail(`themuse.fetch() paginated results = ${JSON.stringify(paginatedJobs.map(j => j.title))}`);

  // page_count cap: a huge value must be clamped to 100, not cause unbounded requests.
  let cappedCalls = 0;
  await themuse.fetch(
    { name: 'X', provider: 'themuse' },
    {
      fetchJson: async () => { cappedCalls++; return { results: [], page: 0, page_count: 99999 }; },
      // no-op so 99 inter-page delays don't slow the test suite down
      sleep: async () => {},
    },
  );
  if (cappedCalls === 100) pass('themuse.fetch() clamps page_count to 100 (prevents unbounded requests)');
  else fail(`themuse.fetch() made ${cappedCalls} requests for page_count=99999 (expected 100)`);

  // Non-integer page_count must be ignored (NaN passes typeof==='number' but not Number.isInteger).
  let nonIntCalls = 0;
  await themuse.fetch(
    { name: 'X', provider: 'themuse' },
    { fetchJson: async () => { nonIntCalls++; return { results: [], page: 0, page_count: 1.5 }; } },
  );
  if (nonIntCalls === 1) pass('themuse.fetch() ignores non-integer page_count (fetches only page 0)');
  else fail(`themuse.fetch() made ${nonIntCalls} requests for page_count=1.5 (expected 1)`);

  let badResponseThrew = false;
  try {
    await themuse.fetch(
      { name: 'X', provider: 'themuse' },
      { fetchJson: async () => ({ wrong: true }) },
    );
  } catch (e) {
    badResponseThrew = /unexpected API response/.test(e.message);
  }
  if (badResponseThrew) pass('themuse.fetch() throws on unexpected API response shape');
  else fail('themuse.fetch() should throw when results array is absent');

  // fetch() retry — a 429 that succeeds on a later attempt is transparent to
  // the caller (no jobs lost, no error surfaced) and respects Retry-After.
  {
    let attempts = 0;
    const sleepCalls = [];
    const jobs = await themuse.fetch(
      { name: 'The Muse Board', provider: 'themuse' },
      {
        fetchJson: async () => {
          attempts++;
          if (attempts === 1) { const err = new Error('HTTP 429'); err.status = 429; err.retryAfter = '1'; throw err; }
          return { results: [sampleResults[0]], page: 0, page_count: 1 };
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
          fetchJson: async (url) => {
            calls++;
            const page = parseInt(new URL(url).searchParams.get('page') ?? '0', 10);
            if (page === 0) return { results: [sampleResults[0]], page: 0, page_count: 3 };
            const err = new Error('HTTP 503'); err.status = 503; throw err; // every page 1+ call fails
          },
          sleep: async () => {},
        },
      ),
    );
    // page 0 (1 call) + page 1 retried MAX_RETRIES+1=4 times, then truncates before page 2
    if (calls === 5) pass('themuse.fetch() stops retrying a page after exhausting attempts');
    else fail(`themuse retry exhaustion: expected 5 fetchJson calls, got ${calls}`);
    if (jobs.length === 1 && jobs[0].title === 'Staff AI Engineer') {
      pass('themuse.fetch() preserves jobs already gathered when a later page exhausts retries');
    } else {
      fail(`themuse retry exhaustion: expected 1 preserved job, got ${JSON.stringify(jobs.map(j => j.title))}`);
    }
    if (errors.some(e => /truncated at page 1 of 3/.test(e) && /after 4 attempts/.test(e) && /1 jobs gathered so far/.test(e))) {
      pass('themuse.fetch() warns (does not throw) with the real exhausted attempt count (4) when a page exhausts retries');
    } else {
      fail(`themuse retry exhaustion: expected a truncation warning, got ${JSON.stringify(errors)}`);
    }
  }

  // fetch() retry — a non-retryable error (e.g. 404) breaks immediately
  // without wasting retry attempts, but still preserves earlier pages. The
  // truncation warning must report the real attempt count (1), not the
  // fixed MAX_RETRIES+1 ceiling that only applies to exhausted retries.
  {
    let calls = 0;
    const { result: jobs, errors } = await captureConsoleErrors(() =>
      themuse.fetch(
        { name: 'The Muse Board', provider: 'themuse' },
        {
          fetchJson: async (url) => {
            calls++;
            const page = parseInt(new URL(url).searchParams.get('page') ?? '0', 10);
            if (page === 0) return { results: [sampleResults[0]], page: 0, page_count: 2 };
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

  // fetch() page 0 is NOT in the tolerant loop — a completely dead board
  // (every attempt on page 0 fails) must throw, not resolve to []. A caught
  // page-0 failure would be indistinguishable from a healthy "0 jobs today"
  // result to scan.mjs's consecutive-failure detector.
  {
    let calls = 0;
    let threw = false;
    let thrownMessage = '';
    try {
      await themuse.fetch(
        { name: 'The Muse Board', provider: 'themuse' },
        {
          fetchJson: async () => {
            calls++;
            const err = new Error('HTTP 503'); err.status = 503; throw err; // every call fails, including page 0
          },
          sleep: async () => {},
        },
      );
    } catch (err) {
      threw = true;
      thrownMessage = err.message;
    }
    if (threw) pass('themuse.fetch() throws (does not return []) when page 0 fails every retry attempt');
    else fail('themuse.fetch() should throw on a total page-0 failure, not resolve to an empty array');
    if (thrownMessage === 'HTTP 503') {
      pass('themuse.fetch() propagates the real page-0 error rather than swallowing it');
    } else {
      fail(`themuse page-0 failure: expected the propagated error message "HTTP 503", got ${JSON.stringify(thrownMessage)}`);
    }
    // page 0 retried MAX_RETRIES+1=4 times, then threw -- no page 1 was ever attempted
    if (calls === 4) pass('themuse.fetch() exhausts retries on page 0 before giving up (4 attempts)');
    else fail(`themuse page-0 failure: expected 4 fetchJson calls, got ${calls}`);
  }

  // fetch() malformed shape on a later page — a successful (200 OK) response
  // whose `results` field isn't an array must land in the same tolerant
  // truncation path as a retry-exhausted page, not escape as an uncaught
  // throw that discards jobs already gathered from earlier pages.
  {
    let calls = 0;
    const { result: jobs, errors } = await captureConsoleErrors(() =>
      themuse.fetch(
        { name: 'The Muse Board', provider: 'themuse' },
        {
          fetchJson: async (url) => {
            calls++;
            const page = parseInt(new URL(url).searchParams.get('page') ?? '0', 10);
            if (page === 0) return { results: [sampleResults[0]], page: 0, page_count: 3 };
            return { page, notResults: 'this response has no results array' }; // malformed but a successful 200
          },
          sleep: async () => {},
        },
      ),
    );
    // page 0 (1 call) + page 1 (1 call, malformed shape, no retry triggered — it's a successful fetch)
    if (calls === 2) pass('themuse.fetch() does not retry a malformed-but-successful response');
    else fail(`themuse malformed later page: expected 2 fetchJson calls, got ${calls}`);
    if (jobs.length === 1 && jobs[0].title === 'Staff AI Engineer') {
      pass('themuse.fetch() preserves jobs already gathered when a later page has a malformed shape');
    } else {
      fail(`themuse malformed later page: expected 1 preserved job, got ${JSON.stringify(jobs.map(j => j.title))}`);
    }
    if (errors.some(e => /truncated at page 1 of 3/.test(e) && /unexpected API response on page 1/.test(e))) {
      pass('themuse.fetch() warns (does not throw) when a later page has a malformed shape');
    } else {
      fail(`themuse malformed later page: expected a truncation warning, got ${JSON.stringify(errors)}`);
    }
  }

} catch (e) {
  fail(`themuse provider tests crashed: ${e.message}`);
}

