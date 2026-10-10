// tests/providers/pageup.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';

console.log('\nProvider — pageup');

const mod = await import(pathToFileURL(join(ROOT, 'providers/pageup.mjs')).href);
const pageup = mod.default;
const { parsePageupListing } = mod;

const ORIGIN = 'https://careers.pageuppeople.com';
const CFG = { tenant: '932', site: 'cw', lang: 'en' };
const LISTING = `${ORIGIN}/932/cw/en/listing/`;

// A four-column tenant's row (ref, title, department, closing date), followed
// by the commented-out duplicate row real pages carry.
const listingRow = (id, slug, title) => `
    <tr>
      <td><span class="job-externalJobNo">${id}</span></td>
      <td><a class="job-link" href="/932/cw/en/job/${id}/${slug}">${title}</a></td>
      <td>School of Nursing (20800)</td>
      <td><span class="close-date"><time datetime="2026-11-26T15:55:00Z">Nov 26, 2026 </time></span></td>
    </tr>
    <!--
    <tr class="summary"><td><a class="job-link" href="/932/cw/en/job/9${id}/commented">Commented ${title}</a></td></tr>
-->`;
// The results table, the "More Jobs" link after it, and the hidden recent-jobs
// block that repeats postings outside the table.
const listingPage = (rows, { more = false } = {}) => `<html><body>
  <div id="search-results"><table><thead><tr><th>Ref.</th><th>Posting Title</th></tr></thead>
  <tbody id="search-results-content">${rows}</tbody></table>
  ${more ? '<p><a href="/932/cw/en/listing/?page=2&page-items=100" class="more-link button" data-page="2">More</a></p>' : ''}
  </div>
  <div id="recent-jobs"><a class="job-link" href="/932/cw/en/job/900001/hidden-duplicate">Hidden Duplicate</a></div>
</body></html>`;

// A two-column tenant (position, department), href before a themed class list.
const TWO_COLUMN_PAGE = `<table><tbody id="search-results-content">
    <tr><td><a href="/798/cw/en/job/500136/investment-manager" class="themed job-link">Investment Manager</a><br></td>
        <td>BOCHK Asset Management Ltd</td></tr>
  </tbody></table>`;

const EMPTY_PAGE = '<table><tbody id="search-results-content"></tbody></table>';
const CHALLENGE_PAGE = '<html><body>In order to continue, we need to verify that you are not a robot.</body></html>';

/** The rejection of a promise, or null if it resolved. */
const rejection = async (promise) => { try { await promise; } catch (err) { return err; } return null; };

if (pageup.id === 'pageup') pass('pageup.id is "pageup"');
else fail(`pageup.id is ${JSON.stringify(pageup.id)}`);

