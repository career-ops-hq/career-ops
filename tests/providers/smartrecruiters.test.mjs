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

  // Empty vs broken (#6906, ADDING_A_PROVIDER.md "Defensive parsing"): only the
  // documented container, present and empty, is an empty page. Any other
  // envelope throws, naming the keys (or the type) it got, so a changed API or
  // an error served with a 200 cannot read as "no open roles".
  const emptyPage = parseSmartRecruitersResponse({ offset: 0, limit: 100, totalFound: 0, content: [] }, 'X');
  if (Array.isArray(emptyPage) && emptyPage.length === 0) pass('parseSmartRecruitersResponse returns [] for { content: [] }');
  else fail(`{ content: [] } → ${JSON.stringify(emptyPage)}`);

  const brokenCases = [
    [{}, '[]'],
    [{ error: 'rate limited' }, '[error]'],
    [{ content: null }, '[content]'],
    [{ content: 'not an array' }, '[content]'],
    ['oops', '[string]'],
    [null, '[null]'],
  ];
  let brokenOk = true;
  for (const [body, got] of brokenCases) {
    let out;
    let err = null;
    try { out = parseSmartRecruitersResponse(body, 'Acme'); } catch (e) { err = e; }
    const msg = String(err?.message || '');
    if (!err || !msg.startsWith('smartrecruiters: unexpected response for Acme') || !msg.includes(`got: ${got}`)) {
      brokenOk = false;
      fail(`parseSmartRecruitersResponse body=${JSON.stringify(body)} should throw naming ${got}; got ${err ? JSON.stringify(msg) : `a return of ${JSON.stringify(out)}`}`);
      break;
    }
  }
  if (brokenOk) pass('parseSmartRecruitersResponse throws, naming what it got, for a body that is not { content: [...] }');

  // Through fetch(): a first page that is not a board fails the run instead of
  // returning an empty board, and so does a later page.
  for (const [label, firstPage] of [['first', {}], ['later', { content: Array.from({ length: 100 }, (_, i) => ({ id: `F${i}`, name: `Role ${i}` })) }]]) {
    let err = null;
    try {
      await sr.fetch(
        { name: 'BrokenCo', careers_url: 'https://careers.smartrecruiters.com/broken' },
        { transport: 'http', sleep: async () => {}, fetchJson: async (url) => (new URL(url).searchParams.get('offset') === '0' ? firstPage : { error: 'upstream' }) },
      );
    } catch (e) { err = e; }
    if (/^smartrecruiters: unexpected response for BrokenCo/.test(String(err?.message))) {
      pass(`smartrecruiters.fetch() throws when the ${label} page is not a board`);
    } else {
      fail(`smartrecruiters.fetch() with a broken ${label} page: ${err ? err.message : 'no throw'}`);
    }
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

  // ── Requisition id + posting language ──
  // `refNumber` is the employer's requisition id: shared by every language
  // version of one requisition and kept across re-releases, while the posting
  // id changes. `language.code` is the posting text's language code.
  {
    const twins = parseSmartRecruitersResponse({
      content: [
        { id: '1001', name: 'Senior QA Manager', refNumber: 'ID2608-00427A', language: { code: 'de', label: 'German' } },
        { id: '1002', name: 'Senior QA Manager', refNumber: 'ID2608-00427A', language: { code: 'en-GB' } },
      ],
    }, 'Acme');
    if (twins[0]?.requisitionId === 'ID2608-00427A' && twins[0]?.language === 'de'
        && twins[1]?.requisitionId === 'ID2608-00427A' && twins[1]?.language === 'en-GB') {
      pass('parseSmartRecruitersResponse maps refNumber → requisitionId and language.code → language');
    } else {
      fail(`twins = ${JSON.stringify(twins)}`);
    }
  }

  {
    const odd = parseSmartRecruitersResponse({
      content: [
        { id: 'A', name: 'Spaced', refNumber: '  JREQ 12757  ', language: { code: ' en ' } },
        { id: 'B', name: 'Numeric', refNumber: 4647 },
        { id: 'C', name: 'Blank', refNumber: '   ', language: { code: '' } },
        { id: 'D', name: 'Object', refNumber: { value: 'R1' }, language: 'de' },
        { id: 'E', name: 'Absent' },
      ],
    }, 'Acme');
    const [spaced, numeric, blank, object, absent] = odd;
    if (spaced?.requisitionId === 'JREQ 12757' && spaced?.language === 'en') {
      pass('parseSmartRecruitersResponse trims both values and keeps an inner space in the requisition id');
    } else {
      fail(`spaced = ${JSON.stringify(spaced)}`);
    }
    if (numeric?.requisitionId === '4647' && !('language' in numeric)) {
      pass('parseSmartRecruitersResponse stringifies a numeric refNumber');
    } else {
      fail(`numeric = ${JSON.stringify(numeric)}`);
    }
    if ([blank, object, absent].every((j) => j && !('requisitionId' in j) && !('language' in j))) {
      pass('parseSmartRecruitersResponse omits both keys for blank, non-scalar or missing values');
    } else {
      fail(`blank/object/absent = ${JSON.stringify([blank, object, absent])}`);
    }
  }

  // fetch() strips the internal posting id but keeps both new fields.
  {
    const rows = await sr.fetch(
      { name: 'KeepCo', careers_url: 'https://careers.smartrecruiters.com/keepco' },
      {
        fetchJson: async () => ({
          content: [{ id: '77', name: 'Role', refNumber: 'REF7515N', language: { code: 'pt' } }],
        }),
      },
    );
    if (rows[0]?.requisitionId === 'REF7515N' && rows[0]?.language === 'pt' && !('id' in rows[0])) {
      pass('fetch() returns requisitionId and language and still strips the internal id');
    } else {
      fail(`fetch row = ${JSON.stringify(rows[0])}`);
    }
  }

  // releasedDate becomes postedAt, so max_posting_age_days and --since can
  // act on SmartRecruiters boards. Before, every row came back undated and
  // buildPostingAgeFilter passes an undated row, so a 2022 requisition
  // survived a 45-day limit.
  {
    const rows = parseSmartRecruitersResponse({
      content: [
        { id: '1', name: 'Dated', company: { name: 'DateCo' }, releasedDate: '2022-07-05T08:50:05.000Z' },
        { id: '2', name: 'Undated', company: { name: 'DateCo' } },
        { id: '3', name: 'Garbled', company: { name: 'DateCo' }, releasedDate: 'not a date' },
        { id: '4', name: 'Object', company: { name: 'DateCo' }, releasedDate: { toString: 1 } },
      ],
    }, 'DateCo', 'dateco');
    const [dated, undated, garbled, objectDate] = rows;
    if (rows.length === 4 && objectDate && !('postedAt' in objectDate)) {
      pass('a releasedDate that is not a string is ignored, not thrown on');
    } else {
      fail(`object-date row = ${JSON.stringify(objectDate)}, rows = ${rows.length}`);
    }
    if (dated?.postedAt === Date.parse('2022-07-05T08:50:05.000Z')) {
      pass('parseSmartRecruitersResponse maps releasedDate to postedAt (epoch ms)');
    } else {
      fail(`dated row = ${JSON.stringify(dated)}`);
    }
    if (undated && !('postedAt' in undated) && garbled && !('postedAt' in garbled)) {
      pass('a missing or unparseable releasedDate leaves postedAt unset');
    } else {
      fail(`undated/garbled = ${JSON.stringify([undated, garbled])}`);
    }
    const { buildPostingAgeFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
    const keep = buildPostingAgeFilter(45, Date.parse('2026-10-30T00:00:00Z'));
    if (keep(dated?.postedAt) === false && keep(undated?.postedAt) === true) {
      pass('a 2022 SmartRecruiters posting is dropped by a 45-day max_posting_age_days');
    } else {
      fail(`age filter kept dated=${keep(dated?.postedAt)} undated=${keep(undated?.postedAt)}`);
    }

    const fetched = await sr.fetch(
      { name: 'DateCo', careers_url: 'https://careers.smartrecruiters.com/dateco' },
      { fetchJson: async () => ({ content: [{ id: '9', name: 'Role', releasedDate: '2026-10-29T10:00:00.000Z' }] }) },
    );
    if (fetched[0]?.postedAt === Date.parse('2026-10-29T10:00:00.000Z')) {
      pass('fetch() keeps postedAt on the rows it returns');
    } else {
      fail(`fetch row = ${JSON.stringify(fetched[0])}`);
    }
  }

  // ── listingIdentity (#6908): the posting id the payload already carries
  //    becomes the strong ATS-native identity instead of being thrown away.
  {
    const { smartRecruitersListingIdentity } = smartrecruitersModule;
    const { isOfferSeen, markOfferSeen, listingIdentityToken } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
    const entry = { name: 'Acme', careers_url: 'https://careers.smartrecruiters.com/acme' };
    const fetchWith = (content) => sr.fetch(entry, { fetchJson: async () => ({ content }) });

    const [row] = await fetchWith([{ id: '744000012345678', name: 'Staff Engineer' }]);
    if (row?.listingIdentity?.ats_provider === 'smartrecruiters'
        && row?.listingIdentity?.board_slug === 'acme'
        && row?.listingIdentity?.posting_id === '744000012345678'
        && !('id' in row)) {
      pass('fetch() returns the smartrecruiters/<slug>/<posting id> identity and still strips the raw id');
    } else {
      fail(`identity row = ${JSON.stringify(row)}`);
    }

    // The board slug comes from the configured entry, not from the posting URL:
    // a branded careers_url with the slug pinned via api: keys on that slug.
    const [pinned] = await sr.fetch(
      { name: 'Continental', careers_url: 'https://jobs.continental.com', api: 'https://careers.smartrecruiters.com/Continental' },
      { fetchJson: async () => ({ content: [{ id: '42', name: 'Role' }] }) },
    );
    if (pinned?.listingIdentity?.board_slug === 'Continental' && pinned?.listingIdentity?.posting_id === '42') {
      pass('fetch() keys the identity on the api:-pinned slug of a branded careers_url');
    } else {
      fail(`pinned identity = ${JSON.stringify(pinned?.listingIdentity)}`);
    }

    // The same posting reached through a second URL (the employer's branded
    // careers page instead of the ATS host) is one listing, not two. URL dedup
    // alone cannot join these; only the ATS-native identity can.
    const [before] = await fetchWith([{ id: '744000099', name: 'Backend Engineer' }]);
    const branded = { ...before, url: 'https://careers.acme.example/jobs/744000099-backend-engineer' };
    const seen = new Set();
    markOfferSeen(before, seen);
    if (isOfferSeen(branded, seen)) {
      pass('the same SmartRecruiters posting under a branded URL is already seen (one row, not two)');
    } else {
      fail(`branded URL not seen; identity = ${JSON.stringify(before?.listingIdentity)}`);
    }

    // A different posting on the same board stays a different listing.
    const [other] = await fetchWith([{ id: '744000100', name: 'Backend Engineer' }]);
    if (listingIdentityToken(other) !== listingIdentityToken(before) && !isOfferSeen(other, seen)) {
      pass('a different posting id on the same board is a different listing');
    } else {
      fail(`other token = ${listingIdentityToken(other)}`);
    }

    // No usable id → no identity, so the scan falls back to URL dedup.
    const unusable = await fetchWith([
      { name: 'No id', ref: 'https://api.smartrecruiters.com/v1/companies/acme/postings/1' },
      { id: ' 7 ', name: 'Padded id' },
      { id: 'a\u0007b', name: 'Control in id' },
    ]);
    if (unusable.length === 3 && unusable.every((j) => !('listingIdentity' in j))) {
      pass('a missing, padded or control-bearing posting id leaves listingIdentity off');
    } else {
      fail(`unusable rows = ${JSON.stringify(unusable)}`);
    }

    // A numeric payload id is stringified for the detail call and the URL, but
    // identity ids are never coerced: 1 and '1' must not become one listing.
    const [numeric] = await fetchWith([{ id: 1, name: 'Numeric id' }]);
    const [stringOne] = await fetchWith([{ id: '1', name: 'String id' }]);
    if (numeric && !('listingIdentity' in numeric)
        && numeric.url === 'https://jobs.smartrecruiters.com/acme/1-numeric-id'
        && stringOne?.listingIdentity?.posting_id === '1') {
      pass('a numeric payload id keeps its URL but gets no identity (no numeric coercion)');
    } else {
      fail(`numeric = ${JSON.stringify(numeric)}, string = ${JSON.stringify(stringOne?.listingIdentity)}`);
    }

    // The internal postingId never reaches a Job row.
    if ([row, numeric, stringOne, ...unusable].every((j) => j && !('postingId' in j) && !('id' in j))) {
      pass('fetch() strips both the raw id and the internal postingId from Job rows');
    } else {
      fail('postingId or id leaked into a Job row');
    }

    if (smartRecruitersListingIdentity('', '1') === undefined
        && smartRecruitersListingIdentity(null, '1') === undefined
        && smartRecruitersListingIdentity('acme', 1) === undefined
        && smartRecruitersListingIdentity('acme', '') === undefined) {
      pass('smartRecruitersListingIdentity() returns undefined for an empty slug or a non-string/empty id');
    } else {
      fail('smartRecruitersListingIdentity() accepted an incomplete triple');
    }
  }

} catch (e) {
  fail(`smartrecruiters provider tests crashed: ${e.message}`);
}

