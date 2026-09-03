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
  for (const bad of ['http://example.taleo.net/careersection/demo/jobsearch.ftl', 'https://evil.example/careersection/demo/jobsearch.ftl', 'https://example.taleo.net/careersection/demo/login.ftl', null, 7]) {
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
  if (jobs[0].url.includes('/jobdetail.ftl?job=2601') && jobs[1].title === '& Engineer') pass('builds detail URLs and decodes HTML entities'); else fail('detail URL/entity parsing failed');
  if (mod.parseTaleoResponse({}, { url: new URL(url), section: 'demo' }, [], 'X').length === 0) pass('malformed/empty response → []'); else fail('malformed response not empty');
  let calls = [];
  const ctx = { fetchText: async (u, o) => { calls.push(['text', u, o]); return shell; }, fetchJson: async (u, o) => { calls.push(['json', u, o]); return response; } };
  const fetched = await provider.fetch({ name: 'Example', careers_url: url }, ctx);
  if (fetched.length === 2 && calls.length === 2 && calls[0][1] === url && calls[1][2].redirect === 'error' && JSON.parse(calls[1][2].body).pageNo === 1) pass('fetches shell + zero-auth JSON search with redirect:error'); else fail(`fetch contract failed ${JSON.stringify(calls)}`);
  let guarded = false;
  try { await provider.fetch({ name: 'X', careers_url: 'https://evil.example/careersection/demo/jobsearch.ftl' }, ctx); } catch { guarded = calls.length === 2; }
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
  pageCalls.length = 0;
  const probed = await provider.fetch({ name: 'PagedCo', careers_url: url, max_pages: 100 }, { ...pagedCtx, maxPages: 1 });
  if (probed.length === 1 && pageCalls.join(',') === '1') pass('ctx.maxPages: 1 limits probe to exactly one list request'); else fail('probe page budget was ignored');

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
} catch (e) { fail(`taleo provider tests crashed: ${e.message}`); }
