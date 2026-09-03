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
} catch (e) { fail(`taleo provider tests crashed: ${e.message}`); }
