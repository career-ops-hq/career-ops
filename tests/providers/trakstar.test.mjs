// tests/providers/trakstar.test.mjs — Trakstar Hire Frontend API (formerly Recruiterbox).
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — trakstar (Trakstar Hire openings API)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/trakstar.mjs')).href);
const trakstar = mod.default;
const { parseTrakstarPage, jobLocation } = mod;
const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);

const CLIENT = 'acme';
const BOARD = `https://${CLIENT}.hire.trakstar.com`;
const API = `https://jsapi.recruiterbox.com/v1/openings?client_name=${CLIENT}`;

if (trakstar.id === 'trakstar') pass('trakstar.id is "trakstar"');
else fail(`trakstar.id is ${JSON.stringify(trakstar.id)}`);

const detectCases = [
  [{ careers_url: BOARD }, API, 'hire.trakstar.com board'],
  [{ careers_url: `${BOARD}/jobs/abc123/` }, API, 'posting URL on the board host'],
  [{ careers_url: 'https://Acme.hire.trakstar.com/' }, API, 'mixed-case client'],
  [{ careers_url: `https://${CLIENT}.recruiterbox.com/jobs` }, API, 'legacy recruiterbox host'],
  [{ api: `${API}&limit=2` }, API, 'Frontend API URL in api'],
  [{ careers_url: 'https://careers.example.test/jobs', api: API }, API, 'api field over a branded careers URL'],
];
for (const [entry, want, label] of detectCases) {
  const got = trakstar.detect(entry);
  if (got?.url === want) pass(`trakstar.detect() claims the ${label}`);
  else fail(`trakstar.detect() ${label}: ${JSON.stringify(got)}`);
}

const rejectCases = [
  [{ careers_url: `http://${CLIENT}.hire.trakstar.com` }, 'non-HTTPS'],
  [{ careers_url: `https://${CLIENT}.hire.trakstar.com.evil.example` }, 'look-alike host'],
  [{ careers_url: 'https://eviltrakstar.com' }, 'suffix look-alike host'],
  [{ careers_url: 'https://hire.trakstar.com' }, 'apex host with no client'],
  [{ careers_url: 'https://www.hire.trakstar.com' }, 'reserved www label'],
  [{ careers_url: 'https://jsapi.recruiterbox.com' }, 'reserved jsapi label'],
  [{ careers_url: 'https://jobs.acme.hire.trakstar.com' }, 'extra subdomain label'],
  [{ careers_url: 'https://jsapi.recruiterbox.com/v1/openings' }, 'API URL with no client_name'],
  [{ careers_url: 'https://jsapi.recruiterbox.com/v1/candidates?client_name=acme' }, 'a different API path'],
  [{ careers_url: 'https://careers.example.test/jobs' }, 'branded careers page'],
  [{ careers_url: 'not a url' }, 'malformed URL'],
  [{ careers_url: null }, 'null careers_url'],
  [{ careers_url: 42 }, 'non-string careers_url'],
  [{}, 'missing careers_url'],
];
for (const [entry, label] of rejectCases) {
  let got;
  try { got = trakstar.detect(entry); } catch (err) { got = `threw ${err.message}`; }
  if (got === null) pass(`trakstar.detect() returns null for ${label}`);
  else fail(`trakstar.detect() ${label}: ${JSON.stringify(got)}`);
}

const realError = console.error;
console.error = () => {};
const providers = await loadProviders(join(ROOT, 'providers'));
console.error = realError;
const routed = resolveProvider({ name: 'Acme', careers_url: BOARD }, providers);
if (routed?.provider?.id === 'trakstar') pass('the registry routes a hire.trakstar.com URL to trakstar');
else fail(`registry routed the board URL to ${routed?.provider?.id}`);

const row = (id, extra = {}) => ({
  id,
  title: `Backend Engineer ${id}`,
  client_name: 'payloadco',
  description: null,
  location: { city: 'Austin', state: 'TX', country: 'US', zipcode: '00000' },
  allows_remote: false,
  hosted_url: `https://${CLIENT}.hire.trakstar.com/jobs/${id}/`,
  close_date: '2026-12-01T00:00:00Z',
  ...extra,
});
const many = (start, n, extra) => Array.from({ length: n }, (_, i) => row(`j${start + i}`, extra));
const page = (objects, total = objects.length) => ({ meta: { offset: 0, limit: 100, total }, objects });

