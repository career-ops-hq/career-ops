// tests/providers/workday.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, warn, run, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workday');


try {
  const workdayModule = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);
  const workday = workdayModule.default;
  const { parseWorkdayResponse } = workdayModule;

  // Shared mock ctx shape for workday.fetch() calls below — only fetchJson varies per test.
  // sleep is a no-op so retry-backoff delays don't slow the test suite down.
  const mkWorkdayCtx = (fetchJson, extra = {}) => ({
    transport: 'http',
    fetchText: async () => { throw new Error('fetchText should not be called'); },
    fetchJson,
    sleep: async () => {},
    ...extra,
  });

  if (workday.id === 'workday') pass('workday.id is "workday"');
  else fail(`workday.id is ${JSON.stringify(workday.id)}`);

  // detect() — valid Workday URLs
  const hitUs = workday.detect({ name: 'Acme', careers_url: 'https://acme.wd12.myworkdayjobs.com/en-US/acme-jobs' });
  if (hitUs && hitUs.url === 'https://acme.wd12.myworkdayjobs.com/wday/cxs/acme/acme-jobs/jobs') {
    pass('workday.detect() resolves wd12 URL to CXS API endpoint');
  } else {
    fail(`workday.detect(wd12) returned ${JSON.stringify(hitUs)}`);
  }

  const hitNoLocale = workday.detect({ name: 'Test', careers_url: 'https://test.wd5.myworkdayjobs.com/TestBoard' });
  if (hitNoLocale && hitNoLocale.url === 'https://test.wd5.myworkdayjobs.com/wday/cxs/test/TestBoard/jobs') {
    pass('workday.detect() works without locale segment in path');
  } else {
    fail(`workday.detect(no-locale) returned ${JSON.stringify(hitNoLocale)}`);
  }

  // detect() — null cases
  if (workday.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('workday.detect() returns null for non-Workday URL');
  } else {
    fail('workday.detect() should return null for non-Workday URL');
  }

  // entry.api precedence: a branded careers_url is kept while the Workday tenant
  // is pinned via api: (mirrors greenhouse/ashby).
  const hitApiWd = workday.detect({
    name: 'PTC',
    careers_url: 'https://www.ptc.com/en/careers',
    api: 'https://ptc.wd1.myworkdayjobs.com/PTC',
  });
  if (hitApiWd && hitApiWd.url === 'https://ptc.wd1.myworkdayjobs.com/wday/cxs/ptc/PTC/jobs') {
    pass('workday.detect() honors api: over a branded careers_url');
  } else {
    fail(`workday.detect(api-pinned) returned ${JSON.stringify(hitApiWd)}`);
  }

  // A non-Workday api: must not shadow a valid Workday careers_url — resolution
  // falls through to the next candidate instead of returning null.
  const hitFallthrough = workday.detect({
    name: 'Acme',
    api: 'https://acme.com/careers',
    careers_url: 'https://acme.wd12.myworkdayjobs.com/en-US/acme-jobs',
  });
  if (hitFallthrough && hitFallthrough.url === 'https://acme.wd12.myworkdayjobs.com/wday/cxs/acme/acme-jobs/jobs') {
    pass('workday.detect() falls through a non-Workday api: to a valid careers_url');
  } else {
    fail(`workday.detect(fallthrough) returned ${JSON.stringify(hitFallthrough)}`);
  }

  // Path-spoofed URL: myworkdayjobs.com in path, not hostname
  if (workday.detect({ name: 'Spoof', careers_url: 'https://evil.example/test.wd5.myworkdayjobs.com/en-US/board' }) === null) {
    pass('workday.detect() rejects path-spoofed URL');
  } else {
    fail('workday.detect() must NOT detect path-spoofed URLs');
  }

  // Non-string careers_url
  if (workday.detect({ name: 'X', careers_url: null }) === null && workday.detect({ name: 'X' }) === null) {
    pass('workday.detect() returns null for null / missing careers_url');
  } else {
    fail('workday.detect() should return null for non-string careers_url');
  }

  // parseWorkdayResponse — normalization
  const sampleJson = {
    jobPostings: [
      { title: 'Senior QA Engineer', externalPath: '/job/board/Senior-QA-Engineer_JR001', locationsText: 'Berlin, Germany', postedOn: 'Posted 2 Days Ago' },
      { title: 'Lead Developer', externalPath: '/job/board/Lead-Developer_JR002', locationsText: 'Remote' },
      { title: '', externalPath: '/job/board/No-Title_JR003' },          // no title — skip
      { title: 'No Path Role', externalPath: '' },                        // no externalPath — skip
      { title: 'Also No Path' },                                          // undefined externalPath — skip
    ],
  };
  const entry = { name: 'Acme', careers_url: 'https://acme.wd12.myworkdayjobs.com/en-US/acme-jobs' };
  const parsed = parseWorkdayResponse(sampleJson, entry);

  if (parsed.length === 2) pass('parseWorkdayResponse extracts 2 valid jobs (skips missing title/path)');
  else fail(`parseWorkdayResponse returned ${parsed.length} jobs, expected 2`);

  if (parsed[0].title === 'Senior QA Engineer' && parsed[0].location === 'Berlin, Germany') {
    pass('parseWorkdayResponse maps title and location');
  } else {
    fail(`row 0 = ${JSON.stringify(parsed[0])}`);
  }

  if (parsed[0].url.includes('acme-jobs') && parsed[0].url.includes('/job/board/Senior-QA-Engineer_JR001')) {
    pass('parseWorkdayResponse builds URL from jobBase + externalPath');
  } else {
    fail(`row 0 url = ${JSON.stringify(parsed[0].url)}`);
  }

  if (parsed[0].company === 'Acme') pass('parseWorkdayResponse sets company from entry.name');
  else fail(`parseWorkdayResponse company = ${JSON.stringify(parsed[0].company)}`);

  // parseWorkdayResponse — location fallback from URL path
  const noLocEntry = { name: 'Globex', careers_url: 'https://globex.wd103.myworkdayjobs.com/globexcareers' };
  const noLocJson = {
    jobPostings: [
      { title: 'Quality Engineer', externalPath: '/job/Mumbai/Quality-Engineer_ATCI-123' },           // no locationsText
      { title: 'Test Lead', externalPath: '/job/Remote-Poland/Test-Lead_ATCI-456', locationsText: '' }, // empty locationsText
      { title: 'QA Analyst', externalPath: '/job/Remote-Hungary/QA-Analyst_ATCI-789', locationsText: 'Remote, Hungary' }, // has locationsText — use it
    ],
  };
  const noLocParsed = parseWorkdayResponse(noLocJson, noLocEntry);
  if (noLocParsed[0]?.location === 'Mumbai') pass('parseWorkdayResponse falls back to URL path location when locationsText absent');
  else fail(`parseWorkdayResponse path fallback: expected "Mumbai", got ${JSON.stringify(noLocParsed[0]?.location)}`);
  if (noLocParsed[1]?.location === 'Remote Poland') pass('parseWorkdayResponse falls back to URL path location when locationsText empty');
  else fail(`parseWorkdayResponse path fallback empty: expected "Remote Poland", got ${JSON.stringify(noLocParsed[1]?.location)}`);
  if (noLocParsed[2]?.location === 'Remote, Hungary') pass('parseWorkdayResponse prefers locationsText over URL path when present');
  else fail(`parseWorkdayResponse locationsText priority: expected "Remote, Hungary", got ${JSON.stringify(noLocParsed[2]?.location)}`);

  // parseWorkdayResponse — malformed percent-encoding in the URL path segment
  // must not throw (decodeURIComponent) and must not abort processing of
  // other job records in the same response.
  const malformedPathJson = {
    jobPostings: [
      { title: 'Broken Encoding', externalPath: '/job/%E0%A4%A/Broken-Encoding_JR1' },
      { title: 'Fine Job', externalPath: '/job/Berlin/Fine-Job_JR2' },
    ],
  };
  try {
    const malformedParsed = parseWorkdayResponse(malformedPathJson, entry);
    if (malformedParsed.length === 2 && malformedParsed[1].location === 'Berlin') {
      pass('parseWorkdayResponse tolerates malformed percent-encoding without dropping other records');
    } else {
      fail(`parseWorkdayResponse malformed encoding result = ${JSON.stringify(malformedParsed)}`);
    }
  } catch (e4) {
    fail(`parseWorkdayResponse should not throw on malformed percent-encoding: ${e4.message}`);
  }

  // parseWorkdayResponse — empty / malformed input
  if (parseWorkdayResponse({}, entry).length === 0) pass('parseWorkdayResponse({}) → empty result');
  else fail('parseWorkdayResponse({}) should be empty');

  if (parseWorkdayResponse({ jobPostings: null }, entry).length === 0) {
    pass('parseWorkdayResponse handles null jobPostings');
  } else {
    fail('parseWorkdayResponse null jobPostings should be empty');
  }

  // fetch() with mock ctx — uses total field to bound sequential pagination
  let postRequests = 0;
  const capturedRedirects = [];
  const fetchedJobs = await workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
    postRequests++;
    capturedRedirects.push(opts?.redirect);
    const body = JSON.parse(opts.body);
    if (body.offset === 0) {
      return { total: 30, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job P1-${i}`, externalPath: `/job/board/p1-${i}` })) };
    }
    return { total: 30, jobPostings: Array.from({ length: 10 }, (_, i) => ({ title: `Job P2-${i}`, externalPath: `/job/board/p2-${i}` })) };
  }));
  if (postRequests === 2 && fetchedJobs.length === 30) {
    pass('workday.fetch() uses total field to fetch exact pages sequentially (20+10=30)');
  } else {
    fail(`fetch pagination: requests=${postRequests}, total=${fetchedJobs.length} (expected 2 requests / 30 jobs)`);
  }

  if (capturedRedirects.length === 2 && capturedRedirects.every(r => r === 'error')) {
    pass('workday.fetch() passes redirect:"error" on every page (SSRF guard)');
  } else {
    fail(`workday.fetch() redirect opts across pages = ${JSON.stringify(capturedRedirects)}`);
  }

  // parseWorkdayResponse — null/undefined entries in jobPostings must be
  // skipped, not crash
  const sparseWorkday = { jobPostings: [null, undefined, { title: 'Real Job', externalPath: '/job/board/real-job' }] };
  try {
    const parsedSparseWorkday = parseWorkdayResponse(sparseWorkday, entry);
    if (parsedSparseWorkday.length === 1 && parsedSparseWorkday[0].title === 'Real Job') {
      pass('parseWorkdayResponse skips null/undefined entries without crashing');
    } else {
      fail(`parseWorkdayResponse sparse result = ${JSON.stringify(parsedSparseWorkday)}`);
    }
  } catch (e2) {
    fail(`parseWorkdayResponse should not throw on null/undefined entries: ${e2.message}`);
  }

  // fetch() pagination cap — an inflated `total` must not trigger unbounded
  // requests (DEFAULT_MAX_PAGES = 100 in providers/workday.mjs), and hitting
  // the cap must be visible (console.error), not silent — real tenants
  // (Dollar Tree, total=23,609; CVS Health, total=16,974) already exceed the
  // 100-page/2000-job default.
  let hugeWorkdayRequests = 0;
  const { result: fetchedHugeWorkday, errors: capturedWarnings } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async () => {
      hugeWorkdayRequests++;
      return { total: 1_000_000, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job ${i}`, externalPath: `/job/board/${i}` })) };
    })));
  if (hugeWorkdayRequests === 100 && fetchedHugeWorkday.length === 2000) {
    pass('workday.fetch() caps pagination at DEFAULT_MAX_PAGES despite an inflated total');
  } else {
    fail(`workday fetch pagination cap: requests=${hugeWorkdayRequests}, total=${fetchedHugeWorkday.length} (expected 100/2000)`);
  }
  if (capturedWarnings.some(w => /truncated at max_pages=\d+/.test(w))) {
    pass('workday.fetch() warns (console.error) when the cap truncates real results');
  } else {
    fail(`workday fetch cap: expected a truncation warning, got ${JSON.stringify(capturedWarnings)}`);
  }

  // fetch() pagination cap — entry.max_pages raises the cap for a genuinely
  // large tenant (e.g. Deutsche Bank-scale postings)
  let overriddenWorkdayRequests = 0;
  const bigWorkdayEntry = { name: 'BigCo', careers_url: 'https://bigco.wd5.myworkdayjobs.com/careers', max_pages: 80 };
  const fetchedOverriddenWorkday = await workday.fetch(bigWorkdayEntry, mkWorkdayCtx(async () => {
    overriddenWorkdayRequests++;
    return { total: 1_000_000, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job ${i}`, externalPath: `/job/board/${i}` })) };
  }));
  if (overriddenWorkdayRequests === 80 && fetchedOverriddenWorkday.length === 1600) {
    pass('workday.fetch() honors entry.max_pages to raise the cap above the default');
  } else {
    fail(`workday fetch max_pages override: requests=${overriddenWorkdayRequests}, total=${fetchedOverriddenWorkday.length} (expected 80/1600)`);
  }

  // entry.max_pages is itself capped (MAX_PAGES_CAP = 1500) — an absurd
  // override can't turn this into an unbounded scan either.
  let absurdWorkdayRequests = 0;
  const absurdWorkdayEntry = { name: 'AbsurdCo', careers_url: 'https://absurdco.wd5.myworkdayjobs.com/careers', max_pages: 100_000 };
  const fetchedAbsurdWorkday = await workday.fetch(absurdWorkdayEntry, mkWorkdayCtx(async () => {
    absurdWorkdayRequests++;
    return { total: 10_000_000, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job ${i}`, externalPath: `/job/board/${i}` })) };
  }));
  if (absurdWorkdayRequests === 1500 && fetchedAbsurdWorkday.length === 30_000) {
    pass('workday.fetch() caps an absurd entry.max_pages at MAX_PAGES_CAP');
  } else {
    fail(`workday fetch max_pages hard cap: requests=${absurdWorkdayRequests}, total=${fetchedAbsurdWorkday.length} (expected 1500/30000)`);
  }

  // Invalid max_pages values (negative, zero, non-numeric) fall back to
  // DEFAULT_MAX_PAGES, same as omitting max_pages entirely.
  for (const invalidMaxPages of [-5, 0, 'abc', NaN, null]) {
    let invalidRequests = 0;
    const invalidEntry = { name: 'InvalidCo', careers_url: 'https://invalidco.wd5.myworkdayjobs.com/careers', max_pages: invalidMaxPages };
    const fetchedInvalid = await workday.fetch(invalidEntry, mkWorkdayCtx(async () => {
      invalidRequests++;
      return { total: 1_000_000, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job ${i}`, externalPath: `/job/board/${i}` })) };
    }));
    // Number.isNaN(NaN) is true but JSON.stringify(NaN) === 'null', which would
    // be indistinguishable from the literal `null` case in the log below.
    const label = Number.isNaN(invalidMaxPages) ? 'NaN' : JSON.stringify(invalidMaxPages);
    if (invalidRequests === 100 && fetchedInvalid.length === 2000) {
      pass(`workday.fetch() falls back to DEFAULT_MAX_PAGES for invalid max_pages=${label}`);
    } else {
      fail(`workday fetch invalid max_pages=${label}: requests=${invalidRequests}, total=${fetchedInvalid.length} (expected 100/2000)`);
    }
  }

  // fetch() pagination — a failure that persists across every retry attempt
  // on a later page returns the jobs gathered so far instead of discarding
  // everything (sequential, not Promise.all), retries MAX_RETRIES+1=4 times
  // on that page before giving up, and the failure itself is visible
  // (console.error), not silent. The truncation ("raise max_pages") warning
  // must NOT also fire — that knob does nothing for a rate-limited tenant.
  let flakyWorkdayRequests = 0;
  const { result: flakyWorkdayJobs, errors: flakyWarnings } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
      flakyWorkdayRequests++;
      const body = JSON.parse(opts.body);
      const page = body.offset / 20; // PAGE_SIZE in providers/workday.mjs
      if (page === 2) { const err = new Error('HTTP 503'); err.status = 503; throw err; }
      return { total: 80, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job p${page}-${i}`, externalPath: `/job/board/p${page}-${i}` })) };
    })));
  if (flakyWorkdayRequests === 6 && flakyWorkdayJobs.length === 40) {
    pass('workday.fetch() retries a failing page 4x then returns partial results');
  } else {
    fail(`workday fetch partial failure: requests=${flakyWorkdayRequests}, total=${flakyWorkdayJobs.length} (expected 6/40)`);
  }
  if (flakyWarnings.some(w => /truncated at \d+ of \d+ pages after 4 attempts/.test(w))) {
    pass('workday.fetch() warns (console.error) when a page fetch fails after exhausting retries, with the attempt count');
  } else {
    fail(`workday fetch page failure: expected a fetch-failed warning, got ${JSON.stringify(flakyWarnings)}`);
  }
  // The failure message must show scale — which page out of how many were
  // planned, and how many jobs came back out of the tenant's real total —
  // not just "page 3, 40 jobs" with no sense of how much was actually lost.
  // Same "truncated at ... (N of M jobs)" shape as the cap-hit warning below,
  // so the two read consistently.
  if (flakyWarnings.some(w => /truncated at 3 of 4 pages after 4 attempts \(40 of 80 jobs\): HTTP 503/.test(w))) {
    pass('workday.fetch() fetch-failure warning reports scale (page X of Y, N of total jobs)');
  } else {
    fail(`workday fetch-failure warning missing scale context: ${JSON.stringify(flakyWarnings)}`);
  }
  if (!flakyWarnings.some(w => /raise max_pages/.test(w))) {
    pass('workday.fetch() does NOT fire the "raise max_pages" warning on a fetch-error stop');
  } else {
    fail(`workday fetch-error stop should not also warn about max_pages: ${JSON.stringify(flakyWarnings)}`);
  }

  // fetch() retry — a 429 that succeeds on a later attempt is transparent to
  // the caller (no jobs lost, no error surfaced) and respects Retry-After.
  let retrySleepCalls = [];
  let retryAttempts = 0;
  const retryEntry = { name: 'RetryCo', careers_url: 'https://retryco.wd5.myworkdayjobs.com/careers' };
  const retryJobs = await workday.fetch(retryEntry, mkWorkdayCtx(async () => {
    retryAttempts++;
    if (retryAttempts === 1) { const err = new Error('HTTP 429'); err.status = 429; err.retryAfter = '1'; throw err; }
    return { total: 1, jobPostings: [{ title: 'Recovered Job', externalPath: '/job/board/recovered' }] };
  }, { sleep: async (ms) => { retrySleepCalls.push(ms); } }));
  if (retryAttempts === 2 && retryJobs.length === 1 && retryJobs[0].title === 'Recovered Job') {
    pass('workday.fetch() retries a 429 and recovers transparently');
  } else {
    fail(`workday 429 retry: attempts=${retryAttempts}, jobs=${JSON.stringify(retryJobs)}`);
  }
  if (retrySleepCalls[0] === 1000) {
    pass('workday.fetch() honors Retry-After header for backoff delay');
  } else {
    fail(`workday retry-after: expected first backoff delay 1000ms, got ${JSON.stringify(retrySleepCalls)}`);
  }

  // fetch() retry — a hostile or misconfigured Retry-After (e.g. 86400s = a
  // full day) must not be honored verbatim: it's clamped to
  // RETRY_MAX_DELAY_MS * 4 (32s) so a single bad header can't stall a
  // tenant's fetch indefinitely, defeating the point of a bounded backoff.
  let hostileRetrySleepCalls = [];
  let hostileRetryAttempts = 0;
  const hostileRetryEntry = { name: 'HostileRetryCo', careers_url: 'https://hostileretryco.wd5.myworkdayjobs.com/careers' };
  await workday.fetch(hostileRetryEntry, mkWorkdayCtx(async () => {
    hostileRetryAttempts++;
    if (hostileRetryAttempts === 1) { const err = new Error('HTTP 429'); err.status = 429; err.retryAfter = '86400'; throw err; }
    return { total: 0, jobPostings: [] };
  }, { sleep: async (ms) => { hostileRetrySleepCalls.push(ms); } }));
  if (hostileRetrySleepCalls[0] === 32_000) {
    pass('workday.fetch() clamps an oversized Retry-After to RETRY_MAX_DELAY_MS * 4');
  } else {
    fail(`workday retry-after clamp: expected 32000ms, got ${JSON.stringify(hostileRetrySleepCalls)}`);
  }

  // fetch() retry — a non-retryable 4xx (e.g. malformed request) breaks
  // immediately, without wasting retry attempts.
  let non429Attempts = 0;
  const { result: non429Jobs } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
      non429Attempts++;
      const body = JSON.parse(opts.body);
      if (body.offset === 0) return { total: 40, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job ${i}`, externalPath: `/job/board/${i}` })) };
      const err = new Error('HTTP 400: bad request'); err.status = 400; throw err;
    })));
  if (non429Attempts === 2 && non429Jobs.length === 20) {
    pass('workday.fetch() does not retry a non-retryable 4xx error');
  } else {
    fail(`workday non-retryable 4xx: attempts=${non429Attempts}, jobs=${non429Jobs.length} (expected 2/20)`);
  }

  // fetch() early-stop — once a page's postings are all clearly past
  // ctx.sinceMs, pagination stops without hitting max_pages, and the
  // "raise max_pages" warning does NOT fire (this isn't a cap hit).
  const SINCE_DAYS = 3; // mirrors scan-ats-full.mjs's --since default
  const nowMs = Date.now();
  const sinceMs = nowMs - SINCE_DAYS * 86_400_000;
  let earlyStopRequests = 0;
  const { result: earlyStopJobs, errors: earlyStopWarnings } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
      earlyStopRequests++;
      const body = JSON.parse(opts.body);
      const page = body.offset / 20;
      if (page === 0) {
        // Page 0: fresh postings, well within the window.
        return { total: 1_000_000, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Fresh ${i}`, externalPath: `/job/board/fresh-${i}`, postedOn: 'Posted Today' })) };
      }
      // Every later page: clearly stale (well past sinceMs - margin) — if
      // early-stop didn't work, this mock would be asked for 100 pages.
      return { total: 1_000_000, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Stale ${i}`, externalPath: `/job/board/stale-${i}`, postedOn: 'Posted 20 Days Ago' })) };
    }, { sinceMs })));
  if (earlyStopRequests === 2 && earlyStopJobs.length === 40) {
    pass('workday.fetch() stops paginating once a page is past --since (early-stop)');
  } else {
    fail(`workday early-stop: requests=${earlyStopRequests}, jobs=${earlyStopJobs.length} (expected 2/40)`);
  }
  if (!earlyStopWarnings.some(w => /truncated at/.test(w))) {
    pass('workday.fetch() does NOT warn about max_pages when it stopped early on --since');
  } else {
    fail(`workday early-stop should not warn about max_pages: ${JSON.stringify(earlyStopWarnings)}`);
  }

  // fetch() early-stop — a wide --since window (>= 30 days) never triggers
  // early-stop off the unbounded "30+ Days Ago" bucket; pagination still
  // proceeds until max_pages/total, as before. includeUndated: true isolates
  // this from the no-date-skip optimization tested separately below — every
  // posting here is undated ("30+"), which would otherwise short-circuit
  // after page 1 regardless of --since width.
  const WIDE_SINCE_DAYS = 90; // >= 30 — past the "30+ Days Ago" bucket's ambiguity threshold
  const wideSinceMs = nowMs - WIDE_SINCE_DAYS * 86_400_000;
  let wideRequests = 0;
  const wideJobs = await workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
    wideRequests++;
    const body = JSON.parse(opts.body);
    if (body.offset === 0) {
      return { total: 40, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Old ${i}`, externalPath: `/job/board/old-${i}`, postedOn: 'Posted 30+ Days Ago' })) };
    }
    return { total: 40, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Old2 ${i}`, externalPath: `/job/board/old2-${i}`, postedOn: 'Posted 30+ Days Ago' })) };
  }, { sinceMs: wideSinceMs, includeUndated: true }));
  if (wideRequests === 2 && wideJobs.length === 40) {
    pass('workday.fetch() never early-stops off the unbounded "30+ Days Ago" bucket');
  } else {
    fail(`workday wide-since: requests=${wideRequests}, jobs=${wideJobs.length} (expected 2/40)`);
  }

  // fetch() cap-hit warning — reverse-scan context (ctx.sinceMs set, as
  // scan-ats-full.mjs always does) where entries are synthesized from an
  // external dataset, not portals.yml: there's no portal entry to edit, and
  // — per the "no fixed cap can guarantee full coverage" conclusion — no
  // fix to advise at all, so the message is just the short fact, with
  // neither "raise max_pages" nor a portals.yml edit suggested.
  // includeUndated: true forces this past the no-date-skip short-circuit
  // (tested separately below) so the fetch actually reaches the cap.
  const noDateSinceMs = nowMs - SINCE_DAYS * 86_400_000;
  const { errors: noDateWarnings } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async () => ({
      total: 1_000_000,
      jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `NoDate ${i}`, externalPath: `/job/board/nodate-${i}` })), // no postedOn
    }), { sinceMs: noDateSinceMs, includeUndated: true })));
  if (noDateWarnings.some(w => /truncated at \d+ pages/.test(w))) {
    pass('workday.fetch() cap-hit warning fires in reverse-scan context (tenant has no dates, includeUndated on)');
  } else {
    fail(`workday no-date cap warning missing: ${JSON.stringify(noDateWarnings)}`);
  }
  if (!noDateWarnings.some(w => /raise max_pages|portal entry|portals\.yml/.test(w))) {
    pass('workday.fetch() reverse-scan cap warning gives no inactionable advice (no portal entry to edit)');
  } else {
    fail(`workday reverse-scan cap warning should not suggest editing a portal entry: ${JSON.stringify(noDateWarnings)}`);
  }

  // fetch() no-date-skip — the default case (includeUndated NOT set, as
  // scan-ats-full.mjs leaves it by default): a tenant whose first page has
  // zero dated postings stops right there instead of grinding through up to
  // maxPages requests whose results would all be dropped as 'undated'
  // downstream anyway. Only 1 request should fire, not maxPages (100).
  const skipSinceMs = nowMs - SINCE_DAYS * 86_400_000;
  let skipRequests = 0;
  const { result: skipJobs, errors: skipWarnings } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async () => {
      skipRequests++;
      return {
        total: 1_000_000,
        jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `NoDate ${i}`, externalPath: `/job/board/skip-${i}` })), // no postedOn
      };
    }, { sinceMs: skipSinceMs }))); // includeUndated intentionally omitted — the default, falsy case
  if (skipRequests === 1 && skipJobs.length === 20) {
    pass('workday.fetch() skips pagination after page 1 when includeUndated is off and the tenant has no dated postings');
  } else {
    fail(`workday no-date-skip: requests=${skipRequests}, jobs=${skipJobs.length} (expected 1/20)`);
  }
  // A full-directory scan hits this on a large fraction of tenants — a
  // console.error per occurrence would just be the same line thousands of
  // times, so the signal is a tag on the returned array instead (aggregated
  // by scan-ats-full.mjs into one summary line at the end of the run).
  if (skipJobs.workdayNoDateSkip === true) {
    pass('workday.fetch() tags the returned jobs array for no-date-skip aggregation');
  } else {
    fail(`workday no-date-skip tag missing: jobs.workdayNoDateSkip = ${JSON.stringify(skipJobs.workdayNoDateSkip)}`);
  }
  if (skipWarnings.length === 0) {
    pass('workday.fetch() does not console.error per-company on a no-date-skip (aggregated instead)');
  } else {
    fail(`workday no-date-skip should not log anything directly: ${JSON.stringify(skipWarnings)}`);
  }

  // fetch() no-date-skip — does NOT trigger when includeUndated is true (the
  // "hit the cap while genuinely undated" scenario above already covers that
  // the fetch continues in that case); this just re-confirms the gate.
  let noSkipWithIncludeUndatedRequests = 0;
  const noSkipJobs = await workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
    noSkipWithIncludeUndatedRequests++;
    const body = JSON.parse(opts.body);
    if (body.offset === 0) return { total: 40, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `ND ${i}`, externalPath: `/job/board/nd-${i}` })) };
    return { total: 40, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `ND2 ${i}`, externalPath: `/job/board/nd2-${i}` })) };
  }, { sinceMs: skipSinceMs, includeUndated: true }));
  if (noSkipWithIncludeUndatedRequests === 2 && noSkipJobs.length === 40) {
    pass('workday.fetch() does not no-date-skip when includeUndated is true');
  } else {
    fail(`workday no-date-skip gate: requests=${noSkipWithIncludeUndatedRequests}, jobs=${noSkipJobs.length} (expected 2/40)`);
  }

  // fetch() cap-hit warning — reverse-scan context, tenant genuinely has
  // more within --since than the cap allows (total far above the window,
  // e.g. cvshealth-scale): short line, no suspect-cap tag.
  const datedCapSinceMs = nowMs - SINCE_DAYS * 86_400_000;
  const { errors: datedCapWarnings } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async () => ({
      total: 1_000_000,
      jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Fresh ${i}`, externalPath: `/job/board/fresh-${i}`, postedOn: 'Posted Today' })),
    }), { sinceMs: datedCapSinceMs })));
  if (datedCapWarnings.some(w => /truncated at \d+ pages \(2000 of 1000000 jobs\)/.test(w))) {
    pass('workday.fetch() cap-hit warning reports the short "truncated at N pages" form');
  } else {
    fail(`workday dated cap-hit warning mismatch: ${JSON.stringify(datedCapWarnings)}`);
  }
  if (!datedCapWarnings.some(w => /Workday-capped/.test(w))) {
    pass('workday.fetch() cap-hit warning omits the suspected-Workday-cap tag when total is far above the window');
  } else {
    fail(`workday cap-hit warning should not suspect a Workday-side cap here (total=1,000,000, window=2,000): ${JSON.stringify(datedCapWarnings)}`);
  }

  // fetch() cap-hit warning — Workday's own CXS backend has been observed
  // reporting `total` as exactly maxPages*PAGE_SIZE even when the real count
  // is far higher (verified live: dickssportinggoods reported total=2000 but
  // its public careers page listed 7,120 openings, and offset=2000/4000
  // requests returned the same first posting as offset=0 instead of new
  // results). This exact-match case must carry a distinct, short tag.
  const suspectCapSinceMs = nowMs - SINCE_DAYS * 86_400_000;
  const { errors: suspectCapWarnings } = await captureConsoleErrors(() =>
    workday.fetch(entry, mkWorkdayCtx(async () => ({
      total: 2000, // === DEFAULT_MAX_PAGES (100) * PAGE_SIZE (20)
      jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Suspect ${i}`, externalPath: `/job/board/suspect-${i}`, postedOn: 'Posted Today' })),
    }), { sinceMs: suspectCapSinceMs })));
  if (suspectCapWarnings.some(w => /\(total may be Workday-capped, not real\)/.test(w))) {
    pass('workday.fetch() cap-hit warning flags a suspected Workday-side total cap when total === maxPages*PAGE_SIZE');
  } else {
    fail(`workday suspected-cap tag missing: ${JSON.stringify(suspectCapWarnings)}`);
  }

  // Verify POST method was used
  let capturedMethod = null;
  await workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => { capturedMethod = opts?.method; return { total: 0, jobPostings: [] }; }));
  if (capturedMethod === 'POST') pass('workday.fetch() uses POST method');
  else fail(`workday.fetch() method is ${JSON.stringify(capturedMethod)}, expected POST`);

  // Fallback: no total field — paginate sequentially until short page
  let fallbackRequests = 0;
  const fallbackJobs = await workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
    fallbackRequests++;
    const body = JSON.parse(opts.body);
    if (body.offset === 0) return { jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `FB P1-${i}`, externalPath: `/job/board/fb-${i}` })) };
    return { jobPostings: Array.from({ length: 5 }, (_, i) => ({ title: `FB P2-${i}`, externalPath: `/job/board/fb2-${i}` })) };
  }));
  if (fallbackRequests === 2 && fallbackJobs.length === 25) {
    pass('workday.fetch() fallback (no total): paginates sequentially, stops on short page (20+5=25)');
  } else {
    fail(`fallback pagination: requests=${fallbackRequests}, jobs=${fallbackJobs.length} (expected 2/25)`);
  }

  // fetch() honors ctx.maxPages — verify-portals' liveness probe sets maxPages:1.
  // It must stop after the first page and NOT request page 2, which would trip
  // the probe's second-request sentinel; fetchPageWithRetry treats that abort as
  // transient and retries it MAX_RETRIES times (4 requests) plus a truncation
  // warning. Even though total=173 implies 9 pages, the cap must win at 1.
  let probeRequests = 0;
  const probeWarnings = [];
  const probeErr = console.error;
  console.error = (m) => probeWarnings.push(m);
  let probeJobs;
  try {
    probeJobs = await workday.fetch(entry, mkWorkdayCtx(async (_url, opts) => {
      probeRequests++;
      // Simulate the probe sentinel: any request past the first throws.
      if (JSON.parse(opts.body).offset > 0) throw new Error('probe budget: no second page');
      return { total: 173, jobPostings: Array.from({ length: 20 }, (_, i) => ({ title: `Job ${i}`, externalPath: `/job/board/${i}` })) };
    }, { maxPages: 1 }));
  } finally {
    console.error = probeErr;
  }
  if (probeRequests === 1 && probeJobs.length === 20) {
    pass('workday.fetch() honors ctx.maxPages=1 — one request, no second-page retry storm');
  } else {
    fail(`workday probe cap: requests=${probeRequests} (expected 1), jobs=${probeJobs?.length} (expected 20)`);
  }
  if (!probeWarnings.some((w) => /truncated/.test(String(w)))) {
    pass('workday.fetch() stays silent (no truncation warning) under the liveness probe cap');
  } else {
    fail(`workday probe should emit no warning, got: ${JSON.stringify(probeWarnings)}`);
  }

} catch (e) {
  fail(`workday provider tests crashed: ${e.message}`);
}
