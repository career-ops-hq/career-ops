// tests/providers/dover.test.mjs — direct provider-contract tests.
//
// Dover's careers page reads a same-origin, DRF-paginated
// `app.dover.com/api/v1/careers-page/<board-uuid>/jobs?limit=&offset=` envelope
// (`{ count, next, previous, results }`) — see the header comment in
// providers/dover.mjs for the full shape.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — dover');

const BOARD = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CAREERS = `https://app.dover.com/Acme/careers/${BOARD}`;
const API0 = `https://app.dover.com/api/v1/careers-page/${BOARD}/jobs?limit=300&offset=0`;

/** One posting in Dover's list shape. */
const row = (id, title, extra = {}) => ({
  id,
  title,
  locations: [{
    location_type: 'REMOTE',
    location_option: { id: 'opt-1', display_name: 'International', location_type: 'REGION', city: '', state: '', country: 'US' },
    name: 'International',
    is_primary: true,
  }],
  workplace_type: 'REMOTE',
  is_published: true,
  is_sample: false,
  ...extra,
});

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/dover.mjs')).href);
  const dover = mod.default;
  const { parseDoverPage, resolveBoard } = mod;

  if (dover.id === 'dover') pass('dover.id is "dover"');
  else fail(`dover.id is ${JSON.stringify(dover.id)}`);

  // detect(): app.dover.com/<Company>/careers/<uuid> → offset-0 list API URL.
  const hit = dover.detect({ name: 'Acme', careers_url: CAREERS });
  if (hit?.url === API0) pass('dover.detect() resolves app.dover.com/<Company>/careers/<uuid> → careers-page jobs API');
  else fail(`dover.detect() returned ${JSON.stringify(hit)}`);

  // Trailing segments (Dover's own /audit link, a trailing slash) still resolve the board.
  if (dover.detect({ name: 'Acme', careers_url: `${CAREERS}/audit` })?.url === API0
      && dover.detect({ name: 'Acme', careers_url: `${CAREERS}/` })?.url === API0) {
    pass('dover.detect() ignores trailing path segments after the board uuid');
  } else {
    fail('dover.detect() should accept trailing segments after the board uuid');
  }

  const junk = [
    { name: 'X', careers_url: 'https://example.com/Acme/careers/' + BOARD },          // other host
    { name: 'X', careers_url: 'http://app.dover.com/Acme/careers/' + BOARD },         // non-https
    { name: 'X', careers_url: 'https://app.dover.com/apply/Acme/' + BOARD },           // a job, not a board
    { name: 'X', careers_url: 'https://app.dover.com/Acme/careers/not-a-uuid' },       // bad board id
    { name: 'X', careers_url: 'https://evil.example/app.dover.com/Acme/careers/' + BOARD }, // path spoof
    { name: 'X', careers_url: 'not a url' },
    { name: 'X', careers_url: null },
    { name: 'X', careers_url: 7 },
    { name: 'X' },
  ];
  let junkOk = true;
  for (const e of junk) {
    try {
      if (dover.detect(e) !== null) { junkOk = false; fail(`dover.detect() should be null for ${JSON.stringify(e.careers_url)}`); }
    } catch (err) {
      junkOk = false;
      fail(`dover.detect() threw for ${JSON.stringify(e.careers_url)}: ${err.message}`);
    }
  }
  if (junkOk) pass('dover.detect() returns null (no throw) for other hosts, non-https, job URLs, bad ids, junk and missing careers_url');

  if (resolveBoard({ careers_url: `https://app.dover.com/Acme%20Labs/careers/${BOARD.toUpperCase()}` })?.company === 'Acme Labs'
      && resolveBoard({ careers_url: `https://app.dover.com/Acme/careers/${BOARD.toUpperCase()}` })?.board === BOARD) {
    pass('resolveBoard decodes the company segment and lower-cases the board uuid');
  } else {
    fail('resolveBoard should decode the company segment and lower-case the board uuid');
  }

  // parseDoverPage — normalization of the real response shape.
  const opts = { companyName: 'Acme', companySegment: 'Acme' };
  const sample = {
    count: 7, next: null, previous: null,
    results: [
      row('id-1', 'Smart Contract Engineer'),
      row('id-2', '  Backend Engineer  ', {
        workplace_type: 'HYBRID',
        locations: [
          { location_type: 'HYBRID', location_option: { display_name: 'Berlin, Germany' }, name: 'Berlin, Germany', is_primary: false },
          { location_type: 'HYBRID', location_option: { display_name: 'New York City, NY' }, name: 'New York City, NY', is_primary: true },
        ],
      }),
      row('id-3', 'No Locations', { locations: [] }),
      row('id-4', 'Draft Role', { is_published: false }),   // drop: unpublished
      row('id-5', 'Sample Role', { is_sample: true }),      // drop: Dover sample job
      row('id-6', ''),                                      // drop: empty title
      { title: 'No Id', locations: [] },                    // drop: no id
    ],
  };
  const { jobs, rawCount, hasNext } = parseDoverPage(sample, opts);

  if (rawCount === 7 && hasNext === false) pass('parseDoverPage reports the raw result count and the absence of `next`');
  else fail(`parseDoverPage rawCount=${rawCount}, hasNext=${hasNext}`);

  if (jobs.length === 3) pass('parseDoverPage keeps 3 postings (drops unpublished, sample, untitled, id-less rows)');
  else fail(`parseDoverPage returned ${jobs.length} postings: ${JSON.stringify(jobs)}`);

  if (jobs[0]?.title === 'Smart Contract Engineer'
      && jobs[0]?.url === 'https://app.dover.com/apply/Acme/id-1'
      && jobs[0]?.company === 'Acme'
      && jobs[0]?.location === 'Remote (International)'
      && Object.keys(jobs[0]).sort().join(',') === 'company,location,title,url') {
    pass('parseDoverPage maps a worldwide-remote row to "Remote (International)", never a US city');
  } else {
    fail(`parseDoverPage row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.title === 'Backend Engineer' && jobs[1]?.location === 'New York City, NY (Hybrid) · Berlin, Germany (Hybrid)') {
    pass('parseDoverPage trims the title, puts the primary location first and marks hybrid');
  } else {
    fail(`parseDoverPage row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (jobs[2]?.location === 'Remote') pass('parseDoverPage falls back to "Remote" from workplace_type when no locations are listed');
  else fail(`parseDoverPage row 2 location = ${JSON.stringify(jobs[2]?.location)}`);

  // Empty-vs-broken split: present-and-empty results[] → []; anything else throws.
  const empty = parseDoverPage({ count: 0, next: null, previous: null, results: [] }, opts);
  if (empty.jobs.length === 0 && empty.rawCount === 0) pass('parseDoverPage returns [] for a present-and-empty results[]');
  else fail(`parseDoverPage empty board = ${JSON.stringify(empty)}`);

  let allThrew = true;
  for (const bad of [{}, { results: null }, { results: {} }, null, '', 42, true]) {
    try {
      parseDoverPage(bad, opts);
      allThrew = false;
      fail(`parseDoverPage should throw for ${JSON.stringify(bad)}`);
    } catch (e) {
      if (!/unexpected response/.test(e.message)) { allThrew = false; fail(`parseDoverPage threw a non-descriptive error: ${e.message}`); }
    }
  }
  if (allThrew) pass('parseDoverPage throws a descriptive error for a non-{results[]} envelope');

  // fetch(): requests the derived URL with redirect:'error'; one request for a short page.
  let calls = 0;
  let firstUrl = null;
  let firstOpts = null;
  const fetched = await dover.fetch({ name: 'Acme Inc', careers_url: CAREERS }, {
    fetchJson: async (url, o) => { calls++; firstUrl ??= url; firstOpts ??= o; return sample; },
  });
  if (firstUrl === API0) pass('dover.fetch() requests the derived careers-page jobs URL');
  else fail(`dover.fetch() requested ${JSON.stringify(firstUrl)}`);
  if (firstOpts?.redirect === 'error') pass('dover.fetch() passes redirect:"error" (SSRF guard)');
  else fail(`dover.fetch() opts = ${JSON.stringify(firstOpts)}`);
  if (calls === 1 && fetched.length === 3 && fetched[0].company === 'Acme Inc'
      && fetched[0].url === 'https://app.dover.com/apply/Acme/id-1') {
    pass('dover.fetch() stops after a short first page; company from entry name, URL company segment from careers_url');
  } else {
    fail(`dover.fetch(): ${calls} calls, ${JSON.stringify(fetched[0])}`);
  }

  // A careers_url that is not a Dover board throws before any request.
  let badThrew = false;
  let badCalled = false;
  try {
    await dover.fetch({ name: 'X', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { badCalled = true; return { results: [] }; } });
  } catch (e) {
    badThrew = /cannot derive API URL/.test(e.message);
  }
  if (badThrew && !badCalled) pass('dover.fetch() throws without calling fetchJson for a non-Dover careers_url');
  else fail(`dover.fetch() bad entry: threw=${badThrew}, fetchJson called=${badCalled}`);

  // Pagination via offset; stops on the natural short page.
  const full = (n, count, next = 'https://app.dover.com/next') => ({
    count: 9999, next, previous: null,
    results: Array.from({ length: count }, (_, i) => row(`${n}-${i}`, `Role ${n}-${i}`)),
  });
  const big = { name: 'BigCo', careers_url: CAREERS };
  const urls = [];
  const pageJobs = await dover.fetch(big, {
    sleep: async () => {},
    fetchJson: async (url) => { urls.push(url); return urls.length === 1 ? full(0, 300) : full(1, 20, null); },
  });
  if (urls.length === 2 && urls[1].endsWith('offset=300') && pageJobs.length === 320) {
    pass('dover.fetch() walks offset pages and stops on the natural short page');
  } else {
    fail(`dover.fetch() pagination: ${JSON.stringify(urls)}, ${pageJobs.length} jobs`);
  }

  // A full page with next: null is also a natural end.
  let nullNextCalls = 0;
  await dover.fetch(big, { sleep: async () => {}, fetchJson: async () => { nullNextCalls++; return full(0, 300, null); } });
  if (nullNextCalls === 1) pass('dover.fetch() treats `next: null` as the end even on a full page');
  else fail(`dover.fetch() made ${nullNextCalls} calls despite next: null`);

  // DEFAULT_MAX_PAGES (5) bounds an always-full board and warns.
  let hugeCalls = 0;
  const { result: huge, errors: hugeErrors } = await captureConsoleErrors(() => dover.fetch(big, {
    sleep: async () => {},
    fetchJson: async () => { hugeCalls++; if (hugeCalls > 25) throw new Error('unbounded'); return full(hugeCalls, 300); },
  }));
  if (hugeCalls === 5 && huge.length === 1500) pass('dover.fetch() clamps at its own DEFAULT_MAX_PAGES (5)');
  else fail(`dover.fetch() made ${hugeCalls} calls, ${huge.length} jobs`);
  if (hugeErrors.some((e) => /raise max_pages/.test(e))) pass('dover.fetch() warns to raise max_pages on a real cap stop');
  else fail(`dover.fetch() cap warning missing: ${JSON.stringify(hugeErrors)}`);

  // A short page that is also the last allowed page is a natural end, not a cap.
  let lastCalls = 0;
  const { errors: lastErrors } = await captureConsoleErrors(() => dover.fetch({ ...big, max_pages: 2 }, {
    sleep: async () => {},
    fetchJson: async () => { lastCalls++; return lastCalls === 1 ? full(0, 300) : full(1, 10); },
  }));
  if (lastCalls === 2 && !lastErrors.some((e) => /raise max_pages/.test(e))) {
    pass('dover.fetch() does not warn "raise max_pages" when the last allowed page is short');
  } else {
    fail(`dover.fetch() last-page-short: ${lastCalls} calls, ${JSON.stringify(lastErrors)}`);
  }

  // Probe: ctx.maxPages: 1 → exactly one request; a rejection propagates unwrapped.
  let probeCalls = 0;
  let probeOpts = null;
  await dover.fetch(big, { maxPages: 1, fetchJson: async (_u, o) => { probeCalls++; probeOpts = o; return full(0, 300); } });
  if (probeCalls === 1 && probeOpts?.redirect === 'error') pass('dover.fetch() honors ctx.maxPages: 1 (one request, redirect:"error")');
  else fail(`dover.fetch() probe made ${probeCalls} calls, opts ${JSON.stringify(probeOpts)}`);

  class FakeProbeBudget extends Error {}
  let unwrapped = false;
  try {
    await dover.fetch(big, { maxPages: 1, fetchJson: async () => { throw new FakeProbeBudget('budget'); } });
  } catch (e) {
    unwrapped = e instanceof FakeProbeBudget;
  }
  if (unwrapped) pass('dover.fetch() propagates a ctx.fetch* rejection unwrapped while probing');
  else fail('dover.fetch() must not swallow/rewrap a rejection while probing');

  // A first-page failure is a broken board, not an empty one: it throws.
  let firstFailThrew = false;
  try {
    await dover.fetch(big, { sleep: async () => {}, fetchJson: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); } });
  } catch {
    firstFailThrew = true;
  }
  if (firstFailThrew) pass('dover.fetch() throws when the first page fails (a dead board never reads as empty)');
  else fail('dover.fetch() should throw on a first-page failure');

  // A later page's exhausted-retry failure keeps earlier pages and does not warn about max_pages.
  let laterCalls = 0;
  const { result: later, errors: laterErrors } = await captureConsoleErrors(() => dover.fetch(big, {
    sleep: async () => {},
    fetchJson: async () => {
      laterCalls++;
      if (laterCalls === 1) return full(0, 300);
      throw Object.assign(new Error('HTTP 404'), { status: 404 });
    },
  }));
  if (later.length === 300 && !laterErrors.some((e) => /raise max_pages/.test(e))) {
    pass('dover.fetch() keeps earlier pages on a later-page failure and does not warn "raise max_pages"');
  } else {
    fail(`dover.fetch() later failure: ${later.length} jobs, ${JSON.stringify(laterErrors)}`);
  }
} catch (e) {
  fail(`dover provider tests crashed: ${e.stack || e.message}`);
}
