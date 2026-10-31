// tests/providers/polymer.test.mjs — Polymer public Hire jobs API.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — polymer (Polymer Hire jobs API)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/polymer.mjs')).href);
const polymer = mod.default;
const { parsePolymerPage, jobLocation } = mod;
const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);

const SLUG = 'acme';
const BOARD = `https://jobs.polymer.co/${SLUG}`;
const API = `https://api.polymer.co/v1/hire/organizations/${SLUG}/jobs`;

if (polymer.id === 'polymer') pass('polymer.id is "polymer"');
else fail(`polymer.id is ${JSON.stringify(polymer.id)}`);

const detectCases = [
  [{ careers_url: BOARD }, API, 'board URL'],
  [{ careers_url: `${BOARD}/1001` }, API, 'posting URL on the board host'],
  [{ careers_url: 'https://jobs.polymer.co/Acme/' }, API, 'mixed-case slug'],
  [{ api: `${API}?page=2` }, API, 'API URL in api'],
  [{ careers_url: 'https://careers.example.test/jobs', api: API }, API, 'api field over a branded careers URL'],
];
for (const [entry, want, label] of detectCases) {
  const got = polymer.detect(entry);
  if (got?.url === want) pass(`polymer.detect() claims the ${label}`);
  else fail(`polymer.detect() ${label}: ${JSON.stringify(got)}`);
}

const rejectCases = [
  [{ careers_url: `http://jobs.polymer.co/${SLUG}` }, 'non-HTTPS'],
  [{ careers_url: `https://jobs.polymer.co.evil.example/${SLUG}` }, 'look-alike host'],
  [{ careers_url: 'https://evilpolymer.co/acme' }, 'suffix look-alike host'],
  [{ careers_url: 'https://jobs.polymer.co/' }, 'empty slug'],
  [{ careers_url: 'https://jobs.polymer.co/-acme' }, 'slug with a leading hyphen'],
  [{ careers_url: 'https://jobs.polymer.co/acme-' }, 'slug with a trailing hyphen'],
  [{ careers_url: 'https://api.polymer.co/v1/hire/organizations/' }, 'API URL with no slug'],
  [{ careers_url: 'https://api.polymer.co/v2/hire/organizations/acme/jobs' }, 'wrong API version'],
  [{ careers_url: 'https://careers.example.test/jobs' }, 'branded careers page'],
  [{ careers_url: 'not a url' }, 'malformed URL'],
  [{ careers_url: null }, 'null careers_url'],
  [{ careers_url: 42 }, 'non-string careers_url'],
  [{}, 'missing careers_url'],
];
for (const [entry, label] of rejectCases) {
  let got;
  try { got = polymer.detect(entry); } catch (err) { got = `threw ${err.message}`; }
  if (got === null) pass(`polymer.detect() returns null for ${label}`);
  else fail(`polymer.detect() ${label}: ${JSON.stringify(got)}`);
}

const realError = console.error;
console.error = () => {};
const providers = await loadProviders(join(ROOT, 'providers'));
console.error = realError;
const routed = resolveProvider({ name: 'Acme', careers_url: BOARD }, providers);
if (routed?.provider?.id === 'polymer') pass('the registry routes a jobs.polymer.co URL to polymer');
else fail(`registry routed the board URL to ${routed?.provider?.id}`);

const row = (id, extra = {}) => ({
  id,
  job_id: id,
  title: `Backend Engineer ${id}`,
  display_location: null,
  city: 'Austin',
  state_region: 'TX',
  country: 'US',
  remoteness_pretty: 'No remote',
  organization_name: 'Payload Co',
  salary_pretty: 'quoted text',
  published_at: '2026-10-02T00:00:00Z',
  published_at_timestamp: 1700000000,
  job_post_url: `https://jobs.polymer.co/${SLUG}/${id}`,
  ...extra,
});
const page = (items, meta = {}) => ({
  items,
  meta: { is_last: false, is_first: true, page: 1, next_page: 2, count: items.length, total: 1, ...meta },
});

