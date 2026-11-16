// tests/providers/clearcompany.test.mjs — ClearCompany careers API provider.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — clearcompany (ClearCompany careers API)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/clearcompany.mjs')).href);
const cc = mod.default;
const { parseClearCompanyPage, jobLocation } = mod;
const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);

const SITE = '0a1b2c3d-1111-2222-3333-444455556666';
const API = `https://careers-api.clearcompany.com/v1/${SITE}`;

if (cc.id === 'clearcompany') pass('clearcompany.id is "clearcompany"');
else fail(`clearcompany.id is ${JSON.stringify(cc.id)}`);

// detect() — the API URL and the embed-script URL both carry the siteId.
const detectCases = [
  [{ careers_url: API }, API, 'API URL in careers_url'],
  [{ api: `${API}/` }, API, 'API URL with a trailing slash in api'],
  [{ careers_url: `https://careers-content.clearcompany.com/js/v1/career-site.js?siteId=${SITE.toUpperCase()}` }, API, 'embed-script URL (siteId lower-cased)'],
  [{ careers_url: `https://careers-content.clearcompany.com/js/v1/career-site.js?siteid=${SITE}` }, API, 'embed-script URL with a lower-case siteid key'],
];
for (const [entry, want, label] of detectCases) {
  const got = cc.detect(entry);
  if (got?.url === want) pass(`clearcompany.detect() claims the ${label}`);
  else fail(`clearcompany.detect() ${label}: ${JSON.stringify(got)}`);
}
const rejectCases = [
  [{ careers_url: `http://careers-api.clearcompany.com/v1/${SITE}` }, 'non-HTTPS'],
  [{ careers_url: `https://careers-api.clearcompany.com.evil.example/v1/${SITE}` }, 'look-alike host'],
  [{ careers_url: `https://evilclearcompany.com/v1/${SITE}` }, 'suffix look-alike host'],
  [{ careers_url: 'https://careers-api.clearcompany.com/v1/not-a-guid' }, 'non-GUID siteId'],
  [{ careers_url: `https://careers-api.clearcompany.com/v1/${SITE}/extra` }, 'deeper API path'],
  [{ careers_url: 'https://careers-content.clearcompany.com/js/v1/career-site.js' }, 'embed URL with no siteId'],
  [{ careers_url: 'https://careers.example.com/jobs' }, 'branded careers page'],
  [{ careers_url: 'not a url' }, 'malformed URL'],
  [{ careers_url: null }, 'null careers_url'],
  [{ careers_url: 42 }, 'non-string careers_url'],
  [{}, 'missing careers_url'],
];
for (const [entry, label] of rejectCases) {
  let got;
  try { got = cc.detect(entry); } catch (err) { got = `threw ${err.message}`; }
  if (got === null) pass(`clearcompany.detect() returns null for ${label}`);
  else fail(`clearcompany.detect() ${label}: ${JSON.stringify(got)}`);
}

// The registry routes an API URL to this provider, not an earlier one.
const realError = console.error;
console.error = () => {};
const providers = await loadProviders(join(ROOT, 'providers'));
console.error = realError;
const routed = resolveProvider({ name: 'Acme', careers_url: API }, providers);
if (routed?.provider?.id === 'clearcompany') pass('the registry routes a careers-api.clearcompany.com URL to clearcompany');
else fail(`registry routed the API URL to ${routed?.provider?.id}`);

// Normalization of the live response shape.
const row = (n, extra = {}) => ({
  id: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`,
  userDefinedId: `REQ-${n}`,
  positionTitle: `Engineer ${n}`,
  description: '<p>Build <strong>things</strong> &amp; ship</p>',
  openDate: '2026-10-01T00:00:00',
  postedDate: '2026-10-02T00:00:00',
  location: 'Springfield, IL',
  locations: [{ city: 'Springfield', subdivision: 'IL', country: 'US', isRemote: false }],
  brandName: 'Acme',
  applyLink: `https://jobs.clearcompany.com/careers/jobs/aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}/apply`,
  ...extra,
});
const page = (rows, totalCount) => ({ results: rows, currentPageIndex: 0, totalCount, currentPageCount: rows.length });

