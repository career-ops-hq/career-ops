// tests/providers/dover.test.mjs — direct provider-contract tests.
//
// Dover's careers page reads a same-origin, DRF-paginated
// `app.dover.com/api/v1/careers-page/<board-uuid>/jobs?limit=&offset=` envelope
// (`{ count, next, previous, results }`) — see the header comment in
// providers/dover.mjs for the full shape. A careers page published as
// app.dover.com/jobs/<slug> resolves to its board uuid through
// app.dover.com/api/v1/careers-page-slug/<slug> first.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — dover');

const BOARD = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CAREERS = `https://app.dover.com/Acme/careers/${BOARD}`;
const API0 = `https://app.dover.com/api/v1/careers-page/${BOARD}/jobs?limit=300&offset=0`;
// The /jobs/<slug> form: the slug resolves to the board uuid through a lookup endpoint.
const SLUG_URL = 'https://app.dover.com/jobs/acme';
const SLUG_LOOKUP = 'https://app.dover.com/api/v1/careers-page-slug/acme';
const lookupBody = { id: BOARD, slug: 'acme', name: 'Acme Corp' };

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
  if (huge.truncated?.reason === 'page-cap' && huge.truncated?.fetched === 1500) pass('dover.fetch() marks a capped board with jobs.truncated');
  else fail(`dover.fetch() cap flag: ${JSON.stringify(huge.truncated)}`);

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
  const probed = await dover.fetch(big, { maxPages: 1, fetchJson: async (_u, o) => { probeCalls++; probeOpts = o; return full(0, 300); } });
  if (probed.truncated) fail(`dover.fetch() flagged a probe as truncated: ${JSON.stringify(probed.truncated)}`);
  else pass('dover.fetch() leaves a ctx.maxPages probe unflagged');
  if (probeCalls === 1 && probeOpts?.redirect === 'error') pass('dover.fetch() honors ctx.maxPages: 1 (one request, redirect:"error")');
  else fail(`dover.fetch() probe made ${probeCalls} calls, opts ${JSON.stringify(probeOpts)}`);

  // max_pages: 1 on the entry: the probe's one page is also the entry's last.
  // It is still a probe, so nothing warns and nothing is marked (#7180).
  const { result: probedAtCap, errors: probeAtCapErrors } = await captureConsoleErrors(() => dover.fetch({ ...big, max_pages: 1 }, { maxPages: 1, fetchJson: async () => full(0, 300) }));
  if (!probeAtCapErrors.some((e) => /raise max_pages/.test(e)) && probedAtCap.truncated === undefined) pass('dover.fetch() warns nothing and marks nothing for a probe on a max_pages: 1 entry');
  else fail(`dover.fetch() probe at max_pages: 1: truncated=${JSON.stringify(probedAtCap.truncated)}, errors ${JSON.stringify(probeAtCapErrors)}`);
  const { result: scannedAtCap, errors: scanAtCapErrors } = await captureConsoleErrors(() => dover.fetch({ ...big, max_pages: 1 }, { sleep: async () => {}, fetchJson: async () => full(0, 300) }));
  if (scanAtCapErrors.some((e) => /raise max_pages/.test(e)) && scannedAtCap.truncated?.reason === 'page-cap') pass('dover.fetch() still warns and marks page-cap for a real scan of a max_pages: 1 entry');
  else fail(`dover.fetch() scan at max_pages: 1: truncated=${JSON.stringify(scannedAtCap.truncated)}, errors ${JSON.stringify(scanAtCapErrors)}`);

  // A plain Error has no status, so isRetryableError() treats it as retryable.
  // The probe must still make exactly one call and rethrow that same error
  // (providers/magneto.mjs's health-probe check).
  const probeErr = new Error('budget');
  let failProbeCalls = 0;
  let unwrapped = false;
  try {
    await dover.fetch(big, {
      maxPages: 1,
      sleep: async () => {},
      fetchJson: async () => { failProbeCalls++; throw probeErr; },
    });
  } catch (e) {
    unwrapped = e === probeErr;
  }
  if (unwrapped && failProbeCalls === 1) pass('dover.fetch() propagates a status-less rejection unwrapped after exactly one call while probing');
  else fail(`dover.fetch() probe failure: unwrapped=${unwrapped}, calls=${failProbeCalls}`);

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
  if (later.truncated?.reason === 'fetch-error' && later.truncated?.fetched === 300) pass('dover.fetch() marks a board cut short by a later-page failure with jobs.truncated');
  else fail(`dover.fetch() fetch-error flag: ${JSON.stringify(later.truncated)}`);
  if (later.length === 300 && !laterErrors.some((e) => /raise max_pages/.test(e))) {
    pass('dover.fetch() keeps earlier pages on a later-page failure and does not warn "raise max_pages"');
  } else {
    fail(`dover.fetch() later failure: ${later.length} jobs, ${JSON.stringify(laterErrors)}`);
  }

  // ── /jobs/<slug> careers-page form ──────────────────────────────────────
  // detect(): synchronous, request-free; returns the slug lookup URL.
  if (dover.detect({ name: 'Acme', careers_url: SLUG_URL })?.url === SLUG_LOOKUP
      && dover.detect({ name: 'Acme', careers_url: `${SLUG_URL}/` })?.url === SLUG_LOOKUP
      && dover.detect({ name: 'Acme', careers_url: `${SLUG_URL}?utm_source=x` })?.url === SLUG_LOOKUP) {
    pass('dover.detect() claims app.dover.com/jobs/<slug> (trailing slash and query ignored)');
  } else {
    fail(`dover.detect() slug form = ${JSON.stringify(dover.detect({ name: 'Acme', careers_url: SLUG_URL }))}`);
  }

  const slugJunk = [
    'https://app.dover.com/jobs',                       // no slug
    'https://app.dover.com/jobs/',                      // no slug
    'http://app.dover.com/jobs/acme',                   // non-https
    'https://example.com/jobs/acme',                    // other host
    'https://evil.example/app.dover.com/jobs/acme',     // path spoof
    'https://app.dover.com/jobs/ac%2Fme',               // percent-escaped slash
    'https://app.dover.com/jobs/ac.me',                 // dot
    'https://app.dover.com/jobs/-acme',                 // non-alphanumeric edge
    `https://app.dover.com/jobs/${'a'.repeat(101)}`,    // over-long
  ];
  let slugJunkOk = true;
  for (const u of slugJunk) {
    try {
      if (dover.detect({ name: 'X', careers_url: u }) !== null) { slugJunkOk = false; fail(`dover.detect() should be null for ${u}`); }
    } catch (err) {
      slugJunkOk = false;
      fail(`dover.detect() threw for ${u}: ${err.message}`);
    }
  }
  if (slugJunkOk) pass('dover.detect() returns null (no throw) for malformed /jobs/<slug> URLs');

  const slugBoard = resolveBoard({ careers_url: SLUG_URL });
  if (slugBoard?.slug === 'acme' && slugBoard?.board === null) pass('resolveBoard returns { slug, board: null } for the /jobs/<slug> form');
  else fail(`resolveBoard slug form = ${JSON.stringify(slugBoard)}`);

  // The older <Company>/careers/<client-id> route carries a client id that is not
  // a v4 uuid (version nibble 6); it keeps resolving like any other board id.
  const CLIENT_ID = '0a1b2c3d-4e5f-6a6b-8c7d-9e0f1a2b3c4d';
  if (dover.detect({ name: 'Acme', careers_url: `https://app.dover.com/Acme/careers/${CLIENT_ID}` })?.url
      === `https://app.dover.com/api/v1/careers-page/${CLIENT_ID}/jobs?limit=300&offset=0`) {
    pass('dover.detect() still resolves the <Company>/careers/<client-id> form (non-v4 client id)');
  } else {
    fail('dover.detect() lost the <Company>/careers/<client-id> form');
  }

  // Overlap: a company literally named "jobs" publishes /jobs/careers/<uuid>. That is the
  // <Company>/careers/<uuid> form, not the /jobs/<slug> form with slug "careers".
  const overlap = resolveBoard({ careers_url: `https://app.dover.com/jobs/careers/${BOARD}` });
  if (overlap?.board === BOARD && overlap?.slug === null && overlap?.company === 'jobs'
      && dover.detect({ name: 'Jobs Co', careers_url: `https://app.dover.com/jobs/careers/${BOARD}` })?.url === API0) {
    pass('dover.detect() reads /jobs/careers/<uuid> as company "jobs" with a board uuid, not slug "careers"');
  } else {
    fail(`dover /jobs/careers/<uuid> overlap = ${JSON.stringify(overlap)}`);
  }
  // A real slug named "careers" (no uuid after it) is still the slug form.
  if (resolveBoard({ careers_url: 'https://app.dover.com/jobs/careers' })?.slug === 'careers') {
    pass('resolveBoard still reads /jobs/careers (no uuid) as slug "careers"');
  } else {
    fail('resolveBoard should read /jobs/careers as slug "careers"');
  }

  // fetch(): slug lookup first, then the board's list pages; company segment from the lookup name.
  const slugCalls = [];
  const slugFetched = await dover.fetch({ name: 'Acme Inc', careers_url: SLUG_URL }, {
    fetchJson: async (url, o) => {
      slugCalls.push({ url, o });
      return url === SLUG_LOOKUP ? lookupBody : sample;
    },
  });
  if (slugCalls.length === 2 && slugCalls[0].url === SLUG_LOOKUP && slugCalls[1].url === API0) {
    pass('dover.fetch() resolves /jobs/<slug> through the slug lookup, then reads the board list');
  } else {
    fail(`dover.fetch() slug calls: ${JSON.stringify(slugCalls.map((c) => c.url))}`);
  }
  if (slugCalls.every((c) => c.o?.redirect === 'error')) pass('dover.fetch() passes redirect:"error" on the slug lookup too (SSRF guard)');
  else fail(`dover.fetch() slug opts = ${JSON.stringify(slugCalls.map((c) => c.o))}`);
  if (slugFetched.length === 3 && slugFetched[0].company === 'Acme Inc'
      && slugFetched[0].url === 'https://app.dover.com/apply/Acme%20Corp/id-1') {
    pass('dover.fetch() on a slug entry: company from entry name, apply URL segment from the lookup name');
  } else {
    fail(`dover.fetch() slug row 0 = ${JSON.stringify(slugFetched[0])}`);
  }

  // Without an entry name, the lookup name is the company; without either, the slug.
  const unnamed = await dover.fetch({ careers_url: SLUG_URL }, {
    fetchJson: async (url) => (url === SLUG_LOOKUP ? lookupBody : sample),
  });
  const noName = await dover.fetch({ careers_url: SLUG_URL }, {
    fetchJson: async (url) => (url === SLUG_LOOKUP ? { id: BOARD } : sample),
  });
  if (unnamed[0]?.company === 'Acme Corp' && noName[0]?.company === 'acme'
      && noName[0]?.url === 'https://app.dover.com/apply/acme/id-1') {
    pass('dover.fetch() falls back from entry name to lookup name to slug');
  } else {
    fail(`dover.fetch() name fallbacks: ${JSON.stringify([unnamed[0], noName[0]])}`);
  }

  // An unknown slug is a 404 from the lookup: it throws and never reads as an empty board.
  let unknownThrew = false;
  let unknownListCalled = false;
  try {
    await dover.fetch({ name: 'Acme', careers_url: 'https://app.dover.com/jobs/no-such-company' }, {
      sleep: async () => {},
      fetchJson: async (url) => {
        if (url.includes('/careers-page-slug/')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
        unknownListCalled = true;
        return { results: [] };
      },
    });
  } catch (e) {
    unknownThrew = /404/.test(e.message);
  }
  if (unknownThrew && !unknownListCalled) pass('dover.fetch() surfaces an unknown slug (404) as an error, not an empty board');
  else fail(`dover.fetch() unknown slug: threw=${unknownThrew}, list requested=${unknownListCalled}`);

  // A lookup body without a board uuid throws (defensive parsing); nothing is listed.
  let badBodies = true;
  for (const bad of [{}, { id: 'not-a-uuid' }, { id: 42 }, null, [], 'x']) {
    let threw = false;
    let listed = false;
    try {
      await dover.fetch({ name: 'Acme', careers_url: SLUG_URL }, {
        sleep: async () => {},
        fetchJson: async (url) => { if (url === SLUG_LOOKUP) return bad; listed = true; return sample; },
      });
    } catch (e) {
      threw = /unexpected slug lookup response/.test(e.message);
    }
    if (!threw || listed) { badBodies = false; fail(`dover.fetch() should throw on slug lookup body ${JSON.stringify(bad)} (threw=${threw}, listed=${listed})`); }
  }
  if (badBodies) pass('dover.fetch() throws on a slug lookup response that carries no board uuid');

  // Paging works on the resolved board id.
  const slugUrls = [];
  const slugPaged = await dover.fetch({ name: 'BigCo', careers_url: SLUG_URL }, {
    sleep: async () => {},
    fetchJson: async (url) => {
      if (url === SLUG_LOOKUP) return lookupBody;
      slugUrls.push(url);
      return slugUrls.length === 1 ? full(0, 300) : full(1, 20, null);
    },
  });
  if (slugUrls.length === 2 && slugUrls[0] === API0 && slugUrls[1].endsWith(`${BOARD}/jobs?limit=300&offset=300`) && slugPaged.length === 320) {
    pass('dover.fetch() pages a /jobs/<slug> board by offset using the resolved board uuid');
  } else {
    fail(`dover.fetch() slug pagination: ${JSON.stringify(slugUrls)}, ${slugPaged.length} jobs`);
  }

  // The page cap still marks a capped slug board with jobs.truncated.
  let slugHugeCalls = 0;
  const { result: slugHuge } = await captureConsoleErrors(() => dover.fetch({ name: 'BigCo', careers_url: SLUG_URL, max_pages: 2 }, {
    sleep: async () => {},
    fetchJson: async (url) => { if (url === SLUG_LOOKUP) return lookupBody; slugHugeCalls++; return full(slugHugeCalls, 300); },
  }));
  if (slugHugeCalls === 2 && slugHuge.truncated?.reason === 'page-cap') pass('dover.fetch() keeps the page-cap truncated signal on a slug board');
  else fail(`dover.fetch() slug cap: ${slugHugeCalls} list calls, ${JSON.stringify(slugHuge.truncated)}`);

  // Probe on a slug board: one lookup + one list page, no retries, failure rethrown unwrapped.
  let slugProbeCalls = 0;
  const slugProbed = await dover.fetch({ name: 'BigCo', careers_url: SLUG_URL }, {
    maxPages: 1,
    fetchJson: async (url) => { slugProbeCalls++; return url === SLUG_LOOKUP ? lookupBody : full(0, 300); },
  });
  if (slugProbeCalls === 2 && !slugProbed.truncated) pass('dover.fetch() probe on a slug board makes one lookup and one list request, unflagged');
  else fail(`dover.fetch() slug probe: ${slugProbeCalls} calls, truncated=${JSON.stringify(slugProbed.truncated)}`);

  const lookupErr = new Error('budget');
  let lookupCalls = 0;
  let lookupUnwrapped = false;
  try {
    await dover.fetch({ name: 'BigCo', careers_url: SLUG_URL }, {
      maxPages: 1,
      sleep: async () => {},
      fetchJson: async () => { lookupCalls++; throw lookupErr; },
    });
  } catch (e) {
    lookupUnwrapped = e === lookupErr;
  }
  if (lookupUnwrapped && lookupCalls === 1) pass('dover.fetch() probe propagates a failed slug lookup unwrapped after exactly one call');
  else fail(`dover.fetch() slug lookup probe failure: unwrapped=${lookupUnwrapped}, calls=${lookupCalls}`);

  // A non-probe lookup retries a status-less failure (RETRY_POLICY), like the list requests.
  let retryCalls = 0;
  const retried = await dover.fetch({ name: 'Acme', careers_url: SLUG_URL }, {
    sleep: async () => {},
    fetchJson: async (url) => {
      if (url === SLUG_LOOKUP) { retryCalls++; if (retryCalls === 1) throw new Error('socket hang up'); return lookupBody; }
      return sample;
    },
  });
  if (retryCalls === 2 && retried.length === 3) pass('dover.fetch() retries a transient slug lookup failure during a normal scan');
  else fail(`dover.fetch() lookup retry: ${retryCalls} lookups, ${retried.length} jobs`);
} catch (e) {
  fail(`dover provider tests crashed: ${e.stack || e.message}`);
}
