// tests/providers/turbohire.test.mjs — TurboHire careers-page provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — turbohire (TurboHire careers page)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/turbohire.mjs')).href);
const turbohire = mod.default;
const { parseTurbohireResponse, jobLocation, employerName, postingSegment, resolveTenant } = mod;
const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);

const ORIGIN = 'https://acme.turbohire.co';
const BOARD = { tenant: 'acme', origin: ORIGIN };
const API = 'https://thapi.azurewebsites.net';
const ORG_ID = '1b2c3d4e-0000-4000-8000-00000000abcd';
const TOKEN_URL = `${API}/api/token/noauth`;
const ORG_URL = `${API}/api/publicorganizations?accountName=acme`;
const JOBS_URL = `${API}/api/careerpagev2/filteredjobs?orgId=${ORG_ID}&pageType=0`;
const ENTRY = { name: 'Acme', careers_url: `${ORIGIN}/` };

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

if (turbohire.id === 'turbohire') pass('turbohire.id is "turbohire"');
else fail(`turbohire.id is ${JSON.stringify(turbohire.id)}`);

// detect() — claims any path on a tenant host, rebuilds the URL itself.
const detectCases = [
  [{ careers_url: `${ORIGIN}/` }, 'the tenant root'],
  [{ careers_url: ORIGIN }, 'the bare tenant host'],
  [{ careers_url: `${ORIGIN}/dashboardv2?orgId=${ORG_ID}` }, 'the dashboard page with a query'],
  [{ careers_url: `${ORIGIN}/job/publicjobs/AbC%2FdEf_gh-1` }, 'a posting link'],
  [{ careers_url: 'https://ACME.turbohire.co/x#y' }, 'an upper-case host with a fragment'],
  [{ careers_url: 'https://acme.turbohire.co:8443/' }, 'a tenant host carrying a port'],
  [{ api: `${ORIGIN}/` }, 'the api: field'],
  [{ careers_url: 'https://acme-group2.turbohire.co/' }, 'a tenant label with a hyphen and a digit'],
];
for (const [entry, label] of detectCases) {
  const got = turbohire.detect(entry);
  const want = entry.careers_url?.toLowerCase().includes('acme-group2') ? 'https://acme-group2.turbohire.co/' : `${ORIGIN}/`;
  if (got?.url === want) pass(`turbohire.detect() claims ${label}`);
  else fail(`turbohire.detect() ${label}: ${JSON.stringify(got)}`);
}
const rejectCases = [
  [{ careers_url: 'http://acme.turbohire.co/' }, 'non-HTTPS'],
  [{ careers_url: 'https://acme.turbohire.co.evil.example/' }, 'look-alike host (trailing suffix)'],
  [{ careers_url: 'https://evilturbohire.co/' }, 'suffix look-alike host'],
  [{ careers_url: 'https://acme-turbohire.co/' }, 'hyphen look-alike host'],
  [{ careers_url: 'https://a.b.turbohire.co/' }, 'two tenant labels'],
  [{ careers_url: 'https://-acme.turbohire.co/' }, 'label starting with a hyphen'],
  [{ careers_url: 'https://turbohire.co/' }, 'the apex host'],
  [{ careers_url: 'https://app.turbohire.co/' }, 'the recruiter app host'],
  [{ careers_url: 'https://www.turbohire.co/' }, 'the website host'],
  [{ careers_url: 'https://api.turbohire.co/' }, 'the reports API host'],
  [{ careers_url: 'https://acme.turbohire.com/' }, 'a different TLD'],
  [{ careers_url: `${API}/api/token/noauth` }, 'the API host itself'],
  [{ careers_url: 'https://careers.example.com/jobs' }, 'a branded careers page'],
  [{ careers_url: 'not a url' }, 'a malformed URL'],
  [{ careers_url: null }, 'null careers_url'],
  [{ careers_url: 42 }, 'non-string careers_url'],
  [{}, 'missing careers_url'],
  [null, 'a null entry'],
];
for (const [entry, label] of rejectCases) {
  let got;
  try { got = turbohire.detect(entry); } catch (err) { got = `threw ${err.message}`; }
  if (got === null) pass(`turbohire.detect() returns null for ${label}`);
  else fail(`turbohire.detect() ${label}: ${JSON.stringify(got)}`);
}
{
  const got = resolveTenant({ api: 'https://www.example.com/', careers_url: `${ORIGIN}/` });
  if (got?.tenant === 'acme' && got?.origin === ORIGIN) pass('resolveTenant() falls through to careers_url when api: is not a tenant');
  else fail(`resolveTenant() did not fall through: ${JSON.stringify(got)}`);
}