// ── detect() ───────────────────────────────────────────────────────────────
{
  const want = `${ORIGIN}/932/cw/en/listing/?page=1&page-items=100`;
  const hit = pageup.detect({ name: 'HKU', careers_url: LISTING });
  if (hit && hit.url === want) pass('detect() resolves the listing URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);

  // The URL a user actually has: a posting link, or a listing with a query.
  const fromJob = pageup.detect({ name: 'HKU', careers_url: `${ORIGIN}/932/cw/en/job/537527` });
  if (fromJob && fromJob.url === want) pass('detect() claims a posting URL and resolves it to the listing');
  else fail(`detect() on a posting URL returned ${JSON.stringify(fromJob)}`);

  const localized = pageup.detect({ name: 'BOCHK', careers_url: `${ORIGIN}/798/cw/zh-c/listing/?jobnotfound=true` });
  if (localized && localized.url === `${ORIGIN}/798/cw/zh-c/listing/?page=1&page-items=100`) pass('detect() keeps the tenant, site and locale');
  else fail(`detect() on a localized URL returned ${JSON.stringify(localized)}`);

  const viaApi = pageup.detect({ name: 'X', api: LISTING, careers_url: 'https://example.com/careers' });
  if (viaApi && viaApi.url === want) pass('detect() reads entry.api ahead of careers_url');
  else fail(`detect() via api returned ${JSON.stringify(viaApi)}`);

  const rejects = [
    ['a branded tenant domain', { careers_url: 'https://jobs.hku.hk/cw/en/listing/' }],
    ['plain http', { careers_url: 'http://careers.pageuppeople.com/932/cw/en/listing/' }],
    ['a lookalike host', { careers_url: 'https://careers.pageuppeople.com.evil.example/932/cw/en/listing/' }],
    ['a non-numeric tenant', { careers_url: `${ORIGIN}/admin/cw/en/listing/` }],
    ['a path with no locale', { careers_url: `${ORIGIN}/932/cw` }],
    ['a malformed URL', { careers_url: 'not a url' }],
    ['a null careers_url', { careers_url: null }],
    ['a non-string careers_url', { careers_url: 42 }],
    ['a missing careers_url', {}],
  ];
  for (const [label, entry] of rejects) {
    let got;
    try { got = pageup.detect({ name: 'X', ...entry }); } catch (err) { got = err; }
    if (got === null) pass(`detect() null for ${label}`);
    else fail(`detect() for ${label} returned ${got instanceof Error ? `a throw: ${got.message}` : JSON.stringify(got)}`);
  }
}

// ── parsePageupListing() ───────────────────────────────────────────────────
{
  const html = listingPage(
    listingRow('537501', 'clerical-assistant', 'Clerical Assistant') +
    listingRow('537485', 'admin', 'Director (Global Communications &amp; Engagement)') +
    listingRow('537454', 'lecturer', 'Lecturer&nbsp;in   Public <b>Health</b>'),
    { more: true },
  );
  const parsed = parsePageupListing(html, CFG, 'HKU');
  if (parsed.valid && parsed.jobs.length === 3) pass('parses the results table only (hidden recent-jobs block and commented rows ignored)');
  else fail(`expected 3 jobs, got ${JSON.stringify(parsed.jobs.map(j => j.url))}`);
  if (parsed.linkCount === 3) pass('linkCount counts the table\'s live posting anchors');
  else fail(`linkCount = ${parsed.linkCount}`);
  if (parsed.hasMore === true) pass('sees the "More Jobs" link');
  else fail('hasMore was false on a page with a more-link');

  const [first, second, third] = parsed.jobs;
  if (first.url === `${ORIGIN}/932/cw/en/job/537501`) pass('url is rebuilt from the numeric id, slug dropped');
  else fail(`url: ${first.url}`);
  if (first.company === 'HKU' && first.location === '' && first.postedAt === undefined) pass('company passed through; no location, no postedAt');
  else fail(`row shape: ${JSON.stringify(first)}`);
  if (second.title === 'Director (Global Communications & Engagement)') pass('title entities decoded');
  else fail(`title: ${JSON.stringify(second.title)}`);
  if (third.title === 'Lecturer in Public Health') pass('title whitespace and inline tags collapsed');
  else fail(`title: ${JSON.stringify(third.title)}`);
}

{
  const parsed = parsePageupListing(TWO_COLUMN_PAGE, { tenant: '798', site: 'cw', lang: 'zh-c' }, 'BOCHK');
  if (parsed.jobs.length === 1 && parsed.jobs[0].url === `${ORIGIN}/798/cw/zh-c/job/500136` && parsed.jobs[0].title === 'Investment Manager') {
    pass('parses a two-column tenant with href before a themed class list');
  } else fail(`two-column parse: ${JSON.stringify(parsed.jobs)}`);
  if (parsed.hasMore === false) pass('no "More Jobs" link reads as hasMore=false');
  else fail('hasMore was true without a more-link');

  const commentedMore = `${EMPTY_PAGE}<!-- <a class="more-link" href="?page=2">More</a> -->`;
  if (parsePageupListing(commentedMore, CFG, 'HKU').hasMore === false) pass('a commented-out more-link is not counted');
  else fail('commented-out more-link read as hasMore');
}

{
  const mixed = listingPage(
    listingRow('1', 'ok', 'Kept') +
    '<tr><td>No link in this row</td></tr>' +
    '<tr><td><a class="job-link" href="https://evil.example.com/932/cw/en/job/2/x">Off host</a></td></tr>' +
    '<tr><td><a class="job-link" href="//evil.example.com/932/cw/en/job/3/x">Protocol relative</a></td></tr>' +
    '<tr><td><a class="job-link" href="/555/cw/en/job/4/x">Other tenant</a></td></tr>' +
    '<tr><td><a class="job-link" href="/932/cw/en/job/5/x">   </a></td></tr>' +
    '<tr><td><a class="job-link-extra" href="/932/cw/en/job/6/x">Longer class token</a></td></tr>' +
    '<tr><td><a class="job-link" href="/932/cw/en/job/7/x">Never closed</td></tr>',
  );
  const parsed = parsePageupListing(mixed, CFG, 'HKU');
  if (parsed.jobs.length === 1 && parsed.jobs[0].title === 'Kept') pass('rows without a same-tenant job link or a title are skipped');
  else fail(`bad rows leaked: ${JSON.stringify(parsed.jobs)}`);
  if (parsed.linkCount === 6) pass('linkCount includes the rows dropped as malformed');
  else fail(`linkCount with malformed rows = ${parsed.linkCount}`);

  // An anchor that never closes must not take the next posting's title.
  const unclosed = '<tbody id="search-results-content">' +
    '<tr><td><a class="job-link" href="/932/cw/en/job/7/x">Never closed</td></tr>' +
    '<tr><td><a class="job-link" href="/932/cw/en/job/8/y">Eight</a></td></tr></tbody>';
  const afterUnclosed = parsePageupListing(unclosed, CFG, 'HKU');
  if (afterUnclosed.jobs.length === 1 && afterUnclosed.jobs[0].title === 'Eight' && afterUnclosed.jobs[0].url.endsWith('/job/8')) {
    pass('an unclosed anchor is dropped without swallowing the next row');
  } else fail(`unclosed anchor: ${JSON.stringify(afterUnclosed.jobs)}`);

  const upper = '<TBODY ID="search-results-content"><TR><TD>' +
    '<A CLASS="job-link" HREF="/932/cw/en/job/42/x">Upper Case</A></TD></TR></TBODY>' +
    '<A CLASS="more-link" HREF="?page=2">More</A>';
  const fromUpper = parsePageupListing(upper, CFG, 'HKU');
  if (fromUpper.jobs.length === 1 && fromUpper.jobs[0].title === 'Upper Case' && fromUpper.hasMore === true) pass('uppercase tags and attributes parse');
  else fail(`uppercase markup: ${JSON.stringify(fromUpper)}`);

  const dataHref = '<tbody id="search-results-content"><tr><td>' +
    '<a data-href="/932/cw/en/job/111/wrong" href="/932/cw/en/job/222/right" class="job-link">Right</a></td></tr></tbody>';
  const fromData = parsePageupListing(dataHref, CFG, 'HKU');
  if (fromData.jobs.length === 1 && fromData.jobs[0].url.endsWith('/job/222')) pass('href is not confused with data-href');
  else fail(`data-href: ${JSON.stringify(fromData.jobs)}`);
}

{
  const empty = parsePageupListing(EMPTY_PAGE, CFG, 'HKU');
  if (empty.valid && empty.jobs.length === 0 && empty.linkCount === 0) pass('an empty results table is valid with no jobs');
  else fail(`empty table: ${JSON.stringify(empty)}`);

  const messageRow = parsePageupListing('<tbody id="search-results-content"><tr><td>No jobs found</td></tr></tbody>', CFG, 'HKU');
  if (messageRow.valid && messageRow.jobs.length === 0) pass('a "no jobs found" message row is still an empty board');
  else fail(`message row: ${JSON.stringify(messageRow)}`);

  const challenge = parsePageupListing(CHALLENGE_PAGE, CFG, 'HKU');
  if (challenge.valid === false && challenge.reason === 'no-table') pass('a page with no results table is invalid, not empty');
  else fail(`challenge page: ${JSON.stringify(challenge)}`);

  const drifted = parsePageupListing('<tbody id="search-results-content"><tr><td><a class="posting" href="/932/cw/en/job/1/x">Renamed</a></td></tr></tbody>', CFG, 'HKU');
  if (drifted.valid === false && drifted.reason === 'no-jobs-parsed') pass('posting links with nothing parsed is invalid, not empty');
  else fail(`drifted markup: ${JSON.stringify(drifted)}`);

  // The anchors kept their class but lost the posting path.
  const deadLinks = parsePageupListing('<tbody id="search-results-content"><tr><td><a class="job-link" href="#">Role</a></td></tr></tbody>', CFG, 'HKU');
  if (deadLinks.valid === false && deadLinks.reason === 'no-jobs-parsed') pass('job-link anchors with no posting path are invalid, not empty');
  else fail(`dead links: ${JSON.stringify(deadLinks)}`);

  for (const junk of [null, undefined, '']) {
    let threw = false;
    try { parsePageupListing(junk, CFG, 'HKU'); } catch { threw = true; }
    if (!threw) pass(`${JSON.stringify(junk) ?? 'undefined'} input does not throw`);
    else fail(`parsePageupListing threw on ${JSON.stringify(junk)}`);
  }

  // Broken pages — unclosed tags, comments and anchors — must parse in linear
  // time. Each shape was quadratic or worse under a regex-per-row parser.
  const TABLE = '<tbody id="search-results-content"><tr>';
  const anchors = Array.from({ length: 20000 }, (_, i) => `<a class="job-link" href="/932/cw/en/job/${i}/x">Role ${i}`).join('');
  const hostile = [
    ['unclosed tags and comments', TABLE + '<a class="job-link'.repeat(20000) + '<!--'.repeat(20000) + '</tbody>'],
    ['anchors that never close', TABLE + anchors + '</tbody>'],
    ['anchors with one close at the very end', TABLE + anchors + '</a></tbody>'],
    ['unclosed tags after the table', TABLE + '</tbody><a class="more-link' + '<a class="x'.repeat(20000)],
  ];
  for (const [label, page] of hostile) {
    const t0 = Date.now();
    const broken = parsePageupListing(page, CFG, 'HKU');
    const elapsed = Date.now() - t0;
    if (broken.jobs.length <= 1 && elapsed < 1000) pass(`${label} do not blow up the parser`);
    else fail(`${label}: ${elapsed}ms, ${broken.jobs.length} jobs`);
  }
}

// ── fetch() ────────────────────────────────────────────────────────────────
const entry = { name: 'HKU', careers_url: LISTING };
// `n` rows whose ids start at `from`.
const pageOfRows = (from, n, opts) =>
  listingPage(Array.from({ length: n }, (_, i) => listingRow(String(from + i), 'x', `Role ${from + i}`)).join(''), opts);
const recorder = (respond) => {
  const calls = [];
  return {
    calls,
    async sleep() {},
    async fetchText(url, opts) { calls.push({ url, opts }); return respond(url, calls.length); },
  };
};
const pageNum = url => Number(new URL(url).searchParams.get('page'));
// Every page full with a more-link, so only a page ceiling can stop the walk.
const endless = () => recorder(url => pageOfRows(pageNum(url) * 1000, 100, { more: true }));

{
  // Two pages: a full one with a more-link, then a short last one.
  const ctx = recorder(url => (pageNum(url) === 1 ? pageOfRows(1000, 100, { more: true }) : pageOfRows(2000, 7)));
  const jobs = await pageup.fetch(entry, ctx);
  if (jobs.length === 107) pass('fetch() walks pages until a short page with no more-link');
  else fail(`expected 107 jobs, got ${jobs.length}`);
  if (ctx.calls.length === 2 && pageNum(ctx.calls[1].url) === 2) pass('fetch() requests page 1 then page 2, and stops');
  else fail(`requests: ${JSON.stringify(ctx.calls.map(c => c.url))}`);
  if (ctx.calls.every(c => c.opts?.redirect === 'error')) pass('every request passes redirect: "error"');
  else fail(`redirect opts: ${JSON.stringify(ctx.calls.map(c => c.opts))}`);
  if (ctx.calls.every(c => new URL(c.url).searchParams.get('page-items') === '100')) pass('every request asks for page-items=100');
  else fail('page-items missing from a request');
}

{
  // A tenant that clamps page-items: short pages, but the more-link says go on.
  const ctx = recorder(url => (pageNum(url) < 3 ? pageOfRows(pageNum(url) * 1000, 20, { more: true }) : pageOfRows(3000, 5)));
  const jobs = await pageup.fetch(entry, ctx);
  if (jobs.length === 45 && ctx.calls.length === 3) pass('a short page with a more-link keeps paginating');
  else fail(`clamped tenant: ${jobs.length} jobs in ${ctx.calls.length} requests`);
}

{
  // A tenant that repeats its last page for an out-of-range `page`.
  const ctx = recorder(() => pageOfRows(1000, 100, { more: true }));
  const jobs = await pageup.fetch(entry, ctx);
  if (jobs.length === 100 && ctx.calls.length === 2) pass('a repeated page ends the walk instead of looping to the ceiling');
  else fail(`repeat guard: ${jobs.length} jobs in ${ctx.calls.length} requests`);
}

{
  // Pages that overlap: postings shift down a page when one is added mid-scan.
  const ctx = recorder(url => (pageNum(url) === 1 ? pageOfRows(1000, 100, { more: true }) : pageOfRows(1090, 30)));
  const jobs = await pageup.fetch(entry, ctx);
  if (jobs.length === 120 && new Set(jobs.map(j => j.url)).size === 120) pass('postings repeated across pages are returned once');
  else fail(`overlapping pages: ${jobs.length} jobs`);
}

{
  const ctx = recorder(() => EMPTY_PAGE);
  const jobs = await pageup.fetch(entry, ctx);
  if (Array.isArray(jobs) && jobs.length === 0 && ctx.calls.length === 1) pass('an empty, well-formed board returns []');
  else fail(`empty board: ${JSON.stringify(jobs)} in ${ctx.calls.length} requests`);
}

{
  let err = await rejection(pageup.fetch(entry, recorder(() => CHALLENGE_PAGE)));
  if (err && /no search-results table/.test(err.message)) pass('fetch() throws on a first page with no results table');
  else fail(`challenge page: ${err ? err.message : 'returned without throwing'}`);

  const drifted = '<tbody id="search-results-content"><tr><td><a class="posting" href="/932/cw/en/job/1/x">Renamed</a></td></tr></tbody>';
  err = await rejection(pageup.fetch(entry, recorder(() => drifted)));
  if (err && /markup changed/.test(err.message)) pass('fetch() throws when posting links are present but none parse');
  else fail(`markup drift: ${err ? err.message : 'returned without throwing'}`);

  err = await rejection(pageup.fetch({ name: 'X', careers_url: 'https://jobs.hku.hk/cw/en/listing/' }, recorder(() => EMPTY_PAGE)));
  if (err && /cannot derive/.test(err.message)) pass('fetch() throws on an entry it cannot resolve');
  else fail(`unresolvable entry: ${err ? err.message : 'returned without throwing'}`);

  // A tenant that has moved off the vendor host: redirect:'error' refuses the
  // 3xx, and the provider says why instead of surfacing a bare "fetch failed".
  const refused = Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') });
  const moved = recorder(() => { throw refused; });
  err = await rejection(pageup.fetch(entry, moved));
  if (err && /redirects away/.test(err.message) && err.cause === refused && moved.calls.length === 1) {
    pass('a refused redirect on the first page is reported as a moved tenant, unretried');
  } else fail(`refused redirect: ${err ? err.message : 'returned without throwing'} (${moved.calls.length} requests)`);

  // A first-page failure is never an empty board.
  const boom = Object.assign(new Error('HTTP 404'), { status: 404 });
  err = await rejection(pageup.fetch(entry, recorder(() => { throw boom; })));
  if (err === boom) pass('a first-page fetch error propagates');
  else fail(`first-page error: ${err && err.message}`);
}

// ── the page ceiling ───────────────────────────────────────────────────────
{
  const dflt = endless();
  const { errors } = await captureConsoleErrors(() => pageup.fetch(entry, dflt));
  if (dflt.calls.length === 20) pass('fetch() stops at the default 20-page ceiling');
  else fail(`default ceiling: ${dflt.calls.length} requests`);
  if (errors.some(w => /raise max_pages/.test(w))) pass('hitting the ceiling warns to raise max_pages');
  else fail(`no ceiling warning: ${JSON.stringify(errors)}`);
}

{
  const small = endless();
  const { result: jobs } = await captureConsoleErrors(() => pageup.fetch({ ...entry, max_pages: 3 }, small));
  if (small.calls.length === 3 && jobs.length === 300) pass('entry.max_pages lowers the ceiling');
  else fail(`max_pages: 3 → ${small.calls.length} requests, ${jobs.length} jobs`);

  const huge = endless();
  await captureConsoleErrors(() => pageup.fetch({ ...entry, max_pages: 100000 }, huge));
  if (huge.calls.length === 200) pass('entry.max_pages is clamped to the hard cap');
  else fail(`max_pages: 100000 → ${huge.calls.length} requests`);
}

// A later page going wrong keeps the pages already collected, and is not
// reported as a max_pages truncation.
for (const [label, laterPage] of [
  ['a later-page fetch error', () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }); }],
  ['a later-page refused redirect', () => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') }); }],
  ['a later page with no results table', () => CHALLENGE_PAGE],
]) {
  const ctx = recorder(url => (pageNum(url) === 1 ? pageOfRows(1000, 100, { more: true }) : laterPage()));
  const { result: jobs, errors } = await captureConsoleErrors(() => pageup.fetch(entry, ctx));
  if (jobs.length === 100) pass(`${label} keeps the earlier pages`);
  else fail(`${label}: ${jobs.length} jobs`);
  if (errors.length === 1 && !/raise max_pages/.test(errors[0])) pass(`${label} warns once, not about max_pages`);
  else fail(`${label} warnings: ${JSON.stringify(errors)}`);
}

