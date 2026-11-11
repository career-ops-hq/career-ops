// tests/providers/darwinbox.test.mjs — Darwinbox careers (alljobs API) provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — darwinbox (Darwinbox careers alljobs API)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/darwinbox.mjs')).href);
const darwinbox = mod.default;
const { parseDarwinboxResponse, jobLocation, resolveBoard, resolveMaxPages } = mod;
const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);

const ORIGIN = 'https://acme.darwinbox.in';
const BOARD = { origin: ORIGIN, companyId: 'main' };
const CAREERS = `${ORIGIN}/ms/candidatev2/main/careers/allJobs`;
const ENDPOINT = `${ORIGIN}/ms/candidateapi/job/alljobs?companyId=main`;
const COM_ORIGIN = 'https://acme.darwinbox.com';
const COM_CAREERS = `${COM_ORIGIN}/ms/candidatev2/main/careers/allJobs`;
const PAGE_SIZE = 50;

/** Run `fn` with console.error captured; returns what it logged. */
async function captureErrors(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return lines;
}

if (darwinbox.id === 'darwinbox') pass('darwinbox.id is "darwinbox"');
else fail(`darwinbox.id is ${JSON.stringify(darwinbox.id)}`);

// detect() — claims any careers URL carrying a company id, rebuilds the URL itself.
const detectCases = [
  [{ careers_url: CAREERS }, 'the allJobs page', CAREERS],
  [{ careers_url: `${ORIGIN}/ms/candidatev2/main/careers/home` }, 'the careers home page', CAREERS],
  [{ careers_url: `${ORIGIN}/ms/candidatev2/main/careers` }, 'the careers root', CAREERS],
  [{ careers_url: `${ORIGIN}/ms/candidatev2/main/careers/jobDetails/a123` }, 'a posting permalink', CAREERS],
  [{ careers_url: 'https://ACME.darwinbox.in/ms/candidatev2/main/careers/allJobs?x=1#y' }, 'an upper-case host with a query', CAREERS],
  [{ careers_url: 'https://acme.darwinbox.in:8443/ms/candidatev2/main/careers/allJobs' }, 'a tenant host carrying a port', CAREERS],
  [{ api: CAREERS }, 'the api: field', CAREERS],
  [{ careers_url: `${ORIGIN}/ms/candidatev2/5ffc190a05f27/careers/allJobs` }, 'a tenant-specific company id', `${ORIGIN}/ms/candidatev2/5ffc190a05f27/careers/allJobs`],
  [{ careers_url: `${COM_CAREERS}?x=1` }, 'a darwinbox.com tenant', COM_CAREERS],
  [{ careers_url: 'https://ACME.darwinbox.com:8443/ms/candidatev2/main/careers/home' }, 'an upper-case darwinbox.com host carrying a port', COM_CAREERS],
];
for (const [entry, label, want] of detectCases) {
  const got = darwinbox.detect(entry);
  if (got?.url === want) pass(`darwinbox.detect() claims ${label}`);
  else fail(`darwinbox.detect() ${label}: ${JSON.stringify(got)}`);
}
const rejectCases = [
  [{ careers_url: 'http://acme.darwinbox.in/ms/candidatev2/main/careers/allJobs' }, 'non-HTTPS'],
  [{ careers_url: 'https://acme.darwinbox.in.evil.example/ms/candidatev2/main/careers/allJobs' }, 'look-alike host (trailing suffix)'],
  [{ careers_url: 'https://evildarwinbox.in/ms/candidatev2/main/careers/allJobs' }, 'suffix look-alike host'],
  [{ careers_url: 'https://acme-darwinbox.in/ms/candidatev2/main/careers/allJobs' }, 'hyphen look-alike host'],
  [{ careers_url: 'https://a.b.darwinbox.in/ms/candidatev2/main/careers/allJobs' }, 'two tenant labels'],
  [{ careers_url: 'https://-acme.darwinbox.in/ms/candidatev2/main/careers/allJobs' }, 'label starting with a hyphen'],
  [{ careers_url: 'https://darwinbox.in/ms/candidatev2/main/careers/allJobs' }, 'the apex host'],
  [{ careers_url: 'http://acme.darwinbox.com/ms/candidatev2/main/careers/allJobs' }, 'non-HTTPS on darwinbox.com'],
  [{ careers_url: 'https://acme.darwinbox.com.evil.example/ms/candidatev2/main/careers/allJobs' }, 'look-alike darwinbox.com host (trailing suffix)'],
  [{ careers_url: 'https://evildarwinbox.com/ms/candidatev2/main/careers/allJobs' }, 'suffix look-alike darwinbox.com host'],
  [{ careers_url: 'https://a.b.darwinbox.com/ms/candidatev2/main/careers/allJobs' }, 'two tenant labels on darwinbox.com'],
  [{ careers_url: 'https://darwinbox.com/ms/candidatev2/main/careers/allJobs' }, 'the darwinbox.com apex host'],
  [{ careers_url: 'https://www.darwinbox.com/careers' }, 'the vendor site without a company id'],
  [{ careers_url: 'https://acme.darwinbox.net/ms/candidatev2/main/careers/allJobs' }, 'a darwinbox host on another TLD'],
  [{ careers_url: ORIGIN }, 'a bare tenant host (no company id to read)'],
  [{ careers_url: `${ORIGIN}/user/login` }, 'the employee login page'],
  [{ careers_url: `${ORIGIN}/ms/candidatev2/ma%2Fin/careers/allJobs` }, 'an encoded slash in the company id'],
  [{ careers_url: 'https://careers.example.com/jobs' }, 'a branded careers page'],
  [{ careers_url: 'not a url' }, 'a malformed URL'],
  [{ careers_url: null }, 'null careers_url'],
  [{ careers_url: 42 }, 'non-string careers_url'],
  [{}, 'missing careers_url'],
  [null, 'a null entry'],
];
for (const [entry, label] of rejectCases) {
  let got;
  try { got = darwinbox.detect(entry); } catch (err) { got = `threw ${err.message}`; }
  if (got === null) pass(`darwinbox.detect() returns null for ${label}`);
  else fail(`darwinbox.detect() ${label}: ${JSON.stringify(got)}`);
}
{
  const got = resolveBoard({ api: 'https://www.example.com/', careers_url: CAREERS });
  if (got?.origin === ORIGIN && got?.companyId === 'main') pass('resolveBoard() falls through to careers_url when api: is not a board');
  else fail(`resolveBoard() did not fall through: ${JSON.stringify(got)}`);
}