const parsed = parsePolymerPage(page([
  row(1001),
  row(1002, { published_at: null, display_location: 'Berlin', city: 'Austin' }),
  row(1003, { title: '   ' }),
  row(1004, { job_post_url: 'http://jobs.polymer.co/acme/1004', id: 1004 }),
  row(1005, { job_post_url: 'https://evil.example/steal', id: 1005 }),
  null,
  'junk',
], { is_last: true, count: 7, total: 1 }), 'Acme', SLUG);
const [j1, j2, j4, j5] = parsed.jobs;
if (parsed.rawCount === 7 && parsed.jobs.length === 4 && parsed.isLast === true && parsed.count === 7) {
  pass('parsePolymerPage() keeps the raw count and drops rows without a title');
} else {
  fail(`parsePolymerPage() counts wrong: ${JSON.stringify({ raw: parsed.rawCount, n: parsed.jobs.length, isLast: parsed.isLast, count: parsed.count })}`);
}
if (
  j1?.title === 'Backend Engineer 1001' &&
  j1.url === `https://jobs.polymer.co/${SLUG}/1001` &&
  j1.company === 'Acme' &&
  j1.location === 'Austin, TX, US' &&
  j1.postedAt === Date.parse('2026-10-02T00:00:00Z') &&
  !('description' in j1) &&
  !('salary' in j1) &&
  !('requisitionId' in j1)
) pass('parsePolymerPage() maps title, vendor URL, location, and published_at, and skips salary text');
else fail(`parsePolymerPage() row 1 wrong: ${JSON.stringify(j1)}`);
if (j2?.company === 'Acme' && j2.location === 'Berlin' && j2.postedAt === 1700000000 * 1000) {
  pass('parsePolymerPage() uses entry.name, display_location, and published_at_timestamp');
} else fail(`parsePolymerPage() row 2 wrong: ${JSON.stringify(j2)}`);
if (j4?.url === `https://jobs.polymer.co/${SLUG}/1004` && j5?.url === `https://jobs.polymer.co/${SLUG}/1005`) {
  pass('parsePolymerPage() rebuilds a non-https or off-host job_post_url on jobs.polymer.co');
} else fail(`parsePolymerPage() rebuilt URLs: ${JSON.stringify([j4, j5])}`);

if (jobLocation({ remoteness_pretty: 'No remote', city: 'Austin' }) === 'Austin') pass('jobLocation() does not treat "No remote" as remote');
else fail(`jobLocation() No remote: ${jobLocation({ remoteness_pretty: 'No remote', city: 'Austin' })}`);
if (jobLocation({ remoteness_pretty: 'Remote' }) === 'Remote' && jobLocation({ remoteness_pretty: 'Remote', city: 'Berlin' }) === 'Remote (Berlin)') {
  pass('jobLocation() marks a remote row, with the place when there is one');
} else fail('jobLocation() remote marker wrong');
if (jobLocation({}) === '') pass('jobLocation() tolerates an empty row');
else fail(`jobLocation() empty: ${JSON.stringify(jobLocation({}))}`);

const badDate = parsePolymerPage(page([row(9, { published_at: 'soon', published_at_timestamp: 'soon' })]), 'Acme', SLUG).jobs[0];
if (badDate && !('postedAt' in badDate)) pass('parsePolymerPage() leaves postedAt unset for an unparseable date');
else fail(`parsePolymerPage() bad date: ${JSON.stringify(badDate)}`);

const lone = '\uD800';
const survived = parsePolymerPage(page([
  row(`${lone}bad`, { job_post_url: 'https://evil.example/nope' }),
  row(1008),
]), 'Acme', SLUG);
if (survived.jobs.length === 1 && survived.jobs[0].url === `https://jobs.polymer.co/${SLUG}/1008`) {
  pass('parsePolymerPage() drops a lone-surrogate id and keeps the other posting');
} else fail(`parsePolymerPage() surrogate: ${JSON.stringify(survived.jobs)}`);

if (parsePolymerPage({ items: [], meta: { is_last: false, next_page: 2, count: 0, total: 1 } }, 'Acme', SLUG).jobs.length === 0) {
  pass('parsePolymerPage() returns [] for a present-and-empty items array');
} else fail('parsePolymerPage() empty board wrong');
for (const [body, label] of [[{}, '{}'], [{ items: null }, 'items: null'], [{ items: {} }, 'items: {}'], [{ jobs: [] }, 'a different key'], ['', 'an empty body'], [42, 'a number'], [null, 'null']]) {
  let msg = null;
  try { parsePolymerPage(body, 'Acme', SLUG); } catch (err) { msg = err.message; }
  if (msg && /polymer: unexpected response/.test(msg) && /items\[\]/.test(msg)) pass(`parsePolymerPage() throws descriptively on ${label}`);
  else fail(`parsePolymerPage() should throw on ${label}, got ${msg}`);
}

