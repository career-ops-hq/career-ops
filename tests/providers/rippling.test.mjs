// tests/providers/rippling.test.mjs — direct provider-contract tests.
//
// Rippling's board API is a same-origin, paginated
// `ats.rippling.com/api/v2/board/<slug>/jobs?page=&pageSize=` envelope
// (`{ items, page, pageSize, totalItems, totalPages }`) — see the header
// comment in providers/rippling.mjs for the full shape.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — rippling');

try {
  const ripplingModule = await import(pathToFileURL(join(ROOT, 'providers/rippling.mjs')).href);
  const rippling = ripplingModule.default;
  const { parseRipplingPage } = ripplingModule;

  if (rippling.id === 'rippling') pass('rippling.id is "rippling"');
  else fail(`rippling.id is ${JSON.stringify(rippling.id)}`);

  // detect(): ats.rippling.com/<slug>/jobs → page-0 board API URL.
  const hit = rippling.detect({ name: 'Acme', careers_url: 'https://ats.rippling.com/acme-corp/jobs' });
  if (hit && hit.url === 'https://ats.rippling.com/api/v2/board/acme-corp/jobs?page=0&pageSize=1000') {
    pass('rippling.detect() resolves ats.rippling.com/<slug>/jobs → v2 board API URL');
  } else {
    fail(`rippling.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect() also works when careers_url is just /<slug> (no /jobs suffix).
  const hitNoJobs = rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/acme-corp' });
  if (hitNoJobs && hitNoJobs.url === 'https://ats.rippling.com/api/v2/board/acme-corp/jobs?page=0&pageSize=1000') {
    pass('rippling.detect() derives the slug from the first path segment (no /jobs needed)');
  } else {
    fail(`rippling.detect() no-/jobs returned ${JSON.stringify(hitNoJobs)}`);
  }

  if (rippling.detect({ name: 'X', careers_url: 'https://example.com/acme/jobs' }) === null) {
    pass('rippling.detect() returns null for non-rippling hosts');
  } else {
    fail('rippling.detect() should return null for non-rippling hosts');
  }

  // careers_url with non-string value → detect() returns null without crashing.
  if (rippling.detect({ name: 'X', careers_url: null }) === null && rippling.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('rippling.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('rippling.detect() should treat non-string careers_url as missing');
  }

  // SSRF/format: non-https, empty path (no slug), and host-spoof in the path.
  if (rippling.detect({ name: 'X', careers_url: 'http://ats.rippling.com/acme/jobs' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://evil.example/ats.rippling.com/acme/jobs' }) === null) {
    pass('rippling.detect() rejects non-https, empty-path, and path-spoofed URLs');
  } else {
    fail('rippling.detect() must reject non-https / empty-path / path-spoofed URLs');
  }

  // Slug safety: a first segment that is not a clean token (space, dot, hyphen-edged) is rejected.
  if (rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/a%20b/jobs' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/acme.corp/jobs' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/-acme/jobs' }) === null) {
    pass('rippling.detect() rejects unsafe slugs (space, dot, leading hyphen)');
  } else {
    fail('rippling.detect() must reject unsafe slugs');
  }

  // Internal hyphens are valid.
  if (rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/just-appraised-jobs/jobs' })?.url
      === 'https://ats.rippling.com/api/v2/board/just-appraised-jobs/jobs?page=0&pageSize=1000') {
    pass('rippling.detect() accepts slugs with internal hyphens');
  } else {
    fail('rippling.detect() should accept internal hyphens in the slug');
  }

  // parseRipplingPage — deterministic sample (one page's `items[]`).
  const sample = {
    page: 0, pageSize: 1000, totalItems: 4, totalPages: 1,
    items: [
      { id: '1', name: 'Account Executive', url: 'https://ats.rippling.com/acme/jobs/uuid-1', department: { name: 'Sales' }, locations: [{ name: 'Remote (United States)' }] },
      { id: '2', name: '  ML Engineer  ', url: '  https://ats.rippling.com/acme/jobs/uuid-2  ', locations: [{ name: 'Berlin, Germany' }, { name: 'Hamburg, Germany' }] },
      { id: '3', name: 'No Loc Role', url: 'https://ats.rippling.com/acme/jobs/uuid-3', locations: [] },
      { id: '4', name: 'Missing Locations', url: 'https://ats.rippling.com/acme/jobs/uuid-4' },
      { id: '5', name: '', url: 'https://ats.rippling.com/acme/jobs/uuid-5' },   // drop: empty name
      { id: '6', name: 'No URL Role' },                                          // drop: no url
      { id: '7', name: 'Insecure', url: 'http://ats.rippling.com/acme/jobs/uuid-7' }, // drop: non-https
    ],
  };
  const { jobs, rawCount } = parseRipplingPage(sample, 'Acme');

  if (rawCount === 7) pass('parseRipplingPage reports the source\'s raw item count (before row filtering)');
  else fail(`parseRipplingPage rawCount = ${rawCount} (expected 7)`);

  if (jobs.length === 4) pass('parseRipplingPage keeps 4 valid postings (drops empty-name / no-url / non-https)');
  else fail(`parseRipplingPage returned ${jobs.length} postings (expected 4)`);

  if (jobs[0] && Object.keys(jobs[0]).sort().join(',') === 'company,location,title,url') {
    pass('parseRipplingPage returns the normalized { title, url, company, location } shape');
  } else {
    fail(`parseRipplingPage row 0 keys = ${JSON.stringify(jobs[0] && Object.keys(jobs[0]))}`);
  }

  if (jobs[0]?.title === 'Account Executive'
      && jobs[0]?.url === 'https://ats.rippling.com/acme/jobs/uuid-1'
      && jobs[0]?.company === 'Acme'
      && jobs[0]?.location === 'Remote (United States)') {
    pass('parseRipplingPage maps name→title, url, company from entry name, locations[0].name→location');
  } else {
    fail(`parseRipplingPage row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.title === 'ML Engineer' && jobs[1]?.url === 'https://ats.rippling.com/acme/jobs/uuid-2'
      && jobs[1]?.location === 'Berlin, Germany · Hamburg, Germany') {
    pass('parseRipplingPage trims whitespace from name/url and joins multiple locations with " · "');
  } else {
    fail(`parseRipplingPage row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (jobs[2]?.location === '' && jobs[3]?.location === '') {
    pass('parseRipplingPage yields "" location for an empty or missing locations array');
  } else {
    fail(`parseRipplingPage loc fallbacks = ${JSON.stringify({ empty: jobs[2]?.location, missing: jobs[3]?.location })}`);
  }

  // Regression: the per-item url is host-locked to ats.rippling.com — an external
  // https URL is dropped, a valid ats.rippling.com posting URL is kept.
  const hostLocked = parseRipplingPage(
    { items: [
      { name: 'External Host', url: 'https://evil.example/acme/jobs/uuid-x' },
      { name: 'Valid Host', url: 'https://ats.rippling.com/acme/jobs/uuid-9' },
    ] },
    'Acme',
  );
  if (hostLocked.jobs.length === 1 && hostLocked.jobs[0]?.title === 'Valid Host'
      && hostLocked.jobs[0]?.url === 'https://ats.rippling.com/acme/jobs/uuid-9') {
    pass('parseRipplingPage host-locks the posting url to ats.rippling.com (drops external https URLs)');
  } else {
    fail(`parseRipplingPage host-lock = ${JSON.stringify(hostLocked)}`);
  }

  // Empty-vs-broken split (ADDING_A_PROVIDER.md §2): a present-and-empty
  // `items: []` is a genuinely empty board → no throw, rawCount 0.
  const emptyBoard = parseRipplingPage({ items: [], page: 0, pageSize: 1000, totalItems: 0, totalPages: 0 }, 'X');
  if (emptyBoard.jobs.length === 0 && emptyBoard.rawCount === 0) {
    pass('parseRipplingPage returns [] for a present-and-empty items[] (genuinely empty board)');
  } else {
    fail(`parseRipplingPage empty-board handling = ${JSON.stringify(emptyBoard)}`);
  }

  // An envelope that isn't the documented shape (`items` absent/wrong-typed, or
  // a bare non-object body) throws a descriptive error instead of silently
  // reading as "0 jobs forever".
  for (const bad of [{}, { items: null }, { items: 'nope' }, null, 'not json', 42]) {
    let threw = false;
    try { parseRipplingPage(bad, 'X'); } catch (e) { threw = /unexpected response/.test(e.message); }
    if (!threw) fail(`parseRipplingPage should throw a descriptive error for ${JSON.stringify(bad)}`);
  }
  pass('parseRipplingPage throws a descriptive error for a non-{items[]} envelope');

  // fetch(): requests the derived board API URL (page 0) and passes the SSRF guard.
  let capturedUrl = null;
  let capturedOpts = null;
  let fetchCalls = 0;
  const fetched = await rippling.fetch(
    { name: 'Acme', careers_url: 'https://ats.rippling.com/acme-corp/jobs' },
    { fetchJson: async (url, opts) => { fetchCalls++; capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://ats.rippling.com/api/v2/board/acme-corp/jobs?page=0&pageSize=1000') {
    pass('rippling.fetch() requests the derived board API URL');
  } else {
    fail(`rippling.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('rippling.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  } else {
    fail(`rippling.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 4 && fetched[0]?.company === 'Acme') {
    pass('rippling.fetch() returns normalized jobs with company from entry name');
  } else {
    fail(`rippling.fetch() returned ${fetched.length} jobs, row 0 = ${JSON.stringify(fetched[0])}`);
  }

  // A short first page (rawCount < PAGE_SIZE) is the natural end — exactly one request.
  if (fetchCalls === 1) pass('rippling.fetch() stops after one request when the first page is short (natural end)');
  else fail(`rippling.fetch() made ${fetchCalls} requests for a short single page`);

  // fetch(): a non-rippling careers_url cannot derive an endpoint → throws,
  // and never even reaches fetchJson (not just "returns null/[]").
  let badEntryThrew = false;
  let badEntryFetchCalled = false;
  try {
    await rippling.fetch(
      { name: 'X', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { badEntryFetchCalled = true; return { items: [] }; } },
    );
  } catch (e) {
    badEntryThrew = /cannot derive API URL/.test(e.message);
  }
  if (badEntryThrew && !badEntryFetchCalled) {
    pass('rippling.fetch() throws (without calling fetchJson) when the careers_url is not an ats.rippling.com host');
  } else {
    fail(`rippling.fetch() bad-entry handling: threw=${badEntryThrew}, fetchJson called=${badEntryFetchCalled}`);
  }

  // Pagination: a board bigger than one page walks page 0, 1, 2, ... and stops
  // on the natural short-page end, even though `totalPages` alone would have
  // stopped it earlier or later — the walk's own short page is the proof.
  const bigEntry = { name: 'BigCo', careers_url: 'https://ats.rippling.com/bigco/jobs' };
  const pageOf = (n, count) => ({
    page: n, pageSize: 1000, totalItems: 2000, totalPages: 2,
    items: Array.from({ length: count }, (_, i) => ({
      id: `${n}-${i}`, name: `Role ${n}-${i}`, url: `https://ats.rippling.com/bigco/jobs/${n}-${i}`, locations: [],
    })),
  });
  let bigPages = 0;
  const bigJobs = await rippling.fetch(bigEntry, {
    sleep: async () => {},
    fetchJson: async () => {
      bigPages++;
      return bigPages === 1 ? pageOf(0, 1000) : pageOf(1, 500); // page 0 full, page 1 short → natural end
    },
  });
  if (bigPages === 2 && bigJobs.length === 1500) {
    pass(`rippling.fetch() paginates past page 0 and stops on the natural short-page end (${bigPages} pages, ${bigJobs.length} jobs)`);
  } else {
    fail(`rippling.fetch() pagination: ${bigPages} pages, ${bigJobs.length} jobs (expected 2 pages, 1500 jobs)`);
  }

  // DEFAULT_MAX_PAGES (10) stops an ever-full board even when the source
  // never reports a short page — and warns, since this IS a healthy board
  // truncated by the ceiling.
  let hugePages = 0;
  const { result: hugeJobs, errors: hugeErrors } = await captureConsoleErrors(() => rippling.fetch(bigEntry, {
    sleep: async () => {},
    fetchJson: async () => {
      hugePages++;
      if (hugePages > 15) throw new Error('rippling paginated past any sane bound');
      return pageOf(hugePages, 1000); // always full
    },
  }));
  if (hugePages === 10 && hugeJobs.length === 10_000) {
    pass(`rippling.fetch() clamps pagination at its own DEFAULT_MAX_PAGES for an always-full board (${hugePages} pages)`);
  } else {
    fail(`rippling.fetch() made ${hugePages} requests, ${hugeJobs.length} jobs (expected DEFAULT_MAX_PAGES=10 pages, 10,000 jobs)`);
  }
  if (hugeErrors.some((e) => /raise max_pages/.test(e))) {
    pass('rippling.fetch() warns to raise max_pages when the ceiling truncated a healthy (always-full) board');
  } else {
    fail(`rippling.fetch() should warn "raise max_pages" on a real cap stop, got: ${JSON.stringify(hugeErrors)}`);
  }

  // An explicit max_pages override stops the walk earlier than the default,
  // capped at the provider's own hard ceiling.
  let overridePages = 0;
  await rippling.fetch({ ...bigEntry, max_pages: 2 }, {
    sleep: async () => {},
    fetchJson: async () => { overridePages++; return pageOf(overridePages, 1000); },
  });
  if (overridePages === 2) pass('rippling.fetch() honors an entry.max_pages override');
  else fail(`rippling.fetch() made ${overridePages} requests despite max_pages: 2`);

  // ctx.maxPages (the portal health probe passes 1) caps pagination
  // independently of max_pages, and every list request still carries redirect:'error'.
  let probePages = 0;
  let probeOpts = null;
  await rippling.fetch(bigEntry, {
    maxPages: 1,
    fetchJson: async (_url, opts) => { probePages++; probeOpts = opts; return pageOf(0, 1000); },
  });
  if (probePages === 1) pass('rippling.fetch() honors ctx.maxPages as a health-probe cap (exactly one list request)');
  else fail(`rippling.fetch() made ${probePages} requests despite ctx.maxPages=1`);
  if (probeOpts?.redirect === 'error') pass('rippling.fetch() probe request still passes redirect:"error"');
  else fail(`rippling.fetch() probe request redirect = ${JSON.stringify(probeOpts?.redirect)}`);

  // A ctx.fetch* rejection while ctx.maxPages is set (a probe) propagates
  // UNWRAPPED — verify-portals identifies ProbePageBudgetReached by instanceof,
  // so it must not be caught/swallowed/rewrapped here.
  class FakeProbeBudget extends Error {}
  let probeRejectionSame = false;
  try {
    await rippling.fetch(bigEntry, {
      maxPages: 1,
      fetchJson: async () => { throw new FakeProbeBudget('probe budget reached'); },
    });
  } catch (e) {
    probeRejectionSame = e instanceof FakeProbeBudget;
  }
  if (probeRejectionSame) pass('rippling.fetch() propagates a ctx.fetch* rejection unwrapped while ctx.maxPages is set');
  else fail('rippling.fetch() must not swallow/rewrap a rejection while probing');

  // Pagination + a later page's transient failure (retries exhausted): keeps
  // the pages already collected and does not throw — the board is alive
  // (page 0 proved it) — and must NOT fire the "raise max_pages" warning,
  // since a fetch-error stop means the board broke, not that the ceiling
  // truncated a healthy one.
  let laterFailPages = 0;
  const { result: laterFail, errors: laterFailErrors } = await captureConsoleErrors(() => rippling.fetch(bigEntry, {
    sleep: async () => {},
    fetchJson: async () => {
      laterFailPages++;
      if (laterFailPages === 1) return pageOf(0, 1000); // full page → walk continues
      throw new Error('page 1 blew up');
    },
  }));
  if (laterFail.length === 1000) {
    pass('rippling.fetch() keeps earlier pages and truncates gracefully when a LATER page fails after exhausting retries');
  } else {
    fail(`rippling.fetch() later-page failure handling returned ${laterFail.length} jobs (expected 1000)`);
  }
  if (!laterFailErrors.some((e) => /raise max_pages/.test(e))) {
    pass('rippling.fetch() does not warn "raise max_pages" on a fetch-error stop');
  } else {
    fail(`rippling.fetch() should not warn "raise max_pages" on a fetch-error stop, got: ${JSON.stringify(laterFailErrors)}`);
  }

} catch (e) {
  fail(`rippling provider tests crashed: ${e.message}`);
}