// The registry routes a tenant URL to this provider.
{
  const realError = console.error;
  console.error = () => {};
  const providers = await loadProviders(join(ROOT, 'providers'));
  console.error = realError;
  const routed = resolveProvider({ name: 'Acme', careers_url: `${ORIGIN}/` }, providers);
  if (routed?.provider?.id === 'turbohire') pass('the registry routes a <tenant>.turbohire.co URL to turbohire');
  else fail(`registry routed a turbohire URL to ${routed?.provider?.id}`);
}

// Normalization of the live response shape.
const row = (id, extra = {}) => ({
  JobId: `0000000${id}-0000-4000-8000-000000000000`,
  JobIdObfuscated: id,
  JobCode: `REQ_${id}`,
  JobTitle: `Engineer ${id}`,
  PublishedDate: '2026-10-01T07:05:00.6942708Z',
  UpdatedDate: '2026-10-27T12:54:52.6233333',
  Location: JSON.stringify([{ Address: 'Pune, Maharashtra, India', PlaceId: null }]),
  ShowClientName: false,
  ClientName: '[REDACTED]',
  JobDescV2: '<h3>Overview</h3><p>Build <b>things</b> &amp; ship</p>',
  CreatedByEmail: 'recruiter@example.com',
  CreatedByName: 'Example Recruiter',
  ...extra,
});
const envelope = (rows, total = rows.length) => ({ Total: total, Result: rows });

{
  const parsed = parseTurbohireResponse(envelope([
    row('a1'),
    row('a2', { PublishedDate: '', JobCode: '', JobDescV2: '', Location: '' }),
    row('a3', { JobTitle: '   ' }),
    row(null),
    row(''),
    row('a4', { JobTitle: '  R&amp;D   Engineer  ' }),
    null,
    'junk',
  ]), 'Acme', BOARD);
  const [j1, j2, j4] = parsed;
  if (parsed.length === 3) pass('parseTurbohireResponse() drops rows without a title or an id, and non-object rows');
  else fail(`parseTurbohireResponse() kept ${parsed.length} rows: ${JSON.stringify(parsed.map((j) => j.url))}`);
  if (
    j1?.title === 'Engineer a1' &&
    j1.url === `${ORIGIN}/job/publicjobs/a1` &&
    j1.company === 'Acme' &&
    j1.location === 'Pune, Maharashtra, India' &&
    j1.requisitionId === 'REQ_a1'
  ) pass('parseTurbohireResponse() maps title/url/company/location/requisitionId');
  else fail(`parseTurbohireResponse() row 1 wrong: ${JSON.stringify(j1)}`);
  if (j1?.postedAt === Date.parse('2026-10-01T07:05:00.694Z')) pass('parseTurbohireResponse() reads PublishedDate, seven fraction digits and all');
  else fail(`parseTurbohireResponse() postedAt wrong: ${j1?.postedAt}`);
  if (j1?.description === 'Overview Build things & ship') pass('parseTurbohireResponse() reduces JobDescV2 to plain text');
  else fail(`parseTurbohireResponse() description wrong: ${JSON.stringify(j1?.description)}`);
  if (j2 && !('postedAt' in j2) && !('requisitionId' in j2) && !('description' in j2) && j2.location === '') pass('parseTurbohireResponse() leaves optional fields unset when empty, and never falls back to UpdatedDate');
  else fail(`parseTurbohireResponse() row 2 wrong: ${JSON.stringify(j2)}`);
  if (j4?.title === 'R&D Engineer') pass('parseTurbohireResponse() decodes entities and collapses whitespace in a title');
  else fail(`parseTurbohireResponse() title wrong: ${JSON.stringify(j4?.title)}`);
  const leaked = parsed.filter((j) => /recruiter|example\.com/i.test(JSON.stringify(j)));
  if (leaked.length === 0) pass('parseTurbohireResponse() keeps nothing from the recruiter fields');
  else fail(`parseTurbohireResponse() carried recruiter fields: ${JSON.stringify(leaked)}`);
}

