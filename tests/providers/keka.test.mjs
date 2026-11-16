// tests/providers/keka.test.mjs — Keka careers (embedjobs) provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — keka (Keka careers embedjobs feed)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/keka.mjs')).href);
const keka = mod.default;
const { parseKekaResponse, extractIdentifier, jobLocation, resolveOrigin } = mod;
const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);

const UUID = '0a1b2c3d-1111-4222-8333-444455556666';
const ORIGIN = 'https://acme.keka.com';
const FEED = `${ORIGIN}/careers/api/embedjobs/default/active/${UUID}`;
// The careers page is a shell; the identifier only shows up in the fragment path.
const SHELL = `<html><script>fetch('/ats/documents/${UUID}/careerportal/9f8e7d6c5b4a.html')</script></html>`;

if (keka.id === 'keka') pass('keka.id is "keka"');
else fail(`keka.id is ${JSON.stringify(keka.id)}`);

// detect() — claims a tenant host at any path, rebuilds the origin itself.
const detectCases = [
  [{ careers_url: 'https://acme.keka.com/careers' }, 'careers page'],
  [{ careers_url: 'https://acme.keka.com' }, 'bare tenant host'],
  [{ careers_url: 'https://ACME.keka.com/careers/jobdetails/12' }, 'upper-case host with a deeper path'],
  [{ careers_url: 'https://acme.keka.com:8443/careers' }, 'tenant host carrying a port'],
  [{ api: 'https://acme.keka.com/careers/api/embedjobs/default/active/x' }, 'api: field'],
];
for (const [entry, label] of detectCases) {
  const got = keka.detect(entry);
  if (got?.url === `${ORIGIN}/careers`) pass(`keka.detect() claims the ${label} and rebuilds https://<host>/careers`);
  else fail(`keka.detect() ${label}: ${JSON.stringify(got)}`);
}
const rejectCases = [
  [{ careers_url: 'http://acme.keka.com/careers' }, 'non-HTTPS'],
  [{ careers_url: 'https://acme.keka.com.evil.example/careers' }, 'look-alike host (trailing suffix)'],
  [{ careers_url: 'https://evilkeka.com/careers' }, 'suffix look-alike host'],
  [{ careers_url: 'https://acme-keka.com/careers' }, 'hyphen look-alike host'],
  [{ careers_url: 'https://a.b.keka.com/careers' }, 'two tenant labels'],
  [{ careers_url: 'https://-acme.keka.com/careers' }, 'label starting with a hyphen'],
  [{ careers_url: 'https://www.keka.com/careers' }, 'the vendor marketing host'],
  [{ careers_url: 'https://app.keka.com/' }, 'a vendor-owned subdomain'],
  [{ careers_url: 'https://careers.example.com/jobs' }, 'branded careers page'],
  [{ careers_url: 'not a url' }, 'malformed URL'],
  [{ careers_url: null }, 'null careers_url'],
  [{ careers_url: 42 }, 'non-string careers_url'],
  [{}, 'missing careers_url'],
  [null, 'a null entry'],
];
for (const [entry, label] of rejectCases) {
  let got;
  try { got = keka.detect(entry); } catch (err) { got = `threw ${err.message}`; }
  if (got === null) pass(`keka.detect() returns null for ${label}`);
  else fail(`keka.detect() ${label}: ${JSON.stringify(got)}`);
}
if (resolveOrigin({ api: 'https://www.keka.com', careers_url: 'https://acme.keka.com/careers' }) === ORIGIN) pass('resolveOrigin() falls through to careers_url when api: is not a tenant');
else fail('resolveOrigin() did not fall through to careers_url');

// The registry routes a tenant URL to this provider.
const realError = console.error;
console.error = () => {};
const providers = await loadProviders(join(ROOT, 'providers'));
console.error = realError;
const routed = resolveProvider({ name: 'Acme', careers_url: 'https://acme.keka.com/careers' }, providers);
if (routed?.provider?.id === 'keka') pass('the registry routes a <tenant>.keka.com URL to keka');
else fail(`registry routed a keka URL to ${routed?.provider?.id}`);

