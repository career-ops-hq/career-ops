// tests/providers/jobicy.test.mjs — parser and single-page fetch cases moved
// from test-all.mjs (#1440); cursor walk and geo/industry/tag filters added.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobicy');

const FEED = 'https://jobicy.com/api/v2/remote-jobs';

/** One feed page: rows built from ids, plus the cursor fields the API sends. */
function feedPage(ids, nextCursor = null) {
  return {
    jobCount: ids.length,
    nextCursor,
    hasMore: nextCursor !== null,
    jobs: ids.map((id) => ({
      id,
      jobTitle: `Engineer ${id}`,
      companyName: 'Acme Corp',
      jobGeo: 'LATAM',
      url: `https://jobicy.com/jobs/${id}-engineer`,
      pubDate: '2026-11-05 10:00:00',
    })),
  };
}

/** A ctx whose fetchJson serves `pages` in order and records every call. */
function pagedCtx(pages, extra = {}) {
  const calls = [];
  const ctx = {
    sleeps: 0,
    sleep: async () => { ctx.sleeps++; },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const next = pages[calls.length - 1];
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(url) : next;
    },
    ...extra,
  };
  return { ctx, calls };
}

try {
  const jobicyModule = await import(pathToFileURL(join(ROOT, 'providers/jobicy.mjs')).href);
  const jobicy = jobicyModule.default;
  const { parseJobicyResponse, jobicyFilters, buildJobicyUrl, resolveMaxPages } = jobicyModule;

  if (jobicy.id === 'jobicy') pass('jobicy.id is "jobicy"');
  else fail(`jobicy.id is ${JSON.stringify(jobicy.id)}`);

  // ── detect() ──────────────────────────────────────────────────────────────

  const hit = jobicy.detect({ name: 'Jobicy Board', provider: 'jobicy' });
  if (hit && hit.url === `${FEED}?count=100`) {
    pass('jobicy.detect() claims explicit provider config');
  } else {
    fail(`jobicy.detect() returned ${JSON.stringify(hit)}`);
  }

  if (jobicy.detect({ name: 'Remote Board', provider: 'remoteok' }) === null) {
    pass('jobicy.detect() ignores other provider ids');
  } else {
    fail('jobicy.detect() should only claim provider: jobicy');
  }

  const junk = [null, undefined, {}, { careers_url: 'https://jobicy.com/' }, { provider: 42 }];
  const junkHits = junk.map((e) => { try { return jobicy.detect(e); } catch (err) { return `threw: ${err.message}`; } });
  if (junkHits.every((h) => h === null)) pass('jobicy.detect() returns null for junk / unclaimed entries without throwing');
  else fail(`jobicy.detect() junk results: ${JSON.stringify(junkHits)}`);

  const filteredHit = jobicy.detect({ name: 'Jobicy LATAM', provider: 'jobicy', geo: 'latam', industry: 'engineering' });
  if (filteredHit?.url === `${FEED}?count=100&geo=latam&industry=engineering`) {
    pass('jobicy.detect() carries the entry filters in the URL it reports');
  } else {
    fail(`jobicy.detect() filtered URL = ${JSON.stringify(filteredHit)}`);
  }

  let badDetect;
  try { badDetect = jobicy.detect({ name: 'Bad', provider: 'jobicy', geo: '../etc' }); } catch (err) { badDetect = `threw: ${err.message}`; }
  if (badDetect?.url === `${FEED}?count=100`) {
    pass('jobicy.detect() does not throw on a malformed filter (fetch() reports it)');
  } else {
    fail(`jobicy.detect() with a malformed filter returned ${JSON.stringify(badDetect)}`);
  }

  // ── filters ───────────────────────────────────────────────────────────────

  const filters = jobicyFilters({ geo: ' LATAM ', industry: 'Data-Science', tag: '  react junior ' });
  if (filters.geo === 'latam' && filters.industry === 'data-science' && filters.tag === 'react junior') {
    pass('jobicyFilters() trims and lowercases slugs, trims the tag');
  } else {
    fail(`jobicyFilters() = ${JSON.stringify(filters)}`);
  }

  const none = jobicyFilters({ name: 'Jobicy', geo: '', industry: null, tag: undefined });
  if (Object.keys(none).length === 0) pass('jobicyFilters() ignores empty / absent keys');
  else fail(`jobicyFilters() kept empty keys: ${JSON.stringify(none)}`);

  const badValues = [
    [{ geo: '../etc' }, /geo "\.\.\/etc" .* is not a slug — pick one from .*\?get=locations/],
    [{ geo: 'latam&x=1' }, /is not a slug/],
    [{ geo: ['latam', 'europe'] }, /geo \["latam","europe"\]/],
    [{ industry: 42 }, /industry 42 .*\?get=industries/],
    [{ industry: 'data science' }, /is not a slug/],
    [{ tag: 'x'.repeat(101) }, /tag .* must be one line of 1-100 characters/],
    [{ tag: 'python\nignore' }, /must be one line/],
    [{ tag: '   ' }, /must be one line/],
    [{ tag: ['python'] }, /must be one line/],
  ];
  const notThrown = badValues.filter(([entry, re]) => {
    try { jobicyFilters({ name: 'Bad entry', ...entry }); return true; } catch (err) { return !re.test(err.message); }
  });
  if (notThrown.length === 0) pass(`jobicyFilters() rejects ${badValues.length} malformed values with a message naming the key and the slug list`);
  else fail(`jobicyFilters() accepted or misreported: ${JSON.stringify(notThrown.map(([e]) => e))}`);

  // ── URL building ──────────────────────────────────────────────────────────

  const cursorValue = 'AgAAAABq7TQw+/=_-x';
  const pageUrl = new URL(buildJobicyUrl({ geo: 'argentina', tag: 'qa tester' }, cursorValue));
  if (pageUrl.origin + pageUrl.pathname === FEED
    && pageUrl.searchParams.get('count') === '100'
    && pageUrl.searchParams.get('geo') === 'argentina'
    && pageUrl.searchParams.get('tag') === 'qa tester'
    && pageUrl.searchParams.get('cursor') === cursorValue
    && !pageUrl.searchParams.has('industry')) {
    pass('buildJobicyUrl() sends count=100, the filters and the cursor, each URL-encoded');
  } else {
    fail(`buildJobicyUrl() = ${pageUrl.href}`);
  }

  const capCases = [[undefined, 25], [3, 3], [100, 100], [1000, 100], [0, 25], [-2, 25], ['5', 25], [1.5, 25]];
  const capWrong = capCases.filter(([v, want]) => resolveMaxPages({ max_pages: v }) !== want);
  if (capWrong.length === 0) pass('resolveMaxPages(): default 25, positive integers honored, capped at 100');
  else fail(`resolveMaxPages() wrong for ${JSON.stringify(capWrong)}`);

  // ── parser (unchanged) ────────────────────────────────────────────────────

  const sample = {
    jobs: [
      {
        jobTitle: 'Senior AI Engineer',
        companyName: 'Acme Corp',
        jobGeo: 'Worldwide',
        url: 'https://jobicy.com/jobs/senior-ai-engineer',
        pubDate: '2026-06-27T10:00:00',
      },
      {
        jobTitle: 'Staff Backend Developer',
        companyName: 'Globex',
        jobGeo: 'Europe',
        url: 'https://jobicy.com/jobs/staff-backend-developer',
        pubDate: '2026-06-25T12:00:00Z',
      },
      {
        jobTitle: 'Role With Missing URL',
        companyName: 'Incomplete',
        jobGeo: 'USA',
        pubDate: '2026-06-24T08:00:00Z',
      },
      {
        jobTitle: 'Role With Invalid URL',
        companyName: 'Invalid',
        url: 'not-a-valid-url',
        jobGeo: 'USA',
      },
      {
        jobTitle: '',
        companyName: 'Empty Title',
        url: 'https://jobicy.com/jobs/empty-title',
        jobGeo: 'USA',
      }
    ]
  };

  const jobs = parseJobicyResponse(sample, 'Jobicy Board');

  if (jobs.length === 2) pass('parseJobicyResponse keeps 2 jobs (drops missing/invalid url and empty title)');
  else fail(`parseJobicyResponse returned ${jobs.length} jobs (expected 2)`);

  if (jobs[0]?.company === 'Acme Corp' && jobs[0]?.title === 'Senior AI Engineer') {
    pass('parseJobicyResponse maps jobTitle -> title, companyName -> company');
  } else {
    fail(`row 0 title/company = ${JSON.stringify({ title: jobs[0]?.title, company: jobs[0]?.company })}`);
  }

  if (jobs[0]?.url === 'https://jobicy.com/jobs/senior-ai-engineer') {
    pass('parseJobicyResponse maps url to url');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.location === 'Worldwide') {
    pass('parseJobicyResponse maps jobGeo to location');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-06-27T10:00:00')) {
    pass('parseJobicyResponse parses pubDate -> postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.company === 'Globex' && jobs[1]?.title === 'Staff Backend Developer') {
    pass('parseJobicyResponse parses second job correctly');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (parseJobicyResponse('', 'X').length === 0 && parseJobicyResponse(null, 'X').length === 0) {
    pass('parseJobicyResponse empty / non-object payload -> empty result (no crash)');
  } else {
    fail('parseJobicyResponse empty / non-object payload should yield empty result');
  }

  // The live feed encodes its text fields, so these used to reach pipeline.md,
  // scan-history and the tracker as literal entities.
  const [encoded] = parseJobicyResponse({
    jobs: [{ jobTitle: 'R&#038;D Engineer &#8211; Part-Time', companyName: 'Zone &#038; Co', jobGeo: 'Asia &amp; Pacific', url: 'https://jobicy.com/jobs/1-rd-engineer' }],
  });
  if (encoded?.company === 'Zone & Co' && encoded?.title === 'R&D Engineer – Part-Time' && encoded?.location === 'Asia & Pacific') {
    pass('parseJobicyResponse decodes HTML entities in the title, company and location');
  } else {
    fail(`parseJobicyResponse left entities in place: ${JSON.stringify(encoded)}`);
  }

  // A company that is only an entity for whitespace is no company: the fallback
  // is decided on the decoded name, or the row would carry an empty one.
  const blanks = parseJobicyResponse({
    jobs: ['&nbsp;', ' &#160; ', '&#32;'].map((companyName, i) => ({ jobTitle: 'Data Engineer', companyName, url: `https://jobicy.com/jobs/${i + 2}-data-engineer` })),
  });
  if (blanks.length === 3 && blanks.every((j) => j.company === 'Jobicy')) {
    pass('parseJobicyResponse falls back to the default company when the name decodes to whitespace');
  } else {
    fail(`parseJobicyResponse kept a blank company: ${JSON.stringify(blanks.map((j) => j.company))}`);
  }

  // ── fetch(): one page ─────────────────────────────────────────────────────

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await jobicy.fetch(
    { name: 'Jobicy Board', provider: 'jobicy' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === `${FEED}?count=100`) {
    pass('jobicy.fetch() requests the pinned JSON feed URL');
  } else {
    fail(`jobicy.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('jobicy.fetch() passes redirect:"error" to fetchJson');
  } else {
    fail(`jobicy.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched[0]?.company === 'Acme Corp' && fetched[0]?.title === 'Senior AI Engineer' && fetched.length === 2) {
    pass('provider: jobicy config returns normalized jobs (a page with no nextCursor ends the walk)');
  } else {
    fail(`jobicy.fetch() normalized rows = ${JSON.stringify(fetched)}`);
  }

  // ── fetch(): the cursor walk ──────────────────────────────────────────────

  const walk = pagedCtx([feedPage([1, 2], 'cur-1'), feedPage([3, 4], 'cur-2'), feedPage([5])]);
  const { result: walked, errors: walkWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy LATAM', provider: 'jobicy', geo: 'latam', tag: 'qa' }, walk.ctx));
  const walkUrls = walk.calls.map((c) => new URL(c.url));
  if (walked.length === 5 && walk.calls.length === 3) pass('jobicy.fetch() follows nextCursor to the end of the feed (3 pages, 5 jobs)');
  else fail(`jobicy.fetch() walk returned ${walked.length} jobs over ${walk.calls.length} requests`);
  if (walkUrls.map((u) => u.searchParams.get('cursor')).join(',') === ',cur-1,cur-2') {
    pass('jobicy.fetch() sends no cursor on page one, then each page\'s nextCursor unchanged');
  } else {
    fail(`jobicy.fetch() cursors sent: ${JSON.stringify(walkUrls.map((u) => u.searchParams.get('cursor')))}`);
  }
  if (walkUrls.every((u) => u.searchParams.get('geo') === 'latam' && u.searchParams.get('tag') === 'qa' && u.searchParams.get('count') === '100')) {
    pass('jobicy.fetch() keeps the same filters on every page (the API rejects a cursor with changed filters)');
  } else {
    fail(`jobicy.fetch() filters drifted across pages: ${walkUrls.map((u) => u.search).join(' | ')}`);
  }
  if (walk.calls.every((c) => c.opts?.redirect === 'error')) pass('jobicy.fetch() passes redirect:"error" on every page request');
  else fail(`jobicy.fetch() page options: ${JSON.stringify(walk.calls.map((c) => c.opts))}`);
  if (walk.ctx.sleeps === 2) pass('jobicy.fetch() paces pages past the first through the shared sleep (2 sleeps for 3 pages)');
  else fail(`jobicy.fetch() slept ${walk.ctx.sleeps} times for 3 pages`);
  if (walkWarnings.length === 0 && walked.jobicyTruncated === undefined) pass('jobicy.fetch() a complete walk warns nothing and is not tagged truncated');
  else fail(`jobicy.fetch() complete walk: warnings=${JSON.stringify(walkWarnings)} truncated=${walked.jobicyTruncated}`);

  const dup = pagedCtx([feedPage([1, 2], 'c1'), feedPage([2, 3])]);
  const deduped = await jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, dup.ctx);
  if (deduped.map((j) => j.title).join(',') === 'Engineer 1,Engineer 2,Engineer 3') pass('jobicy.fetch() keeps a posting seen on two pages once');
  else fail(`jobicy.fetch() dedup = ${JSON.stringify(deduped.map((j) => j.title))}`);

  const hasMoreFalse = pagedCtx([{ ...feedPage([1]), nextCursor: 'stale', hasMore: false }, feedPage([2])]);
  await jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, hasMoreFalse.ctx);
  if (hasMoreFalse.calls.length === 1) pass('jobicy.fetch() stops on hasMore:false even when a cursor string is present');
  else fail(`jobicy.fetch() kept walking past hasMore:false (${hasMoreFalse.calls.length} requests)`);

  const emptyWithCursor = pagedCtx([feedPage([1], 'c1'), feedPage([], 'c2'), feedPage([9])]);
  const { result: emptyEnd, errors: emptyWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, emptyWithCursor.ctx));
  if (emptyWithCursor.calls.length === 2 && emptyEnd.length === 1 && emptyWarnings.length === 0) {
    pass('jobicy.fetch() an empty page ends the walk as complete, with no warning');
  } else {
    fail(`jobicy.fetch() empty page: ${emptyWithCursor.calls.length} requests, ${emptyEnd.length} jobs, warnings ${JSON.stringify(emptyWarnings)}`);
  }

  // ── fetch(): page ceilings ────────────────────────────────────────────────

  let endlessCalls = 0;
  const endlessCtx = {
    sleep: async () => {},
    fetchJson: async () => { endlessCalls++; return feedPage([endlessCalls], `cursor-${endlessCalls}`); },
  };
  const { result: endless, errors: endlessWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, endlessCtx));
  if (endlessCalls === 25 && endless.length === 25) pass('jobicy.fetch() stops at DEFAULT_MAX_PAGES (25) however many pages the feed offers');
  else fail(`jobicy.fetch() endless feed: ${endlessCalls} requests, ${endless.length} jobs`);
  if (endlessWarnings.some((w) => /truncated at max_pages=25 \(25 jobs\) — raise max_pages on this entry/.test(w)) && endless.jobicyTruncated === true) {
    pass('jobicy.fetch() warns "raise max_pages" and tags jobicyTruncated when its own cap cut the feed');
  } else {
    fail(`jobicy.fetch() cap stop: warnings=${JSON.stringify(endlessWarnings)} truncated=${endless.jobicyTruncated}`);
  }

  const entryCap = pagedCtx([feedPage([1], 'c1'), feedPage([2], 'c2'), feedPage([3], 'c3')]);
  const { errors: entryCapWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy', max_pages: 2 }, entryCap.ctx));
  if (entryCap.calls.length === 2 && entryCapWarnings.some((w) => /max_pages=2/.test(w))) pass('jobicy.fetch() honors an entry max_pages and warns when it truncates');
  else fail(`jobicy.fetch() entry max_pages: ${entryCap.calls.length} requests, warnings ${JSON.stringify(entryCapWarnings)}`);

  const exactFit = pagedCtx([feedPage([1], 'c1'), feedPage([2])]);
  const { result: exactJobs, errors: exactWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy', max_pages: 2 }, exactFit.ctx));
  if (exactWarnings.length === 0 && exactJobs.jobicyTruncated === undefined) pass('jobicy.fetch() a feed that ends on the last allowed page is complete, not capped');
  else fail(`jobicy.fetch() exact fit: warnings=${JSON.stringify(exactWarnings)} truncated=${exactJobs.jobicyTruncated}`);

  // ── fetch(): the health probe (verify-portals, ctx.maxPages: 1) ───────────

  const probe = pagedCtx([feedPage([1, 2], 'c1'), feedPage([3])], { maxPages: 1 });
  const { result: probed, errors: probeWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, probe.ctx));
  if (probe.calls.length === 1 && probed.length === 2 && probe.ctx.sleeps === 0) pass('jobicy.fetch() makes exactly one list request under ctx.maxPages: 1');
  else fail(`jobicy.fetch() probe: ${probe.calls.length} requests, ${probed.length} jobs, ${probe.ctx.sleeps} sleeps`);
  if (probeWarnings.length === 0) pass('jobicy.fetch() does NOT fire the "raise max_pages" warning when the probe, not the entry cap, stopped it');
  else fail(`jobicy.fetch() probe warned: ${JSON.stringify(probeWarnings)}`);

  class BudgetReached extends Error {}
  const budgetError = new BudgetReached('probe budget reached');
  let probeRejection;
  try {
    await jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw budgetError; } });
  } catch (err) {
    probeRejection = err;
  }
  if (probeRejection === budgetError) pass('jobicy.fetch() propagates a ctx.fetchJson rejection unwrapped while probing');
  else fail(`jobicy.fetch() probe rejection was ${probeRejection === undefined ? 'swallowed' : `rewrapped: ${probeRejection?.message}`}`);

  // ── fetch(): failures ─────────────────────────────────────────────────────

  // Page 2 fails on every attempt, so fetchJsonWithRetry exhausts its default
  // policy (2 retries = 3 attempts): 1 call for page 1 + 3 for page 2 = 4.
  const flaky = Object.assign(new Error('HTTP 503 Service Unavailable'), { status: 503 });
  const partial = pagedCtx([feedPage([1, 2], 'c1'), flaky, flaky, flaky]);
  const { result: partialJobs, errors: partialWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, partial.ctx));
  if (partialJobs.length === 2 && partial.calls.length === 4) pass('jobicy.fetch() keeps page 1 when page 2 exhausts its retries');
  else fail(`jobicy.fetch() partial failure: ${partialJobs.length} jobs after ${partial.calls.length} calls`);
  if (partialWarnings.some((w) => /truncated at page 2 \(2 jobs kept\): HTTP 503/.test(w)) && !partialWarnings.some((w) => /raise max_pages/.test(w))) {
    pass('jobicy.fetch() a fetch-error stop warns about the failed page, never "raise max_pages"');
  } else {
    fail(`jobicy.fetch() fetch-error warnings: ${JSON.stringify(partialWarnings)}`);
  }
  if (partialJobs.jobicyTruncated === true) pass('jobicy.fetch() tags a fetch-error-truncated board jobicyTruncated');
  else fail(`jobicy.fetch() fetch-error board should carry jobicyTruncated, got ${partialJobs.jobicyTruncated}`);

  const recovered = pagedCtx([feedPage([1], 'c1'), flaky, feedPage([2])]);
  const { result: recoveredJobs, errors: recoveredWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, recovered.ctx));
  if (recoveredJobs.length === 2 && recovered.calls.length === 3 && recoveredWarnings.length === 0) pass('jobicy.fetch() a transient page failure is retried and the walk completes');
  else fail(`jobicy.fetch() transient failure: ${recoveredJobs.length} jobs, ${recovered.calls.length} calls, warnings ${JSON.stringify(recoveredWarnings)}`);

  let firstPageError;
  try {
    await jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, pagedCtx([flaky, flaky, flaky]).ctx);
  } catch (err) {
    firstPageError = err;
  }
  if (firstPageError?.status === 503) pass('jobicy.fetch() a failed first page throws instead of returning an empty board');
  else fail(`jobicy.fetch() first-page failure: ${firstPageError ? firstPageError.message : 'no throw'}`);

  const rejectedBody = JSON.stringify({ success: false, error: "Invalid 'geo' value. This value must contain a predefined 'geoSlug'. See here: https://jobicy.com/api/v2/remote-jobs?get=locations" });
  const rejected = Object.assign(new Error('HTTP 400 Bad Request'), { status: 400, body: rejectedBody });
  const rejectedCtx = pagedCtx([rejected, rejected, rejected]);
  let rejection;
  try {
    await jobicy.fetch({ name: 'Jobicy Typo', provider: 'jobicy', geo: 'argentna' }, rejectedCtx.ctx);
  } catch (err) {
    rejection = err;
  }
  if (rejectedCtx.calls.length === 1 && /^jobicy: Jobicy Typo: Jobicy rejected the request \(HTTP 400\): Invalid 'geo' value\..*\?get=locations$/.test(rejection?.message ?? '') && rejection?.cause === rejected) {
    pass('jobicy.fetch() an unknown slug fails once, with the API\'s own reason and the original error as cause');
  } else {
    fail(`jobicy.fetch() 400 handling: ${rejectedCtx.calls.length} calls, message ${JSON.stringify(rejection?.message)}`);
  }

  let configCalls = 0;
  let configError;
  try {
    await jobicy.fetch({ name: 'Bad', provider: 'jobicy', industry: 'data science' }, { fetchJson: async () => { configCalls++; return feedPage([]); } });
  } catch (err) {
    configError = err;
  }
  if (configCalls === 0 && /is not a slug/.test(configError?.message ?? '')) pass('jobicy.fetch() a malformed filter throws before any request (fetch stub never entered)');
  else fail(`jobicy.fetch() malformed filter: ${configCalls} requests, error ${JSON.stringify(configError?.message)}`);

  // ── fetch(): empty vs broken ──────────────────────────────────────────────

  const empty = await jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, pagedCtx([{ jobCount: 0, nextCursor: null, hasMore: false, jobs: [] }]).ctx);
  if (Array.isArray(empty) && empty.length === 0) pass('jobicy.fetch() a present-and-empty jobs[] returns [] (empty board)');
  else fail(`jobicy.fetch() empty board returned ${JSON.stringify(empty)}`);

  const broken = [[{}, /got keys: \[\]/], [{ jobs: null, success: true }, /got keys: \[jobs, success\]/], ['', /got keys: \[string\]/], [42, /got keys: \[number\]/]];
  const notBroken = [];
  for (const [payload, re] of broken) {
    try {
      await jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, pagedCtx([payload]).ctx);
      notBroken.push(payload);
    } catch (err) {
      if (!/^jobicy: unexpected API response — expected \{ jobs: \[\.\.\.\] \}/.test(err.message) || !re.test(err.message)) notBroken.push(payload);
    }
  }
  if (notBroken.length === 0) pass('jobicy.fetch() an undocumented first-page envelope throws, naming the keys or type it got');
  else fail(`jobicy.fetch() accepted or misreported envelopes: ${JSON.stringify(notBroken)}`);

  const laterBroken = pagedCtx([feedPage([1], 'c1'), { error: 'maintenance' }]);
  const { result: laterJobs, errors: laterWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, laterBroken.ctx));
  if (laterJobs.length === 1 && laterJobs.jobicyTruncated === true && laterWarnings.some((w) => /truncated at page 2 .*got keys: \[error\]/.test(w))) {
    pass('jobicy.fetch() an undocumented later page keeps the earlier pages, warns and tags the board truncated');
  } else {
    fail(`jobicy.fetch() later broken page: ${laterJobs.length} jobs, warnings ${JSON.stringify(laterWarnings)}`);
  }

  const looping = pagedCtx([feedPage([1], 'same'), feedPage([2], 'same'), feedPage([3], 'same')]);
  const { result: loopJobs, errors: loopWarnings } = await captureConsoleErrors(() =>
    jobicy.fetch({ name: 'Jobicy', provider: 'jobicy' }, looping.ctx));
  if (looping.calls.length === 2 && loopJobs.jobicyTruncated === true && loopWarnings.some((w) => /a cursor it had already returned/.test(w))) {
    pass('jobicy.fetch() a repeated cursor stops the walk instead of looping');
  } else {
    fail(`jobicy.fetch() repeated cursor: ${looping.calls.length} requests, warnings ${JSON.stringify(loopWarnings)}`);
  }

} catch (e) {
  fail(`jobicy provider tests crashed: ${e.message}`);
}