let guardCalls = 0;
let guardErr = null;
try {
  await polymer.fetch({ name: 'Acme', careers_url: 'https://careers.example.test/jobs' }, { fetchJson: async () => { guardCalls++; return { items: [] }; } });
} catch (err) { guardErr = err; }
if (guardErr && /cannot derive the organization slug/.test(guardErr.message) && guardCalls === 0) {
  pass('polymer.fetch() rejects an unrecognised URL before any request');
} else fail(`polymer.fetch() guard: err=${guardErr?.message} calls=${guardCalls}`);

const ctxOf = (fetchJson) => ({ sleep: async () => {}, fetchJson });

{
  const urls = [];
  const opts = [];
  const jobs = await polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async (url, o) => {
    urls.push(url);
    opts.push(o);
    const n = urls.length;
    if (n === 1) return page([row(1), row(2)], { is_last: false, count: 3, total: 1, next_page: 2 });
    return page([row(3)], { is_last: true, count: 3, total: 1, next_page: null, page: 2 });
  }));
  if (jobs.length === 3 && urls.length === 2 && urls[0] === `${API}?page=1` && urls[1] === `${API}?page=2`) {
    pass('polymer.fetch() walks page= until is_last, ignoring meta.total');
  } else fail(`polymer.fetch() is_last walk: ${jobs.length} jobs, ${JSON.stringify(urls)}`);
  if (opts.length > 0 && opts.every((o) => o?.redirect === 'error')) pass('polymer.fetch() passes redirect:"error" on every request');
  else fail(`polymer.fetch() redirect opts: ${JSON.stringify(opts)}`);
}

{
  let calls = 0;
  const jobs = await polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    if (calls === 1) return page([row(1), row(2)], { is_last: false, next_page: 2, count: 1, total: 1 });
    return { items: [], meta: { is_last: false, next_page: 3, count: 1, total: 1, page: 2 } };
  }));
  if (jobs.length === 2 && calls === 2 && !jobs.polymerTruncated) {
    pass('polymer.fetch() stops on an empty page even when is_last is false and next_page is set');
  } else fail(`polymer.fetch() empty over-page: ${jobs.length} jobs, ${calls} calls, truncated=${jobs.polymerTruncated}`);
}

{
  let calls = 0;
  const jobs = await polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    return page([row(1), row(2)], { is_last: false, count: 1, total: 1 });
  }));
  if (jobs.length === 2 && calls === 2 && !jobs.polymerTruncated) {
    pass('polymer.fetch() stops when a page repeats and does not trust an understated count');
  } else fail(`polymer.fetch() repeated page: ${jobs.length} jobs, ${calls} calls`);
}

{
  let calls = 0;
  const jobs = await polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    return page([row(1), row(2), row(3)], { is_last: false, count: 3, total: 1 });
  }));
  if (jobs.length === 3 && calls === 1) pass('polymer.fetch() stops when meta.count covers this page');
  else fail(`polymer.fetch() count stop: ${jobs.length} jobs, ${calls} calls`);
}

{
  let calls = 0;
  let sleeps = 0;
  const jobs = await polymer.fetch({ name: 'Acme', careers_url: BOARD }, {
    sleep: async () => { sleeps++; },
    fetchJson: async () => {
      calls++;
      if (calls === 1) return page([row(1)], { is_last: false, count: 9, total: 1 });
      return page([row(2)], { is_last: true, count: 9, total: 1 });
    },
  });
  if (jobs.length === 2 && calls === 2 && sleeps === 1) pass('polymer.fetch() sleeps only between pages');
  else fail(`polymer.fetch() pacing: ${calls} calls, ${sleeps} sleeps, ${jobs.length} jobs`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    return page([row(calls)], { is_last: false, count: 100000, total: 1, next_page: calls + 1 });
  })));
  if (calls === 20 && jobs.length === 20) pass('polymer.fetch() caps pagination at DEFAULT_MAX_PAGES');
  else fail(`polymer.fetch() cap: ${calls} requests, ${jobs.length} jobs`);
  if (errors.some((w) => /truncated at max_pages=20/.test(w)) && errors.some((w) => /Raise max_pages/.test(w)) && jobs.polymerTruncated === true) {
    pass('polymer.fetch() warns and tags the board when the cap truncates it');
  } else fail(`polymer.fetch() cap warning: ${JSON.stringify(errors)}`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => polymer.fetch({ name: 'Acme', careers_url: BOARD, max_pages: 2 }, ctxOf(async () => {
    calls++;
    return page([row(calls)], { is_last: calls === 2, count: 2, total: 1 });
  })));
  if (calls === 2 && jobs.length === 2 && errors.length === 0 && !jobs.polymerTruncated) {
    pass('polymer.fetch() treats is_last on the cap page as complete');
  } else fail(`polymer.fetch() cap is_last: ${calls} calls, ${jobs.length} jobs, ${JSON.stringify(errors)}`);
}