const parsed = parseTrakstarPage(page([
  row('aaa', { description: '<p>Build <strong>apis</strong> and ship</p>' }),
  row('bbb', { allows_remote: true, location: { city: null, state: null, country: null } }),
  row('ccc', { title: '   ' }),
  row('ddd', { hosted_url: 'http://acme.hire.trakstar.com/jobs/ddd/' }),
  row('eee', { hosted_url: 'https://evil.example/jobs/eee/' }),
  null,
  'junk',
], 7), 'Acme', CLIENT);
const [j1, j2, j4, j5] = parsed.jobs;
if (parsed.rawCount === 7 && parsed.total === 7 && parsed.jobs.length === 4) {
  pass('parseTrakstarPage() keeps the raw count and drops rows without a title');
} else fail(`parseTrakstarPage() counts wrong: ${JSON.stringify({ raw: parsed.rawCount, total: parsed.total, n: parsed.jobs.length })}`);
if (
  j1?.title === 'Backend Engineer aaa' &&
  j1.url === `https://${CLIENT}.hire.trakstar.com/jobs/aaa/` &&
  j1.company === 'Acme' &&
  j1.location === 'Austin, TX, US' &&
  j1.description === 'Build apis and ship' &&
  !('postedAt' in j1) &&
  !('requisitionId' in j1)
) pass('parseTrakstarPage() maps title, hosted_url, location, and description, and ignores close_date');
else fail(`parseTrakstarPage() row 1 wrong: ${JSON.stringify(j1)}`);
if (j2?.company === 'Acme' && j2.location === 'Remote' && !('description' in j2)) {
  pass('parseTrakstarPage() uses entry.name and marks a remote opening with no place');
} else fail(`parseTrakstarPage() row 2 wrong: ${JSON.stringify(j2)}`);
if (j4?.url === `https://${CLIENT}.hire.trakstar.com/jobs/ddd/` && j5?.url === `https://${CLIENT}.hire.trakstar.com/jobs/eee/`) {
  pass('parseTrakstarPage() rebuilds a non-https or off-host hosted_url on the client board');
} else fail(`parseTrakstarPage() rebuilt URLs: ${JSON.stringify([j4, j5])}`);

if (jobLocation({ allows_remote: true, location: { city: 'Berlin' } }) === 'Remote (Berlin)') {
  pass('jobLocation() keeps the place on a remote opening');
} else fail(`jobLocation() remote place: ${jobLocation({ allows_remote: true, location: { city: 'Berlin' } })}`);
if (jobLocation({ allows_remote: false, location: { zipcode: '00000' } }) === '') pass('jobLocation() ignores zipcode and tolerates an empty place');
else fail(`jobLocation() zip: ${JSON.stringify(jobLocation({ allows_remote: false, location: { zipcode: '00000' } }))}`);

const counted = parseTrakstarPage({ meta: { total_count: 4 }, objects: [row('z1')] }, 'Acme', CLIENT);
if (counted.total === 4) pass('parseTrakstarPage() reads meta.total_count when meta.total is absent');
else fail(`parseTrakstarPage() total_count: ${counted.total}`);

const lone = '\uD800';
const survived = parseTrakstarPage(page([
  row(`${lone}bad`, { hosted_url: 'https://evil.example/nope' }),
  row('good1'),
]), 'Acme', CLIENT);
if (survived.jobs.length === 1 && survived.jobs[0].url === `https://${CLIENT}.hire.trakstar.com/jobs/good1/`) {
  pass('parseTrakstarPage() drops a lone-surrogate id and keeps the other opening');
} else fail(`parseTrakstarPage() surrogate: ${JSON.stringify(survived.jobs)}`);