// A date that cannot be read leaves postedAt unset.
{
  const [job] = parseTurbohireResponse(envelope([row('a1', { PublishedDate: 'soon' })]), 'Acme', BOARD);
  if (job && !('postedAt' in job)) pass('parseTurbohireResponse() leaves postedAt unset when PublishedDate does not parse');
  else fail(`parseTurbohireResponse() bad date: ${JSON.stringify(job)}`);
}

// A posting listed twice comes back once.
{
  const parsed = parseTurbohireResponse(envelope([row('a1'), row('a1')]), 'Acme', BOARD);
  if (parsed.length === 1) pass('parseTurbohireResponse() de-duplicates a posting listed twice');
  else fail(`parseTurbohireResponse() dedup: ${parsed.length} jobs`);
}

// postingSegment() — the obfuscated id arrives percent-encoded and must stay that way.
{
  const cases = [
    ['uiv4JEq5%2FquZ_m-9', 'uiv4JEq5%2FquZ_m-9', 'a pre-encoded slash round-trips unchanged'],
    ['abc%2Bdef%3D', 'abc%2Bdef%3D', 'pre-encoded + and = round-trip unchanged'],
    ['abc+def/ghi', 'abc%2Bdef%2Fghi', 'a raw + and / are encoded'],
    ['abc%zz', null, 'a malformed escape drops the posting'],
    ['abc%ED%A0%80', null, 'an encoded lone surrogate drops the posting'],
    ['\uD800bad', null, 'a raw lone surrogate drops the posting'],
    ['', null, 'an empty id drops the posting'],
    [null, null, 'a null id drops the posting'],
  ];
  for (const [input, want, label] of cases) {
    let got;
    try { got = postingSegment(input); } catch (err) { got = `threw ${err.message}`; }
    if (got === want) pass(`postingSegment(): ${label}`);
    else fail(`postingSegment() ${label}: ${JSON.stringify(got)}`);
  }
}

// jobLocation()
if (
  jobLocation(JSON.stringify([{ Address: 'Pune, India' }, { Address: 'Pune, India' }, { Address: 'Mumbai,  India' }])) === 'Pune, India; Mumbai, India' &&
  jobLocation([{ Address: 'Pune, India' }]) === 'Pune, India' &&
  jobLocation('Pune, India') === 'Pune, India' &&
  jobLocation('[{"Address": broken') === '' &&
  jobLocation(JSON.stringify([{ Address: null }, 42, null, { PlaceId: 'x' }])) === '' &&
  jobLocation(JSON.stringify({ Address: 'Pune' })) === '' &&
  jobLocation('') === '' && jobLocation(undefined) === '' && jobLocation(null) === ''
) pass('jobLocation() joins distinct sites, accepts a parsed array or a plain string, tolerates junk');
else fail('jobLocation() wrong');