// The registry routes a tenant URL to this provider.
{
  const realError = console.error;
  console.error = () => {};
  const providers = await loadProviders(join(ROOT, 'providers'));
  console.error = realError;
  const routed = resolveProvider({ name: 'Acme', careers_url: CAREERS }, providers);
  if (routed?.provider?.id === 'darwinbox') pass('the registry routes a <tenant>.darwinbox.in URL to darwinbox');
  else fail(`registry routed a darwinbox URL to ${routed?.provider?.id}`);
  const routedCom = resolveProvider({ name: 'Acme', careers_url: COM_CAREERS }, providers);
  if (routedCom?.provider?.id === 'darwinbox') pass('the registry routes a <tenant>.darwinbox.com URL to darwinbox');
  else fail(`registry routed a darwinbox.com URL to ${routedCom?.provider?.id}`);
}

// Normalization of the live response shape.
const row = (id, extra = {}) => ({
  id,
  title: `Engineer ${id}`,
  jd: '&lt;p class=&quot;x&quot;&gt;Build &lt;b&gt;things&lt;/b&gt; &amp;amp; ship&lt;/p&gt;',
  tool_tip_locations: ['Head Office, Pune, Maharashtra, India'],
  locations: 'Head Office, Pune, Maharashtra\r, India',
  posted_on: 1790000000,
  created_on: '2026-09-01T07:56:42.000Z',
  internal_job_code: `JOB_${id}`,
  salary_min: '1600000',
  salary_max: '2300000',
  salary_currency: 'inr',
  salary_timeframe: 'Annual',
  ...extra,
});
const envelope = (rows, jobCounts = rows.length) => ({ status: 'success', data: rows, job_counts: jobCounts });