// extractIdentifier()
if (extractIdentifier(SHELL) === UUID && extractIdentifier(SHELL.toUpperCase().replace('/ATS/DOCUMENTS/', '/ats/documents/').replace('/CAREERPORTAL/', '/careerportal/')) === UUID) pass('extractIdentifier() reads the UUID out of the fragment path (case-insensitive, lower-cased)');
else fail('extractIdentifier() did not read the UUID');
for (const body of ['<html></html>', '', null, undefined, 42, "/ats/documents/not-a-uuid/careerportal/x.html"]) {
  if (extractIdentifier(body) === null) pass(`extractIdentifier() returns null for ${JSON.stringify(body)}`);
  else fail(`extractIdentifier() should be null for ${JSON.stringify(body)}`);
}

// Normalization of the live response shape.
const row = (id, extra = {}) => ({
  id,
  title: `Engineer ${id}`,
  description: '<div>Build <strong>things</strong> &amp; ship</div>',
  publishedOn: '2026-10-02T08:30:00.000Z',
  jobLocations: [{ id: 1, name: 'Acme HQ - Tower 2', city: 'Pune', state: 'MH', countryCode: 'IN', countryName: 'India' }],
  ...extra,
});
const parsed = parseKekaResponse([
  row(101),
  row(102, { publishedOn: 'soon', description: '', jobLocations: [] }),
  row(103, { title: '   ' }),
  row(null),
  row('', {}),
  row(104, { title: '  Data   Engineer  ' }),
  null,
  'junk',
], 'Acme', ORIGIN);
const [j1, j2, j4] = parsed;
if (parsed.length === 3) pass('parseKekaResponse() drops rows without a title or an id, and non-object rows');
else fail(`parseKekaResponse() kept ${parsed.length} rows: ${JSON.stringify(parsed.map((j) => j.url))}`);
if (
  j1?.title === 'Engineer 101' && j1.url === `${ORIGIN}/careers/jobdetails/101` && j1.company === 'Acme' &&
  j1.location === 'Pune, India' && j1.postedAt === Date.parse('2026-10-02T08:30:00.000Z') &&
  j1.description === 'Build things & ship'
) pass('parseKekaResponse() maps title/id/location/publishedOn/description');
else fail(`parseKekaResponse() row 1 wrong: ${JSON.stringify(j1)}`);
if (j2 && !('postedAt' in j2) && !('description' in j2) && j2.location === '') pass('parseKekaResponse() leaves postedAt and description unset when absent or unparseable');
else fail(`parseKekaResponse() row 2 wrong: ${JSON.stringify(j2)}`);
if (j4?.title === 'Data Engineer') pass('parseKekaResponse() collapses whitespace in a title');
else fail(`parseKekaResponse() title wrong: ${JSON.stringify(j4)}`);

// jobLocation()
if (
  jobLocation({ jobLocations: [{ city: 'Pune', countryName: 'India' }, { city: 'Pune', countryName: 'India' }, { city: 'Dubai', countryName: 'UAE' }] }) === 'Pune, India; Dubai, UAE' &&
  jobLocation({ jobLocations: [{ name: 'Remote Hub' }] }) === 'Remote Hub' &&
  jobLocation({ jobLocations: [null, 'x', {}] }) === '' && jobLocation({}) === ''
) pass('jobLocation() joins distinct places, falls back to the office name, tolerates junk');
else fail('jobLocation() wrong');

// A lone surrogate in an id drops that posting only (encodeURIComponent would throw).
{
  let out; let threw = null;
  try { out = parseKekaResponse([row('\uD800bad'), row(7)], 'Acme', ORIGIN); } catch (err) { threw = err; }
  if (!threw && out.length === 1 && out[0].url === `${ORIGIN}/careers/jobdetails/7`) pass('parseKekaResponse() drops a lone-surrogate id and keeps the rest');
  else fail(`parseKekaResponse() surrogate: ${threw?.message} ${JSON.stringify(out)}`);
}