if (parseTrakstarPage(page([]), 'Acme', CLIENT).jobs.length === 0) pass('parseTrakstarPage() returns [] for a present-and-empty objects array');
else fail('parseTrakstarPage() empty board wrong');
for (const [body, label] of [[{}, '{}'], [{ objects: null }, 'objects: null'], [{ objects: {} }, 'objects: {}'], [{ jobs: [] }, 'a different key'], ['', 'an empty body'], [42, 'a number'], [null, 'null']]) {
  let msg = null;
  try { parseTrakstarPage(body, 'Acme', CLIENT); } catch (err) { msg = err.message; }
  if (msg && /trakstar: unexpected response/.test(msg) && /objects\[\]/.test(msg)) pass(`parseTrakstarPage() throws descriptively on ${label}`);
  else fail(`parseTrakstarPage() should throw on ${label}, got ${msg}`);
}

const ctxOf = (fetchJson) => ({ sleep: async () => {}, fetchJson });

let guardCalls = 0;
let guardErr = null;
try {
  await trakstar.fetch({ name: 'Acme', careers_url: 'https://careers.example.test/jobs' }, ctxOf(async () => { guardCalls++; return page([]); }));
} catch (err) { guardErr = err; }
if (guardErr && /cannot derive the client name/.test(guardErr.message) && guardCalls === 0) {
  pass('trakstar.fetch() rejects an unrecognised URL before any request');
} else fail(`trakstar.fetch() guard: err=${guardErr?.message} calls=${guardCalls}`);

{
  const urls = [];
  const opts = [];
  const jobs = await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async (url, o) => {
    urls.push(url);
    opts.push(o);
    if (urls.length === 1) return page(many(1, 100), 150);
    return page(many(101, 50), 150);
  }));
  if (
    jobs.length === 150 && urls.length === 2 &&
    urls[0] === `${API}&limit=100&offset=0` &&
    urls[1] === `${API}&limit=100&offset=100`
  ) pass('trakstar.fetch() walks offset until meta.total, 100 per page');
  else fail(`trakstar.fetch() pagination: ${jobs.length} jobs, ${JSON.stringify(urls)}`);
  if (opts.length > 0 && opts.every((o) => o?.redirect === 'error')) pass('trakstar.fetch() passes redirect:"error" on every request');
  else fail(`trakstar.fetch() redirect opts: ${JSON.stringify(opts)}`);
}

{
  let calls = 0;
  const jobs = await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    return calls === 1 ? page(many(1, 100), 40) : page(many(201, 100), 40);
  }));
  if (jobs.length === 100 && calls === 1 && !jobs.trakstarTruncated) {
    pass('trakstar.fetch() stops when seen rows reach meta.total even if the page is full');
  } else fail(`trakstar.fetch() total stop: ${jobs.length} jobs, ${calls} calls`);
}

{
  let calls = 0;
  let sleeps = 0;
  const jobs = await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, {
    sleep: async () => { sleeps++; },
    fetchJson: async () => {
      calls++;
      return page(many(calls === 1 ? 1 : 500, calls === 1 ? 100 : 20), 500);
    },
  });
  if (jobs.length === 120 && calls === 2 && sleeps === 1 && !jobs.trakstarTruncated) {
    pass('trakstar.fetch() stops on a short page and sleeps only between pages');
  } else fail(`trakstar.fetch() short page: ${jobs.length} jobs, ${calls} calls, ${sleeps} sleeps`);
}

{
  let calls = 0;
  const jobs = await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    return page(many(1, 100), 9000);
  }));
  if (jobs.length === 100 && calls === 2 && !jobs.trakstarTruncated) {
    pass('trakstar.fetch() stops when a page repeats');
  } else fail(`trakstar.fetch() repeated page: ${jobs.length} jobs, ${calls} calls, truncated=${jobs.trakstarTruncated}`);
}

