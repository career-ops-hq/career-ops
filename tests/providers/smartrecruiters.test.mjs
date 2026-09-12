// tests/providers/smartrecruiters.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — smartrecruiters');

try {
  const smartrecruitersModule = await import(pathToFileURL(join(ROOT, 'providers/smartrecruiters.mjs')).href);
  const sr = smartrecruitersModule.default;
  const { parseSmartRecruitersResponse, extractDescription } = smartrecruitersModule;

  if (sr.id === 'smartrecruiters') pass('smartrecruiters.id is "smartrecruiters"');
  else fail(`smartrecruiters.id is ${JSON.stringify(sr.id)}`);

  const hitCareers = sr.detect({ name: 'Adyen', careers_url: 'https://careers.smartrecruiters.com/adyen' });
  if (hitCareers && hitCareers.url.startsWith('https://api.smartrecruiters.com/v1/companies/adyen/postings')) {
    pass('smartrecruiters.detect() resolves careers.smartrecruiters.com/<slug> → api URL');
  } else {
    fail(`smartrecruiters.detect(careers) returned ${JSON.stringify(hitCareers)}`);
  }

  const hitJobs = sr.detect({ name: 'X', careers_url: 'https://jobs.smartrecruiters.com/x' });
  if (hitJobs && hitJobs.url.startsWith('https://api.smartrecruiters.com/v1/companies/x/postings')) {
    pass('smartrecruiters.detect() also handles jobs.smartrecruiters.com');
  } else {
    fail(`smartrecruiters.detect(jobs) returned ${JSON.stringify(hitJobs)}`);
  }

  if (sr.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('smartrecruiters.detect() returns null for non-SR URLs');
  } else {
    fail('smartrecruiters.detect() should return null for non-SR URLs');
  }

  // entry.api precedence: a branded careers_url is kept while the SR slug is
  // pinned via api: (mirrors greenhouse/ashby).
  const hitApi = sr.detect({
    name: 'Continental',
    careers_url: 'https://jobs.continental.com',
    api: 'https://careers.smartrecruiters.com/Continental',
  });
  if (hitApi && hitApi.url.startsWith('https://api.smartrecruiters.com/v1/companies/Continental/postings')) {
    pass('smartrecruiters.detect() honors api: over a branded careers_url');
  } else {
    fail(`smartrecruiters.detect(api-pinned) returned ${JSON.stringify(hitApi)}`);
  }

  // parseSmartRecruitersResponse
  const sample = {
    content: [
      {
        id: 'abc-123',
        name: 'Senior PM',
        ref: 'https://api.smartrecruiters.com/v1/companies/sgs/postings/abc-123',
        location: { fullLocation: 'Geneva, Switzerland', remote: false },
      },
      {
        id: 'def-456',
        name: 'Remote AI Engineer',
        ref: 'https://api.smartrecruiters.com/v1/companies/sgs/postings/def-456',
        location: { city: 'Paris', country: 'France', remote: true },
      },
      {
        id: 'ghi-789',
        name: 'No-ref Role',
        location: { fullLocation: 'Berlin, Germany' },
      },
    ],
  };
  const jobs = parseSmartRecruitersResponse(sample, 'SGS');
  if (jobs.length === 3) pass('parseSmartRecruitersResponse extracts 3 jobs');
  else fail(`parseSmartRecruitersResponse returned ${jobs.length} jobs`);

  if (jobs[0]?.location === 'Geneva, Switzerland' && jobs[0]?.title === 'Senior PM') {
    pass('parseSmartRecruitersResponse uses fullLocation when present');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.location === 'Paris, France, Remote') {
    pass('parseSmartRecruitersResponse builds location from city/country/remote when no fullLocation');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Paris, France, Remote"`);
  }

  // The public site is /<slug>/<id>-<title-slug> — NOT /<slug>/postings/<id>.
  // Carrying the API's /postings/ segment over produces a 404 that the liveness
  // checker misreports as an expired posting (#1612).
  if (jobs[0]?.url === 'https://jobs.smartrecruiters.com/sgs/abc-123-senior-pm') {
    pass('parseSmartRecruitersResponse rewrites api ref → public /<slug>/<id>-<title> URL');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (!jobs.some(j => j.url.includes('/postings/'))) {
    pass('parseSmartRecruitersResponse never emits a /postings/ segment (404 on the public site)');
  } else {
    fail(`a /postings/ URL leaked: ${JSON.stringify(jobs.map(j => j.url))}`);
  }

  // Malformed ref (no /postings/<id> tail) must fall through to the id fallback,
  // not emit a truncated URL.
  const malformedRef = parseSmartRecruitersResponse(
    { content: [{ id: 'zz-9', name: 'Odd Role', ref: 'https://api.smartrecruiters.com/v1/companies/sgs' }] },
    'SGS',
  );
  if (malformedRef[0]?.url === 'https://jobs.smartrecruiters.com/sgs/zz-9-odd-role') {
    pass('parseSmartRecruitersResponse falls back when ref lacks a /postings/<id> tail');
  } else {
    fail(`malformed ref url = ${JSON.stringify(malformedRef[0]?.url)}`);
  }

  if (jobs[2]?.url && jobs[2].url.startsWith('https://jobs.smartrecruiters.com/sgs/ghi-789')) {
    pass('parseSmartRecruitersResponse falls back to synthetic URL when ref is missing');
  } else {
    fail(`row 2 url = ${JSON.stringify(jobs[2]?.url)}`);
  }

  // Empty input safety
  if (parseSmartRecruitersResponse({}, 'X').length === 0) pass('empty {} input → empty result');
  else fail('empty {} input should yield empty result');

  if (parseSmartRecruitersResponse({ content: 'not an array' }, 'X').length === 0) {
    pass('non-array content → empty result (no crash)');
  } else {
    fail('non-array content should yield empty result');
  }

  // careers_url with non-string value → detect() returns null without crashing
  if (sr.detect({ name: 'X', careers_url: { foo: 'bar' } }) === null) {
    pass('smartrecruiters.detect() returns null for non-string careers_url (object)');
  } else {
    fail('smartrecruiters.detect() should treat non-string careers_url as missing');
  }

  // Fallback URL when both ref AND id are missing → empty string (not "undefined" in URL)
  const noRefNoId = parseSmartRecruitersResponse(
    { content: [{ name: 'Stranded Role' }] },
    'X',
  );
  if (noRefNoId.length === 1 && noRefNoId[0].url === '') {
    pass('parseSmartRecruitersResponse returns url="" when both ref and id are missing');
  } else {
    fail(`expected url='' when ref+id both missing, got ${JSON.stringify(noRefNoId[0])}`);
  }

  // SSRF: malicious URL with smartrecruiters hostname in the PATH (not host) must not be detected.
  if (sr.detect({ name: 'Spoof', careers_url: 'https://evil.example/careers.smartrecruiters.com/slug' }) === null) {
    pass('smartrecruiters.detect() rejects path-spoofed URLs');
  } else {
    fail('smartrecruiters.detect() must NOT misdetect path-spoofed URLs');
  }

  // SmartRecruiters: untrusted j.ref host falls through to fallback rather than rewriting
  const bogusRef = parseSmartRecruitersResponse(
    { content: [{ id: 'X1', name: 'Strange Role', ref: 'https://evil.example/v1/companies/x/postings/X1' }] },
    'TestCo',
  );
  if (bogusRef[0]?.url && !bogusRef[0].url.includes('evil.example')) {
    pass('parseSmartRecruitersResponse rejects untrusted j.ref host (falls through to fallback)');
  } else {
    fail(`untrusted j.ref leaked into url: ${JSON.stringify(bogusRef[0]?.url)}`);
  }

  // SmartRecruiters: companyName with spaces/symbols is slugified for the fallback URL
  const slugifiedCompany = parseSmartRecruitersResponse(
    { content: [{ id: 'X2', name: 'Strange Role' }] },
    'My Acme & Co.',
  );
  if (slugifiedCompany[0]?.url === 'https://jobs.smartrecruiters.com/my-acme-co/X2-strange-role') {
    pass('parseSmartRecruitersResponse slugifies the companyName for the fallback URL');
  } else {
    fail(`fallback URL not properly slugified: ${JSON.stringify(slugifiedCompany[0]?.url)}`);
  }

  // A posting with no usable name must not leave a dangling hyphen on either
  // URL-building path (the id alone resolves fine).
  const noName = parseSmartRecruitersResponse(
    { content: [
      { id: 'N1', ref: 'https://api.smartrecruiters.com/v1/companies/sgs/postings/N1' },
      { id: 'N2' },
    ] },
    'SGS',
  );
  if (noName[0]?.url === 'https://jobs.smartrecruiters.com/sgs/N1'
      && noName[1]?.url === 'https://jobs.smartrecruiters.com/sgs/N2') {
    pass('parseSmartRecruitersResponse omits the trailing hyphen when the title slug is empty');
  } else {
    fail(`empty-title urls = ${JSON.stringify(noName.map(j => j.url))}`);
  }

  // Pagination: fetch() loops until an empty page (or short page) is returned
  let pageRequests = 0;
  const pagedJobs = await sr.fetch(
    { name: 'PagedCo', careers_url: 'https://careers.smartrecruiters.com/paged' },
    {
      transport: 'http',
      fetchText: async () => { throw new Error('fetchText should not be called'); },
      fetchJson: async (url) => {
        pageRequests++;
        const offset = parseInt(new URL(url).searchParams.get('offset') || '0', 10);
        if (offset === 0) {
          // Page 1: full page (100 items)
          return { content: Array.from({ length: 100 }, (_, i) => ({ id: `P1-${i}`, name: `Role 1-${i}` })) };
        }
        if (offset === 100) {
          // Page 2: short page (50 items) → loop stops after this
          return { content: Array.from({ length: 50 }, (_, i) => ({ id: `P2-${i}`, name: `Role 2-${i}` })) };
        }
        // Should not be reached because page 2 was short
        return { content: [] };
      },
    },
  );
  if (pageRequests === 2 && pagedJobs.length === 150) {
    pass('smartrecruiters.fetch() paginates and aggregates results (2 pages → 150 total)');
  } else {
    fail(`pagination: pageRequests=${pageRequests}, total=${pagedJobs.length} (expected 2 requests / 150 results)`);
  }

  // Pagination stop condition: empty content terminates the loop
  let emptyPageRequests = 0;
  const emptyJobs = await sr.fetch(
    { name: 'EmptyCo', careers_url: 'https://careers.smartrecruiters.com/empty' },
    {
      transport: 'http',
      fetchText: async () => { throw new Error('fetchText should not be called'); },
      fetchJson: async () => {
        emptyPageRequests++;
        return { content: [] };
      },
    },
  );
  if (emptyPageRequests === 1 && emptyJobs.length === 0) {
    pass('smartrecruiters.fetch() stops on the first empty page');
  } else {
    fail(`empty pagination: requests=${emptyPageRequests}, total=${emptyJobs.length}`);
  }

  // ── Description enrichment (#3175 phase 2) ──
  // The list payload carries no body; opted-in boards fetch one detail JSON
  // per posting. extractDescription() joins the four known jobAd sections in
  // a fixed order (company context first, call-to-action last), then strips
  // via the shared _html-to-text pipeline.
  if (extractDescription(null) === '' && extractDescription({}) === ''
      && extractDescription({ jobAd: {} }) === '' && extractDescription({ jobAd: { sections: 'nope' } }) === '') {
    pass('extractDescription() returns "" for missing / malformed payloads');
  } else {
    fail('extractDescription() should return "" for missing or malformed payloads');
  }

  const joined = extractDescription({
    jobAd: {
      sections: {
        additionalInformation: { text: '<p>Sponsorship: <strong>no</strong></p>' },
        companyDescription: { text: '<p>Acme builds &amp; ships widgets</p>' },
        someUnknownSection: { text: '<p>must be ignored</p>' },
        qualifications: { text: '<ul><li>5+ years</li></ul>' },
        jobDescription: { text: '<p>You will&nbsp;build robots</p>' },
      },
    },
  });
  if (joined === "Acme builds & ships widgets You will build robots 5+ years Sponsorship: no") {
    pass('extractDescription() joins the four known sections in order, strips HTML, decodes entities');
  } else {
    fail(`extractDescription() = ${JSON.stringify(joined)}`);
  }

  if (extractDescription({ jobAd: { sections: { jobDescription: { text: '   ' } } } }) === '') {
    pass('extractDescription() returns "" when every section is blank');
  } else {
    fail('extractDescription() should return "" for blank-only sections');
  }

  // fetch(): opt-in detail enrichment — hits the detail endpoint per posting,
  // attaches the plain-text description, and strips the internal id.
  {
    const detailCalls = [];
    const enriched = await sr.fetch(
      {
        name: 'DescCo',
        careers_url: 'https://careers.smartrecruiters.com/desco',
        smartrecruiters: { fetchDetails: true, detailLimit: 25 },
      },
      {
        fetchJson: async (url) => {
          detailCalls.push(url);
          if (detailCalls.length === 1) {
            return {
              content: [
                { id: 'A1', name: 'Role A' },
                { id: 'B2', name: 'Role B' },
              ],
            };
          }
          const id = new URL(url).pathname.split('/').pop();
          return {
            jobAd: {
              sections: id === 'A1'
                ? { jobDescription: { text: '<p>Body of A1</p>' } }
                : {},  // B2 has no usable sections → no description key
            },
          };
        },
      },
    );
    const listCallsOnly = detailCalls.filter((u) => u.includes('/postings?'));
    const detailUrls = detailCalls.filter((u) => !u.includes('/postings?'));
    if (listCallsOnly.length === 1
        && detailUrls.length === 2
        && detailUrls[0] === 'https://api.smartrecruiters.com/v1/companies/desco/postings/A1'
        && detailUrls[1] === 'https://api.smartrecruiters.com/v1/companies/desco/postings/B2') {
      pass('fetch(fetchDetails:true) requests one detail URL per posting, in list order');
    } else {
      fail(`detail calls: ${JSON.stringify(detailCalls)}`);
    }
    if (enriched[0]?.description === 'Body of A1' && !('id' in enriched[0])) {
      pass("fetch(fetchDetails:true) attaches the description and strips the internal id");
    } else {
      fail(`row 0 = ${JSON.stringify(enriched[0])}`);
    }
    if (!('description' in enriched[1]) && !('id' in enriched[1])) {
      pass('fetch(fetchDetails:true) omits the description key when the board ships no sections');
    } else {
      fail(`row 1 = ${JSON.stringify(enriched[1])}`);
    }
  }

  // Default (no config): zero detail calls — the scanner stays zero-token.
  {
    let defaultModeDetailCalls = 0;
    await sr.fetch(
      { name: 'PlainCo', careers_url: 'https://careers.smartrecruiters.com/plainco' },
      {
        fetchJson: async (url) => {
          if (!url.includes('/postings?')) defaultModeDetailCalls++;
          return { content: [{ id: 'X1', name: 'Role X' }] };
        },
      },
    );
    if (defaultModeDetailCalls === 0) {
      pass('fetch() without smartrecruiters.fetchDetails makes no per-posting requests');
    } else {
      fail(`expected 0 detail calls by default, saw ${defaultModeDetailCalls}`);
    }
  }

  // Probing (verify-portals passes ctx.maxPages=1): enrichment must never
  // spend budget a liveness check has no use for (same rule as vdab).
  {
    let probeDetailCalls = 0;
    await sr.fetch(
      {
        name: 'ProbeCo',
        careers_url: 'https://careers.smartrecruiters.com/probeco',
        smartrecruiters: { fetchDetails: true },
      },
      {
        maxPages: 1,
        fetchJson: async (url) => {
          if (!url.includes('/postings?')) probeDetailCalls++;
          return { content: [{ id: 'Y1', name: 'Role Y' }] };
        },
      },
    );
    if (probeDetailCalls === 0) {
      pass('fetch() skips detail enrichment while probing (ctx.maxPages set)');
    } else {
      fail(`expected 0 detail calls while probing, saw ${probeDetailCalls}`);
    }
  }

  // ctx.maxPages also caps the listing walk itself, not just enrichment:
  // a health probe reads one page even when the board keeps serving full pages.
  {
    const fullPage = {
      content: Array.from({ length: 100 }, (_, i) => ({ id: `P${i}`, name: `Role ${i}` })),
    };
    let probeListCalls = 0;
    await sr.fetch(
      { name: 'CappedCo', careers_url: 'https://careers.smartrecruiters.com/cappedco' },
      {
        maxPages: 1,
        fetchJson: async (url) => {
          if (url.includes('/postings?')) probeListCalls++;
          return fullPage;
        },
      },
    );
    if (probeListCalls === 1) {
      pass('fetch() honors the ctx.maxPages hint and stops after one list page');
    } else {
      fail(`ctx.maxPages=1: ${probeListCalls} list calls (expected 1)`);
    }
  }

  // detailLimit caps the per-sweep detail budget on a large board.
  {
    const bigBoardIds = Array.from({ length: 40 }, (_, i) => `ID-${i}`);
    let bigBoardDetailCalls = 0;
    await sr.fetch(
      {
        name: 'BigCo',
        careers_url: 'https://careers.smartrecruiters.com/bigco',
        smartrecruiters: { fetchDetails: true, detailLimit: 10 },
      },
      {
        fetchJson: async (url) => {
          if (url.includes('/postings?')) return { content: bigBoardIds.map((id) => ({ id, name: `Role ${id}` })) };
          bigBoardDetailCalls++;
          return { jobAd: { sections: { jobDescription: { text: `<p>body ${bigBoardDetailCalls}</p>` } } } };
        },
      },
    );
    if (bigBoardDetailCalls === 10) {
      pass('fetch() caps detail calls at smartrecruiters.detailLimit (40 postings → 10 details)');
    } else {
      fail(`expected 10 detail calls (detailLimit=10), saw ${bigBoardDetailCalls}`);
    }
  }

  // A failing detail fetch is an enrichment only — the listing result survives.
  {
    let resilientCalls = 0;
    const survived = await sr.fetch(
      {
        name: 'FlakyCo',
        careers_url: 'https://careers.smartrecruiters.com/flakyco',
        smartrecruiters: { fetchDetails: true },
      },
      {
        fetchJson: async (url) => {
          if (url.includes('/postings?')) {
            return { content: [{ id: 'OK-1', name: 'Fine Role' }, { id: 'BAD-2', name: 'Doomed Role' }] };
          }
          resilientCalls++;
          if (new URL(url).pathname.endsWith('BAD-2')) throw new Error('HTTP 500');
          return { jobAd: { sections: { jobDescription: { text: '<p>fine body</p>' } } } };
        },
      },
    );
    if (resilientCalls === 2 && survived.length === 2
        && survived[0]?.description === 'fine body'
        && !('description' in survived[1])
        && survived[1]?.title === 'Doomed Role') {
      pass('fetch() keeps the listing row and the rest of the batch when one detail request fails');
    } else {
      fail(`resilience: calls=${resilientCalls}, rows=${JSON.stringify(survived)}`);
    }
  }

} catch (e) {
  fail(`smartrecruiters provider tests crashed: ${e.message}`);
}

