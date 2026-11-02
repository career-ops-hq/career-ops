// tests/providers/jobstreet.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobstreet');


try {
  const jobstreetModule = await import(pathToFileURL(join(ROOT, 'providers/jobstreet.mjs')).href);
  const jobstreet = jobstreetModule.default;
  const { parseJobstreetItem } = jobstreetModule;

  // id check
  if (jobstreet.id === 'jobstreet') pass('jobstreet.id is "jobstreet"');
  else fail(`jobstreet.id is ${JSON.stringify(jobstreet.id)}`);

  // detect() always returns null (job board, not ATS)
  if (jobstreet.detect({ name: 'X', careers_url: 'https://id.jobstreet.com/jobs' }) === null) {
    pass('jobstreet.detect() returns null — explicit provider only, no URL auto-detection');
  } else {
    fail('jobstreet.detect() should return null for any URL');
  }

  // parseJobstreetItem — valid item (v5 API shape)
  const sampleItem = {
    id: '92996157',
    title: 'Facility Engineer',
    advertiser: { id: '60960115', description: 'PT YOFC International Indonesia' },
    companyName: 'YOFC International',
    locations: [{ label: 'Karawang, West Java', countryCode: 'ID' }],
    listingDate: '2026-06-29T02:53:00Z',
  };
  const parsed = parseJobstreetItem(sampleItem, 'https://id.jobstreet.com', 'FallbackCo');
  if (parsed && parsed.title === 'Facility Engineer'
      && parsed.url === 'https://id.jobstreet.com/id/job/92996157'
      && parsed.company === 'PT YOFC International Indonesia'
      && parsed.location === 'Karawang, West Java'
      && parsed.postedAt != null) {
    pass('parseJobstreetItem extracts title, url, company, location, postedAt correctly');
  } else {
    fail(`parseJobstreetItem returned ${JSON.stringify(parsed)}`);
  }

  // parseJobstreetItem — job-detail path is host-aware: only the Indonesian
  // sites use the /id/ locale prefix; seek.com.au & co serve /job/<id>
  const auParsed = parseJobstreetItem({ id: '94036672', title: 'Strategy Consultant' }, 'https://www.seek.com.au', 'Co');
  if (auParsed && auParsed.url === 'https://www.seek.com.au/job/94036672') {
    pass('parseJobstreetItem builds /job/<id> for www.seek.com.au (no /id/ locale prefix)');
  } else {
    fail(`parseJobstreetItem seek.com.au url was ${JSON.stringify(auParsed && auParsed.url)}`);
  }
  const sgParsed = parseJobstreetItem({ id: '94244276', title: 'Analyst' }, 'https://sg.jobstreet.com', 'Co');
  if (sgParsed && sgParsed.url === 'https://sg.jobstreet.com/job/94244276') {
    pass('parseJobstreetItem builds /job/<id> for sg.jobstreet.com');
  } else {
    fail(`parseJobstreetItem sg.jobstreet.com url was ${JSON.stringify(sgParsed && sgParsed.url)}`);
  }

  // parseJobstreetItem — appendWorkType is opt-in and suffixes the title
  const wtItem = { id: '1', title: 'Strategy Consultant', workTypes: ['Part time'] };
  const wtOff = parseJobstreetItem(wtItem, 'https://www.seek.com.au', 'Co');
  const wtOn = parseJobstreetItem(wtItem, 'https://www.seek.com.au', 'Co', { appendWorkType: true });
  if (wtOff && wtOff.title === 'Strategy Consultant'
      && wtOn && wtOn.title === 'Strategy Consultant [Part time]') {
    pass('parseJobstreetItem appends work type to the title only when appendWorkType is set');
  } else {
    fail(`appendWorkType titles were off=${JSON.stringify(wtOff && wtOff.title)} on=${JSON.stringify(wtOn && wtOn.title)}`);
  }
  const wtNone = parseJobstreetItem({ id: '2', title: 'Analyst' }, 'https://www.seek.com.au', 'Co', { appendWorkType: true });
  if (wtNone && wtNone.title === 'Analyst') pass('parseJobstreetItem leaves the title alone when workTypes is absent');
  else fail(`appendWorkType with no workTypes gave ${JSON.stringify(wtNone && wtNone.title)}`);

  // fetch() — appendWorkType on the portal entry flows through to parsed titles
  const auJobs = await jobstreet.fetch(
    {
      name: 'SEEK AU',
      provider: 'jobstreet',
      api: 'https://www.seek.com.au/api/jobsearch/v5/search',
      siteKey: 'AU-Main',
      searchKeywords: 'strategy',
      appendWorkType: true,
    },
    {
      transport: 'http',
      fetchJson: async () => ({
        data: [{ id: '94036672', title: 'Strategy Consultant', workTypes: ['Part time'], locations: [{ label: 'Melbourne VIC' }] }],
        totalCount: 1,
      }),
      fetchText: async () => { throw new Error('should not be called'); },
    },
  );
  if (auJobs.length === 1 && auJobs[0].title === 'Strategy Consultant [Part time]'
      && auJobs[0].url === 'https://www.seek.com.au/job/94036672') {
    pass('jobstreet.fetch() honours entry.appendWorkType and builds seek.com.au /job/ links');
  } else {
    fail(`jobstreet.fetch() SEEK AU gave ${JSON.stringify(auJobs)}`);
  }

  // parseJobstreetItem — uses companyName fallback when advertiser.description is absent
  const noAdvertiserItem = {
    id: '2',
    title: 'Data Scientist',
    companyName: 'TechCorp',
    locations: [{ label: 'Jakarta' }],
    listingDate: '2026-06-01T00:00:00Z',
  };
  const noAdvParsed = parseJobstreetItem(noAdvertiserItem, 'https://id.jobstreet.com', 'Fallback');
  if (noAdvParsed && noAdvParsed.company === 'TechCorp') {
    pass('parseJobstreetItem falls back to companyName when advertiser.description is absent');
  } else {
    fail(`parseJobstreetItem companyName fallback: ${JSON.stringify(noAdvParsed)}`);
  }

  // parseJobstreetItem — rejects items without title
  if (parseJobstreetItem({ id: '1' }, 'https://id.jobstreet.com', 'Co') === null) {
    pass('parseJobstreetItem returns null for items without title');
  } else {
    fail('parseJobstreetItem should return null for title-less items');
  }

  // parseJobstreetItem — rejects items without id (URL cannot be built)
  if (parseJobstreetItem({ title: 'Role' }, 'https://id.jobstreet.com', 'Co') === null) {
    pass('parseJobstreetItem returns null for items without id');
  } else {
    fail('parseJobstreetItem should return null for items without id');
  }

  // parseJobstreetItem — rejects off-domain base URLs
  const offDomain = parseJobstreetItem(
    { id: '1', title: 'Role', locations: [{ label: 'Remote' }] },
    'https://evil.example.com', 'Co'
  );
  if (offDomain === null) pass('parseJobstreetItem rejects off-domain base URLs');
  else fail(`parseJobstreetItem should reject off-domain base URLs, got ${JSON.stringify(offDomain)}`);

  // parseJobstreetItem — handles null/malformed input safely
  if (parseJobstreetItem(null, 'https://id.jobstreet.com', 'Co') === null) pass('parseJobstreetItem(null) → null');
  else fail('parseJobstreetItem(null) should return null');
  if (parseJobstreetItem(7, 'https://id.jobstreet.com', 'Co') === null) pass('parseJobstreetItem(7) → null');
  else fail('parseJobstreetItem(number) should return null');

  // parseJobstreetItem — uses fallback company when both advertiser and companyName are missing
  const noCompany = parseJobstreetItem(
    { id: '99', title: 'Engineer', locations: [{ label: 'Remote' }] },
    'https://id.jobstreet.com', 'PortalFallback'
  );
  if (noCompany && noCompany.company === 'PortalFallback') {
    pass('parseJobstreetItem uses fallback company when all company fields are missing');
  } else {
    fail(`parseJobstreetItem fallback company: ${JSON.stringify(noCompany)}`);
  }

  // parseJobstreetItem — handles empty locations gracefully
  const noLocItem = {
    id: '42',
    title: 'Remote Engineer',
    advertiser: { description: 'RemoteCo' },
    listingDate: '2026-06-15T00:00:00Z',
  };
  const noLocParsed = parseJobstreetItem(noLocItem, 'https://id.jobstreet.com', 'Fallback');
  if (noLocParsed && noLocParsed.location === '') {
    pass('parseJobstreetItem handles missing locations gracefully');
  } else {
    fail(`parseJobstreetItem empty location: ${JSON.stringify(noLocParsed)}`);
  }

  // fetch() — happy path with mock context (v5 API response shape)
  const mockCtx = {
    transport: 'http',
    fetchJson: async (url) => {
      if (!url.startsWith('https://id.jobstreet.com/api/jobsearch/v5/search')) throw new Error('Unexpected URL');
      return {
        data: [
          {
            id: '92884969',
            title: 'AI Engineer',
            advertiser: { id: '14025083', description: 'Capgemini' },
            companyName: 'Capgemini',
            locations: [{ label: 'Jakarta, Indonesia', countryCode: 'ID' }],
            listingDate: '2026-06-23T03:55:20Z',
          },
        ],
        totalCount: 1,
      };
    },
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const jobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'AI' },
    mockCtx,
  );
  if (jobs.length === 1 && jobs[0].title === 'AI Engineer') pass('jobstreet.fetch() returns parsed jobs via v5 API');
  else fail(`jobstreet.fetch() returned ${JSON.stringify(jobs)}`);

  // fetch() — handles empty results
  const emptyCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: [], totalCount: 0 }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const emptyJobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'nonexistent' },
    emptyCtx,
  );
  if (emptyJobs.length === 0) pass('jobstreet.fetch() handles empty results');
  else fail(`jobstreet.fetch() should return empty array for no results, got ${emptyJobs.length}`);

  // fetch() — rejects invalid hostname
  let hostRejected = false;
  try {
    await jobstreet.fetch(
      { name: 'Bad', provider: 'jobstreet', api: 'https://evil.example.com/api/jobsearch/v5/search' },
      { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('untrusted hostname')) hostRejected = true;
    else fail(`jobstreet.fetch() host rejection wrong error: ${e.message}`);
  }
  if (hostRejected) pass('jobstreet.fetch() rejects untrusted hostnames');
  else fail('jobstreet.fetch() should reject non-jobstreet hostnames');

  // fetch() — accepts SEEK's Hong Kong host (JobsDB brand, same v5 API)
  let hkReached = false;
  const hkJobs = await jobstreet.fetch(
    {
      name: 'JobsDB HK',
      provider: 'jobstreet',
      api: 'https://hk.jobsdb.com/api/jobsearch/v5/search',
      siteKey: 'HK-Main',
      searchKeywords: 'business intelligence',
    },
    {
      transport: 'http',
      fetchJson: async (url) => {
        hkReached = String(url).startsWith('https://hk.jobsdb.com/');
        return { data: [], totalCount: 0 };
      },
      fetchText: async () => { throw new Error('should not be called'); },
    },
  );
  if (hkReached && hkJobs.length === 0) pass('jobstreet.fetch() accepts hk.jobsdb.com (HK-Main)');
  else fail('jobstreet.fetch() should accept hk.jobsdb.com and query it directly');

  // fetch() — handles non-array data field
  const badDataCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: null }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const badDataJobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'test' },
    badDataCtx,
  );
  if (badDataJobs.length === 0) pass('jobstreet.fetch() handles null data field');
  else fail(`jobstreet.fetch() should return empty for null data`);


  // Regression: the API can report far more matches than the legacy 3-page
  // default. This is an OFFLINE synthetic response, not a new live measurement.
  let walkedPages = 0;
  const fullWalk = await jobstreet.fetch(
    { name: 'Example Board', provider: 'jobstreet', searchKeywords: 'engineering' },
    {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        if (opts?.redirect !== 'error') throw new Error('redirect guard missing');
        const u = new URL(url);
        const page = Number(u.searchParams.get('page'));
        const size = Number(u.searchParams.get('pageSize'));
        if (size !== 30 || page < 1 || page > 50) throw new Error('bad pagination request');
        walkedPages++;
        const offset = (page - 1) * size;
        return {
          data: Array.from({ length: Math.max(0, Math.min(size, 1397 - offset)) }, (_, i) => ({
            id: String(offset + i + 1), title: 'Example role',
          })),
          totalCount: 1397,
        };
      },
    },
  );
  if (walkedPages === 47 && fullWalk.length === 1397 && !fullWalk.jobstreetTruncated) {
    pass('jobstreet.fetch() walks 1397 synthetic matches to the natural short last page');
  } else {
    fail(`jobstreet default pagination lost rows: pages=${walkedPages}, jobs=${fullWalk.length}`);
  }

  // Preserve legacy maxPages for existing portals.yml configurations.
  // Without this guard, reading only max_pages would silently widen older scans.
  const legacyPages = [];
  const legacyWarnings = [];
  const originalLegacyWarn = console.warn;
  let legacyJobs;
  try {
    console.warn = (...args) => legacyWarnings.push(args.join(' '));
    legacyJobs = await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 2, maxPages: 2 },
      {
        transport: 'http', sleep: async () => {},
        fetchJson: async (url, opts) => {
          if (opts?.redirect !== 'error') throw new Error('redirect guard missing');
          const page = Number(new URL(url).searchParams.get('page'));
          legacyPages.push(page);
          return {
            data: [
              { id: String(page * 2 - 1), title: 'Example role' },
              { id: String(page * 2), title: 'Example role' },
            ],
            totalCount: 8,
          };
        },
      },
    );
  } finally {
    console.warn = originalLegacyWarn;
  }
  if (legacyPages.join(',') === '1,2' && legacyJobs.length === 4
      && legacyJobs.jobstreetTruncated?.reason === 'cap'
      && legacyWarnings.some(w => w.includes('max_pages=2'))) {
    pass('jobstreet.fetch() keeps the legacy maxPages cap when max_pages is absent');
  } else {
    fail(`jobstreet legacy maxPages ignored: ${JSON.stringify({ legacyPages, legacyWarnings })}`);
  }

  // The canonical max_pages key overrides the legacy maxPages spelling.
  const cappedPages = [];
  const capWarnings = [];
  const originalWarn = console.warn;
  let cappedJobs;
  try {
    console.warn = (...args) => capWarnings.push(args.join(' '));
    cappedJobs = await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 2, max_pages: 2, maxPages: 1 },
      {
        transport: 'http', sleep: async () => {},
        fetchJson: async (url, opts) => {
          if (opts?.redirect !== 'error') throw new Error('redirect guard missing');
          const page = Number(new URL(url).searchParams.get('page'));
          cappedPages.push(page);
          return { data: [{ id: String(page * 2), title: 'Example role' },
            { id: String(page * 2 + 1), title: 'Example role' }], totalCount: 5 };
        },
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  if (cappedPages.join(',') === '1,2' && cappedJobs.length === 4
      && cappedJobs.jobstreetTruncated?.reason === 'cap'
      && capWarnings.some(w => w.includes('max_pages=2'))) {
    pass('jobstreet.fetch() honours max_pages and warns/tags when the page cap truncates results');
  } else {
    fail(`jobstreet max_pages cap not respected or unreported: ${JSON.stringify({ cappedPages, capWarnings })}`);
  }

  // A health probe only makes one listing request, even when the page is full;
  // it must not be falsely tagged as a regular capped scan.
  let probeCalls = 0;
  const probeWarnings = [];
  let probeJobs;
  try {
    console.warn = (...args) => probeWarnings.push(args.join(' '));
    probeJobs = await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 2, max_pages: 10 },
      {
        transport: 'http', maxPages: 1, sleep: async () => {},
        fetchJson: async (_url, opts) => {
          probeCalls++;
          if (opts?.redirect !== 'error') throw new Error('redirect guard missing');
          return { data: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }], totalCount: 10 };
        },
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  if (probeCalls === 1 && probeJobs.length === 2
      && !probeJobs.jobstreetTruncated && probeWarnings.length === 0) {
    pass('jobstreet.fetch() honours ctx.maxPages=1 without a false truncation warning');
  } else {
    fail(`jobstreet health probe: calls=${probeCalls}, warnings=${probeWarnings.join('; ')}`);
  }

  // A short final page wins even when it coincides with max_pages.
  const shortWarnings = [];
  let shortJobs;
  try {
    console.warn = (...args) => shortWarnings.push(args.join(' '));
    shortJobs = await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 2, max_pages: 2 },
      {
        transport: 'http', sleep: async () => {},
        fetchJson: async (url) => {
          const page = Number(new URL(url).searchParams.get('page'));
          return { data: page === 1
            ? [{ id: '1', title: 'A' }, { id: '2', title: 'B' }]
            : [{ id: '3', title: 'C' }], totalCount: 10 };
        },
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  if (shortJobs.length === 3 && !shortJobs.jobstreetTruncated && shortWarnings.length === 0) {
    pass('jobstreet.fetch() treats a short last page as completion, not truncation');
  } else {
    fail(`jobstreet short-page completion misidentified: ${shortWarnings.join('; ')}`);
  }

  // A full final page is also complete when totalCount equals the number read.
  let exactlyFull;
  const fullWarnings = [];
  try {
    console.warn = (...args) => fullWarnings.push(args.join(' '));
    exactlyFull = await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 2, max_pages: 2 },
      {
        transport: 'http', sleep: async () => {},
        fetchJson: async (url) => {
          const page = Number(new URL(url).searchParams.get('page'));
          return { data: [{ id: String(page * 2 - 1), title: 'A' },
            { id: String(page * 2), title: 'B' }], totalCount: 4 };
        },
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  if (exactlyFull.length === 4 && !exactlyFull.jobstreetTruncated && fullWarnings.length === 0) {
    pass('jobstreet.fetch() does not warn on a full boundary page matching totalCount');
  } else {
    fail(`jobstreet totalCount boundary was misidentified: ${fullWarnings.join('; ')}`);
  }

  // On a real scan, a failed second page retains page 1 and tags the partial
  // result as a fetch failure, not a max_pages limit.
  const fetchWarnings = [];
  let partialJobs;
  let failureCalls = 0;
  try {
    console.warn = (...args) => fetchWarnings.push(args.join(' '));
    partialJobs = await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 2, max_pages: 2 },
      {
        transport: 'http', sleep: async () => {},
        fetchJson: async () => {
          failureCalls++;
          if (failureCalls === 1) {
            return { data: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }], totalCount: 10 };
          }
          throw Object.assign(new Error('fixture page failure'), { status: 400 });
        },
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  if (partialJobs.length === 2 && partialJobs.jobstreetTruncated?.reason === 'fetch-error'
      && fetchWarnings.some(w => w.includes('page 2 failed'))
      && !fetchWarnings.some(w => w.includes('raise max_pages'))) {
    pass('jobstreet.fetch() preserves partial results and identifies a failed later page');
  } else {
    fail(`jobstreet page failure incorrectly treated as complete or capped: ${fetchWarnings.join('; ')}`);
  }

  // Health probes must propagate a fetch-budget rejection by identity, not
  // swallow it as a truncated success.
  const budgetError = Object.assign(new Error('probe budget exhausted'), { status: 400 });
  let budgetCaught;
  try {
    let calls = 0;
    await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 1, max_pages: 3 },
      {
        transport: 'http', maxPages: 2, sleep: async () => {},
        fetchJson: async () => {
          calls++;
          if (calls === 1) return { data: [{ id: '1', title: 'A' }], totalCount: 4 };
          throw budgetError;
        },
      },
    );
  } catch (e) {
    budgetCaught = e;
  }
  if (budgetCaught === budgetError) {
    pass('jobstreet.fetch() preserves the original health-probe request failure');
  } else {
    fail('jobstreet.fetch() swallowed or replaced a health-probe failure');
  }

  // A full page with no totalCount still needs a bounded cap and warning.
  let unknownPages = 0;
  let unknownJobs;
  const unknownWarnings = [];
  try {
    console.warn = (...args) => unknownWarnings.push(args.join(' '));
    unknownJobs = await jobstreet.fetch(
      { name: 'Example Board', provider: 'jobstreet', pageSize: 2, max_pages: 2 },
      {
        transport: 'http', sleep: async () => {},
        fetchJson: async () => {
          unknownPages++;
          return { data: [{ id: String(unknownPages), title: 'A' },
            { id: String(unknownPages + 10), title: 'B' }] };
        },
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  if (unknownPages === 2 && unknownJobs.jobstreetTruncated?.reason === 'cap'
      && unknownWarnings.some(w => w.includes('max_pages=2'))) {
    pass('jobstreet.fetch() warns when full capped pages carry no reported total');
  } else {
    fail('jobstreet.fetch() missed page-cap truncation without totalCount');
  }

  // Mocked 429 on page 2 is retried without restarting the first page.
  let retryCalls = 0;
  const retryWaits = [];
  const recovered = await jobstreet.fetch(
    { name: 'Example Board', provider: 'jobstreet', pageSize: 2, max_pages: 2 },
    {
      transport: 'http', sleep: async ms => retryWaits.push(ms),
      fetchJson: async (url, opts) => {
        if (opts?.redirect !== 'error') throw new Error('redirect guard missing');
        retryCalls++;
        const page = Number(new URL(url).searchParams.get('page'));
        if (page === 1) return { data: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }], totalCount: 3 };
        if (retryCalls === 2) throw Object.assign(new Error('rate limited'), { status: 429 });
        return { data: [{ id: '3', title: 'C' }], totalCount: 3 };
      },
    },
  );
  if (retryCalls === 3 && recovered.length === 3
      && retryWaits.some(ms => ms === 200) && retryWaits.length === 2) {
    pass('jobstreet.fetch() retries 429 with shared backoff and inter-page pacing');
  } else {
    fail(`jobstreet fetch/retry coverage: calls=${retryCalls}, delays=${retryWaits.length}`);
  }

} catch (e) {
  fail(`jobstreet provider tests crashed: ${e.message}`);
}