// ── ctx.maxPages (verify-portals health probe) ─────────────────────────────
{
  const probe = endless();
  const { errors } = await captureConsoleErrors(() => pageup.fetch({ ...entry, max_pages: 10 }, { ...probe, maxPages: 1 }));
  if (probe.calls.length === 1) pass('fetch() honours ctx.maxPages=1 even when max_pages says 10');
  else fail(`ctx.maxPages=1 issued ${probe.calls.length} requests`);
  if (errors.length === 0) pass('a probe cut-off does not warn about max_pages');
  else fail(`probe warned: ${JSON.stringify(errors)}`);

  // While probing, a rejection must propagate UNWRAPPED and unretried so
  // verify-portals' `err instanceof ProbePageBudgetReached` still works.
  class FakeSentinel extends Error {}
  let attempts = 0;
  const sentinel = await rejection(
    pageup.fetch(entry, { async sleep() {}, maxPages: 1, async fetchText() { attempts++; throw new FakeSentinel(); } }),
  );
  if (sentinel instanceof FakeSentinel) pass('fetch() propagates a probe sentinel unwrapped');
  else fail(`probe sentinel = ${sentinel && sentinel.constructor.name}`);
  if (attempts === 1) pass('fetch() does not retry while probing');
  else fail(`probe sentinel took ${attempts} requests`);
}