const parsed = parseClearCompanyPage(page([
  row(1),
  row(2, { userDefinedId: null, postedDate: null, location: '' }),
  row(3, { positionTitle: '   ' }),
  row(4, { applyLink: 'jobs@example.com' }),
  row(5, { applyLink: 'http://jobs.example.com/5' }),
  null,
  'junk',
], 7), 'Acme');
const [j1, j2] = parsed.jobs;
if (parsed.rawCount === 7 && parsed.total === 7 && parsed.jobs.length === 2) pass('parseClearCompanyPage() keeps the raw count and drops rows without a title or an https applyLink');
else fail(`parseClearCompanyPage() counts wrong: ${JSON.stringify({ raw: parsed.rawCount, total: parsed.total, n: parsed.jobs.length })}`);
if (
  j1?.title === 'Engineer 1' && j1.url === row(1).applyLink && j1.company === 'Acme' &&
  j1.location === 'Springfield, IL' && j1.postedAt === Date.parse('2026-10-02T00:00:00') &&
  j1.requisitionId === 'REQ-1' && j1.description === 'Build things & ship'
) pass('parseClearCompanyPage() maps title/applyLink/location/postedDate/userDefinedId/description');
else fail(`parseClearCompanyPage() row 1 wrong: ${JSON.stringify(j1)}`);
if (j2 && !('requisitionId' in j2) && j2.postedAt === Date.parse('2026-10-01T00:00:00') && j2.location === 'Springfield, IL, US') {
  pass('parseClearCompanyPage() falls back to openDate and locations[], omits a null requisition id');
} else fail(`parseClearCompanyPage() row 2 wrong: ${JSON.stringify(j2)}`);
if (jobLocation({ locations: [{ country: 'US', isRemote: true }] }) === 'Remote (US)' && jobLocation({}) === '') pass('jobLocation() marks a remote location and tolerates none');
else fail(`jobLocation() wrong: ${jobLocation({ locations: [{ country: 'US', isRemote: true }] })}`);
const badDate = parseClearCompanyPage(page([row(9, { postedDate: 'soon', openDate: 'later' })], 1), 'Acme').jobs[0];
if (badDate && !('postedAt' in badDate)) pass('parseClearCompanyPage() leaves postedAt unset for an unparseable date');
else fail(`parseClearCompanyPage() bad date: ${JSON.stringify(badDate)}`);

// Empty vs broken envelope.
if (parseClearCompanyPage(page([], 0), 'Acme').jobs.length === 0) pass('parseClearCompanyPage() returns [] for a present-and-empty results array');
else fail('parseClearCompanyPage() empty board wrong');
for (const [body, label] of [[{}, '{}'], [{ results: null }, 'results: null'], [{ results: {} }, 'results: {}'], [{ jobs: [] }, 'a different key'], ['', 'an empty body'], [42, 'a number'], [null, 'null']]) {
  let msg = null;
  try { parseClearCompanyPage(body, 'Acme'); } catch (err) { msg = err.message; }
  if (msg && /clearcompany: unexpected response — expected results\[\]/.test(msg)) pass(`parseClearCompanyPage() throws descriptively on ${label}`);
  else fail(`parseClearCompanyPage() should throw on ${label}, got ${msg}`);
}

// fetch() — guard runs before any request.
let guardCalls = 0;
let guardErr = null;
try {
  await cc.fetch({ name: 'Acme', careers_url: 'https://careers.example.com/jobs' }, { fetchJson: async () => { guardCalls++; return page([], 0); } });
} catch (err) { guardErr = err; }
if (guardErr && /cannot derive the siteId/.test(guardErr.message) && guardCalls === 0) pass('clearcompany.fetch() rejects an unrecognised URL before any request');
else fail(`clearcompany.fetch() guard: err=${guardErr?.message} calls=${guardCalls}`);

// fetch() — paginates until totalCount, redirect:'error' on every request.
const fullRows = (start, n) => Array.from({ length: n }, (_, i) => row(start + i));
{
  const urls = [];
  const opts = [];
  const pages = [page(fullRows(1, 100), 150), page(fullRows(101, 50), 150)];
  const jobs = await cc.fetch({ name: 'Acme', careers_url: API }, {
    sleep: async () => {},
    fetchJson: async (url, o) => { urls.push(url); opts.push(o); return pages[urls.length - 1] ?? page([], 150); },
  });
  if (jobs.length === 150 && urls.length === 2) pass('clearcompany.fetch() walks pages until totalCount is served');
  else fail(`clearcompany.fetch() pagination: ${jobs.length} jobs, ${urls.length} requests`);
  if (urls[0] === `${API}?pageIndex=0&pageSize=100` && urls[1] === `${API}?pageIndex=1&pageSize=100`) pass('clearcompany.fetch() requests 0-based pageIndex with pageSize=100');
  else fail(`clearcompany.fetch() urls: ${JSON.stringify(urls)}`);
  if (opts.length > 0 && opts.every((o) => o?.redirect === 'error')) pass('clearcompany.fetch() passes redirect:"error" on every request');
  else fail(`clearcompany.fetch() redirect opts: ${JSON.stringify(opts)}`);
}

