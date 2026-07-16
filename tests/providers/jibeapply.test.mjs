// tests/providers/jibeapply.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jibeapply');

try {
  const jibeapplyModule = await import(pathToFileURL(join(ROOT, 'providers/jibeapply.mjs')).href);
  const jibeapply = jibeapplyModule.default;
  const { parseJibeapplyResponse } = jibeapplyModule;

  if (jibeapply.id === 'jibeapply') pass('jibeapply.id is "jibeapply"');
  else fail(`jibeapply.id is ${JSON.stringify(jibeapply.id)}`);

  // detect() — /jobs path → /api/jobs
  const hit = jibeapply.detect({ name: 'Acme', careers_url: 'https://acme.jibeapply.com/jobs?location=Germany' });
  if (hit && hit.url === 'https://acme.jibeapply.com/api/jobs?location=Germany') {
    pass('jibeapply.detect() rewrites /jobs → /api/jobs');
  } else {
    fail(`jibeapply.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect() — /api/jobs already present (idempotent)
  const hitApi = jibeapply.detect({ name: 'X', careers_url: 'https://acme.jibeapply.com/api/jobs' });
  if (hitApi && hitApi.url === 'https://acme.jibeapply.com/api/jobs') {
    pass('jibeapply.detect() leaves already-correct /api/jobs URL unchanged');
  } else {
    fail(`jibeapply.detect(api) returned ${JSON.stringify(hitApi)}`);
  }

  // detect() — null cases
  if (jibeapply.detect({ name: 'X', careers_url: 'https://example.com/jobs' }) === null) {
    pass('jibeapply.detect() returns null for non-jibeapply URL');
  } else {
    fail('jibeapply.detect() should return null for non-jibeapply URL');
  }

  // Path-spoofed: jibeapply.com in path, not host
  if (jibeapply.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.jibeapply.com/jobs' }) === null) {
    pass('jibeapply.detect() rejects path-spoofed URL');
  } else {
    fail('jibeapply.detect() must NOT detect path-spoofed URLs');
  }

  // Non-string careers_url
  if (jibeapply.detect({ name: 'X', careers_url: 42 }) === null) {
    pass('jibeapply.detect() returns null for non-string careers_url');
  } else {
    fail('jibeapply.detect() should return null for non-string careers_url');
  }

  // HTTP (non-HTTPS) must not be detected
  if (jibeapply.detect({ name: 'X', careers_url: 'http://acme.jibeapply.com/jobs' }) === null) {
    pass('jibeapply.detect() rejects HTTP (non-HTTPS) URL');
  } else {
    fail('jibeapply.detect() should reject HTTP URLs');
  }

  // parseJibeapplyResponse — normalization
  const entry = { name: 'Acme', careers_url: 'https://acme.jibeapply.com/jobs' };
  const sampleJson = {
    jobs: [
      { title: 'Senior QA', slug: 'senior-qa-berlin', city: 'Berlin', country: 'Germany', hiring_organization: 'Acme GmbH' },
      { title: 'Backend Dev', req_id: 'REQ-123', full_location: 'Remote, Germany' },
      { data: { title: 'Wrapped Job', slug: 'wrapped-job', city: 'Munich', country: 'Germany' } },
      { title: '', slug: 'no-title' },          // missing title — skip
      { title: 'No Slug' },                      // missing slug/req_id — skip
    ],
  };
  const parsedJibe = parseJibeapplyResponse(sampleJson, entry);

  if (parsedJibe.length === 3) pass('parseJibeapplyResponse extracts 3 valid jobs');
  else fail(`parseJibeapplyResponse returned ${parsedJibe.length} jobs, expected 3`);

  if (parsedJibe[0].url === 'https://acme.jibeapply.com/jobs/senior-qa-berlin') {
    pass('parseJibeapplyResponse builds URL from origin + /jobs/ + slug');
  } else {
    fail(`row 0 url = ${JSON.stringify(parsedJibe[0].url)}`);
  }

  if (parsedJibe[0].location === 'Berlin, Germany') {
    pass('parseJibeapplyResponse builds location from city/country');
  } else {
    fail(`row 0 location = ${JSON.stringify(parsedJibe[0].location)}`);
  }

  if (parsedJibe[0].company === 'Acme GmbH') {
    pass('parseJibeapplyResponse uses hiring_organization when present');
  } else {
    fail(`row 0 company = ${JSON.stringify(parsedJibe[0].company)}`);
  }

  if (parsedJibe[1].url.includes('REQ-123') && parsedJibe[1].location === 'Remote, Germany') {
    pass('parseJibeapplyResponse uses req_id and full_location');
  } else {
    fail(`row 1 = ${JSON.stringify(parsedJibe[1])}`);
  }

  if (parsedJibe[2].title === 'Wrapped Job') {
    pass('parseJibeapplyResponse unwraps item.data');
  } else {
    fail(`row 2 title = ${JSON.stringify(parsedJibe[2].title)}`);
  }

  // parseJibeapplyResponse — falls back to entry.name when hiring_organization missing
  const noOrg = parseJibeapplyResponse({ jobs: [{ title: 'Dev', slug: 'dev', city: 'Berlin', country: 'Germany' }] }, entry);
  if (noOrg[0].company === 'Acme') {
    pass('parseJibeapplyResponse falls back to entry.name when hiring_organization missing');
  } else {
    fail(`fallback company = ${JSON.stringify(noOrg[0].company)}`);
  }

  // parseJibeapplyResponse — empty input
  if (parseJibeapplyResponse({}, entry).length === 0) pass('parseJibeapplyResponse({}) → empty result');
  else fail('parseJibeapplyResponse({}) should be empty');

  // parseJibeapplyResponse — falls back to entry.api's origin when careers_url
  // can't be parsed, so job URLs stay absolute instead of degrading to "/jobs/<slug>"
  const malformedCareersEntry = { name: 'Widget Co', careers_url: 'jobs.widgetco.com', api: 'https://jobs.widgetco.com/api/jobs' };
  const apiOriginFallback = parseJibeapplyResponse({ jobs: [{ title: 'Dev', slug: 'dev-1' }] }, malformedCareersEntry);
  if (apiOriginFallback[0]?.url === 'https://jobs.widgetco.com/jobs/dev-1') {
    pass('parseJibeapplyResponse falls back to entry.api origin for a malformed careers_url');
  } else {
    fail(`parseJibeapplyResponse api-origin fallback: url = ${JSON.stringify(apiOriginFallback[0]?.url)}`);
  }

  // parseJibeapplyResponse — null/undefined entries in jobs must be skipped, not crash
  const sparseJson = { jobs: [null, undefined, { title: 'Real Job', slug: 'real-job' }] };
  try {
    const parsedSparse = parseJibeapplyResponse(sparseJson, entry);
    if (parsedSparse.length === 1 && parsedSparse[0].title === 'Real Job') {
      pass('parseJibeapplyResponse skips null/undefined entries without crashing');
    } else {
      fail(`parseJibeapplyResponse sparse result = ${JSON.stringify(parsedSparse)}`);
    }
  } catch (e3) {
    fail(`parseJibeapplyResponse should not throw on null/undefined entries: ${e3.message}`);
  }

  // fetch() pagination — 2 pages
  let pageRequests = 0;
  const fetchedJibe = await jibeapply.fetch(entry, {
    transport: 'http',
    fetchText: async () => { throw new Error('fetchText not expected'); },
    fetchJson: async (url) => {
      pageRequests++;
      const u = new URL(url);
      const page = parseInt(u.searchParams.get('page') || '1', 10);
      if (page === 1) {
        return { totalCount: 15, count: 10, jobs: Array.from({ length: 10 }, (_, i) => ({ title: `Job ${i}`, slug: `job-${i}` })) };
      }
      return { totalCount: 15, count: 10, jobs: Array.from({ length: 5 }, (_, i) => ({ title: `Job p2-${i}`, slug: `job-p2-${i}` })) };
    },
  });
  if (pageRequests === 2 && fetchedJibe.length === 15) {
    pass('jibeapply.fetch() paginates across 2 pages (10+5=15)');
  } else {
    fail(`jibeapply fetch pagination: requests=${pageRequests}, total=${fetchedJibe.length} (expected 2/15)`);
  }

  // fetch() pagination cap — an inflated totalCount must not trigger unbounded
  // concurrent requests (MAX_PAGES = 50 in providers/jibeapply.mjs), and
  // hitting the cap must be visible (console.error), not silent.
  let hugeRequests = 0;
  const jibeCapWarnings = [];
  const originalConsoleError = console.error;
  console.error = (msg) => jibeCapWarnings.push(msg);
  let fetchedHuge;
  try {
    fetchedHuge = await jibeapply.fetch(entry, {
      transport: 'http',
      fetchText: async () => { throw new Error('fetchText not expected'); },
      fetchJson: async () => {
        hugeRequests++;
        return { totalCount: 1_000_000, count: 10, jobs: Array.from({ length: 10 }, (_, i) => ({ title: `Job ${i}`, slug: `job-${i}` })) };
      },
    });
  } finally {
    console.error = originalConsoleError;
  }
  if (hugeRequests === 50 && fetchedHuge.length === 500) {
    pass('jibeapply.fetch() caps pagination at MAX_PAGES despite an inflated totalCount');
  } else {
    fail(`jibeapply fetch pagination cap: requests=${hugeRequests}, total=${fetchedHuge.length} (expected 50/500)`);
  }
  if (jibeCapWarnings.some(w => /has more postings than max_pages allows/.test(w))) {
    pass('jibeapply.fetch() warns (console.error) when the cap truncates real results');
  } else {
    fail(`jibeapply fetch cap: expected a truncation warning, got ${JSON.stringify(jibeCapWarnings)}`);
  }

  // fetch() pagination cap — entry.max_pages raises the cap for a genuinely
  // large tenant (e.g. a Workday-scale Deutsche Bank equivalent on JibeApply)
  let overriddenRequests = 0;
  const bigEntry = { name: 'BigCo', careers_url: 'https://bigco.jibeapply.com/jobs', max_pages: 80 };
  const fetchedOverridden = await jibeapply.fetch(bigEntry, {
    transport: 'http',
    fetchText: async () => { throw new Error('fetchText not expected'); },
    fetchJson: async () => {
      overriddenRequests++;
      return { totalCount: 1_000_000, count: 10, jobs: Array.from({ length: 10 }, (_, i) => ({ title: `Job ${i}`, slug: `job-${i}` })) };
    },
  });
  if (overriddenRequests === 80 && fetchedOverridden.length === 800) {
    pass('jibeapply.fetch() honors entry.max_pages to raise the cap above the default');
  } else {
    fail(`jibeapply fetch max_pages override: requests=${overriddenRequests}, total=${fetchedOverridden.length} (expected 80/800)`);
  }

  // entry.max_pages is itself capped (MAX_PAGES_CAP = 500) — an absurd override
  // can't turn this into an unbounded scan either
  let cappedOverrideRequests = 0;
  const absurdEntry = { name: 'AbsurdCo', careers_url: 'https://absurdco.jibeapply.com/jobs', max_pages: 100_000 };
  const fetchedAbsurd = await jibeapply.fetch(absurdEntry, {
    transport: 'http',
    fetchText: async () => { throw new Error('fetchText not expected'); },
    fetchJson: async () => {
      cappedOverrideRequests++;
      return { totalCount: 10_000_000, count: 10, jobs: Array.from({ length: 10 }, (_, i) => ({ title: `Job ${i}`, slug: `job-${i}` })) };
    },
  });
  if (cappedOverrideRequests === 500 && fetchedAbsurd.length === 5000) {
    pass('jibeapply.fetch() caps an absurd entry.max_pages at MAX_PAGES_CAP');
  } else {
    fail(`jibeapply fetch max_pages hard cap: requests=${cappedOverrideRequests}, total=${fetchedAbsurd.length} (expected 500/5000)`);
  }

  // fetch() pagination — a failure on a later page returns the jobs gathered
  // so far instead of discarding everything (sequential, not Promise.all),
  // and the failure itself is visible (console.error), not silent.
  let flakyRequests = 0;
  const jibeFlakyWarnings = [];
  console.error = (msg) => jibeFlakyWarnings.push(msg);
  let fetchedFlaky;
  try {
    fetchedFlaky = await jibeapply.fetch(entry, {
      transport: 'http',
      fetchText: async () => { throw new Error('fetchText not expected'); },
      fetchJson: async (url) => {
        flakyRequests++;
        const u = new URL(url);
        const page = parseInt(u.searchParams.get('page') || '1', 10);
        if (page === 3) throw new Error('HTTP 503');
        return { totalCount: 40, count: 10, jobs: Array.from({ length: 10 }, (_, i) => ({ title: `Job p${page}-${i}`, slug: `job-p${page}-${i}` })) };
      },
    });
  } finally {
    console.error = originalConsoleError;
  }
  if (flakyRequests === 3 && fetchedFlaky.length === 20) {
    pass('jibeapply.fetch() returns partial results when a later page fails');
  } else {
    fail(`jibeapply fetch partial failure: requests=${flakyRequests}, total=${fetchedFlaky.length} (expected 3/20)`);
  }
  if (jibeFlakyWarnings.some(w => /page \d+ fetch failed/.test(w))) {
    pass('jibeapply.fetch() warns (console.error) when a page fetch fails mid-pagination');
  } else {
    fail(`jibeapply fetch page failure: expected a fetch-failed warning, got ${JSON.stringify(jibeFlakyWarnings)}`);
  }

  // fetch() with explicit entry.api (non-jibeapply.com host)
  let explicitApiUrl = null;
  const brandedEntry = { name: 'Widget Co', careers_url: 'https://jobs.widgetco.com/jobs', api: 'https://jobs.widgetco.com/api/jobs?internal=false' };
  await jibeapply.fetch(brandedEntry, {
    transport: 'http',
    fetchText: async () => { throw new Error('fetchText not expected'); },
    fetchJson: async (url) => { explicitApiUrl = url; return { totalCount: 3, count: 3, jobs: [{ title: 'Dev', slug: 'dev-1' }] }; },
  });
  if (explicitApiUrl && explicitApiUrl.startsWith('https://jobs.widgetco.com/api/jobs')) {
    pass('jibeapply.fetch() uses entry.api for non-jibeapply.com hosts');
  } else {
    fail(`jibeapply.fetch() with entry.api called url=${JSON.stringify(explicitApiUrl)}`);
  }

  // fetch() with entry.api — iCIMS-hosted JibeApply pattern: count === totalCount but jobs.length < count
  let brandedRequests = 0;
  const fetchedBranded = await jibeapply.fetch(brandedEntry, {
    transport: 'http',
    fetchText: async () => { throw new Error('fetchText not expected'); },
    fetchJson: async (url) => {
      brandedRequests++;
      const u = new URL(url);
      const page = parseInt(u.searchParams.get('page') || '1', 10);
      // count === totalCount (iCIMS-hosted pattern), jobs only has page-worth of items
      if (page === 1) return { totalCount: 15, count: 15, jobs: Array.from({ length: 10 }, (_, i) => ({ title: `J${i}`, slug: `j-${i}` })) };
      return { totalCount: 15, count: 15, jobs: Array.from({ length: 5 }, (_, i) => ({ title: `J2-${i}`, slug: `j2-${i}` })) };
    },
  });
  if (brandedRequests === 2 && fetchedBranded.length === 15) {
    pass('jibeapply.fetch() paginates when count===totalCount but jobs.length < count');
  } else {
    fail(`jibeapply fetch iCIMS pattern: requests=${brandedRequests}, total=${fetchedBranded.length} (expected 2/15)`);
  }

  // fetch() throws when both entry.api is HTTP and careers_url is non-jibeapply.com
  // (no valid API URL can be derived from either source)
  try {
    await jibeapply.fetch({ name: 'X', careers_url: 'https://jobs.example.com/jobs', api: 'http://evil.com/api/jobs' }, {
      fetchText: async () => '', fetchJson: async () => { throw new Error('should not reach'); },
    });
    fail('jibeapply.fetch() should throw when no valid API URL can be derived');
  } catch (e2) {
    if (/cannot derive API URL/i.test(e2.message)) pass('jibeapply.fetch() throws when HTTP entry.api and non-jibeapply careers_url');
    else fail(`jibeapply.fetch() wrong error: ${e2.message}`);
  }

} catch (e) {
  fail(`jibeapply provider tests crashed: ${e.message}`);
}