{
  const parsed = parseDarwinboxResponse(envelope([
    row('a1'),
    row('a2', { posted_on: 0, jd: '', internal_job_code: '', salary_min: '', salary_max: '', tool_tip_locations: [], locations: '' }),
    row('a3', { title: '   ' }),
    row(null),
    row('', {}),
    row('a4', { title: '  R&amp;D   Engineer  ' }),
    null,
    'junk',
  ]), 'Acme', BOARD);
  const [j1, j2, j4] = parsed;
  if (parsed.length === 3) pass('parseDarwinboxResponse() drops rows without a title or an id, and non-object rows');
  else fail(`parseDarwinboxResponse() kept ${parsed.length} rows: ${JSON.stringify(parsed.map((j) => j.url))}`);
  if (
    j1?.title === 'Engineer a1' &&
    j1.url === `${ORIGIN}/ms/candidatev2/main/careers/jobDetails/a1` &&
    j1.company === 'Acme' &&
    j1.location === 'Head Office, Pune, Maharashtra, India' &&
    j1.requisitionId === 'JOB_a1'
  ) pass('parseDarwinboxResponse() maps title/url/company/location/requisitionId');
  else fail(`parseDarwinboxResponse() row 1 wrong: ${JSON.stringify(j1)}`);
  if (j1?.postedAt === 1790000000 * 1000) pass('parseDarwinboxResponse() reads posted_on as epoch seconds');
  else fail(`parseDarwinboxResponse() postedAt wrong: ${j1?.postedAt}`);
  if (j1?.description === 'Build things & ship') pass('parseDarwinboxResponse() reduces the double-encoded jd to plain text');
  else fail(`parseDarwinboxResponse() description wrong: ${JSON.stringify(j1?.description)}`);
  if (j1?.salary?.min === 1600000 && j1.salary.max === 2300000 && j1.salary.currency === 'INR') pass('parseDarwinboxResponse() maps annual salary figures to numbers');
  else fail(`parseDarwinboxResponse() salary wrong: ${JSON.stringify(j1?.salary)}`);
  if (j2?.postedAt === Date.parse('2026-09-01T07:56:42.000Z')) pass('parseDarwinboxResponse() falls back to created_on without a usable posted_on');
  else fail(`parseDarwinboxResponse() created_on fallback wrong: ${j2?.postedAt}`);
  if (j2 && !('description' in j2) && !('requisitionId' in j2) && !('salary' in j2) && j2.location === '') pass('parseDarwinboxResponse() leaves optional fields unset when empty');
  else fail(`parseDarwinboxResponse() row 2 wrong: ${JSON.stringify(j2)}`);
  if (j4?.title === 'R&D Engineer') pass('parseDarwinboxResponse() decodes entities and collapses whitespace in a title');
  else fail(`parseDarwinboxResponse() title wrong: ${JSON.stringify(j4?.title)}`);
}

// A date that cannot be read leaves postedAt unset.
{
  const [job] = parseDarwinboxResponse(envelope([row('a1', { posted_on: 'soon', created_on: 'later' })]), 'Acme', BOARD);
  if (job && !('postedAt' in job)) pass('parseDarwinboxResponse() leaves postedAt unset when neither date parses');
  else fail(`parseDarwinboxResponse() bad dates: ${JSON.stringify(job)}`);
}

