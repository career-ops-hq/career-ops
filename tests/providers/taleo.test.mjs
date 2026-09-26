import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — taleo');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/taleo.mjs')).href);
  const provider = mod.default;
  if (provider.id === 'taleo') pass('taleo.id is "taleo"'); else fail('wrong provider id');
  const url = 'https://example.taleo.net/careersection/demo/jobsearch.ftl?lang=en';
  if (provider.detect({ name: 'Example', careers_url: url })?.url === url) pass('detects public TEE career-section URL'); else fail('detect failed');
  for (const bad of ['http://example.taleo.net/careersection/demo/jobsearch.ftl', 'https://tre.taleo.net/careersection/demo/jobsearch.ftl', 'https://evil.example/careersection/demo/jobsearch.ftl', 'https://example.taleo.net/careersection/demo/login.ftl', null, 7]) {
    if (provider.detect({ name: 'X', careers_url: bad }) === null) pass(`rejects ${String(bad)}`); else fail(`accepted ${String(bad)}`);
  }
  const shell = '<form action="/careersection/rest/jobboard/searchjobs?portal=8100120144"><table><th>Requisition Title</th><th>Location</th><th>Posting Date</th></table></form>';
  const response = { requisitionList: [
    { jobId: '2601', contestNo: 'R-1', column: ['Learning Designer', 'Toronto', '2026-09-01'] },
    { jobId: '2602', column: ['&amp; Engineer', 'London', 'not-a-date'] },
    { jobId: '', column: ['Dropped', 'X', ''] },
  ], pagingData: { currentPageNo: 1, pageSize: 25, totalCount: 2 } };
  const jobs = mod.parseTaleoResponse(response, { url: new URL(url), section: 'demo' }, mod.extractHeadings(shell), 'Example');
  if (jobs.length === 2 && jobs[0].title === 'Learning Designer' && jobs[0].location === 'Toronto' && jobs[0].postedAt) pass('parses dynamic columns, IDs, location, and date'); else fail(`unexpected parsed jobs ${JSON.stringify(jobs)}`);
  if (jobs[0].url.includes('/jobdetail.ftl?job=R-1') && jobs[1].title === '& Engineer') pass('builds canonical contestNo detail URLs and decodes HTML entities'); else fail('detail URL/entity parsing failed');
  if (mod.parseTaleoResponse({}, { url: new URL(url), section: 'demo' }, [], 'X').length === 0 && mod.parseTaleoResponse(null, { url: new URL(url), section: 'demo' }, [], 'X').length === 0 && mod.parseTaleoResponse([], { url: new URL(url), section: 'demo' }, [], 'X').length === 0) pass('null/empty response → []'); else fail('empty response not empty');
  let malformedThrew = false;
  try { mod.parseTaleoResponse({ requisitionList: {} }, { url: new URL(url), section: 'demo' }, [], 'X'); } catch (e) { malformedThrew = /requisitionList|unexpected API response/.test(e.message); }
  if (malformedThrew) pass('wrong response envelope throws descriptively'); else fail('wrong response envelope was treated as empty');
  const positional = mod.parseTaleoResponse({ requisitionList: [{ jobId: '2603', column: ['Positional title', 'Vancouver', '2026-09-02'] }] }, { url: new URL(url), section: 'demo' }, [], 'X');
  if (positional.length === 1 && positional[0].title === 'Positional title' && positional[0].location === 'Vancouver') pass('uses positional columns when the shell has no headings'); else fail('positional column fallback failed');
  const detailHtml = '<script type="application/ld+json">{"@type":"JobPosting","description":"%3Cp%3EBuild%20R%26amp%3BD%20systems.%3C%2Fp%3E"}</script>';
  if (mod.parseTaleoDetail(detailHtml) === 'Build R&D systems.') pass('decodes URL-encoded HTML from public detail JSON-LD'); else fail('detail description parsing failed');
  let calls = [];
  let sleepCalls = 0;
  const ctx = {
    fetchText: async (u, o) => { calls.push(['text', u, o]); return u === url ? shell : detailHtml; },
    fetchJson: async (u, o) => { calls.push(['json', u, o]); return response; },
    sleep: async () => { sleepCalls++; },
  };
  const fetched = await provider.fetch({ name: 'Example', careers_url: url, fetchDetails: true }, ctx);
  if (fetched.length === 2 && fetched.every((job) => job.description === 'Build R&D systems.') && calls.length === 4 && calls[0][1] === url && calls[0][2].redirect === 'error' && calls[1][2].redirect === 'error' && calls.slice(2).every((call) => call[2].redirect === 'error') && JSON.parse(calls[1][2].body).pageNo === 1) pass('fetches shell + search + bounded public details with redirect:error'); else fail(`fetch contract failed ${JSON.stringify(calls)}`);
  if (sleepCalls === 1) pass('paces detail requests through the shared clock'); else fail(`unexpected detail pacing calls: ${sleepCalls}`);
  let noDetailCalls = 0;
  const noDetails = await provider.fetch({ name: 'NoOptIn', careers_url: url }, {
    fetchText: async (u) => { if (u !== url) noDetailCalls++; return u === url ? shell : detailHtml; },
    fetchJson: async () => response,
    sleep: async () => {},
  });
  if (noDetails.length === 2 && noDetailCalls === 0) pass('does not fetch details without explicit fetchDetails opt-in'); else fail(`detail opt-in failed: ${noDetailCalls}`);
  let guarded = false;
  let guardCalls = 0;
  const guardCtx = { fetchText: async () => { guardCalls++; throw new Error('must not fetch'); }, fetchJson: async () => { guardCalls++; throw new Error('must not fetch'); } };
  try { await provider.fetch({ name: 'X', careers_url: 'https://evil.example/careersection/demo/jobsearch.ftl' }, guardCtx); } catch { guarded = guardCalls === 0; }
  if (guarded) pass('SSRF guard rejects untrusted host before fetch'); else fail('SSRF guard failed');

  // A public board with no postings is a valid empty result, while a shell
  // without the portal id is a private/unavailable board and must be loud.
  const emptyCtx = { fetchText: async () => shell, fetchJson: async () => ({ requisitionList: [], pagingData: { totalCount: 0, pageSize: 25 } }) };
  const empty = await provider.fetch({ name: 'EmptyCo', careers_url: url }, emptyCtx);
  if (empty.length === 0) pass('valid public zero-result board returns []'); else fail('zero-result board should be empty');
  let unavailable = false;
  try { await provider.fetch({ name: 'PrivateCo', careers_url: url }, { fetchText: async () => '<html><title>Sign in</title></html>', fetchJson: async () => response }); } catch (e) { unavailable = /portal id|private|unavailable/i.test(e.message); }
  if (unavailable) pass('private/unavailable shell without portal id throws descriptively'); else fail('private shell should not look like zero jobs');

  // Pagination is bounded independently from the source total and cooperates
  // with verify-portals probes through ctx.maxPages.
  const pageOne = { requisitionList: [{ jobId: '1', column: ['One', 'Toronto', '2026-09-01'] }], pagingData: { totalCount: 2, pageSize: 1 } };
  const pageTwo = { requisitionList: [{ jobId: '2', column: ['Two', 'London', '2026-09-02'] }], pagingData: { totalCount: 2, pageSize: 1 } };
  const pageCalls = [];
  const pagedCtx = { fetchText: async () => shell, fetchJson: async (u, o) => { const p = JSON.parse(o.body).pageNo; pageCalls.push(p); return p === 1 ? pageOne : pageTwo; }, sleep: async () => {} };
  const paged = await provider.fetch({ name: 'PagedCo', careers_url: url }, pagedCtx);
  if (paged.length === 2 && pageCalls.join(',') === '1,2') pass('fetches a second JSON page when pagingData reports more rows'); else fail(`pagination failed: ${pageCalls.join(',')} / ${paged.length}`);
  const noClockPages = [];
  const noClock = await provider.fetch({ name: 'NoClockCo', careers_url: url }, { fetchText: async () => shell, fetchJson: async (u, o) => { const p = JSON.parse(o.body).pageNo; noClockPages.push(p); return p === 1 ? pageOne : pageTwo; } });
  if (noClock.length === 2 && noClockPages.join(',') === '1,2') pass('pagination uses shared sleep fallback when ctx.sleep is absent'); else fail(`sleep fallback failed: ${noClockPages} / ${noClock.length}`);
  pageCalls.length = 0;
  let probeDetailCalls = 0;
  const probed = await provider.fetch({ name: 'PagedCo', careers_url: url, max_pages: 100, fetchDetails: true }, {
    ...pagedCtx,
    fetchText: async (u) => { if (u !== url) probeDetailCalls++; return shell; },
    maxPages: 1,
  });
  if (probed.length === 1 && pageCalls.join(',') === '1' && probeDetailCalls === 0) pass('ctx.maxPages: 1 limits probe to one list request and skips details'); else fail(`probe page budget/details failed: ${pageCalls} / ${probeDetailCalls}`);

  // A malformed row must not make a full raw page look short and hide a
  // valid job on the following page.
  const malformedPage = { requisitionList: [
    { jobId: '', column: ['Malformed', 'X', ''] },
    { jobId: '3', column: ['Three', 'Ottawa', '2026-09-03'] },
  ], pagingData: { totalCount: 3, pageSize: 2 } };
  const laterPage = { requisitionList: [{ jobId: '4', column: ['Four', 'Montreal', '2026-09-04'] }], pagingData: { totalCount: 3, pageSize: 2 } };
  const malformedCalls = [];
  const survived = await provider.fetch({ name: 'MalformedCo', careers_url: url }, {
    maxPages: 2,
    fetchText: async () => shell,
    fetchJson: async (u, o) => { const page = JSON.parse(o.body).pageNo; malformedCalls.push(page); return page === 1 ? malformedPage : laterPage; },
    sleep: async () => {},
  });
  if (survived.length === 2 && malformedCalls.join(',') === '1,2') pass('raw page length, not normalized rows, controls short-page termination'); else fail(`malformed-row pagination failed: ${malformedCalls} / ${survived.length}`);

  let boundedDetails = 0;
  const bounded = await provider.fetch({ name: 'BoundedCo', careers_url: url, fetchDetails: true, detailLimit: 1 }, {
    fetchText: async (u) => { if (u === url) return shell; boundedDetails++; return detailHtml; },
    fetchJson: async () => response,
    sleep: async () => {},
  });
  if (boundedDetails === 1 && bounded[0].description && !bounded[1].description) pass('normal detail enrichment honors detailLimit'); else fail(`detail limit failed: ${boundedDetails}`);

  const failedDetail = await provider.fetch({ name: 'FailedDetailCo', careers_url: url, fetchDetails: true }, {
    fetchText: async (u) => {
      if (u === url) return shell;
      if (u.includes('R-1')) { const e = new Error('not found'); e.status = 404; throw e; }
      return detailHtml;
    },
    fetchJson: async () => response,
    sleep: async () => {},
  });
  if (failedDetail.length === 2 && !failedDetail[0].description && failedDetail[1].description === 'Build R&D systems.') pass('failed detail enrichment keeps the listing and continues'); else fail(`failed detail was fatal or lost later descriptions: ${JSON.stringify(failedDetail)}`);

  // Retryable transport failures use the shared retry helper; a probe error is
  // allowed to propagate so callers retain their page-budget identity.
  let attempts = 0;
  const retried = await provider.fetch({ name: 'RetryCo', careers_url: url }, {
    fetchText: async () => shell,
    fetchJson: async () => { attempts++; if (attempts === 1) { const e = new Error('temporary'); e.status = 503; throw e; } return response; },
    sleep: async () => {},
  });
  if (retried.length === 2 && attempts === 2) pass('retries transient 503 once and returns parsed jobs'); else fail(`retry path failed: attempts=${attempts}`);
  const probeError = new Error('ProbePageBudgetReached');
  let sameError = false;
  try { await provider.fetch({ name: 'ProbeErrorCo', careers_url: url }, { maxPages: 1, fetchText: async () => shell, fetchJson: async () => { throw probeError; } }); } catch (e) { sameError = e === probeError; }
  if (sameError) pass('probe fetch errors propagate with original identity'); else fail('probe error was swallowed or wrapped');

  // A page can under-report relative to the board's own advertised pageSize
  // (e.g. Taleo reports pageSize: 25 but returns only 14 rows on page 1).
  // That must not be mistaken for end-of-results while totalCount says
  // there's more — pagination should keep going until the accumulated row
  // count reaches totalCount (or the maxPages ceiling).
  const shortFirstPage = {
    requisitionList: Array.from({ length: 14 }, (_, i) => ({ jobId: `f${i}`, column: [`First ${i}`, 'Calgary', '2026-09-01'] })),
    pagingData: { totalCount: 30, pageSize: 25 },
  };
  const fullerSecondPage = {
    requisitionList: Array.from({ length: 16 }, (_, i) => ({ jobId: `s${i}`, column: [`Second ${i}`, 'Edmonton', '2026-09-02'] })),
    pagingData: { totalCount: 30, pageSize: 25 },
  };
  const underReportCalls = [];
  const underReport = await provider.fetch({ name: 'UnderReportCo', careers_url: url }, {
    fetchText: async () => shell,
    fetchJson: async (u, o) => { const p = JSON.parse(o.body).pageNo; underReportCalls.push(p); return p === 1 ? shortFirstPage : fullerSecondPage; },
    sleep: async () => {},
  });
  if (underReport.length === 30 && underReportCalls.join(',') === '1,2') pass('keeps paginating when a page under-reports vs. its own pageSize but totalCount is not yet reached'); else fail(`under-reported page size terminated pagination early: ${underReportCalls.join(',')} / ${underReport.length}`);

  // Taleo's location column sometimes carries the raw JSON-encoded array the
  // UI groups multi-location postings from, instead of plain text.
  const jsonLocationResponse = { requisitionList: [
    { jobId: 'loc-1', column: ['Single Location Role', '["AB-Calgary"]', '2026-09-01'] },
    { jobId: 'loc-2', column: ['Multi Location Role', '["AB-Calgary","AB-Edmonton"]', '2026-09-02'] },
    { jobId: 'loc-3', column: ['Plain Location Role', 'Toronto', '2026-09-03'] },
  ] };
  const locationJobs = mod.parseTaleoResponse(jsonLocationResponse, { url: new URL(url), section: 'demo' }, mod.extractHeadings(shell), 'Example');
  if (locationJobs[0].location === 'AB-Calgary') pass('parses a single-element JSON location array into plain text'); else fail(`single JSON location array not parsed: ${JSON.stringify(locationJobs[0])}`);
  if (locationJobs[1].location === 'AB-Calgary; AB-Edmonton') pass('joins a multi-element JSON location array with "; "'); else fail(`multi JSON location array not joined: ${JSON.stringify(locationJobs[1])}`);
  if (locationJobs[2].location === 'Toronto') pass('leaves a plain-string location unchanged'); else fail(`plain location was altered: ${JSON.stringify(locationJobs[2])}`);
} catch (e) { fail(`taleo provider tests crashed: ${e.message}`); }