// Empty vs broken envelope.
if (parseKekaResponse([], 'Acme', ORIGIN).length === 0) pass('parseKekaResponse() returns [] for a present-and-empty array');
else fail('parseKekaResponse() empty board wrong');
for (const [body, label] of [[{}, '{}'], [{ jobs: [] }, 'an object wrapping the array'], [null, 'null'], ['', 'an empty body'], [42, 'a number'], ['<html>', 'an HTML body']]) {
  let msg = null;
  try { parseKekaResponse(body, 'Acme', ORIGIN); } catch (err) { msg = err.message; }
  if (msg && /keka: unexpected response — expected a jobs array/.test(msg)) pass(`parseKekaResponse() throws descriptively on ${label}`);
  else fail(`parseKekaResponse() should throw on ${label}, got ${msg}`);
}
{
  let msg = '';
  try { parseKekaResponse({ error: 'x', jobs: [] }, 'Acme', ORIGIN); } catch (err) { msg = err.message; }
  if (/\[error, jobs\]/.test(msg)) pass('the unexpected-response error names the keys it got');
  else fail(`error does not name the keys: ${msg}`);
}

// fetch() — the host guard runs before any request.
{
  let calls = 0; let err = null;
  const stub = async () => { calls++; return ''; };
  try { await keka.fetch({ name: 'Acme', careers_url: 'https://careers.example.com/jobs' }, { fetchText: stub, fetchJson: stub }); } catch (e) { err = e; }
  if (err && /cannot derive a <tenant>\.keka\.com host/.test(err.message) && calls === 0) pass('keka.fetch() rejects an unrecognised host before any request');
  else fail(`keka.fetch() guard: err=${err?.message} calls=${calls}`);
}