// Salary is attached only for real annual figures.
{
  const salaryOf = (extra) => parseDarwinboxResponse(envelope([row('a1', extra)]), 'Acme', BOARD)[0].salary;
  if (salaryOf({ salary_timeframe: 'Monthly' }) === undefined) pass('a monthly salary is left out rather than converted');
  else fail('a monthly salary was attached');
  if (salaryOf({ salary_min: 'negotiable', salary_max: '0' }) === undefined) pass('non-numeric and zero salary figures are left out');
  else fail('a junk salary was attached');
  const oneSided = salaryOf({ salary_min: '', salary_max: '900000' });
  if (oneSided?.max === 900000 && !('min' in oneSided)) pass('a one-sided salary keeps only the bound it states');
  else fail(`one-sided salary wrong: ${JSON.stringify(oneSided)}`);
}

// jobLocation()
if (
  jobLocation({ tool_tip_locations: ['Pune, India', 'Pune, India', 'Dubai, UAE'], locations: 'Multiple Locations' }) === 'Pune, India; Dubai, UAE' &&
  jobLocation({ locations: 'Head Office, Pune, Maharashtra\r, India' }) === 'Head Office, Pune, Maharashtra, India' &&
  jobLocation({ tool_tip_locations: [], locations: 'Pune' }) === 'Pune' &&
  jobLocation({ tool_tip_locations: [null, 42] }) === '' &&
  jobLocation({}) === '' && jobLocation(null) === ''
) pass('jobLocation() joins distinct sites, falls back to the display string, tolerates junk');
else fail('jobLocation() wrong');

// A lone surrogate in an id drops that posting only (encodeURIComponent would throw).
{
  let out; let threw = null;
  try { out = parseDarwinboxResponse(envelope([row('\uD800bad'), row('a7')]), 'Acme', BOARD); } catch (err) { threw = err; }
  if (!threw && out.length === 1 && out[0].url.endsWith('/jobDetails/a7')) pass('parseDarwinboxResponse() drops a lone-surrogate id and keeps the rest');
  else fail(`parseDarwinboxResponse() surrogate: ${threw?.message} ${JSON.stringify(out)}`);
}

// Empty vs broken envelope.
if (parseDarwinboxResponse(envelope([]), 'Acme', BOARD).length === 0) pass('parseDarwinboxResponse() returns [] for a present-and-empty data array');
else fail('parseDarwinboxResponse() empty board wrong');
for (const [body, label] of [
  [{}, '{}'],
  [{ status: 'success' }, 'a missing data key'],
  [{ status: 'success', data: null }, 'a null data key'],
  [{ status: 'success', data: {} }, 'a non-array data key'],
  [{ status: 'error', data: [] }, 'a status other than success'],
  [{ jobs: [] }, 'a different container key'],
  [[], 'a bare array'],
  [null, 'null'],
  ['', 'an empty body'],
  [42, 'a number'],
  ['<html>', 'an HTML body'],
]) {
  let msg = null;
  try { parseDarwinboxResponse(body, 'Acme', BOARD); } catch (err) { msg = err.message; }
  if (msg && /darwinbox: unexpected response/.test(msg)) pass(`parseDarwinboxResponse() throws descriptively on ${label}`);
  else fail(`parseDarwinboxResponse() should throw on ${label}, got ${msg}`);
}
{
  let msg = '';
  try { parseDarwinboxResponse({ error: 'x', jobs: [] }, 'Acme', BOARD); } catch (err) { msg = err.message; }
  if (/\[error, jobs\]/.test(msg)) pass('the unexpected-response error names the keys it got');
  else fail(`error does not name the keys: ${msg}`);
}

// resolveMaxPages()
if (
  resolveMaxPages({}) === 20 && resolveMaxPages({ max_pages: 3 }) === 3 && resolveMaxPages({ max_pages: 99999 }) === 200 &&
  resolveMaxPages({ max_pages: 0 }) === 20 && resolveMaxPages({ max_pages: 'many' }) === 20
) pass('resolveMaxPages() honours a positive integer up to the hard ceiling');
else fail('resolveMaxPages() wrong');