{
  let calls = 0;
  await captureConsoleErrors(() => polymer.fetch({ name: 'Acme', careers_url: BOARD, max_pages: 10_000 }, ctxOf(async () => {
    calls++;
    return page([row(calls)], { is_last: false, count: 100000, total: 1 });
  })));
  if (calls === 100) pass('polymer.fetch() caps an oversized max_pages at MAX_PAGES_CAP');
  else fail(`polymer.fetch() MAX_PAGES_CAP: ${calls} requests`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => polymer.fetch({ name: 'Acme', careers_url: BOARD }, {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async () => {
      calls++;
      return page([row(1), row(2)], { is_last: false, count: 50, total: 1 });
    },
  }));
  if (calls === 1 && jobs.length === 2 && errors.length === 0 && !jobs.polymerTruncated) {
    pass('polymer.fetch() honours ctx.maxPages: one request, no truncation warning');
  } else fail(`polymer.fetch() probe: ${calls} calls, ${jobs.length} jobs, ${JSON.stringify(errors)}`);
}

{
  class FakeSentinel extends Error {}
  let caught = null;
  try {
    await polymer.fetch({ name: 'Acme', careers_url: BOARD }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw new FakeSentinel('budget'); } });
  } catch (err) { caught = err; }
  if (caught instanceof FakeSentinel) pass('polymer.fetch() propagates a ctx.fetch* rejection unwrapped while probing');
  else fail(`polymer.fetch() probe error identity lost: ${caught?.constructor?.name}`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
    calls++;
    if (calls === 1) return page([row(1), row(2)], { is_last: false, count: 10, total: 1 });
    const err = new Error('upstream 503');
    err.status = 503;
    throw err;
  })));
  if (jobs.length === 2 && calls === 4) pass('polymer.fetch() keeps page 1 when page 2 exhausts retries (1 + 3 attempts)');
  else fail(`polymer.fetch() partial: ${jobs.length} jobs, ${calls} calls`);
  if (errors.some((w) => /truncated at page 2 \(2 jobs\): upstream 503/.test(w)) && !errors.some((w) => /Raise max_pages/.test(w)) && jobs.polymerTruncated === true) {
    pass('polymer.fetch() warns on a fetch-error stop without the max_pages hint');
  } else fail(`polymer.fetch() fetch-error warnings: ${JSON.stringify(errors)} tag=${jobs.polymerTruncated}`);
}

{
  let calls = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => (
    ++calls === 1 ? page([row(1)], { is_last: false, count: 4, total: 1 }) : { error: 'maintenance' }
  ))));
  if (jobs.length === 1 && calls === 2 && jobs.polymerTruncated === true && errors.some((w) => /truncated at page 2/.test(w)) && errors.some((w) => /items\[\]/.test(w))) {
    pass('polymer.fetch() keeps page 1 when page 2 has a malformed envelope');
  } else fail(`polymer.fetch() malformed later page: ${jobs.length} jobs, ${calls} calls, ${JSON.stringify(errors)}`);
  let threw = false;
  try {
    await polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => ({ error: 'maintenance' })));
  } catch { threw = true; }
  if (threw) pass('polymer.fetch() throws when the first page has a malformed envelope');
  else fail('polymer.fetch() swallowed a malformed first page');
}

{
  let calls = 0;
  let threw = false;
  try {
    await polymer.fetch({ name: 'Acme', careers_url: BOARD }, ctxOf(async () => {
      calls++;
      const err = new Error('Unprocessable');
      err.status = 422;
      throw err;
    }));
  } catch { threw = true; }
  if (threw && calls === 1) pass('polymer.fetch() throws a first-page 422 without retrying it');
  else fail(`polymer.fetch() first-page 422: threw=${threw} calls=${calls}`);
}