// fetch() — two requests, URLs rebuilt from the host, redirect policy per request.
{
  const calls = [];
  const jobs = await keka.fetch({ name: 'Acme', careers_url: 'https://acme.keka.com:9999/careers/jobdetails/5?x=1' }, {
    sleep: async () => {},
    fetchText: async (url, opts) => { calls.push({ kind: 'text', url, opts }); return SHELL; },
    fetchJson: async (url, opts) => { calls.push({ kind: 'json', url, opts }); return [row(1), row(2)]; },
  });
  if (jobs.length === 2 && jobs[0].url === `${ORIGIN}/careers/jobdetails/1` && jobs[0].company === 'Acme') pass('keka.fetch() returns the normalized jobs');
  else fail(`keka.fetch() jobs: ${JSON.stringify(jobs)}`);
  if (calls.length === 2 && calls[0].url === `${ORIGIN}/careers` && calls[1].url === FEED) pass('keka.fetch() requests the careers shell then the feed, with the input port and path discarded');
  else fail(`keka.fetch() urls: ${JSON.stringify(calls.map((c) => c.url))}`);
  if (calls[0]?.opts?.redirect === 'manual' && calls[1]?.opts?.redirect === 'error') pass('keka.fetch() inspects (never follows) the shell redirect and refuses redirects on the feed');
  else fail(`keka.fetch() redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);
}

// fetch() — an unknown tenant (302 read under redirect:'manual') is a named missing tenant.
{
  let err = null;
  try {
    await keka.fetch({ name: 'Acme', careers_url: 'https://nosuch.keka.com/careers' }, {
      sleep: async () => {},
      fetchText: async () => { const e = new Error('redirect'); e.status = 302; e.location = '/careers/Content/TenantNotFound.html'; throw e; },
      fetchJson: async () => { throw new Error('feed must not be requested'); },
    });
  } catch (e) { err = e; }
  if (err && /no such tenant/.test(err.message) && err.status === 404 && /TenantNotFound/.test(err.message)) pass('keka.fetch() reports a 302 from the careers page as "no such tenant" (status 404)');
  else fail(`keka.fetch() unknown tenant: ${err?.message} status=${err?.status}`);
}

// fetch() — a shell without the identifier is a scraper break, not an empty board.
{
  let err = null; let feedCalls = 0;
  try {
    await keka.fetch({ name: 'Acme', careers_url: 'https://acme.keka.com/careers' }, {
      sleep: async () => {},
      fetchText: async () => '<html><body>Careers</body></html>',
      fetchJson: async () => { feedCalls++; return []; },
    });
  } catch (e) { err = e; }
  if (err && /missing the embedjobs identifier/.test(err.message) && feedCalls === 0) pass('keka.fetch() throws when the shell has no identifier, without requesting the feed');
  else fail(`keka.fetch() missing identifier: ${err?.message} feedCalls=${feedCalls}`);
}

// fetch() — empty board is [], a broken envelope throws.
{
  const ctx = (body) => ({ sleep: async () => {}, fetchText: async () => SHELL, fetchJson: async () => body });
  const empty = await keka.fetch({ name: 'Acme', careers_url: ORIGIN }, ctx([]));
  if (Array.isArray(empty) && empty.length === 0) pass('keka.fetch() returns [] for a live empty board');
  else fail(`keka.fetch() empty: ${JSON.stringify(empty)}`);
  let msg = '';
  try { await keka.fetch({ name: 'Acme', careers_url: ORIGIN }, ctx({ message: 'maintenance' })); } catch (e) { msg = e.message; }
  if (/unexpected response/.test(msg)) pass('keka.fetch() throws on a non-array feed body');
  else fail(`keka.fetch() broken envelope: ${msg}`);
}

// fetch() — a non-redirect failure on the shell, and a feed failure, propagate unwrapped
// (so a dead tenant reads as broken, and a probe's budget error keeps its identity).
{
  const boom = new Error('budget');
  let got = null;
  try {
    await keka.fetch({ name: 'Acme', careers_url: ORIGIN }, { maxPages: 1, sleep: async () => {}, fetchText: async () => { throw boom; }, fetchJson: async () => [] });
  } catch (e) { got = e; }
  if (got === boom) pass('keka.fetch() propagates a shell fetch failure unwrapped during a probe');
  else fail(`keka.fetch() shell rejection was wrapped: ${got?.message}`);

  got = null;
  try {
    await keka.fetch({ name: 'Acme', careers_url: ORIGIN }, { maxPages: 1, sleep: async () => {}, fetchText: async () => SHELL, fetchJson: async () => { throw boom; } });
  } catch (e) { got = e; }
  if (got === boom) pass('keka.fetch() propagates a feed fetch failure unwrapped during a probe');
  else fail(`keka.fetch() feed rejection was wrapped: ${got?.message}`);
}

// fetch() — probe cooperation: one list request under maxPages:1, no detail requests.
{
  let textCalls = 0; let jsonCalls = 0;
  await keka.fetch({ name: 'Acme', careers_url: ORIGIN }, {
    maxPages: 1, sleep: async () => {},
    fetchText: async () => { textCalls++; return SHELL; },
    fetchJson: async () => { jsonCalls++; return [row(1)]; },
  });
  if (jsonCalls === 1 && textCalls === 1) pass('keka.fetch() issues exactly one list request (plus the identifier bootstrap) under ctx.maxPages: 1');
  else fail(`keka.fetch() probe: ${jsonCalls} list calls, ${textCalls} shell calls`);
}

// fetch() — a transient 503 on the feed is retried through the shared helper.
{
  let n = 0;
  const jobs = await keka.fetch({ name: 'Acme', careers_url: ORIGIN }, {
    sleep: async () => {},
    fetchText: async () => SHELL,
    fetchJson: async () => { if (++n === 1) { const e = new Error('Service Unavailable'); e.status = 503; throw e; } return [row(1)]; },
  });
  if (n === 2 && jobs.length === 1) pass('keka.fetch() retries a transient 503 on the feed');
  else fail(`keka.fetch() retry: ${n} calls, ${jobs.length} jobs`);
}