{
  let calls = 0;
  const jobs = await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    if (calls === 1) return page(many(1, 100), 500);
    return page([], 500);
  }));
  if (jobs.length === 100 && calls === 2 && !jobs.trakstarTruncated) pass('trakstar.fetch() stops on an empty page');
  else fail(`trakstar.fetch() empty page: ${jobs.length} jobs, ${calls} calls`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    return page(many(calls * 1000, 100), 1_000_000);
  })));
  if (calls === 20 && jobs.length === 2000) pass('trakstar.fetch() caps pagination at DEFAULT_MAX_PAGES');
  else fail(`trakstar.fetch() cap: ${calls} requests, ${jobs.length} jobs`);
  if (errors.some((w) => /truncated at max_pages=20/.test(w)) && errors.some((w) => /Raise max_pages/.test(w)) && jobs.trakstarTruncated === true) {
    pass('trakstar.fetch() warns and tags the board when the cap truncates it');
  } else fail(`trakstar.fetch() cap warning: ${JSON.stringify(errors)}`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => trakstar.fetch({ name: 'Acme', careers_url: BOARD, max_pages: 2 }, ctxOf(async () => {
    calls++;
    return page(many(calls * 100, calls === 1 ? 100 : 40), 140);
  })));
  if (calls === 2 && jobs.length === 140 && errors.length === 0 && !jobs.trakstarTruncated) {
    pass('trakstar.fetch() treats a short page at the cap as complete');
  } else fail(`trakstar.fetch() short boundary: ${calls} calls, ${jobs.length} jobs, ${JSON.stringify(errors)}`);
}

{
  let calls = 0;
  await captureConsoleErrors(() => trakstar.fetch({ name: 'Acme', careers_url: BOARD, max_pages: 10_000 }, ctxOf(async () => {
    calls++;
    return page(many(calls * 1000, 100), 1_000_000);
  })));
  if (calls === 50) pass('trakstar.fetch() caps an oversized max_pages at MAX_PAGES_CAP');
  else fail(`trakstar.fetch() MAX_PAGES_CAP: ${calls} requests`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => trakstar.fetch({ name: 'Acme', careers_url: BOARD }, {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async () => {
      calls++;
      return page(many(1, 100), 500);
    },
  }));
  if (calls === 1 && jobs.length === 100 && errors.length === 0 && !jobs.trakstarTruncated) {
    pass('trakstar.fetch() honours ctx.maxPages: one request, no truncation warning');
  } else fail(`trakstar.fetch() probe: ${calls} calls, ${jobs.length} jobs, ${JSON.stringify(errors)}`);
}

{
  class FakeSentinel extends Error {}
  let caught = null;
  try {
    await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw new FakeSentinel('budget'); } });
  } catch (err) { caught = err; }
  if (caught instanceof FakeSentinel) pass('trakstar.fetch() propagates a ctx.fetch* rejection unwrapped while probing');
  else fail(`trakstar.fetch() probe error identity lost: ${caught?.constructor?.name}`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    if (calls === 1) return page(many(1, 100), 250);
    const err = new Error('upstream 503');
    err.status = 503;
    throw err;
  })));
  if (jobs.length === 100 && calls === 4) pass('trakstar.fetch() keeps page 1 when page 2 exhausts retries (1 + 3 attempts)');
  else fail(`trakstar.fetch() partial: ${jobs.length} jobs, ${calls} calls`);
  if (errors.some((w) => /truncated at page 2 \(100 of 250 jobs\): upstream 503/.test(w)) && !errors.some((w) => /Raise max_pages/.test(w)) && jobs.trakstarTruncated === true) {
    pass('trakstar.fetch() warns on a fetch-error stop without the max_pages hint');
  } else fail(`trakstar.fetch() fetch-error warnings: ${JSON.stringify(errors)}`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => (
    ++calls === 1 ? page(many(1, 100), 250) : { error: 'maintenance' }
  ))));
  if (jobs.length === 100 && calls === 2 && jobs.trakstarTruncated === true && errors.some((w) => /objects\[\]/.test(w))) {
    pass('trakstar.fetch() keeps page 1 when page 2 has a malformed envelope');
  } else fail(`trakstar.fetch() malformed later page: ${jobs.length} jobs, ${calls} calls, ${JSON.stringify(errors)}`);
  let threw = false;
  try {
    await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => ({ error: 'maintenance' })));
  } catch { threw = true; }
  if (threw) pass('trakstar.fetch() throws when the first page has a malformed envelope');
  else fail('trakstar.fetch() swallowed a malformed first page');
}

{
  let calls = 0;
  let threw = false;
  try {
    await trakstar.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
      calls++;
      const err = new Error('Invalid client name');
      err.status = 400;
      throw err;
    }));
  } catch { threw = true; }
  if (threw && calls === 1) pass('trakstar.fetch() throws a first-page 400 without retrying it');
  else fail(`trakstar.fetch() first-page 400: threw=${threw} calls=${calls}`);
}