// fetch() — the host guard runs before any request.
{
  let calls = 0; let err = null;
  const stub = async () => { calls++; return envelope([]); };
  for (const entry of [
    { name: 'Acme', careers_url: 'https://careers.example.com/jobs' },
    { name: 'Acme', careers_url: ORIGIN },
  ]) {
    err = null;
    try { await darwinbox.fetch(entry, { fetchJson: stub }); } catch (e) { err = e; }
    if (err && /cannot derive a board/.test(err.message) && calls === 0) pass(`darwinbox.fetch() rejects ${entry.careers_url} before any request`);
    else fail(`darwinbox.fetch() guard: err=${err?.message} calls=${calls}`);
  }
}

/** A ctx whose fetchJson serves `pages` in order and records every call. */
function pagedCtx(pages, extra = {}) {
  const calls = [];
  const sleeps = [];
  return {
    calls,
    sleeps,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts, body: JSON.parse(opts.body) });
      const page = pages[calls.length - 1];
      if (page instanceof Error) throw page;
      return page;
    },
    ...extra,
  };
}
const fullPage = (prefix, jobCounts) => envelope(Array.from({ length: PAGE_SIZE }, (_, i) => row(`${prefix}${i}`)), jobCounts);

// fetch() — request shape, rebuilt from the host and the company id only.
{
  const ctx = pagedCtx([envelope([row('a1'), row('a2')])]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: 'https://acme.darwinbox.in:9999/ms/candidatev2/main/careers/home?x=1' }, ctx);
  if (jobs.length === 2 && jobs[0].company === 'Acme') pass('darwinbox.fetch() returns the normalized jobs');
  else fail(`darwinbox.fetch() jobs: ${JSON.stringify(jobs)}`);
  const [call] = ctx.calls;
  if (ctx.calls.length === 1 && call.url === ENDPOINT) pass('darwinbox.fetch() stops on a short first page and discards the input port and path');
  else fail(`darwinbox.fetch() urls: ${JSON.stringify(ctx.calls.map((c) => c.url))}`);
  if (call?.opts.method === 'POST' && call.body.companyId === 'main' && call.body.page === 1 && call.body.limit === PAGE_SIZE) pass('darwinbox.fetch() POSTs the company id, a 1-based page and the page size');
  else fail(`darwinbox.fetch() request: ${JSON.stringify(call)}`);
  if (ctx.sleeps.length === 0) pass('darwinbox.fetch() does not delay before the first page');
  else fail(`darwinbox.fetch() slept before page 1: ${ctx.sleeps}`);
}

// fetch() — a tenant-specific company id reaches both the request and the posting URLs.
{
  const ctx = pagedCtx([envelope([row('a1')])]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: `${ORIGIN}/ms/candidatev2/5ffc190a05f27/careers/allJobs` }, ctx);
  if (
    ctx.calls[0].url === `${ORIGIN}/ms/candidateapi/job/alljobs?companyId=5ffc190a05f27` &&
    ctx.calls[0].body.companyId === '5ffc190a05f27' &&
    jobs[0].url === `${ORIGIN}/ms/candidatev2/5ffc190a05f27/careers/jobDetails/a1`
  ) pass('darwinbox.fetch() carries a tenant-specific company id through');
  else fail(`darwinbox.fetch() company id: ${ctx.calls[0].url} ${jobs[0]?.url}`);
}

// fetch() — a darwinbox.com tenant is read from its own host, not rewritten to darwinbox.in.
{
  const ctx = pagedCtx([envelope([row('a1')])]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: 'https://acme.darwinbox.com:9999/ms/candidatev2/main/careers/home' }, ctx);
  if (
    ctx.calls.length === 1 &&
    ctx.calls[0].url === `${COM_ORIGIN}/ms/candidateapi/job/alljobs?companyId=main` &&
    ctx.calls[0].opts.redirect === 'error' &&
    jobs[0].url === `${COM_ORIGIN}/ms/candidatev2/main/careers/jobDetails/a1`
  ) pass('darwinbox.fetch() reads a darwinbox.com tenant from its own host');
  else fail(`darwinbox.fetch() darwinbox.com: ${JSON.stringify(ctx.calls.map((c) => c.url))} ${jobs[0]?.url}`);
}