// employerName()
if (
  employerName({ ShowClientName: true, ClientName: 'Acme Motors Limited' }, 'Acme Group') === 'Acme Motors Limited' &&
  employerName({ ShowClientName: true, ClientName: '  Acme &amp; Sons ' }, 'Acme Group') === 'Acme & Sons' &&
  employerName({ ShowClientName: false, ClientName: 'Acme Motors Limited' }, 'Acme Group') === 'Acme Group' &&
  employerName({ ShowClientName: true, ClientName: '[REDACTED]' }, 'Acme Group') === 'Acme Group' &&
  employerName({ ShowClientName: true, ClientName: '' }, 'Acme Group') === 'Acme Group' &&
  employerName({ ShowClientName: true, ClientName: 'AcmeGroup' }, 'Acme Group') === 'Acme Group' &&
  employerName({ ShowClientName: 'true', ClientName: 'Acme Motors' }, 'Acme Group') === 'Acme Group' &&
  employerName(null, 'Acme Group') === 'Acme Group'
) pass('employerName() uses a shown client name, never a hidden one, and keeps the entry spelling for the same employer');
else fail('employerName() wrong');

// Empty vs broken envelope.
if (parseTurbohireResponse(envelope([]), 'Acme', BOARD).length === 0) pass('parseTurbohireResponse() returns [] for a present-and-empty Result array');
else fail('parseTurbohireResponse() empty board wrong');
for (const [body, label] of [
  [{}, '{}'],
  [{ Total: 0 }, 'a missing Result key'],
  [{ Total: 0, Result: null }, 'a null Result key'],
  [{ Total: 0, Result: {} }, 'a non-array Result key'],
  [{ jobs: [] }, 'a different container key'],
  [[], 'a bare array'],
  [null, 'null'],
  ['', 'an empty body'],
  [42, 'a number'],
  ['<html>', 'an HTML body'],
]) {
  let msg = null;
  try { parseTurbohireResponse(body, 'Acme', BOARD); } catch (err) { msg = err.message; }
  if (msg && /turbohire: unexpected response/.test(msg)) pass(`parseTurbohireResponse() throws descriptively on ${label}`);
  else fail(`parseTurbohireResponse() should throw on ${label}, got ${msg}`);
}
{
  let msg = '';
  try { parseTurbohireResponse({ error: 'x', jobs: [] }, 'Acme', BOARD); } catch (err) { msg = err.message; }
  if (/\[error, jobs\]/.test(msg)) pass('the unexpected-response error names the keys it got');
  else fail(`error does not name the keys: ${msg}`);
}

/**
 * A ctx whose fetchJson answers by URL. Each route is a list served in order
 * (the last item repeats); an Error item is thrown. Records every call.
 */
