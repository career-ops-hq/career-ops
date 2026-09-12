// tests/providers/mycareersfuture.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — mycareersfuture');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/mycareersfuture.mjs')).href);
  const mycareersfuture = mod.default;
  const { parseConfig, cleanUrl, normalizeJob } = mod;

  if (mycareersfuture.id === 'mycareersfuture') pass('mycareersfuture.id is "mycareersfuture"');
  else fail(`mycareersfuture.id is ${JSON.stringify(mycareersfuture.id)}`);

  const hit = mycareersfuture.detect({ name: 'MCF', provider: 'mycareersfuture' });
  if (hit && hit.url === 'https://api.mycareersfuture.gov.sg/v2/search') {
    pass('mycareersfuture.detect() claims explicit provider config');
  } else {
    fail(`mycareersfuture.detect() returned ${JSON.stringify(hit)}`);
  }

  if (mycareersfuture.detect({ name: 'Other', provider: 'vdab' }) === null) {
    pass('mycareersfuture.detect() ignores other provider ids');
  } else {
    fail('mycareersfuture.detect() should only claim provider: mycareersfuture');
  }

  // ── parseConfig ──
  if (JSON.stringify(parseConfig({ mycareersfuture: { keywords: [' engineer ', 'nurse', '', 42] } }).keywords)
    === JSON.stringify(['engineer', 'nurse'])) {
    pass('parseConfig trims keywords and drops blank/non-string entries');
  } else {
    fail(`parseConfig returned ${JSON.stringify(parseConfig({ mycareersfuture: { keywords: [' engineer ', 'nurse', '', 42] } }))}`);
  }

  if (parseConfig({}).keywords.length === 0 && parseConfig({ mycareersfuture: {} }).keywords.length === 0) {
    pass('parseConfig defaults to no keywords when the block or array is absent');
  } else {
    fail('parseConfig should default to an empty keywords array');
  }

  if (parseConfig({ mycareersfuture: { size: 500 } }).size === 100) {
    pass('parseConfig clamps size down to the server-enforced 100 ceiling');
  } else {
    fail(`parseConfig({ size: 500 }).size = ${parseConfig({ mycareersfuture: { size: 500 } }).size} (expected 100)`);
  }

  if (parseConfig({}).size === 100) {
    pass('parseConfig defaults size to 100 (the max page size) when unset');
  } else {
    fail(`parseConfig({}).size = ${parseConfig({}).size} (expected 100)`);
  }

  if (parseConfig({ max_pages: 100 }).maxPages === 20) {
    pass('parseConfig clamps max_pages down to MAX_PAGES_CAP (20)');
  } else {
    fail(`parseConfig({ max_pages: 100 }).maxPages = ${parseConfig({ max_pages: 100 }).maxPages} (expected 20)`);
  }

  if (parseConfig({}).maxPages === 5) {
    pass('parseConfig defaults max_pages to 5 when unset');
  } else {
    fail(`parseConfig({}).maxPages = ${parseConfig({}).maxPages} (expected 5)`);
  }

  // ── cleanUrl ──
  const trustedUrl = 'https://www.mycareersfuture.gov.sg/job/others/example-abc123';
  if (cleanUrl(trustedUrl) === trustedUrl) {
    pass('cleanUrl() returns a trusted https URL unchanged');
  } else {
    fail(`cleanUrl(trusted) = ${JSON.stringify(cleanUrl(trustedUrl))}`);
  }

  if (cleanUrl('https://evil.example.com/job/abc') === '') {
    pass('cleanUrl() rejects an untrusted hostname');
  } else {
    fail(`cleanUrl(untrusted host) = ${JSON.stringify(cleanUrl('https://evil.example.com/job/abc'))}`);
  }

  if (cleanUrl('http://www.mycareersfuture.gov.sg/job/abc') === '') {
    pass('cleanUrl() rejects a non-HTTPS URL');
  } else {
    fail(`cleanUrl(http) = ${JSON.stringify(cleanUrl('http://www.mycareersfuture.gov.sg/job/abc'))}`);
  }

  if (cleanUrl('') === '' && cleanUrl(null) === '' && cleanUrl(undefined) === '' && cleanUrl('not a url') === '') {
    pass('cleanUrl() returns "" for empty/non-string/unparseable input without throwing');
  } else {
    fail('cleanUrl() should return "" for empty/non-string/unparseable input');
  }

  // ── cleanUrl — port/userinfo rejection. `.hostname` alone can't be fooled
  // by the classic `https://TRUSTED@evil.example/` userinfo trick (it
  // extracts only the real host), but a non-default port or embedded
  // credentials on the REAL trusted host still passed a `.hostname`-only
  // check — confirmed by execution — and have no legitimate reason to
  // appear in this feed. ──
  if (cleanUrl('https://www.mycareersfuture.gov.sg:9999/job/evil') === '') {
    pass('cleanUrl() rejects a non-default port on the trusted host');
  } else {
    fail(`cleanUrl(non-default port) = ${JSON.stringify(cleanUrl('https://www.mycareersfuture.gov.sg:9999/job/evil'))}`);
  }
  if (cleanUrl('https://user:pass@www.mycareersfuture.gov.sg/job/x') === '') {
    pass('cleanUrl() rejects embedded username:password credentials on the trusted host');
  } else {
    fail(`cleanUrl(credentials) = ${JSON.stringify(cleanUrl('https://user:pass@www.mycareersfuture.gov.sg/job/x'))}`);
  }
  if (cleanUrl('https://user@www.mycareersfuture.gov.sg/job/x') === '') {
    pass('cleanUrl() rejects a bare username with no password on the trusted host');
  } else {
    fail(`cleanUrl(username only) = ${JSON.stringify(cleanUrl('https://user@www.mycareersfuture.gov.sg/job/x'))}`);
  }
  if (cleanUrl('https://www.mycareersfuture.gov.sg:443/job/x') === 'https://www.mycareersfuture.gov.sg/job/x') {
    pass('cleanUrl() still accepts an explicit default HTTPS port (443), normalized away by URL parsing');
  } else {
    fail(`cleanUrl(explicit :443) = ${JSON.stringify(cleanUrl('https://www.mycareersfuture.gov.sg:443/job/x'))}`);
  }

  // ── normalizeJob — fixture shaped from a real record captured 2026-08-21
  // from the live public search API. ──
  const sampleRecord = {
    metadata: {
      jobPostId: 'MCF-2026-1458520',
      newPostingDate: '2026-08-21',
      jobDetailsUrl: 'https://www.mycareersfuture.gov.sg/job/building-construction/site-supervisor-woh-hup-engineering-dbac8e747e21f520170b3a66a019480c',
    },
    address: {
      districts: [{ location: 'Islandwide' }],
    },
    postedCompany: { name: 'WOH HUP ENGINEERING PTE. LTD.' },
    hiringCompany: null,
    title: 'Site Supervisor',
  };
  const normalized = normalizeJob(sampleRecord);
  if (
    normalized
    && normalized.title === 'Site Supervisor'
    && normalized.url === sampleRecord.metadata.jobDetailsUrl
    && normalized.company === 'WOH HUP ENGINEERING PTE. LTD.'
    && normalized.location === 'Islandwide'
    && normalized.postedAt === Date.parse('2026-08-21')
    && normalized.id === 'MCF-2026-1458520'
  ) {
    pass('normalizeJob() maps a real-shaped record to title/url/company/location/postedAt/id');
  } else {
    fail(`normalizeJob(sample) = ${JSON.stringify(normalized)}`);
  }

  // hiringCompany (the real employer on an agency-posted listing) wins over
  // postedCompany (the agency) when both are present.
  const onBehalfRecord = {
    ...sampleRecord,
    postedCompany: { name: 'RECRUIT EXPERT PTE. LTD.' },
    hiringCompany: { name: 'Real Employer Pte Ltd' },
  };
  if (normalizeJob(onBehalfRecord)?.company === 'Real Employer Pte Ltd') {
    pass('normalizeJob() prefers hiringCompany over postedCompany when both are present');
  } else {
    fail(`normalizeJob(onBehalf).company = ${JSON.stringify(normalizeJob(onBehalfRecord)?.company)}`);
  }

  // Multiple districts join into one location string.
  const multiDistrictRecord = {
    ...sampleRecord,
    address: { districts: [{ location: 'D01 Marina' }, { location: 'D02 Tanjong Pagar' }] },
  };
  if (normalizeJob(multiDistrictRecord)?.location === 'D01 Marina, D02 Tanjong Pagar') {
    pass('normalizeJob() joins multiple districts into one comma-separated location');
  } else {
    fail(`normalizeJob(multiDistrict).location = ${JSON.stringify(normalizeJob(multiDistrictRecord)?.location)}`);
  }

  // Missing id / title / trusted url each drop the record.
  if (normalizeJob({ ...sampleRecord, metadata: { ...sampleRecord.metadata, jobPostId: undefined } }) === null) {
    pass('normalizeJob() returns null when jobPostId is missing');
  } else {
    fail('normalizeJob() should return null when jobPostId is missing');
  }
  if (normalizeJob({ ...sampleRecord, title: '' }) === null) {
    pass('normalizeJob() returns null when title is blank');
  } else {
    fail('normalizeJob() should return null when title is blank');
  }
  if (normalizeJob({ ...sampleRecord, metadata: { ...sampleRecord.metadata, jobDetailsUrl: 'https://evil.example.com/job/1' } }) === null) {
    pass('normalizeJob() returns null when jobDetailsUrl is off-host');
  } else {
    fail('normalizeJob() should return null when jobDetailsUrl is off-host');
  }

  // No districts / empty array → empty location, not a crash.
  if (normalizeJob({ ...sampleRecord, address: {} })?.location === '') {
    pass('normalizeJob() tolerates a missing address/districts, returning an empty location');
  } else {
    fail(`normalizeJob(no address).location = ${JSON.stringify(normalizeJob({ ...sampleRecord, address: {} })?.location)}`);
  }

  // ── fetch(): keyword requirement + config/profile.yml fallback. Runs in an
  // isolated tmp cwd (never this checkout's own config/profile.yml, so the
  // test is hermetic regardless of whether the checkout is onboarded) —
  // same pattern as tests/providers/jobbankca.test.mjs. ──
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'career-ops-mycareersfuture-fallback-'));
      const cwdBefore = process.cwd();
      try {
        setup(tmp);
        process.chdir(tmp);
        return await run();
      } finally {
        process.chdir(cwdBefore);
      }
    };

    // No entry keywords, but a profile.yml with target_roles → falls back.
    let sentSearch = null;
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => mycareersfuture.fetch(
        { provider: 'mycareersfuture', name: 'No own keywords' },
        { fetchJson: async (url, opts) => { sentSearch = JSON.parse(opts.body).search; return { results: [] }; } },
      ),
    );
    if (sentSearch === 'Data Engineer') {
      pass('mycareersfuture.fetch() falls back to config/profile.yml target_roles when mycareersfuture.keywords[] is empty');
    } else {
      fail(`mycareersfuture.fetch() fallback search = ${JSON.stringify(sentSearch)}`);
    }

    // No entry keywords AND no profile.yml at all → throws.
    let threwNoKeywords = false;
    let threwMessage = '';
    try {
      await withTmpCwd(
        () => {}, // no config/ dir created — profile.yml genuinely absent
        () => mycareersfuture.fetch({ provider: 'mycareersfuture', name: 'No Keywords' }, { fetchJson: async () => ({ results: [] }) }),
      );
    } catch (err) {
      threwNoKeywords = true;
      threwMessage = err.message;
    }
    if (threwNoKeywords && /no mycareersfuture\.keywords/.test(threwMessage)) {
      pass('mycareersfuture.fetch() throws a clear error when no keywords and no profile.yml fallback are available');
    } else {
      fail(`mycareersfuture.fetch() should throw when no keywords are available from any source, got: threw=${threwNoKeywords} message=${JSON.stringify(threwMessage)}`);
    }
  }

  // ── fetch(): pagination stops on a short page, and advances via the QUERY
  // STRING page param — confirmed live that the JSON body's page field is
  // NOT what advances pages, so a test that only varied body.page would pass
  // even on a provider that never changed the URL at all. ──
  {
    const record = (n) => ({
      metadata: { jobPostId: `id-${n}`, newPostingDate: '2026-08-20', jobDetailsUrl: `https://www.mycareersfuture.gov.sg/job/x/role-${n}` },
      address: { districts: [{ location: 'X' }] },
      postedCompany: { name: 'Co' },
      title: `role ${n}`,
    });
    const fullPage = Array.from({ length: 100 }, (_, i) => record(i));
    const shortPage = [record(100)];

    const requestedUrls = [];
    const fetched = await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Full page test', mycareersfuture: { keywords: ['developer'] } },
      {
        fetchJson: async (url) => {
          requestedUrls.push(url);
          const page = new URL(url).searchParams.get('page');
          return { results: page === '1' ? shortPage : fullPage };
        },
      },
    );

    if (requestedUrls.length === 2) pass('mycareersfuture.fetch() paginates: a full (100-entry) page requests the next one');
    else fail(`mycareersfuture.fetch() made ${requestedUrls.length} requests (expected 2): ${JSON.stringify(requestedUrls)}`);

    if (fetched.length === 101) pass('mycareersfuture.fetch() stops after a short page and returns all collected jobs');
    else fail(`mycareersfuture.fetch() returned ${fetched.length} jobs (expected 101)`);

    if (new URL(requestedUrls[0]).searchParams.get('page') === '0' && new URL(requestedUrls[1]).searchParams.get('page') === '1') {
      pass('mycareersfuture.fetch() advances pages via the URL query string, not the JSON body');
    } else {
      fail(`mycareersfuture.fetch() request pages were ${requestedUrls.map((u) => new URL(u).searchParams.get('page'))} (expected ["0","1"])`);
    }
  }

  // ── fetch(): ctx.maxPages caps entry.max_pages, not the other way around ──
  {
    const fullPage = (n) => Array.from({ length: 100 }, (_, i) => ({
      metadata: { jobPostId: `${n}-${i}`, newPostingDate: '2026-08-20', jobDetailsUrl: `https://www.mycareersfuture.gov.sg/job/x/r-${n}-${i}` },
      address: { districts: [{ location: 'X' }] },
      postedCompany: { name: 'Co' },
      title: `r${n}`,
    }));
    let requestCount = 0;
    await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Capped', mycareersfuture: { keywords: ['x'] }, max_pages: 3 },
      {
        maxPages: 1, // a health-probe-style cap
        fetchJson: async () => ({ results: fullPage(requestCount++) }),
      },
    );
    if (requestCount === 1) pass('mycareersfuture.fetch(): ctx.maxPages caps entry.max_pages, not the other way around');
    else fail(`mycareersfuture.fetch() made ${requestCount} requests under ctx.maxPages=1 (expected 1)`);
  }

  // ── fetch(): max_pages is clamped to MAX_PAGES_CAP (20) ──
  {
    const fullPage = (n) => Array.from({ length: 100 }, (_, i) => ({
      metadata: { jobPostId: `${n}-${i}`, newPostingDate: '2026-08-20', jobDetailsUrl: `https://www.mycareersfuture.gov.sg/job/x/r-${n}-${i}` },
      address: { districts: [{ location: 'X' }] },
      postedCompany: { name: 'Co' },
      title: `r${n}`,
    }));
    let requestCount = 0;
    await mycareersfuture.fetch(
      // Every page returns a FULL (100-entry) page, so pagination would run
      // forever without the cap — this isolates the cap as the only thing
      // that can stop it.
      { provider: 'mycareersfuture', name: 'Cap test', mycareersfuture: { keywords: ['x'] }, max_pages: 100 },
      { fetchJson: async () => ({ results: fullPage(requestCount++) }) },
    );
    if (requestCount === 20) {
      pass('mycareersfuture.fetch() clamps entry.max_pages (100) down to MAX_PAGES_CAP (20)');
    } else {
      fail(`mycareersfuture.fetch() made ${requestCount} requests with max_pages:100 (expected 20, the cap)`);
    }
  }

  // ── fetch(): recall-first — one failed keyword does not abort the others ──
  {
    const record = {
      metadata: { jobPostId: 'ok-1', newPostingDate: '2026-08-20', jobDetailsUrl: 'https://www.mycareersfuture.gov.sg/job/x/ok' },
      address: { districts: [{ location: 'X' }] },
      postedCompany: { name: 'Co' },
      title: 'ok',
    };
    const fetched = await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Partial failure', mycareersfuture: { keywords: ['bad', 'good'] } },
      {
        fetchJson: async (url, opts) => {
          if (JSON.parse(opts.body).search === 'bad') throw new Error('network error');
          return { results: [record] };
        },
      },
    );
    if (fetched.length === 1 && fetched[0].title === 'ok') {
      pass('mycareersfuture.fetch(): a failed keyword does not abort keywords that still succeed');
    } else {
      fail(`mycareersfuture.fetch() with one failing keyword returned ${JSON.stringify(fetched)}`);
    }
  }

  // ── fetch(): total outage throws ──
  try {
    await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Outage', mycareersfuture: { keywords: ['a', 'b'] } },
      { fetchJson: async () => { throw new Error('boom'); } },
    );
    fail('mycareersfuture.fetch() should throw when every keyword request fails');
  } catch (err) {
    if (/all 2 keyword request\(s\) failed/.test(err.message)) pass('mycareersfuture.fetch() throws when every keyword fails (total outage)');
    else fail(`mycareersfuture.fetch() threw an unexpected error on total outage: ${err.message}`);
  }

  // ── fetch(): dedups across keywords by jobPostId ──
  {
    const shared = {
      metadata: { jobPostId: 'dup-1', newPostingDate: '2026-08-20', jobDetailsUrl: 'https://www.mycareersfuture.gov.sg/job/x/dup' },
      address: { districts: [{ location: 'X' }] },
      postedCompany: { name: 'Co' },
      title: 'duplicate role',
    };
    const fetched = await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Dedup', mycareersfuture: { keywords: ['engineer', 'developer'] } },
      { fetchJson: async () => ({ results: [shared] }) },
    );
    if (fetched.length === 1) pass('mycareersfuture.fetch() dedups the same jobPostId returned by two different keywords');
    else fail(`mycareersfuture.fetch() with an overlapping keyword pair returned ${fetched.length} jobs (expected 1)`);
  }

  // ── fetch(): request hygiene ──
  {
    let capturedOpts = null;
    let capturedUrl = null;
    await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Hygiene', mycareersfuture: { keywords: ['x'] } },
      {
        fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { results: [] }; },
      },
    );
    if (capturedOpts && capturedOpts.redirect === 'error') {
      pass('mycareersfuture.fetch() passes redirect:"error" to fetchJson (SSRF-via-redirect guard)');
    } else {
      fail(`mycareersfuture.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
    }
    if (capturedOpts && capturedOpts.headers && capturedOpts.headers['content-type'] === 'application/json') {
      pass('mycareersfuture.fetch() sends a JSON content-type header');
    } else {
      fail(`mycareersfuture.fetch() should send content-type: application/json, got: ${JSON.stringify(capturedOpts)}`);
    }
    if (capturedUrl && new URL(capturedUrl).origin + new URL(capturedUrl).pathname === 'https://api.mycareersfuture.gov.sg/v2/search') {
      pass('mycareersfuture.fetch() requests the pinned v2/search endpoint');
    } else {
      fail(`mycareersfuture.fetch() requested ${JSON.stringify(capturedUrl)}`);
    }
  }

  // ── fetch(): entry.mycareersfuture.size reaches the URL's `limit` param ──
  {
    let capturedUrl = null;
    await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Custom size', mycareersfuture: { keywords: ['x'], size: 25 } },
      { fetchJson: async (url) => { capturedUrl = url; return { results: [] }; } },
    );
    if (new URL(capturedUrl).searchParams.get('limit') === '25') {
      pass('mycareersfuture.fetch() honors a custom mycareersfuture.size as the URL limit param');
    } else {
      fail(`mycareersfuture.fetch() with size:25 requested limit=${new URL(capturedUrl).searchParams.get('limit')}`);
    }
  }

  // ── fetch(): tolerates a malformed/missing `results` field instead of
  // crashing — a transport bug or an unannounced API shape change should
  // surface as zero jobs from that page, not an unhandled exception. ──
  {
    const malformed = await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Malformed', mycareersfuture: { keywords: ['x'] } },
      { fetchJson: async () => ({ results: null }) },
    );
    if (Array.isArray(malformed) && malformed.length === 0) {
      pass('mycareersfuture.fetch() tolerates a non-array results field, returning no jobs');
    } else {
      fail(`mycareersfuture.fetch() with results:null returned ${JSON.stringify(malformed)}`);
    }

    const emptyBody = await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Empty body', mycareersfuture: { keywords: ['x'] } },
      { fetchJson: async () => ({}) },
    );
    if (Array.isArray(emptyBody) && emptyBody.length === 0) {
      pass('mycareersfuture.fetch() tolerates a response with no results key at all');
    } else {
      fail(`mycareersfuture.fetch() with {} response returned ${JSON.stringify(emptyBody)}`);
    }
  }

  // ── fetch(): a non-ASCII keyword (Mandarin/Malay/Tamil are all official
  // search languages on this board) passes through JSON.stringify unmangled
  // — this provider, unlike the English-only ones, genuinely needs this to
  // work for a Singapore user's real target roles. ──
  {
    let sentSearch = null;
    await mycareersfuture.fetch(
      { provider: 'mycareersfuture', name: 'Unicode keyword', mycareersfuture: { keywords: ['软件工程师'] } },
      { fetchJson: async (url, opts) => { sentSearch = JSON.parse(opts.body).search; return { results: [] }; } },
    );
    if (sentSearch === '软件工程师') {
      pass('mycareersfuture.fetch() passes a non-ASCII (Mandarin) keyword through unmangled');
    } else {
      fail(`mycareersfuture.fetch() sent search=${JSON.stringify(sentSearch)} for a Mandarin keyword`);
    }
  }
} catch (e) {
  fail(`mycareersfuture provider tests crashed: ${e.message}`);
}