// fetch() — walks until a short page, paced, refusing redirects on every request.
{
  const ctx = pagedCtx([fullPage('a', 72), fullPage('b', 72), envelope([row('c1'), row('c2')], 72)]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx);
  if (jobs.length === 102 && ctx.calls.length === 3 && ctx.calls.map((c) => c.body.page).join() === '1,2,3') pass('darwinbox.fetch() walks pages until a short one');
  else fail(`darwinbox.fetch() walk: ${jobs.length} jobs, pages ${ctx.calls.map((c) => c.body.page)}`);
  if (ctx.calls.every((c) => c.opts.redirect === 'error')) pass('darwinbox.fetch() passes redirect: error on every page');
  else fail(`darwinbox.fetch() redirect opts: ${JSON.stringify(ctx.calls.map((c) => c.opts.redirect))}`);
  if (ctx.sleeps.length === 2) pass('darwinbox.fetch() delays only between pages');
  else fail(`darwinbox.fetch() sleeps: ${ctx.sleeps}`);
  if (jobs.truncated === undefined) pass('a board read to its end is not marked truncated');
  else fail(`darwinbox.fetch() marked a complete walk: ${JSON.stringify(jobs.truncated)}`);
}

// fetch() — an exact multiple of the page size ends on the empty page after it.
{
  const ctx = pagedCtx([fullPage('a', PAGE_SIZE), envelope([], PAGE_SIZE)]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx);
  if (jobs.length === PAGE_SIZE && ctx.calls.length === 2) pass('darwinbox.fetch() stops on an empty page');
  else fail(`darwinbox.fetch() empty page: ${jobs.length} jobs, ${ctx.calls.length} calls`);
}

// fetch() — the short-page stop reads the source's row count, not the rows kept.
{
  const withBadRow = fullPage('a', 51);
  withBadRow.data[0] = row('bad', { title: '' });
  const ctx = pagedCtx([withBadRow, envelope([row('b1')], 51)]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx);
  if (ctx.calls.length === 2 && jobs.length === PAGE_SIZE) pass('a full page with a malformed row does not end the walk');
  else fail(`darwinbox.fetch() malformed row: ${ctx.calls.length} calls, ${jobs.length} jobs`);
}

// fetch() — a posting that shifts across pages mid-walk is returned once.
{
  const ctx = pagedCtx([fullPage('a', 51), envelope([row('a49')], 51)]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx);
  if (jobs.length === PAGE_SIZE) pass('darwinbox.fetch() de-duplicates a posting seen on two pages');
  else fail(`darwinbox.fetch() dedup: ${jobs.length} jobs`);
}

