// tests/providers/adp-myjobs.test.mjs
// ADP Recruiting Management "myjobs" career sites (myjobs.adp.com/{site}/cx/...).
import assert from 'node:assert/strict';
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — adp-myjobs (ADP Recruiting Management myjobs)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/adp-myjobs.mjs')).href);
  const adp = mod.default;
  const { parseListPage, extractLocation, buildPostingUrl, resolveSite } = mod;

  const ORGOID = 'ABCDEFGH12345678';
  const CAREERS_URL = 'https://myjobs.adp.com/examplesite/cx/job-listing';
  const entry = { name: 'ExampleCo', careers_url: CAREERS_URL };
  const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

  check(adp.id === 'adp-myjobs', 'adp-myjobs.id is "adp-myjobs"');

  // ── detect() ──────────────────────────────────────────────────────────────
  check(adp.detect(entry)?.url.startsWith('https://myjobs.adp.com/public/staffing/v1/job-requisitions'), 'detect() claims a myjobs.adp.com/{site}/cx/... URL');
  check(adp.detect({ name: 'X', careers_url: 'https://myjobs.adp.com/examplesite' }) !== null, 'detect() claims the bare site root');
  check(adp.detect({ name: 'X', careers_url: 'https://myjobs.adp.com/examplesite/cx/job-details?rb=CareerSite&reqId=5001' }) !== null, 'detect() claims a job-details permalink');
  check(adp.detect({ name: 'X', careers_url: 'https://example.com/careers', api: CAREERS_URL }) !== null, 'detect() honors api: over a non-ADP careers_url');
  for (const bad of [
    'https://evil.com/myjobs.adp.com/examplesite/cx',
    'https://myjobs.adp.com.evil.com/examplesite/cx',
    'http://myjobs.adp.com/examplesite/cx',
    'https://myjobs.adp.com/',
    'https://myjobs.adp.com/public/staffing/v1/job-requisitions',
    'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=a&ccId=b',
    'not a url', '', null, undefined, 42,
  ]) {
    let r; try { r = adp.detect({ name: 'X', careers_url: bad }); } catch { r = 'threw'; }
    check(r === null, `detect() returns null for ${JSON.stringify(bad)}`);
  }
  check(adp.detect({ name: 'X' }) === null && adp.detect(null) === null, 'detect() tolerates a missing careers_url and a null entry');
  check(resolveSite({ careers_url: 'https://MyJobs.ADP.com/Apply/cx' }) === 'Apply', 'resolveSite() keeps the slug as written, matches the host case-insensitively');

  // ── pure helpers ─────────────────────────────────────────────────────────
  check(buildPostingUrl('apply', '5001236109606') === 'https://myjobs.adp.com/apply/cx/job-details?rb=CareerSite&reqId=5001236109606', 'buildPostingUrl() builds the public job-details URL with the site slug');
  check(buildPostingUrl('apply', '\uD800') === null, 'buildPostingUrl() drops a lone-surrogate reqId');
  check(extractLocation({ requisitionLocations: [
    { address: { cityName: 'Stamford', countrySubdivisionLevel1: { codeValue: 'CT', longName: 'Connecticut' }, country: { codeValue: 'USA' } }, nameCode: { longName: 'Stamford CT (1266 East Main St. - 17011)' } },
    { address: { cityName: 'Stamford', countrySubdivisionLevel1: { codeValue: 'CT' }, country: { codeValue: 'USA' } } },
    { address: { cityName: 'Hyderabad', countrySubdivisionLevel1: { codeValue: 'IND-TG', longName: 'Telangana' }, country: { longName: 'India' } } },
    { nameCode: { longName: 'Remote - US' } },
  ] }) === 'Stamford, CT, USA / Hyderabad, Telangana, India / Remote - US', 'extractLocation() builds City, ST, Country, dedupes, and falls back to the nameCode label');
  check(extractLocation({}) === '' && extractLocation(null) === '', 'extractLocation() returns "" with no locations');

  const cfg = { site: 'examplesite', companyName: 'ExampleCo' };
  const row = (reqId, jobTitle, extra = {}) => ({ reqId, jobTitle, clientRequisitionID: `R-${reqId}`, requisitionLocations: [], ...extra });

  const parsed = parseListPage({ count: 5, jobRequisitions: [
    row('1', 'Engineer'),
    { reqId: '2', clientRequisitionID: 'x', type: 'Sourcing' },        // no title at all — talent pool, dropped
    row('3', '   '),                                                   // blank title — dropped
    row('', 'No id'),                                                  // no reqId — dropped
    null, 'junk',
    { reqId: 4, publishedJobTitle: 'Published Title' },               // numeric id, alt title field
  ] }, cfg);
  check(parsed.jobs.length === 2 && parsed.total === 5 && parsed.rawCount === 7, 'parseListPage() drops rows without id/title, keeps count and the raw row count');
  check(parsed.jobs[0].requisitionId === 'R-1' && parsed.jobs[0].company === 'ExampleCo', 'parseListPage() sets requisitionId from clientRequisitionID and company from the entry');
  check(parsed.jobs[1].title === 'Published Title' && parsed.jobs[1].url.endsWith('reqId=4'), 'parseListPage() falls back to publishedJobTitle and coerces a numeric reqId');
  check(parseListPage({ jobRequisitions: [] }, cfg).total === null, 'parseListPage() reads an empty board as []');
  for (const bad of [null, '', 42, true, [], {}, { jobRequisitions: null }, { jobRequisitions: {} }, { message: 'x' }]) {
    let threw = false;
    try { parseListPage(bad, cfg); } catch (e) { threw = /adp-myjobs: unexpected response/.test(e.message); }
    check(threw, `parseListPage() throws on ${JSON.stringify(bad)}`);
  }

  // ── fetch() ──────────────────────────────────────────────────────────────
  const mkRows = (start, n) => Array.from({ length: n }, (_, i) => row(String(start + i), `Job ${start + i}`));
  const mkCtx = (handler, extra = {}) => {
    const calls = [];
    return {
      calls,
      sleep: async () => {},
      fetchJson: async (url, opts) => { calls.push({ url: String(url), opts }); return handler(String(url), opts, calls.length); },
      ...extra,
    };
  };
  const siteResp = { orgoid: ORGOID, clientName: 'Example' };
  const skipOf = (url) => Number(new URL(url).searchParams.get('$skip'));

  {
    // Site lookup → orgoid header, $top/$skip walk, count-bounded stop, dedup, redirect:'error' everywhere.
    const ctx = mkCtx((url) => {
      if (url.includes('/career-site/')) return siteResp;
      const skip = skipOf(url);
      if (skip === 0) return { count: 205, jobRequisitions: mkRows(1, 200) };
      return { count: 205, jobRequisitions: [row('200', 'dup'), ...mkRows(201, 5)] };
    });
    const jobs = await adp.fetch(entry, ctx);
    const lists = ctx.calls.filter(c => c.url.includes('/job-requisitions'));
    check(ctx.calls[0].url === 'https://myjobs.adp.com/public/staffing/v1/career-site/examplesite', 'fetch() resolves the orgoid from the career-site endpoint first');
    check(lists.length === 2 && lists.map(c => skipOf(c.url)).join() === '0,200', 'fetch() pages with $top/$skip, advancing by rows returned (never limit/offset)');
    check(lists.every(c => new URL(c.url).searchParams.get('$top') === '200' && !c.url.includes('limit=') && !c.url.includes('offset=')), 'fetch() sends $top=200 and no limit/offset');
    check(jobs.length === 205, 'fetch() walks to the count and dedupes the overlapping reqId');
    check(ctx.calls.every(c => c.opts?.redirect === 'error'), "fetch() passes redirect: 'error' on every request");
    check(lists.every(c => c.opts.headers.orgoid === ORGOID && c.opts.headers['accept-language'] === 'en-US'), 'fetch() sends the orgoid and an explicit Accept-Language on every list call');
    check(ctx.calls[0].opts.headers['accept-language'] === 'en-US', 'fetch() sends an explicit Accept-Language on the site lookup');
    check(jobs.every(j => !('_reqId' in j)) && jobs[0].url === 'https://myjobs.adp.com/examplesite/cx/job-details?rb=CareerSite&reqId=1', 'fetch() strips internal plumbing and builds the posting URL from the site slug');
  }

  {
    // Explicit orgoid skips the lookup; no count → a short page ends the walk.
    const ctx = mkCtx(() => ({ jobRequisitions: mkRows(1, 3) }));
    const jobs = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, ctx);
    check(ctx.calls.length === 1 && !ctx.calls[0].url.includes('/career-site/') && jobs.length === 3, 'fetch() with adpMyjobs.orgoid skips the lookup and stops on a short page');
  }

  {
    // idCache: second scan makes no lookup request.
    const store = new Map();
    const idCache = { get: k => store.get(k), set: (k, v) => store.set(k, v), delete: k => store.delete(k) };
    const handler = (url) => (url.includes('/career-site/') ? siteResp : { count: 1, jobRequisitions: mkRows(1, 1) });
    const c1 = mkCtx(handler, { idCache });
    await adp.fetch(entry, c1);
    const c2 = mkCtx(handler, { idCache });
    await adp.fetch(entry, c2);
    check(c1.calls.length === 2 && c2.calls.length === 1, 'fetch() caches the resolved orgoid in ctx.idCache');
  }

  {
    // Bad lookup responses fail loudly.
    for (const body of [{}, { orgoid: '' }, { orgoid: 'short' }, null]) {
      const ctx = mkCtx(() => body);
      let msg = '';
      try { await adp.fetch(entry, ctx); } catch (e) { msg = e.message; }
      check(/could not resolve orgoid/.test(msg) && ctx.calls.length === 1, `fetch() throws when the career-site lookup returns ${JSON.stringify(body)}`);
    }
    let msg = '';
    try { await adp.fetch({ name: 'X', careers_url: 'https://example.com/x' }, mkCtx(() => ({}))); } catch (e) { msg = e.message; }
    check(/cannot derive the career-site slug/.test(msg), 'fetch() throws a named error when no site slug can be derived');
  }

  {
    // Envelope vs empty: {} throws, {count:0, jobRequisitions:[]} is an empty board.
    const bad = mkCtx(() => ({ count: 4 }));
    let msg = '';
    try { await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, bad); } catch (e) { msg = e.message; }
    check(/expected jobRequisitions\[\], got: \[count\]/.test(msg), 'fetch() throws, naming the keys, on a response without jobRequisitions[]');
    const empty = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, mkCtx(() => ({ count: 0, jobRequisitions: [] })));
    check(Array.isArray(empty) && empty.length === 0, 'fetch() returns [] for a present-and-empty jobRequisitions');
  }

  {
    // HTTP errors surface (non-retryable 400 = the "Missing orgoid header" case).
    const ctx = mkCtx(() => { const e = new Error('HTTP 400'); e.status = 400; throw e; });
    let status = 0;
    try { await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, ctx); } catch (e) { status = e.status; }
    check(status === 400 && ctx.calls.length === 1, 'fetch() surfaces a 400 without retrying it');
  }

  {
    // A short-but-not-final page when count says more: keep walking (server clamped $top).
    const ctx = mkCtx((url) => {
      const skip = skipOf(url);
      return { count: 120, jobRequisitions: skip < 120 ? mkRows(skip + 1, Math.min(50, 120 - skip)) : [] };
    });
    const jobs = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, ctx);
    check(jobs.length === 120 && ctx.calls.length === 3, 'fetch() keeps walking short pages until count is reached (clamped $top)');
  }

  {
    // Ceiling: max_pages truncates a full-page board, warns, and tags the result.
    const warns = [];
    const origErr = console.error;
    console.error = (...a) => warns.push(a.join(' '));
    let jobs;
    const ctx = mkCtx((url) => ({ count: 100000, jobRequisitions: mkRows(skipOf(url) + 1, 200) }));
    try { jobs = await adp.fetch({ ...entry, max_pages: 2, adpMyjobs: { orgoid: ORGOID } }, ctx); } finally { console.error = origErr; }
    check(ctx.calls.length === 2 && jobs.length === 400 && jobs.adpMyjobsTruncated === true && warns.some(w => /raise max_pages/.test(w)), 'fetch() stops at max_pages, warns "raise max_pages", and tags adpMyjobsTruncated');

    // A natural end on the last allowed page is not a truncation.
    const warns2 = [];
    console.error = (...a) => warns2.push(a.join(' '));
    let j2;
    try { j2 = await adp.fetch({ ...entry, max_pages: 2, adpMyjobs: { orgoid: ORGOID } }, mkCtx((url) => ({ count: 250, jobRequisitions: mkRows(skipOf(url) + 1, skipOf(url) === 0 ? 200 : 50) }))); } finally { console.error = origErr; }
    check(j2.length === 250 && !j2.adpMyjobsTruncated && warns2.length === 0, 'fetch() does not warn when the board ends on the last allowed page');

    // Hard ceiling regardless of what the source claims or the entry asks.
    const big = mkCtx((url) => ({ count: 1e9, jobRequisitions: mkRows(skipOf(url) + 1, 200) }));
    const origErr2 = console.error; console.error = () => {};
    try { await adp.fetch({ ...entry, max_pages: 99999, adpMyjobs: { orgoid: ORGOID } }, big); } finally { console.error = origErr2; }
    check(big.calls.length === 1500, 'fetch() caps max_pages at 1500 even when the source reports more');
  }

  {
    // A source that ignores $skip (same page forever) ends the walk instead of looping.
    const ctx = mkCtx(() => ({ count: 1000, jobRequisitions: mkRows(1, 200) }));
    const jobs = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, ctx);
    check(ctx.calls.length === 3 && jobs.length === 200, 'fetch() stops after two consecutive pages with no new reqIds');
  }

  {
    // The stall is signalled (warning + tag) without blaming max_pages.
    const warns = [];
    const origErr = console.error; console.error = (...a) => warns.push(a.join(' '));
    let jobs;
    try { jobs = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, mkCtx(() => ({ count: 1000, jobRequisitions: mkRows(1, 200) }))); } finally { console.error = origErr; }
    check(jobs.adpMyjobsTruncated === true && warns.some(w => /incomplete/.test(w)) && !warns.some(w => /raise max_pages/.test(w)), 'a stalled walk warns "incomplete" and tags the result, without the max_pages warning');

    // A repeated page that happens to carry skip past count is still a stall.
    const warns2 = [];
    console.error = (...a) => warns2.push(a.join(' '));
    let j2;
    try { j2 = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, mkCtx(() => ({ count: 250, jobRequisitions: mkRows(1, 200) }))); } finally { console.error = origErr; }
    // One repeated page followed by fresh rows does not end the walk.
    const ctx3 = mkCtx((url) => {
      const skip = skipOf(url);
      return { count: 600, jobRequisitions: skip === 200 ? mkRows(1, 200) : mkRows(skip + 1, 200) };
    });
    const j3 = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, ctx3);
    check(ctx3.calls.length === 3 && j3.length === 400 && j3.adpMyjobsTruncated === true, 'a single repeated page does not end the walk early, but the gap marks the board incomplete');
    check(j2.length === 200 && j2.adpMyjobsTruncated === true && warns2.some(w => /incomplete/.test(w)), 'a repeated page that reaches count is still flagged as a stall');
  }

  {
    // Pagination + transient failure: keep nothing partial silently — page-2 5xx exhausts retry and throws, no "raise max_pages" warning.
    const warns = [];
    const origErr = console.error; console.error = (...a) => warns.push(a.join(' '));
    let threw = false;
    try {
      await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, mkCtx((url) => {
        if (skipOf(url) === 0) return { count: 400, jobRequisitions: mkRows(1, 200) };
        const e = new Error('HTTP 503'); e.status = 503; throw e;
      }));
    } catch { threw = true; } finally { console.error = origErr; }
    check(threw && !warns.some(w => /raise max_pages/.test(w)), 'fetch() fails loud on a page-2 5xx and never blames max_pages');
  }

  {
    // Probe: ctx.maxPages=1 → one list request, no detail calls, ProbePageBudgetReached-style rejection propagates unwrapped.
    const ctx = mkCtx((url) => ({ count: 500, jobRequisitions: mkRows(1, 200) }), { maxPages: 1 });
    const jobs = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID, fetchDetails: true } }, ctx);
    check(ctx.calls.length === 1 && jobs.length === 200 && !jobs.adpMyjobsTruncated, 'fetch() under ctx.maxPages=1 makes exactly one list request, no detail calls, no truncation warning');
    const sentinel = new Error('budget');
    let caught;
    try { await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, mkCtx(() => { throw sentinel; }, { maxPages: 1 })); } catch (e) { caught = e; }
    check(caught === sentinel, 'fetch() propagates a ctx.fetch* rejection unwrapped while probing');
  }

  {
    // fetchDetails: description + postedAt, bounded by detailLimit, redirect:'error', reqId path-encoded.
    const ctx = mkCtx((url) => {
      if (url.includes('/job-requisitions/')) return { jobRequisitions: [{ jobDescription: '<p>Build <b>things</b></p>', jobQualifications: '<ul><li>Node</li></ul>', postingDate: '2026-11-06T15:18:00Z' }] };
      return { count: 5, jobRequisitions: mkRows(1, 5) };
    });
    const jobs = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID, fetchDetails: true, detailLimit: 2 } }, ctx);
    const details = ctx.calls.filter(c => /\/job-requisitions\/[^?]/.test(c.url));
    check(details.length === 2 && details.every(c => c.opts.redirect === 'error' && c.opts.headers.orgoid === ORGOID), 'fetchDetails caps detail calls at detailLimit and keeps redirect:"error" + orgoid');
    check(jobs[0].description?.includes('Build things') && jobs[0].postedAt === Date.parse('2026-11-06T15:18:00Z') && jobs[2].description === undefined, 'fetchDetails fills description and postedAt on the first detailLimit rows only');
    const noDetails = mkCtx(() => ({ count: 1, jobRequisitions: mkRows(1, 1) }));
    await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID } }, noDetails);
    check(noDetails.calls.length === 1, 'detail enrichment is off unless adpMyjobs.fetchDetails is true');
  }

  {
    // A failed detail fetch (or unparseable date) never loses the listing.
    const ctx = mkCtx((url) => {
      if (url.includes('/job-requisitions/')) { const e = new Error('boom'); e.status = 400; throw e; }
      return { count: 1, jobRequisitions: mkRows(1, 1) };
    });
    const jobs = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID, fetchDetails: true } }, ctx);
    check(jobs.length === 1 && jobs[0].description === undefined, 'a failed detail fetch keeps the listing row');
    const badDate = mkCtx((url) => (url.includes('/job-requisitions/') ? { jobRequisitions: [{ jobDescription: 'x', postingDate: 'garbage' }] } : { count: 1, jobRequisitions: mkRows(1, 1) }));
    const j2 = await adp.fetch({ ...entry, adpMyjobs: { orgoid: ORGOID, fetchDetails: true } }, badDate);
    check(j2[0].description === 'x' && j2[0].postedAt === undefined, 'an unparseable postingDate is left undefined, not NaN');
  }

  assert.ok(true);
} catch (e) {
  fail(`adp-myjobs provider tests crashed: ${e.message}\n${e.stack}`);
}