// fetch() — without a totalCount, a short page is not the end (the server may
// clamp pageSize); an empty page is.
{
  let calls = 0;
  const pages = [{ results: fullRows(1, 10) }, { results: fullRows(11, 10) }, { results: [] }];
  const jobs = await cc.fetch({ name: 'Acme', careers_url: API }, {
    sleep: async () => {},
    fetchJson: async () => pages[calls++] ?? { results: [] },
  });
  if (jobs.length === 20 && calls === 3) pass('clearcompany.fetch() reads past a short page without a totalCount, stops on an empty one');
  else fail(`clearcompany.fetch() short page: ${jobs.length} jobs, ${calls} calls`);
}

// fetch() — without a totalCount, a repeat of the previous page ends the walk,
// so a server that ignores pageIndex is not walked to max_pages.
{
  let calls = 0;
  const jobs = await cc.fetch({ name: 'Acme', careers_url: API }, {
    sleep: async () => {},
    fetchJson: async () => { calls++; return { results: fullRows(1, 3) }; },
  });
  if (jobs.length === 3 && calls === 2 && !jobs.clearcompanyTruncated) pass('clearcompany.fetch() stops when a page repeats without a totalCount');
  else fail(`clearcompany.fetch() repeated page: ${jobs.length} jobs, ${calls} calls`);
}

// fetch() — without a totalCount, a page whose rows are all dropped (email-to-
// apply) is not mistaken for a repeat: the walk reads past it.
{
  let calls = 0;
  const emailOnly = fullRows(11, 10).map((r) => ({ ...r, applyLink: 'jobs@example.com' }));
  const pages = [{ results: fullRows(1, 10) }, { results: emailOnly }, { results: fullRows(21, 5) }, { results: [] }];
  const jobs = await cc.fetch({ name: 'Acme', careers_url: API }, {
    sleep: async () => {},
    fetchJson: async () => pages[calls++] ?? { results: [] },
  });
  if (jobs.length === 15 && calls === 4) pass('clearcompany.fetch() reads past a page of dropped rows without a totalCount');
  else fail(`clearcompany.fetch() dropped-rows page: ${jobs.length} jobs, ${calls} calls`);
}

// fetch() — DEFAULT_MAX_PAGES caps an inflated totalCount and warns.
{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => cc.fetch({ name: 'Acme', careers_url: API }, {
    sleep: async () => {},
    fetchJson: async () => { calls++; return page(fullRows(calls * 1000, 100), 1_000_000); },
  }));
  if (calls === 20 && jobs.length === 2000) pass('clearcompany.fetch() caps pagination at DEFAULT_MAX_PAGES despite an inflated totalCount');
  else fail(`clearcompany.fetch() cap: ${calls} requests, ${jobs.length} jobs`);
  if (errors.some((w) => /truncated at max_pages=20/.test(w)) && jobs.clearcompanyTruncated === true) pass('clearcompany.fetch() warns and tags the board when the cap truncates it');
  else fail(`clearcompany.fetch() cap warning: ${JSON.stringify(errors)}`);
}

// fetch() — a short final page at the cap boundary is a complete board.
{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => cc.fetch({ name: 'Acme', careers_url: API, max_pages: 2 }, {
    sleep: async () => {},
    fetchJson: async () => { calls++; return page(calls === 1 ? fullRows(1, 100) : fullRows(101, 40), 140); },
  }));
  if (calls === 2 && jobs.length === 140 && errors.length === 0 && !jobs.clearcompanyTruncated) pass('clearcompany.fetch() treats a short page at the cap as complete');
  else fail(`clearcompany.fetch() short boundary page: ${calls} calls, ${jobs.length} jobs, ${JSON.stringify(errors)}`);
}

// fetch() — without a totalCount, a short page at the cap cannot prove the end,
// so the board is reported as truncated rather than silently complete.
{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => cc.fetch({ name: 'Acme', careers_url: API, max_pages: 2 }, {
    sleep: async () => {},
    fetchJson: async () => { calls++; return { results: calls === 1 ? fullRows(1, 10) : fullRows(11, 10) }; },
  }));
  if (calls === 2 && jobs.length === 20 && jobs.clearcompanyTruncated === true && errors.some((w) => /truncated at max_pages=2/.test(w))) pass('clearcompany.fetch() reports the cap as truncation without a totalCount');
  else fail(`clearcompany.fetch() uncounted cap: ${calls} calls, ${jobs.length} jobs, ${JSON.stringify(errors)}`);
}

