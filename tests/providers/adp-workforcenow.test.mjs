// tests/providers/adp-workforcenow.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — adp-workforcenow (ADP Workforce Now Recruitment)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/adp-workforcenow.mjs')).href);
  const adp = mod.default;
  const {
    parseListPage,
    extractExternalJobId,
    extractPostedAt,
    extractLocation,
    extractSalary,
    buildPostingUrl,
  } = mod;

  // Fictional fixture tenant — cid/ccId shaped like the real (GUID + numeric)
  // form so URL parsing exercises the real pattern without a real company.
  const CID = '11111111-2222-3333-4444-555555555555';
  const CCID = '19000101_000001';
  const CAREERS_URL = `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${CID}&ccId=${CCID}`;

  if (adp.id === 'adp-workforcenow') pass('adp-workforcenow.id is "adp-workforcenow"');
  else fail(`adp-workforcenow.id is ${JSON.stringify(adp.id)}`);

  // ── detect() ────────────────────────────────────────────────────────────

  const hit = adp.detect({ name: 'ExampleCo', careers_url: CAREERS_URL });
  if (hit && hit.url.includes(`cid=${CID}`) && hit.url.includes(`ccId=${CCID}`) && hit.url.startsWith('https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions')) {
    pass('adp-workforcenow.detect() matches a recruitment.html URL and builds the list API URL');
  } else {
    fail(`adp-workforcenow.detect() returned ${JSON.stringify(hit)}`);
  }

  // ccId order-independence — query params may appear in either order.
  const hitReordered = adp.detect({ name: 'ExampleCo', careers_url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?ccId=${CCID}&cid=${CID}` });
  if (hitReordered) pass('adp-workforcenow.detect() accepts cid/ccId in either query order');
  else fail('adp-workforcenow.detect() should accept cid/ccId in either order');

  // entry.api takes precedence, same convention as workday/greenhouse/ashby.
  const hitApi = adp.detect({ name: 'ExampleCo', careers_url: 'https://example.com/careers', api: CAREERS_URL });
  if (hitApi) pass('adp-workforcenow.detect() honors api: over a non-ADP careers_url');
  else fail('adp-workforcenow.detect() should honor api: over careers_url');

  // Missing cid or ccId → null, not a throw.
  if (adp.detect({ name: 'X', careers_url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=only-cid' }) === null) {
    pass('adp-workforcenow.detect() returns null when ccId is missing');
  } else {
    fail('adp-workforcenow.detect() should return null when ccId is missing');
  }
  if (adp.detect({ name: 'X', careers_url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?ccId=${CCID}` }) === null) {
    pass('adp-workforcenow.detect() returns null when cid is missing');
  } else {
    fail('adp-workforcenow.detect() should return null when cid is missing');
  }

  // Untrusted / spoofed hosts.
  if (adp.detect({ name: 'X', careers_url: `https://evil.com/workforcenow.adp.com/mdf/recruitment/recruitment.html?cid=${CID}&ccId=${CCID}` }) === null) {
    pass('adp-workforcenow.detect() rejects path-spoofed host');
  } else {
    fail('adp-workforcenow.detect() should reject path-spoofed host');
  }
  if (adp.detect({ name: 'X', careers_url: `https://workforcenow.adp.com.evil.com/mdf/recruitment/recruitment.html?cid=${CID}&ccId=${CCID}` }) === null) {
    pass('adp-workforcenow.detect() rejects suffix-spoofed host');
  } else {
    fail('adp-workforcenow.detect() should reject suffix-spoofed host');
  }
  if (adp.detect({ name: 'X', careers_url: `http://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${CID}&ccId=${CCID}` }) === null) {
    pass('adp-workforcenow.detect() rejects non-HTTPS');
  } else {
    fail('adp-workforcenow.detect() should reject non-HTTPS');
  }

  // Malformed / non-string / missing careers_url — never throws.
  try {
    const r1 = adp.detect({ name: 'X', careers_url: 'not a url' });
    const r2 = adp.detect({ name: 'X', careers_url: null });
    const r3 = adp.detect({ name: 'X' });
    const r4 = adp.detect(null);
    if (r1 === null && r2 === null && r3 === null && r4 === null) {
      pass('adp-workforcenow.detect() returns null (no throw) for malformed/missing/null input');
    } else {
      fail(`adp-workforcenow.detect() unexpected results: ${JSON.stringify([r1, r2, r3, r4])}`);
    }
  } catch (e) {
    fail(`adp-workforcenow.detect() should never throw, got: ${e.message}`);
  }

  // ── extractExternalJobId ────────────────────────────────────────────────

  const cfgWithExternal = {
    stringFields: [
      { nameCode: { codeValue: 'SomeOtherField' }, stringValue: 'ignore-me' },
      { nameCode: { codeValue: 'ExternalJobID' }, stringValue: '2026-1234' },
    ],
  };
  if (extractExternalJobId(cfgWithExternal) === '2026-1234') {
    pass('extractExternalJobId() finds the ExternalJobID entry by nameCode.codeValue');
  } else {
    fail(`extractExternalJobId() wrong: ${JSON.stringify(extractExternalJobId(cfgWithExternal))}`);
  }
  if (extractExternalJobId({ stringFields: [] }) === null && extractExternalJobId(undefined) === null && extractExternalJobId({}) === null) {
    pass('extractExternalJobId() returns null when absent/malformed');
  } else {
    fail('extractExternalJobId() should return null when absent');
  }

  // ── buildPostingUrl — canonical URL + missing-ExternalJobID fallback ────

  const urlWithExternal = buildPostingUrl(CID, CCID, '9200947568911_1', '2026-1234');
  if (
    urlWithExternal &&
    urlWithExternal.includes(`cid=${CID}`) &&
    urlWithExternal.includes(`ccId=${CCID}`) &&
    urlWithExternal.includes('jobId=2026-1234') &&
    urlWithExternal.includes('jwId=9200947568911_1') &&
    urlWithExternal.includes('type=JS')
  ) {
    pass('buildPostingUrl() builds the canonical URL with jobId=ExternalJobID and jwId=itemID');
  } else {
    fail(`buildPostingUrl() wrong: ${JSON.stringify(urlWithExternal)}`);
  }

  const urlFallback = buildPostingUrl(CID, CCID, '9200947568911_1', null);
  if (urlFallback && urlFallback.includes('jobId=9200947568911_1') && urlFallback.includes('jwId=9200947568911_1')) {
    pass('buildPostingUrl() falls back to itemID as jobId when ExternalJobID is absent');
  } else {
    fail(`buildPostingUrl() fallback wrong: ${JSON.stringify(urlFallback)}`);
  }

  // ── extractPostedAt ──────────────────────────────────────────────────────

  if (extractPostedAt({ postDate: '2026-07-01' }) === Date.parse('2026-07-01')) {
    pass('extractPostedAt() reads job.postDate directly');
  } else {
    fail(`extractPostedAt() postDate wrong: ${extractPostedAt({ postDate: '2026-07-01' })}`);
  }
  const withDateField = {
    customFieldGroup: { dateFields: [{ nameCode: { codeValue: 'PostingDate' }, dateValue: '2026-06-15' }] },
  };
  if (extractPostedAt(withDateField) === Date.parse('2026-06-15')) {
    pass('extractPostedAt() falls back to customFieldGroup.dateFields PostingDate when postDate absent');
  } else {
    fail(`extractPostedAt() dateFields fallback wrong: ${extractPostedAt(withDateField)}`);
  }
  if (extractPostedAt({}) === undefined && extractPostedAt({ postDate: 'garbage' }) === undefined) {
    pass('extractPostedAt() returns undefined for absent/unparsable dates (NaN-safe)');
  } else {
    fail('extractPostedAt() should return undefined, not NaN, for junk dates');
  }

  // ── extractLocation ──────────────────────────────────────────────────────

  const locNameCode = { requisitionLocations: [{ nameCode: { shortName: 'Toronto, ON' } }] };
  if (extractLocation(locNameCode) === 'Toronto, ON') pass('extractLocation() uses nameCode.shortName');
  else fail(`extractLocation() nameCode wrong: ${JSON.stringify(extractLocation(locNameCode))}`);

  const locAddressFallback = {
    requisitionLocations: [{ address: { cityName: 'London', countrySubdivisionLevel1: { codeValue: 'ON' }, country: { codeValue: 'CA' } } }],
  };
  if (extractLocation(locAddressFallback) === 'London, ON, CA') {
    pass('extractLocation() falls back to structured address when nameCode is absent');
  } else {
    fail(`extractLocation() address fallback wrong: ${JSON.stringify(extractLocation(locAddressFallback))}`);
  }

  const locMulti = {
    requisitionLocations: [
      { nameCode: { shortName: 'Toronto, ON' } },
      { nameCode: { shortName: 'Remote' } },
      { nameCode: { shortName: 'Toronto, ON' } }, // duplicate — deduped
    ],
  };
  if (extractLocation(locMulti) === 'Toronto, ON / Remote') pass('extractLocation() dedupes and joins multiple locations with " / "');
  else fail(`extractLocation() multi wrong: ${JSON.stringify(extractLocation(locMulti))}`);

  if (extractLocation({}) === '' && extractLocation({ requisitionLocations: [] }) === '') {
    pass('extractLocation() returns "" when no locations are present');
  } else {
    fail('extractLocation() should return "" for no locations');
  }

  // ── extractSalary ────────────────────────────────────────────────────────

  const payGrade = { payGradeRange: { minimumRate: { amountValue: 50000, currencyCode: 'CAD' }, maximumRate: { amountValue: 70000, currencyCode: 'CAD' } } };
  const salaryStruct = extractSalary(payGrade);
  if (salaryStruct && salaryStruct.min === 50000 && salaryStruct.max === 70000 && salaryStruct.currency === 'CAD') {
    pass('extractSalary() reads structured payGradeRange into {min, max, currency}');
  } else {
    fail(`extractSalary() payGradeRange wrong: ${JSON.stringify(salaryStruct)}`);
  }

  const salaryCustomField = {
    customFieldGroup: {
      stringFields: [
        { nameCode: { codeValue: 'SalaryRange' }, stringValue: '$50,000 - $70,000' },
        { nameCode: { codeValue: 'CurrencySymbolOrCode' }, stringValue: 'CAD' },
      ],
    },
  };
  const salaryFallback = extractSalary(salaryCustomField);
  if (salaryFallback && salaryFallback.min === 50000 && salaryFallback.max === 70000 && salaryFallback.currency === 'CAD') {
    pass('extractSalary() falls back to tagged customFieldGroup strings when payGradeRange is absent');
  } else {
    fail(`extractSalary() customFieldGroup fallback wrong: ${JSON.stringify(salaryFallback)}`);
  }

  if (extractSalary({}) === null) pass('extractSalary() returns null when no salary data is present (never invents one)');
  else fail(`extractSalary() should return null for no data, got ${JSON.stringify(extractSalary({}))}`);

  // ── parseListPage ────────────────────────────────────────────────────────

  const cfg = { cid: CID, ccId: CCID, companyName: 'ExampleCo' };

  const emptyPage = parseListPage({ jobRequisitions: [], meta: { totalNumber: 0 } }, cfg);
  if (emptyPage.jobs.length === 0 && emptyPage.total === 0) pass('parseListPage() treats an empty jobRequisitions array as a valid empty result');
  else fail(`parseListPage() empty case wrong: ${JSON.stringify(emptyPage)}`);

  const mkJob = (itemId, title, externalId) => ({
    itemID: itemId,
    requisitionTitle: title,
    customFieldGroup: externalId ? { stringFields: [{ nameCode: { codeValue: 'ExternalJobID' }, stringValue: externalId }] } : {},
    requisitionLocations: [{ nameCode: { shortName: 'Toronto, ON' } }],
    workLevelCode: { shortName: 'Full Time' },
  });
  const sample = {
    jobRequisitions: [
      mkJob('9200947568911_1', 'Instructional Designer', '2026-001'),
      mkJob('9200947568912_1', 'No External ID Role', null),
      { itemID: '', requisitionTitle: 'No itemID — dropped' },
      { itemID: 'abc', requisitionTitle: '' }, // no title — dropped
    ],
    meta: { totalNumber: 42 },
  };
  const parsed = parseListPage(sample, cfg);
  if (parsed.jobs.length === 2 && parsed.total === 42) {
    pass('parseListPage() drops rows missing itemID/title, keeps meta.totalNumber');
  } else {
    fail(`parseListPage() returned ${parsed.jobs.length} jobs / total ${parsed.total}, expected 2 / 42`);
  }
  if (parsed.jobs[0].url.includes('jobId=2026-001') && parsed.jobs[0].url.includes('jwId=9200947568911_1')) {
    pass('parseListPage() row 0 uses ExternalJobID for jobId');
  } else {
    fail(`parseListPage() row 0 url wrong: ${JSON.stringify(parsed.jobs[0].url)}`);
  }
  if (parsed.jobs[1].url.includes('jobId=9200947568912_1') && parsed.jobs[1].url.includes('jwId=9200947568912_1')) {
    pass('parseListPage() row 1 falls back to itemID for jobId when ExternalJobID is absent');
  } else {
    fail(`parseListPage() row 1 url wrong: ${JSON.stringify(parsed.jobs[1].url)}`);
  }
  if (parsed.jobs[0].company === 'ExampleCo' && parsed.jobs[0].location === 'Toronto, ON') {
    pass('parseListPage() sets company from cfg and location from requisitionLocations');
  } else {
    fail(`parseListPage() row 0 fields wrong: ${JSON.stringify(parsed.jobs[0])}`);
  }

  // ── fetch() — pagination, $skip advancing by rows returned, dedup, totals ─

  const fullPage = (start) => Array.from({ length: 20 }, (_, i) => mkJob(`item-${start + i}`, `Job ${start + i}`, `ext-${start + i}`));
  {
    const seenSkips = [];
    const pages = [
      { jobRequisitions: fullPage(1), meta: { totalNumber: 25 } },
      // Page 2 repeats the last id of page 1 (server-side overlap) — must dedup.
      { jobRequisitions: [mkJob('item-20', 'Job 20 dup', 'ext-20'), ...fullPage(21).slice(0, 5)], meta: { totalNumber: 25 } },
    ];
    let call = 0;
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async (url) => {
        const u = new URL(url);
        seenSkips.push(Number(u.searchParams.get('$skip')));
        return pages[call++] ?? { jobRequisitions: [], meta: { totalNumber: 25 } };
      },
    };
    const jobs = await adp.fetch({ name: 'ExampleCo', careers_url: CAREERS_URL }, mockCtx);
    if (seenSkips[0] === 1 && seenSkips[1] === 21) {
      pass('adp-workforcenow.fetch() advances $skip by rows actually returned (1-based), not a fixed page size assumption');
    } else {
      fail(`adp-workforcenow.fetch() $skip sequence wrong: ${JSON.stringify(seenSkips)}`);
    }
    if (jobs.length === 25) {
      pass('adp-workforcenow.fetch() stops once the running count reaches meta.totalNumber, deduping the overlapping itemID');
    } else {
      fail(`adp-workforcenow.fetch() returned ${jobs.length} jobs, expected 25 (deduped)`);
    }
    if (jobs.every((j) => j._itemId === undefined)) {
      pass('adp-workforcenow.fetch() strips the internal _itemId plumbing field from output rows');
    } else {
      fail('adp-workforcenow.fetch() leaked _itemId into a Job row');
    }
  }

  // A page that comes back empty (not just short) stops pagination — the
  // infinite-loop guard for a malformed/empty response, independent of totals.
  {
    let calls = 0;
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        calls++;
        return { jobRequisitions: [], meta: { totalNumber: 999 } };
      },
    };
    const jobs = await adp.fetch({ name: 'ExampleCo', careers_url: CAREERS_URL }, mockCtx);
    if (jobs.length === 0 && calls === 1) {
      pass('adp-workforcenow.fetch() stops after one empty page even when meta.totalNumber claims more');
    } else {
      fail(`adp-workforcenow.fetch() empty-page guard failed: ${jobs.length} jobs after ${calls} calls`);
    }
  }

  // ── malformed / error responses are NOT silently treated as zero jobs ────

  {
    // Recognizably-wrong shape: no jobRequisitions array AND no meta at all —
    // must throw, not report an empty board forever.
    const mockCtx = { sleep: async () => {}, fetchJson: async () => ({ unexpectedShape: true }) };
    let threw = false;
    try {
      await adp.fetch({ name: 'X', careers_url: CAREERS_URL }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('adp-workforcenow.fetch() throws on a response shape it does not recognize (never silently "0 jobs")');
    else fail('adp-workforcenow.fetch() should throw on an unrecognized response shape');
  }

  {
    // 429 that retries can't clear must propagate, not resolve to [].
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        const err = new Error('HTTP 429 Too Many Requests');
        err.status = 429;
        throw err;
      },
    };
    let threw = false;
    try {
      await adp.fetch({ name: 'X', careers_url: CAREERS_URL }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('adp-workforcenow.fetch() propagates a 429 exhausted by retry, does not silently return []');
    else fail('adp-workforcenow.fetch() should propagate an exhausted 429, not swallow it');
  }

  {
    // 5xx, same requirement.
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        const err = new Error('HTTP 503 Service Unavailable');
        err.status = 503;
        throw err;
      },
    };
    let threw = false;
    try {
      await adp.fetch({ name: 'X', careers_url: CAREERS_URL }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('adp-workforcenow.fetch() propagates an exhausted 5xx, does not silently return []');
    else fail('adp-workforcenow.fetch() should propagate an exhausted 5xx, not swallow it');
  }

  {
    // A non-JSON body surfaces as ctx.fetchJson itself rejecting (mirrors how
    // fetchJson/res.json() behaves on a malformed body) — must propagate.
    const mockCtx = { sleep: async () => {}, fetchJson: async () => { throw new SyntaxError('Unexpected token < in JSON'); } };
    let threw = false;
    try {
      await adp.fetch({ name: 'X', careers_url: CAREERS_URL }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('adp-workforcenow.fetch() propagates a non-JSON/parse failure, does not silently return []');
    else fail('adp-workforcenow.fetch() should propagate a JSON parse failure');
  }

  // ── redirect:'error' on every request ────────────────────────────────────

  {
    const seenOpts = [];
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        seenOpts.push(opts);
        return { jobRequisitions: [], meta: { totalNumber: 0 } };
      },
    };
    await adp.fetch({ name: 'X', careers_url: CAREERS_URL }, mockCtx);
    if (seenOpts.length > 0 && seenOpts.every((o) => o.redirect === 'error')) {
      pass("adp-workforcenow.fetch() passes redirect:'error' on every list request");
    } else {
      fail(`adp-workforcenow.fetch() redirect option wrong: ${JSON.stringify(seenOpts)}`);
    }
  }

  // ── ctx.maxPages — health-probe cooperation ──────────────────────────────

  {
    let calls = 0;
    const mockCtx = {
      sleep: async () => {},
      maxPages: 1,
      fetchJson: async () => {
        calls++;
        return { jobRequisitions: fullPage(1), meta: { totalNumber: 200 } };
      },
    };
    await adp.fetch({ name: 'X', careers_url: CAREERS_URL }, mockCtx);
    if (calls === 1) pass('adp-workforcenow.fetch() honors ctx.maxPages, stopping after one page during a health probe');
    else fail(`adp-workforcenow.fetch() made ${calls} calls under ctx.maxPages: 1, expected 1`);
  }

  // ── fetchDetails opt-in — requisitionDescription enrichment ─────────────

  {
    const listCtx = {
      sleep: async () => {},
      fetchJson: async (url) => {
        if (String(url).includes('/job-requisitions/')) {
          return { requisitionDescription: '<p>Great <b>role</b> &amp; team.</p>' };
        }
        return { jobRequisitions: [mkJob('item-1', 'Instructional Designer', 'ext-1')], meta: { totalNumber: 1 } };
      },
    };
    const jobs = await adp.fetch(
      { name: 'ExampleCo', careers_url: CAREERS_URL, adpWorkforcenow: { fetchDetails: true, detailLimit: 5 } },
      listCtx,
    );
    if (jobs.length === 1 && jobs[0].description && jobs[0].description.includes('Great role & team.')) {
      pass('adp-workforcenow.fetch() with fetchDetails:true enriches description from requisitionDescription');
    } else {
      fail(`adp-workforcenow.fetch() fetchDetails enrichment failed: ${JSON.stringify(jobs)}`);
    }
  }

  {
    // Without fetchDetails, no per-job detail request is made at all.
    let detailCalls = 0;
    const listCtx = {
      sleep: async () => {},
      fetchJson: async (url) => {
        if (String(url).includes('/job-requisitions/')) { detailCalls++; return { requisitionDescription: 'x' }; }
        return { jobRequisitions: [mkJob('item-1', 'Instructional Designer', 'ext-1')], meta: { totalNumber: 1 } };
      },
    };
    const jobs = await adp.fetch({ name: 'ExampleCo', careers_url: CAREERS_URL }, listCtx);
    if (detailCalls === 0 && jobs[0]?.description === undefined) {
      pass('adp-workforcenow.fetch() never fetches detail/description unless fetchDetails:true is set (zero-token default)');
    } else {
      fail(`adp-workforcenow.fetch() made ${detailCalls} unsolicited detail calls`);
    }
  }

  {
    // fetchDetails is skipped entirely during a health probe (ctx.maxPages set).
    let detailCalls = 0;
    const probeCtx = {
      sleep: async () => {},
      maxPages: 1,
      fetchJson: async (url) => {
        if (String(url).includes('/job-requisitions/')) { detailCalls++; return { requisitionDescription: 'x' }; }
        return { jobRequisitions: [mkJob('item-1', 'Instructional Designer', 'ext-1')], meta: { totalNumber: 1 } };
      },
    };
    await adp.fetch({ name: 'ExampleCo', careers_url: CAREERS_URL, adpWorkforcenow: { fetchDetails: true } }, probeCtx);
    if (detailCalls === 0) pass('adp-workforcenow.fetch() skips fetchDetails enrichment while a health probe (ctx.maxPages) is running');
    else fail(`adp-workforcenow.fetch() made ${detailCalls} detail calls during a probe, expected 0`);
  }

  {
    // A detail-fetch failure is enrichment-only — the listing result survives.
    const listCtx = {
      sleep: async () => {},
      fetchJson: async (url) => {
        if (String(url).includes('/job-requisitions/')) throw new Error('boom');
        return { jobRequisitions: [mkJob('item-1', 'Instructional Designer', 'ext-1')], meta: { totalNumber: 1 } };
      },
    };
    const jobs = await adp.fetch({ name: 'ExampleCo', careers_url: CAREERS_URL, adpWorkforcenow: { fetchDetails: true } }, listCtx);
    if (jobs.length === 1 && jobs[0].description === undefined) {
      pass('adp-workforcenow.fetch() keeps the listing result when detail enrichment fails');
    } else {
      fail(`adp-workforcenow.fetch() lost the listing on a detail-fetch failure: ${JSON.stringify(jobs)}`);
    }
  }
} catch (e) {
  fail(`adp-workforcenow provider tests crashed: ${e.message}\n${e.stack}`);
}