// fetch() — the provider's own page ceiling, whatever the source reports.
{
  const pages = Array.from({ length: 30 }, (_, i) => fullPage(`p${i}x`, 5000));
  const ctx = pagedCtx(pages);
  let jobs;
  const logged = await captureErrors(async () => { jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx); });
  if (ctx.calls.length === 20 && jobs.length === 20 * PAGE_SIZE) pass('darwinbox.fetch() stops at DEFAULT_MAX_PAGES even when the source reports more');
  else fail(`darwinbox.fetch() cap: ${ctx.calls.length} calls, ${jobs?.length} jobs`);
  if (logged.some((l) => /truncated at max_pages=20 \(1000 of 5000 jobs\) — raise max_pages/.test(l))) pass('darwinbox.fetch() warns when the ceiling truncated the board');
  else fail(`darwinbox.fetch() cap warning: ${JSON.stringify(logged)}`);
  const t = jobs?.truncated;
  if (t?.reason === 'page-cap' && t.fetched === 1000 && t.total === 5000) pass('a page-cap stop marks the result truncated, with the counts');
  else fail(`darwinbox.fetch() page-cap marker: ${JSON.stringify(t)}`);
}
{
  const ctx = pagedCtx([fullPage('a'), fullPage('b'), fullPage('c')]);
  await captureErrors(() => darwinbox.fetch({ name: 'Acme', careers_url: CAREERS, max_pages: 2 }, ctx));
  if (ctx.calls.length === 2) pass('darwinbox.fetch() honours max_pages on the entry');
  else fail(`darwinbox.fetch() max_pages: ${ctx.calls.length} calls`);
}
// Only a short page proves the board ended: a full page at the cap is a page-cap stop,
// whatever total the source reports.
{
  const ctx = pagedCtx([fullPage('a', 100), fullPage('b', 100)]);
  let jobs;
  const logged = await captureErrors(async () => { jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS, max_pages: 2 }, ctx); });
  if (jobs?.truncated?.reason === 'page-cap' && logged.some((l) => /truncated at max_pages=2 \(100 jobs\) — raise max_pages/.test(l))) pass('a full page at the cap stays a page-cap stop even when the reported total matches what was read');
  else fail(`darwinbox.fetch() matching total: ${JSON.stringify(logged)} ${JSON.stringify(jobs?.truncated)}`);
}
{
  // The source reports 72 postings but serves 102: an under-reported total must not hide the cap.
  const ctx = pagedCtx([fullPage('a', 72), fullPage('b', 72), envelope([row('c1'), row('c2')], 72)]);
  let jobs;
  const logged = await captureErrors(async () => { jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS, max_pages: 2 }, ctx); });
  const t = jobs?.truncated;
  if (ctx.calls.length === 2 && jobs?.length === 2 * PAGE_SIZE && t?.reason === 'page-cap' && t.fetched === 2 * PAGE_SIZE && !('total' in t)) pass('an under-reported total does not hide a page-cap stop, and is left out of the marker');
  else fail(`darwinbox.fetch() under-reported total: ${ctx.calls.length} calls, ${jobs?.length} jobs, ${JSON.stringify(t)}`);
  if (logged.some((l) => /truncated at max_pages=2 \(100 jobs\) — raise max_pages/.test(l))) pass('the cap warning does not quote a total below what was read');
  else fail(`darwinbox.fetch() under-reported total warning: ${JSON.stringify(logged)}`);
}
{
  const ctx = pagedCtx([fullPage('a', 60), envelope([row('b1')], 60)]);
  const logged = await captureErrors(() => darwinbox.fetch({ name: 'Acme', careers_url: CAREERS, max_pages: 2 }, ctx));
  if (logged.length === 0) pass('no truncation warning when the last page allowed is a short one');
  else fail(`darwinbox.fetch() false cap warning on a short page: ${JSON.stringify(logged)}`);
}

// fetch() — probe cooperation: one list request, no warning, rejections unwrapped.
{
  const ctx = pagedCtx([fullPage('a', 5000), fullPage('b', 5000)], { maxPages: 1 });
  let jobs;
  const logged = await captureErrors(async () => { jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx); });
  if (ctx.calls.length === 1) pass('darwinbox.fetch() issues exactly one list request under ctx.maxPages: 1');
  else fail(`darwinbox.fetch() probe: ${ctx.calls.length} calls`);
  if (logged.length === 0) pass('the probe cap does not fire the raise-max_pages warning');
  else fail(`darwinbox.fetch() probe warned: ${JSON.stringify(logged)}`);
  if (jobs?.truncated === undefined) pass('the probe cap does not mark the result truncated');
  else fail(`darwinbox.fetch() probe marked: ${JSON.stringify(jobs?.truncated)}`);
}
{
  const boom = new Error('budget');
  let got = null;
  // Repeated because the shared retry helper retries a transport-shaped error.
  try { await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, pagedCtx([boom, boom, boom], { maxPages: 1 })); } catch (e) { got = e; }
  if (got === boom) pass('darwinbox.fetch() propagates a fetch failure unwrapped during a probe');
  else fail(`darwinbox.fetch() probe rejection was wrapped: ${got?.message}`);
  got = null;
  try { await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, pagedCtx([fullPage('a'), boom, boom, boom], { maxPages: 2 })); } catch (e) { got = e; }
  if (got === boom) pass('darwinbox.fetch() propagates a later-page failure unwrapped during a probe');
  else fail(`darwinbox.fetch() later-page probe rejection: ${got?.message}`);
}