// fetch() — max_pages raises the cap but is itself capped at MAX_PAGES_CAP.
{
  let calls = 0;
  await captureConsoleErrors(() => cc.fetch({ name: 'Acme', careers_url: API, max_pages: 10_000 }, {
    sleep: async () => {},
    fetchJson: async () => { calls++; return page(fullRows(calls * 1000, 100), 1_000_000); },
  }));
  if (calls === 300) pass('clearcompany.fetch() caps an oversized max_pages at MAX_PAGES_CAP');
  else fail(`clearcompany.fetch() MAX_PAGES_CAP: ${calls} requests`);
}

// fetch() — ctx.maxPages (health probe) issues exactly one list request.
{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => cc.fetch({ name: 'Acme', careers_url: API }, {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async () => { calls++; return page(fullRows(1, 100), 500); },
  }));
  if (calls === 1 && jobs.length === 100 && errors.length === 0) pass('clearcompany.fetch() honours ctx.maxPages: one request, no truncation warning');
  else fail(`clearcompany.fetch() probe: ${calls} calls, ${jobs.length} jobs, ${JSON.stringify(errors)}`);
}

// fetch() — a rejection while probing propagates unwrapped.
{
  class FakeSentinel extends Error {}
  let caught = null;
  try {
    await cc.fetch({ name: 'Acme', careers_url: API }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw new FakeSentinel('budget'); } });
  } catch (err) { caught = err; }
  if (caught instanceof FakeSentinel) pass('clearcompany.fetch() propagates a ctx.fetch* rejection unwrapped while probing');
  else fail(`clearcompany.fetch() probe error identity lost: ${caught?.constructor?.name}`);
}

// fetch() — a later page that exhausts retry keeps earlier pages and warns,
// without the "raise max_pages" message.
{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => cc.fetch({ name: 'Acme', careers_url: API }, {
    sleep: async () => {},
    fetchJson: async () => {
      calls++;
      if (calls === 1) return page(fullRows(1, 100), 250);
      const err = new Error('upstream 503');
      err.status = 503;
      throw err;
    },
  }));
  if (jobs.length === 100 && calls === 4) pass('clearcompany.fetch() keeps page 1 when page 2 exhausts retries (1 + 3 attempts)');
  else fail(`clearcompany.fetch() partial: ${jobs.length} jobs, ${calls} calls`);
  if (errors.some((w) => /truncated at page 2 \(100 of 250 jobs\): upstream 503/.test(w)) && !errors.some((w) => /raise max_pages/.test(w))) {
    pass('clearcompany.fetch() warns on a fetch-error stop without the max_pages hint');
  } else fail(`clearcompany.fetch() fetch-error warnings: ${JSON.stringify(errors)}`);
  if (jobs.clearcompanyTruncated === true) pass('clearcompany.fetch() tags a fetch-error-truncated board');
  else fail('clearcompany.fetch() fetch-error board not tagged');
}

// fetch() — a later page that answers 200 with a broken envelope keeps
// earlier pages too, the same as a failed request; on page 1 it throws.
{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => cc.fetch({ name: 'Acme', careers_url: API }, {
    sleep: async () => {},
    fetchJson: async () => (++calls === 1 ? page(fullRows(1, 100), 250) : { error: 'maintenance' }),
  }));
  if (jobs.length === 100 && calls === 2) pass('clearcompany.fetch() keeps page 1 when page 2 has a malformed envelope');
  else fail(`clearcompany.fetch() malformed later page: ${jobs.length} jobs, ${calls} calls`);
  if (jobs.clearcompanyTruncated === true && errors.some((w) => /truncated at page 2 \(100 of 250 jobs\): .*expected results\[\]/.test(w))) {
    pass('clearcompany.fetch() warns and tags a board cut short by a malformed later page');
  } else fail(`clearcompany.fetch() malformed later page warnings: ${JSON.stringify(errors)}`);
  let threw = false;
  try {
    await cc.fetch({ name: 'Acme', careers_url: API }, { sleep: async () => {}, fetchJson: async () => ({ error: 'maintenance' }) });
  } catch { threw = true; }
  if (threw) pass('clearcompany.fetch() throws when the first page has a malformed envelope');
  else fail('clearcompany.fetch() swallowed a malformed first page');
}

// fetch() — a first-page failure throws (dead tenant is not an empty board).
{
  let threw = false;
  try {
    await cc.fetch({ name: 'Acme', careers_url: API }, {
      sleep: async () => {},
      fetchJson: async () => { const err = new Error('Not Found'); err.status = 404; throw err; },
    });
  } catch { threw = true; }
  if (threw) pass('clearcompany.fetch() throws when the first page fails');
  else fail('clearcompany.fetch() swallowed a first-page failure');
}