function routedCtx(routes, extra = {}) {
  const calls = [];
  const served = new Map();
  return {
    calls,
    sleep: async () => {},
    fetchJson: async (url, opts = {}) => {
      calls.push({ url, opts });
      const list = routes[url];
      if (!list) throw new Error(`unexpected request ${url}`);
      const i = served.get(url) ?? 0;
      served.set(url, i + 1);
      const answer = list[Math.min(i, list.length - 1)];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    ...extra,
  };
}
const liveRoutes = (jobs = envelope([row('a1'), row('a2')])) => ({
  [TOKEN_URL]: [{ access_token: 'anon-token', expires_in: 3600, OrgId: '00000000-0000-0000-0000-000000000000' }],
  [ORG_URL]: [{ OrgID: ORG_ID, OrgName: 'Acme Group', CareerPageSubdomain: 'acme' }],
  [JOBS_URL]: [jobs],
});
/** An idCache with the shape provider-id-cache.mjs hands a provider. */
function memoryCache(initial = {}) {
  const store = new Map(Object.entries(initial));
  return { store, get: (k) => store.get(k), set: (k, v) => store.set(k, v), delete: (k) => store.delete(k) };
}

// fetch() — the host guard runs before any request.
for (const entry of [
  { name: 'Acme', careers_url: 'https://careers.example.com/jobs' },
  { name: 'Acme', careers_url: 'https://app.turbohire.co/' },
  { name: 'Acme', careers_url: 'http://acme.turbohire.co/' },
]) {
  const ctx = routedCtx({});
  let err = null;
  try { await turbohire.fetch(entry, ctx); } catch (e) { err = e; }
  if (err && /cannot derive a tenant/.test(err.message) && ctx.calls.length === 0) pass(`turbohire.fetch() rejects ${entry.careers_url} before any request`);
  else fail(`turbohire.fetch() guard: err=${err?.message} calls=${ctx.calls.length}`);
}

// fetch() — the three requests the careers page makes, in order.
{
  const ctx = routedCtx(liveRoutes());
  const jobs = await turbohire.fetch({ name: 'Acme', careers_url: 'https://acme.turbohire.co:9999/dashboardv2?x=1' }, ctx);
  if (jobs.length === 2 && jobs[0].company === 'Acme' && jobs[0].url === `${ORIGIN}/job/publicjobs/a1`) pass('turbohire.fetch() returns the normalized jobs on the tenant origin, without the input port or path');
  else fail(`turbohire.fetch() jobs: ${JSON.stringify(jobs)}`);
  const [token, org, list] = ctx.calls;
  if (ctx.calls.map((c) => c.url).join(' ') === `${TOKEN_URL} ${ORG_URL} ${JOBS_URL}`) pass('turbohire.fetch() requests the token, then the org id, then the public job list');
  else fail(`turbohire.fetch() urls: ${JSON.stringify(ctx.calls.map((c) => c.url))}`);
  if (ctx.calls.every((c) => c.opts.redirect === 'error')) pass('turbohire.fetch() passes redirect: error on every request');
  else fail(`turbohire.fetch() redirect opts: ${JSON.stringify(ctx.calls.map((c) => c.opts.redirect))}`);
  if (token?.opts.headers?.origin === ORIGIN && token.opts.headers.referer === `${ORIGIN}/` && !token.opts.method) pass('the token request is a GET carrying the tenant careers page as Origin and Referer');
  else fail(`token request: ${JSON.stringify(token?.opts)}`);
  if (!('origin' in (org?.opts.headers ?? {})) && !('origin' in (list?.opts.headers ?? {}))) pass('only the token request sends an Origin header');
  else fail('a later request sent an Origin header');
  if (org?.opts.headers?.authorization === 'Bearer anon-token' && list?.opts.headers?.authorization === 'Bearer anon-token') pass('the org lookup and the job list carry the anonymous token');
  else fail(`authorization headers: ${org?.opts.headers?.authorization} / ${list?.opts.headers?.authorization}`);
  if (list?.opts.method === 'POST' && list.opts.body === '{}' && list.opts.headers['content-type'] === 'application/json') pass('the job list is a POST of an empty filter');
  else fail(`job list request: ${JSON.stringify(list?.opts)}`);
}

// fetch() — only the public careers page is ever requested.
{
  const ctx = routedCtx(liveRoutes());
  await turbohire.fetch(ENTRY, ctx);
  const pageTypes = ctx.calls.map((c) => new URL(c.url).searchParams.get('pageType')).filter((v) => v !== null);
  if (pageTypes.length === 1 && pageTypes[0] === '0') pass('turbohire.fetch() asks for pageType=0, the public careers page, and nothing else');
  else fail(`turbohire.fetch() page types: ${JSON.stringify(pageTypes)}`);
}

// fetch() — the org id is cached between scans.
{
  const cache = memoryCache({ acme: { id: ORG_ID, checkedAt: new Date().toISOString() } });
  const ctx = routedCtx(liveRoutes(), { idCache: cache });
  const jobs = await turbohire.fetch(ENTRY, ctx);
  if (jobs.length === 2 && ctx.calls.length === 2 && !ctx.calls.some((c) => c.url === ORG_URL)) pass('turbohire.fetch() skips the org lookup when a fresh id is cached');
  else fail(`turbohire.fetch() cached: ${ctx.calls.map((c) => c.url)}`);
}
{
  const cache = memoryCache();
  const ctx = routedCtx(liveRoutes(), { idCache: cache });
  await turbohire.fetch(ENTRY, ctx);
  if (cache.store.get('acme')?.id === ORG_ID) pass('turbohire.fetch() stores a looked-up org id under the tenant');
  else fail(`turbohire.fetch() cache store: ${JSON.stringify([...cache.store])}`);
}

// fetch() — an unknown tenant.
{
  const notFound = Object.assign(new Error('Not Found'), { status: 404 });
  const cache = memoryCache({ acme: { id: ORG_ID, checkedAt: '2000-01-01T00:00:00.000Z' } });
  const ctx = routedCtx({ ...liveRoutes(), [ORG_URL]: [notFound] }, { idCache: cache });
  let err = null;
  try { await turbohire.fetch(ENTRY, ctx); } catch (e) { err = e; }
  if (err?.status === 404 && /no TurboHire tenant "acme"/.test(err.message)) pass('turbohire.fetch() names an unknown tenant when the org lookup answers 404');
  else fail(`turbohire.fetch() unknown tenant: ${err?.status} ${err?.message}`);
  if (!cache.store.has('acme') && !ctx.calls.some((c) => c.url === JOBS_URL)) pass('a 404 drops the stale cached org id and requests no job list');
  else fail(`turbohire.fetch() 404 cache: ${JSON.stringify([...cache.store])}, calls ${ctx.calls.map((c) => c.url)}`);
}

// fetch() — a token or org response in the wrong shape stops the scan loudly.
for (const [answer, label] of [[{}, 'no access_token'], [{ access_token: '  ' }, 'a blank access_token'], [null, 'a null body']]) {
  const ctx = routedCtx({ ...liveRoutes(), [TOKEN_URL]: [answer] });
  let msg = '';
  try { await turbohire.fetch(ENTRY, ctx); } catch (e) { msg = e.message; }
  if (/returned no access_token/.test(msg) && ctx.calls.length === 1) pass(`turbohire.fetch() throws on a token response with ${label}, before any other request`);
  else fail(`turbohire.fetch() token ${label}: ${msg}, ${ctx.calls.length} calls`);
}
for (const [answer, label] of [
  [{ OrgName: 'Acme' }, 'no OrgID'],
  [{ OrgID: '00000000-0000-0000-0000-000000000000' }, 'the nil GUID'],
  [{ OrgID: '../../etc' }, 'an OrgID that is not a GUID'],
]) {
  const ctx = routedCtx({ ...liveRoutes(), [ORG_URL]: [answer] });
  let msg = '';
  try { await turbohire.fetch(ENTRY, ctx); } catch (e) { msg = e.message; }
  if (/returned no org id/.test(msg) && !ctx.calls.some((c) => c.url.includes('filteredjobs'))) pass(`turbohire.fetch() throws on an org response with ${label}, before the job list`);
  else fail(`turbohire.fetch() org ${label}: ${msg}`);
}

// fetch() — a response that holds fewer rows than its Total warns.
{
  const ctx = routedCtx(liveRoutes(envelope([row('a1')], 5)));
  let jobs;
  const logged = await captureErrors(async () => { jobs = await turbohire.fetch(ENTRY, ctx); });
  if (jobs?.length === 1 && logged.some((l) => /returned 1 of 5 postings/.test(l))) pass('turbohire.fetch() warns when the response holds fewer rows than its Total');
  else fail(`turbohire.fetch() total warning: ${JSON.stringify(logged)}`);
}
{
  const ctx = routedCtx(liveRoutes());
  const logged = await captureErrors(() => turbohire.fetch(ENTRY, ctx));
  if (logged.length === 0) pass('turbohire.fetch() logs nothing for a complete response');
  else fail(`turbohire.fetch() logged: ${JSON.stringify(logged)}`);
}

// fetch() — probe cooperation: one list request, rejections unwrapped.
{
  const ctx = routedCtx(liveRoutes(), { maxPages: 1 });
  await turbohire.fetch(ENTRY, ctx);
  if (ctx.calls.filter((c) => c.url === JOBS_URL).length === 1 && ctx.calls.length === 3) pass('turbohire.fetch() issues exactly one list request under ctx.maxPages: 1 (three requests in all)');
  else fail(`turbohire.fetch() probe: ${ctx.calls.map((c) => c.url)}`);
}
{
  const boom = new Error('budget');
  for (const url of [TOKEN_URL, ORG_URL, JOBS_URL]) {
    let got = null;
    // Repeated because the shared retry helper retries a transport-shaped error.
    try { await turbohire.fetch(ENTRY, routedCtx({ ...liveRoutes(), [url]: [boom, boom, boom] }, { maxPages: 1 })); } catch (e) { got = e; }
    if (got === boom) pass(`turbohire.fetch() propagates a failure of ${new URL(url).pathname} unwrapped during a probe`);
    else fail(`turbohire.fetch() probe rejection of ${url} was wrapped: ${got?.message}`);
  }
}

// fetch() — failures in a real scan.
{
  const dead = Object.assign(new Error('Internal Server Error'), { status: 500 });
  const ctx = routedCtx({ ...liveRoutes(), [JOBS_URL]: [dead, dead, dead] });
  let got = null;
  try { await turbohire.fetch(ENTRY, ctx); } catch (e) { got = e; }
  if (got?.status === 500 && ctx.calls.filter((c) => c.url === JOBS_URL).length === 3) pass('turbohire.fetch() throws when the job list fails after retries, rather than reading as empty');
  else fail(`turbohire.fetch() job list failure: ${got?.message} after ${ctx.calls.length} calls`);
}
{
  const unavailable = Object.assign(new Error('Service Unavailable'), { status: 503 });
  const ctx = routedCtx({ ...liveRoutes(), [TOKEN_URL]: [unavailable, { access_token: 'anon-token' }] });
  const jobs = await turbohire.fetch(ENTRY, ctx);
  if (jobs.length === 2 && ctx.calls.filter((c) => c.url === TOKEN_URL).length === 2) pass('turbohire.fetch() retries a transient 503 on the token request');
  else fail(`turbohire.fetch() token retry: ${jobs.length} jobs, ${ctx.calls.length} calls`);
}
{
  const forbidden = Object.assign(new Error('Forbidden'), { status: 403, body: '"Invalid request."' });
  const ctx = routedCtx({ ...liveRoutes(), [TOKEN_URL]: [forbidden] });
  let got = null;
  try { await turbohire.fetch(ENTRY, ctx); } catch (e) { got = e; }
  if (got?.status === 403 && ctx.calls.length === 1) pass('turbohire.fetch() fails on a refused token request without retrying or going further');
  else fail(`turbohire.fetch() refused token: ${got?.message}, ${ctx.calls.length} calls`);
}
{
  const ctx = routedCtx(liveRoutes({ message: 'maintenance' }));
  let msg = '';
  try { await turbohire.fetch(ENTRY, ctx); } catch (e) { msg = e.message; }
  if (/unexpected response/.test(msg)) pass('turbohire.fetch() throws on a broken job-list envelope');
  else fail(`turbohire.fetch() broken envelope: ${msg}`);
  const empty = await turbohire.fetch(ENTRY, routedCtx(liveRoutes(envelope([]))));
  if (Array.isArray(empty) && empty.length === 0) pass('turbohire.fetch() returns [] for a live empty board');
  else fail(`turbohire.fetch() empty: ${JSON.stringify(empty)}`);
}