// fetch() — failures in a real scan.
{
  const dead = new Error('Internal Server Error');
  dead.status = 500;
  let got = null;
  const ctx = pagedCtx([dead, dead, dead]);
  try { await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx); } catch (e) { got = e; }
  if (got?.status === 500 && ctx.calls.length === 3) pass('darwinbox.fetch() throws when the first page fails after retries, rather than reading as empty');
  else fail(`darwinbox.fetch() first-page failure: ${got?.message} after ${ctx.calls.length} calls`);
}
{
  const unavailable = new Error('Service Unavailable');
  unavailable.status = 503;
  const ctx = pagedCtx([fullPage('a', 120), unavailable, fullPage('b', 120), envelope([row('c1')], 120)]);
  const jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx);
  if (jobs.length === 2 * PAGE_SIZE + 1 && ctx.calls.length === 4) pass('darwinbox.fetch() retries a transient 503 and finishes the walk');
  else fail(`darwinbox.fetch() retry: ${jobs.length} jobs, ${ctx.calls.length} calls`);
}
{
  const unavailable = new Error('Service Unavailable');
  unavailable.status = 503;
  const ctx = pagedCtx([fullPage('a', 120), unavailable, unavailable, unavailable]);
  let jobs;
  const logged = await captureErrors(async () => { jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx); });
  if (jobs?.length === PAGE_SIZE) pass('darwinbox.fetch() keeps the pages collected when a later page exhausts its retries');
  else fail(`darwinbox.fetch() partial: ${jobs?.length} jobs`);
  if (logged.some((l) => /stopped at page 2/.test(l)) && !logged.some((l) => /raise max_pages/.test(l))) pass('a fetch-error stop warns without blaming max_pages');
  else fail(`darwinbox.fetch() fetch-error warning: ${JSON.stringify(logged)}`);
  const t = jobs?.truncated;
  if (t?.reason === 'fetch-error' && t.fetched === PAGE_SIZE && t.total === 120) pass('a later-page failure marks the result truncated, with the counts');
  else fail(`darwinbox.fetch() fetch-error marker: ${JSON.stringify(t)}`);
}
{
  const ctx = pagedCtx([fullPage('a', 120), { message: 'maintenance' }]);
  let jobs;
  const logged = await captureErrors(async () => { jobs = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, ctx); });
  if (jobs?.length === PAGE_SIZE && logged.some((l) => /stopped at page 2.*unexpected response/.test(l))) pass('a broken envelope on a later page keeps the pages collected and names the cause');
  else fail(`darwinbox.fetch() later broken envelope: ${jobs?.length} jobs, ${JSON.stringify(logged)}`);
  if (jobs?.truncated?.reason === 'fetch-error') pass('a broken envelope on a later page marks the result truncated');
  else fail(`darwinbox.fetch() broken-envelope marker: ${JSON.stringify(jobs?.truncated)}`);
}
{
  let msg = '';
  try { await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, pagedCtx([{ message: 'maintenance' }])); } catch (e) { msg = e.message; }
  if (/unexpected response/.test(msg)) pass('darwinbox.fetch() throws on a broken envelope on the first page');
  else fail(`darwinbox.fetch() first-page broken envelope: ${msg}`);
  const empty = await darwinbox.fetch({ name: 'Acme', careers_url: CAREERS }, pagedCtx([envelope([])]));
  if (Array.isArray(empty) && empty.length === 0) pass('darwinbox.fetch() returns [] for a live empty board');
  else fail(`darwinbox.fetch() empty: ${JSON.stringify(empty)}`);
}
