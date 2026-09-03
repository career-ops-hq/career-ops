// tests/providers/ultipro.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — ultipro (UKG Pro / UltiPro Recruiting)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/ultipro.mjs')).href);
  const ultipro = mod.default;
  const { parseListPage, extractLocations, extractCandidateOpportunityDetail } = mod;

  // Fictional fixture tenant/board — GUID-shaped boardId, alphanumeric tenant,
  // matching the real observed shape without a real company.
  const TENANT = 'EXA5001EXCO';
  const BOARD_ID = '11111111-2222-3333-4444-555555555555';
  const listApiPrefix = (host) => `https://${host}/${TENANT}/JobBoard/${BOARD_ID}/JobBoardView/LoadSearchResults`;

  if (ultipro.id === 'ultipro') pass('ultipro.id is "ultipro"');
  else fail(`ultipro.id is ${JSON.stringify(ultipro.id)}`);

  // ── detect() — host allowlist PATTERN, not a fixed string ────────────────

  for (const host of ['recruiting.ultipro.ca', 'recruiting.ultipro.com', 'recruiting2.ultipro.com', 'recruiting3.ultipro.com']) {
    const careersUrl = `https://${host}/${TENANT}/JobBoard/${BOARD_ID}/`;
    const hit = ultipro.detect({ name: 'ExampleCo', careers_url: careersUrl });
    if (hit && hit.url === listApiPrefix(host)) {
      pass(`ultipro.detect() matches ${host} and builds the list API URL on that same host`);
    } else {
      fail(`ultipro.detect() for ${host} returned ${JSON.stringify(hit)}`);
    }
  }

  // No trailing slash after boardId is also a valid careers URL shape.
  {
    const hit = ultipro.detect({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}` });
    if (hit) pass('ultipro.detect() matches a board URL with no trailing slash');
    else fail('ultipro.detect() should match a board URL with no trailing slash');
  }

  // entry.api takes precedence, same convention as workday/adp-workforcenow.
  {
    const hit = ultipro.detect({
      name: 'ExampleCo',
      careers_url: 'https://example.com/careers',
      api: `https://recruiting.ultipro.com/${TENANT}/JobBoard/${BOARD_ID}/`,
    });
    if (hit) pass('ultipro.detect() honors api: over a non-UKG careers_url');
    else fail('ultipro.detect() should honor api: over careers_url');
  }

  // Invalid / spoofed / untrusted hosts — never claimed.
  const badHosts = [
    'https://recruitingxultipro.com/T/JobBoard/B/',            // not a subdomain match at all
    'https://ultipro.com/T/JobBoard/B/',                        // missing "recruiting" host label
    'https://recruiting.ultipro.com.evil.com/T/JobBoard/B/',    // suffix-spoofed
    'https://evil.com/recruiting.ultipro.com/T/JobBoard/B/',    // path-spoofed
    'http://recruiting.ultipro.com/T/JobBoard/B/',              // non-HTTPS
  ];
  for (const url of badHosts) {
    if (ultipro.detect({ name: 'X', careers_url: url }) === null) {
      pass(`ultipro.detect() rejects untrusted/malformed URL: ${url}`);
    } else {
      fail(`ultipro.detect() should reject: ${url}`);
    }
  }

  // Missing JobBoard segment / boardId → null, not a throw.
  if (ultipro.detect({ name: 'X', careers_url: `https://recruiting.ultipro.com/${TENANT}/` }) === null) {
    pass('ultipro.detect() returns null when the path has no /JobBoard/{id} segment');
  } else {
    fail('ultipro.detect() should return null with no JobBoard segment');
  }

  // Malformed / non-string / missing / null input — never throws.
  try {
    const r1 = ultipro.detect({ name: 'X', careers_url: 'not a url' });
    const r2 = ultipro.detect({ name: 'X', careers_url: null });
    const r3 = ultipro.detect({ name: 'X' });
    const r4 = ultipro.detect(null);
    if (r1 === null && r2 === null && r3 === null && r4 === null) {
      pass('ultipro.detect() returns null (no throw) for malformed/missing/null input');
    } else {
      fail(`ultipro.detect() unexpected results: ${JSON.stringify([r1, r2, r3, r4])}`);
    }
  } catch (e) {
    fail(`ultipro.detect() should never throw, got: ${e.message}`);
  }

  // ── extractLocations ───────────────────────────────────────────────────

  if (extractLocations(['Toronto, ON', 'Remote', 'Toronto, ON']) === 'Toronto, ON / Remote') {
    pass('extractLocations() dedupes and joins bare-string locations with " / "');
  } else {
    fail(`extractLocations() string case wrong: ${JSON.stringify(extractLocations(['Toronto, ON', 'Remote', 'Toronto, ON']))}`);
  }
  // Real shape (verified live against a UKG Pro tenant, 2026-09): Locations[]
  // objects carry Address.City/Address.State.Code, not a top-level Name/City.
  const liveShapeLocations = [
    { LocalizedName: 'Central Health & Fitness Centre', Address: { City: 'Toronto', State: { Code: 'ON' }, Country: { Code: 'CAN' } } },
    { LocalizedName: 'Wagner Green Branch', Address: { City: 'Toronto', State: { Code: 'ON' }, Country: { Code: 'CAN' } } }, // dedup — same City/State as above
  ];
  if (extractLocations(liveShapeLocations) === 'Toronto, ON') {
    pass('extractLocations() reads City/State.Code from the real Locations[].Address shape and dedupes');
  } else {
    fail(`extractLocations() live-shape case wrong: ${JSON.stringify(extractLocations(liveShapeLocations))}`);
  }
  if (extractLocations([{ LocalizedName: 'Branch With No Address' }]) === 'Branch With No Address') {
    pass('extractLocations() falls back to LocalizedName when Address is absent');
  } else {
    fail(`extractLocations() LocalizedName-fallback case wrong: ${JSON.stringify(extractLocations([{ LocalizedName: 'Branch With No Address' }]))}`);
  }
  if (extractLocations(undefined) === '' && extractLocations([]) === '' && extractLocations('not-an-array') === '') {
    pass('extractLocations() returns "" for missing/empty/non-array input');
  } else {
    fail('extractLocations() should return "" for missing/empty/non-array input');
  }

  // ── parseListPage ─────────────────────────────────────────────────────

  const cfg = { origin: 'https://recruiting.ultipro.ca', tenant: TENANT, boardId: BOARD_ID, companyName: 'ExampleCo' };

  const emptyPage = parseListPage({ opportunities: [], totalCount: 0 }, cfg);
  if (emptyPage.jobs.length === 0 && emptyPage.total === 0) {
    pass('parseListPage() treats an empty opportunities array as a valid empty result');
  } else {
    fail(`parseListPage() empty case wrong: ${JSON.stringify(emptyPage)}`);
  }

  const mkOpp = (id, title, opts = {}) => ({
    Id: id,
    Title: title,
    RequisitionNumber: opts.reqNumber ?? 'REQ-1',
    JobCategoryName: opts.category ?? 'General',
    Locations: opts.locations ?? ['Toronto, ON'],
    PostedDate: opts.postedDate ?? '2026-08-01',
    BriefDescription: opts.briefDescription ?? '',
    JobLocationType: opts.jobLocationType ?? 'On-Site',
  });

  const sample = {
    opportunities: [
      mkOpp('opp-1', 'Instructional Designer', { briefDescription: '<p>Great <b>role</b> &amp; team.</p>' }),
      mkOpp(2001, 'Numeric Id Role'), // Id as a number — must normalize to string
      { Id: '', Title: 'No Id — dropped' },
      { Id: 'abc', Title: '' }, // no title — dropped
    ],
    totalCount: 37,
  };
  const parsed = parseListPage(sample, cfg);
  if (parsed.jobs.length === 2 && parsed.total === 37) {
    pass('parseListPage() drops rows missing Id/Title, keeps totalCount');
  } else {
    fail(`parseListPage() returned ${parsed.jobs.length} jobs / total ${parsed.total}, expected 2 / 37`);
  }
  if (parsed.jobs[0].url.includes('opportunityId=opp-1') && parsed.jobs[0].url.startsWith(`${cfg.origin}/${TENANT}/JobBoard/${BOARD_ID}/OpportunityDetail?`)) {
    pass('parseListPage() row 0 builds the canonical OpportunityDetail URL');
  } else {
    fail(`parseListPage() row 0 url wrong: ${JSON.stringify(parsed.jobs[0].url)}`);
  }
  if (parsed.jobs[1].url.includes('opportunityId=2001')) {
    pass('parseListPage() normalizes a numeric Id to a string in the URL');
  } else {
    fail(`parseListPage() numeric-id url wrong: ${JSON.stringify(parsed.jobs[1].url)}`);
  }
  if (parsed.jobs[0].description === 'Great role & team.') {
    pass('parseListPage() runs BriefDescription through htmlToText (tags stripped, entities decoded)');
  } else {
    fail(`parseListPage() description wrong: ${JSON.stringify(parsed.jobs[0].description)}`);
  }
  if (parsed.jobs[0].company === 'ExampleCo' && parsed.jobs[0].location === 'Toronto, ON' && parsed.jobs[0].postedAt === Date.parse('2026-08-01')) {
    pass('parseListPage() sets company/location/postedAt from the response fields');
  } else {
    fail(`parseListPage() row 0 fields wrong: ${JSON.stringify(parsed.jobs[0])}`);
  }

  // ── fetch() — Top/Skip pagination, dedup, stop conditions ──────────────

  const mkPageOpps = (startId, count) => Array.from({ length: count }, (_, i) => mkOpp(`opp-${startId + i}`, `Job ${startId + i}`));

  {
    const seenSkips = [];
    const pages = [
      { opportunities: mkPageOpps(1, 50), totalCount: 70 },
      { opportunities: mkPageOpps(51, 20), totalCount: 70 },
    ];
    let call = 0;
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        const body = JSON.parse(opts.body);
        seenSkips.push(body.opportunitySearch.Skip);
        return pages[call++] ?? { opportunities: [], totalCount: 70 };
      },
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    if (seenSkips[0] === 0 && seenSkips[1] === 50) {
      pass('ultipro.fetch() advances Skip by Top (50) each page');
    } else {
      fail(`ultipro.fetch() Skip sequence wrong: ${JSON.stringify(seenSkips)}`);
    }
    if (jobs.length === 70) {
      pass('ultipro.fetch() stops once Skip + count reaches totalCount, returning every posting');
    } else {
      fail(`ultipro.fetch() returned ${jobs.length} jobs, expected 70`);
    }
    if (jobs.every((j) => j._id === undefined)) {
      pass('ultipro.fetch() strips the internal _id plumbing field from output rows');
    } else {
      fail('ultipro.fetch() leaked _id into a Job row');
    }
  }

  // A short page (fewer than Top) stops pagination even without totalCount agreeing exactly.
  {
    let calls = 0;
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        calls++;
        return { opportunities: mkPageOpps(1, 10), totalCount: 999 };
      },
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    if (jobs.length === 10 && calls === 1) {
      pass('ultipro.fetch() stops after a short page (returned fewer than Top) regardless of totalCount');
    } else {
      fail(`ultipro.fetch() short-page stop failed: ${jobs.length} jobs after ${calls} calls`);
    }
  }

  // An empty array is a valid stop, not an error.
  {
    let calls = 0;
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        calls++;
        return { opportunities: [], totalCount: 500 };
      },
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    if (jobs.length === 0 && calls === 1) {
      pass('ultipro.fetch() stops after one empty opportunities page even when totalCount claims more');
    } else {
      fail(`ultipro.fetch() empty-page guard failed: ${jobs.length} jobs after ${calls} calls`);
    }
  }

  // Duplicate Id across pages (server-side overlap) must dedup.
  {
    const pages = [
      { opportunities: mkPageOpps(1, 50), totalCount: 55 },
      { opportunities: [mkOpp('opp-50', 'Job 50 dup'), ...mkPageOpps(51, 4)], totalCount: 55 },
    ];
    let call = 0;
    const mockCtx = { sleep: async () => {}, fetchJson: async () => pages[call++] ?? { opportunities: [], totalCount: 55 } };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    if (jobs.length === 54) pass('ultipro.fetch() dedupes a duplicate Id repeated across pages');
    else fail(`ultipro.fetch() dedup failed: got ${jobs.length} jobs, expected 54`);
  }

  // Hitting the page-count safety cap before totalCount is reached marks the
  // result incomplete (a console warning + the ultiproTruncated tag), not
  // silently "done".
  {
    let calls = 0;
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        calls++;
        // Every page is a full 50-row page and totalCount is far beyond what
        // max_pages will ever reach — pagination can only stop by hitting the cap.
        return { opportunities: mkPageOpps(1, 50), totalCount: 999999 };
      },
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/`, max_pages: 3 }, mockCtx);
    if (calls === 3 && jobs.ultiproTruncated === true) {
      pass('ultipro.fetch() tags the result ultiproTruncated when the page cap is hit before totalCount is reached');
    } else {
      fail(`ultipro.fetch() cap-incomplete handling wrong: calls=${calls}, ultiproTruncated=${jobs.ultiproTruncated}`);
    }
  }

  // A tenant that finishes exactly at the cap (totalCount reached) is NOT
  // tagged truncated — the cap and "genuinely done" must not be conflated.
  {
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async () => ({ opportunities: mkPageOpps(1, 50), totalCount: 50 }),
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/`, max_pages: 1 }, mockCtx);
    if (jobs.ultiproTruncated === undefined) pass('ultipro.fetch() does not tag truncated when the board finished exactly at the cap');
    else fail('ultipro.fetch() should not tag truncated when totalCount was actually reached');
  }

  // ── malformed / error responses are NOT silently treated as zero jobs ──

  {
    const mockCtx = { sleep: async () => {}, fetchJson: async () => ({ unexpectedShape: true }) };
    let threw = false;
    try {
      await ultipro.fetch({ name: 'X', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('ultipro.fetch() throws on a response shape it does not recognize (never silently "0 jobs")');
    else fail('ultipro.fetch() should throw on an unrecognized response shape');
  }

  {
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
      await ultipro.fetch({ name: 'X', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('ultipro.fetch() propagates a 429 exhausted by retry, does not silently return []');
    else fail('ultipro.fetch() should propagate an exhausted 429, not swallow it');
  }

  {
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
      await ultipro.fetch({ name: 'X', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('ultipro.fetch() propagates an exhausted 5xx, does not silently return []');
    else fail('ultipro.fetch() should propagate an exhausted 5xx, not swallow it');
  }

  {
    const mockCtx = { sleep: async () => {}, fetchJson: async () => { throw new SyntaxError('Unexpected token < in JSON'); } };
    let threw = false;
    try {
      await ultipro.fetch({ name: 'X', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('ultipro.fetch() propagates a non-JSON/parse failure, does not silently return []');
    else fail('ultipro.fetch() should propagate a JSON parse failure');
  }

  // ── redirect:'error' on every request ───────────────────────────────────

  {
    const seenOpts = [];
    const mockCtx = {
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        seenOpts.push(opts);
        return { opportunities: [], totalCount: 0 };
      },
    };
    await ultipro.fetch({ name: 'X', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    if (seenOpts.length > 0 && seenOpts.every((o) => o.redirect === 'error')) {
      pass("ultipro.fetch() passes redirect:'error' on every list request");
    } else {
      fail(`ultipro.fetch() redirect option wrong: ${JSON.stringify(seenOpts)}`);
    }
  }

  // ── ctx.maxPages — health-probe cooperation ─────────────────────────────

  {
    let calls = 0;
    const mockCtx = {
      sleep: async () => {},
      maxPages: 1,
      fetchJson: async () => {
        calls++;
        return { opportunities: mkPageOpps(1, 50), totalCount: 500 };
      },
    };
    const jobs = await ultipro.fetch({ name: 'X', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, mockCtx);
    if (calls === 1) pass('ultipro.fetch() honors ctx.maxPages, stopping after one page during a health probe');
    else fail(`ultipro.fetch() made ${calls} calls under ctx.maxPages: 1, expected 1`);
    if (jobs.ultiproTruncated === undefined) pass('ultipro.fetch() does not tag truncated when stopped by a probe cap (ctx.maxPages)');
    else fail('ultipro.fetch() should not tag truncated for a probe-driven stop');
  }

  // ── extractCandidateOpportunityDetail — the brace-balancing extractor ───

  const wrapHtml = (jsonLiteral) => `<html><body><script>var x = new US.Opportunity.CandidateOpportunityDetail(${jsonLiteral});</script></body></html>`;

  {
    // Braces AND escaped quotes/backslashes inside the JD text — the whole
    // point of walking string-aware instead of regexing.
    const detailObj = {
      Id: 'opp-1',
      Title: 'Instructional Designer',
      RequisitionNumber: 'REQ-1',
      JobCategoryName: 'Education',
      Locations: ['Toronto, ON'],
      PostedDate: '2026-08-01',
      Description: 'Role covers {curriculum design} and a \\"quoted\\" term, plus edge cases like } and {.',
    };
    const html = wrapHtml(JSON.stringify(detailObj));
    const result = extractCandidateOpportunityDetail(html, 'opp-1');
    if (result.status === 'ok' && result.detail.Id === 'opp-1' && result.detail.Description.includes('{curriculum design}')) {
      pass('extractCandidateOpportunityDetail() correctly balances braces/quotes inside JD text');
    } else {
      fail(`extractCandidateOpportunityDetail() brace-in-string case wrong: ${JSON.stringify(result)}`);
    }
  }

  {
    // Marker present, but the object is malformed JSON.
    const html = `<script>new US.Opportunity.CandidateOpportunityDetail({Id: 'opp-1', Title: unquoted-value-not-json});</script>`;
    let threw = false;
    try {
      extractCandidateOpportunityDetail(html, 'opp-1');
    } catch {
      threw = true;
    }
    if (threw) pass('extractCandidateOpportunityDetail() throws when the extracted slice is not valid JSON');
    else fail('extractCandidateOpportunityDetail() should throw on malformed JSON');
  }

  {
    // Marker present, braces never balance back to 0.
    const html = `<script>new US.Opportunity.CandidateOpportunityDetail({"Id": "opp-1", "Title": "Unbalanced"</script>`;
    let threw = false;
    try {
      extractCandidateOpportunityDetail(html, 'opp-1');
    } catch {
      threw = true;
    }
    if (threw) pass('extractCandidateOpportunityDetail() throws when braces never balance');
    else fail('extractCandidateOpportunityDetail() should throw on unbalanced braces');
  }

  {
    // Marker entirely absent — the "expired posting" 200-with-empty-shell case.
    const html = '<html><body><div id="app"></div></body></html>';
    const result = extractCandidateOpportunityDetail(html, 'opp-1');
    if (result.status === 'not-found') pass('extractCandidateOpportunityDetail() reports not-found when the marker is entirely absent');
    else fail(`extractCandidateOpportunityDetail() should report not-found, got: ${JSON.stringify(result)}`);
  }

  {
    // Returned Id mismatches the requested opportunityId — must reject.
    const html = wrapHtml(JSON.stringify({ Id: 'opp-OTHER', Title: 'Wrong One', Description: 'x' }));
    let threw = false;
    try {
      extractCandidateOpportunityDetail(html, 'opp-1');
    } catch {
      threw = true;
    }
    if (threw) pass('extractCandidateOpportunityDetail() throws when the detail Id does not match the requested opportunityId');
    else fail('extractCandidateOpportunityDetail() should reject an Id mismatch');
  }

  {
    // Numeric Id in the detail payload still matches a string-typed expectedId.
    const html = wrapHtml(JSON.stringify({ Id: 2001, Title: 'Numeric Id Role', Description: 'x' }));
    const result = extractCandidateOpportunityDetail(html, '2001');
    if (result.status === 'ok') pass('extractCandidateOpportunityDetail() matches a numeric detail Id against a string expectedId');
    else fail(`extractCandidateOpportunityDetail() numeric-id match failed: ${JSON.stringify(result)}`);
  }

  {
    // Missing Id / Title — malformed, must reject.
    const htmlNoId = wrapHtml(JSON.stringify({ Title: 'No Id', Description: 'x' }));
    const htmlNoTitle = wrapHtml(JSON.stringify({ Id: 'opp-1', Description: 'x' }));
    let threwNoId = false;
    let threwNoTitle = false;
    try { extractCandidateOpportunityDetail(htmlNoId, 'opp-1'); } catch { threwNoId = true; }
    try { extractCandidateOpportunityDetail(htmlNoTitle, 'opp-1'); } catch { threwNoTitle = true; }
    if (threwNoId && threwNoTitle) pass('extractCandidateOpportunityDetail() throws when Id or Title is missing from the detail object');
    else fail(`extractCandidateOpportunityDetail() missing-field handling wrong: noId=${threwNoId}, noTitle=${threwNoTitle}`);
  }

  {
    // Empty/non-string html input — treated as not-found, never throws.
    if (
      extractCandidateOpportunityDetail('', 'opp-1').status === 'not-found' &&
      extractCandidateOpportunityDetail(/** @type {any} */ (null), 'opp-1').status === 'not-found'
    ) {
      pass('extractCandidateOpportunityDetail() treats empty/non-string html as not-found');
    } else {
      fail('extractCandidateOpportunityDetail() should treat empty/non-string html as not-found');
    }
  }

  // ── fetchDetails opt-in — full-JD enrichment via the detail page ───────

  {
    const detailHtml = wrapHtml(JSON.stringify({
      Id: 'opp-1',
      Title: 'Instructional Designer',
      Description: '<p>Great <b>role</b> &amp; team.</p>',
    }));
    const listCtx = {
      sleep: async () => {},
      fetchJson: async () => ({ opportunities: [mkOpp('opp-1', 'Instructional Designer')], totalCount: 1 }),
      fetchText: async (url) => {
        if (String(url).includes('OpportunityDetail')) return detailHtml;
        throw new Error(`unexpected fetchText url: ${url}`);
      },
    };
    const jobs = await ultipro.fetch(
      { name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/`, ultipro: { fetchDetails: true, detailLimit: 5 } },
      listCtx,
    );
    if (jobs.length === 1 && jobs[0].description === 'Great role & team.') {
      pass('ultipro.fetch() with fetchDetails:true enriches description from the detail page\'s Description');
    } else {
      fail(`ultipro.fetch() fetchDetails enrichment failed: ${JSON.stringify(jobs)}`);
    }
  }

  {
    // Without fetchDetails, no per-job detail request is made at all.
    let detailCalls = 0;
    const listCtx = {
      sleep: async () => {},
      fetchJson: async () => ({ opportunities: [mkOpp('opp-1', 'Instructional Designer')], totalCount: 1 }),
      fetchText: async () => { detailCalls++; return wrapHtml(JSON.stringify({ Id: 'opp-1', Title: 'x', Description: 'x' })); },
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/` }, listCtx);
    if (detailCalls === 0 && jobs[0]?.description !== undefined) {
      // The list-level BriefDescription (empty in mkOpp's default) means no
      // description key at all is also acceptable here — the key assertion
      // is zero detail calls.
    }
    if (detailCalls === 0) {
      pass('ultipro.fetch() never fetches the detail page unless fetchDetails:true is set (zero-token default)');
    } else {
      fail(`ultipro.fetch() made ${detailCalls} unsolicited detail calls`);
    }
  }

  {
    // fetchDetails is skipped entirely during a health probe (ctx.maxPages set).
    let detailCalls = 0;
    const probeCtx = {
      sleep: async () => {},
      maxPages: 1,
      fetchJson: async () => ({ opportunities: [mkOpp('opp-1', 'Instructional Designer')], totalCount: 1 }),
      fetchText: async () => { detailCalls++; return wrapHtml(JSON.stringify({ Id: 'opp-1', Title: 'x', Description: 'x' })); },
    };
    await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/`, ultipro: { fetchDetails: true } }, probeCtx);
    if (detailCalls === 0) pass('ultipro.fetch() skips fetchDetails enrichment while a health probe (ctx.maxPages) is running');
    else fail(`ultipro.fetch() made ${detailCalls} detail calls during a probe, expected 0`);
  }

  {
    // A detail-fetch failure is enrichment-only — the listing result survives.
    const listCtx = {
      sleep: async () => {},
      fetchJson: async () => ({ opportunities: [mkOpp('opp-1', 'Instructional Designer')], totalCount: 1 }),
      fetchText: async () => { throw new Error('boom'); },
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/`, ultipro: { fetchDetails: true } }, listCtx);
    if (jobs.length === 1) {
      pass('ultipro.fetch() keeps the listing result when detail enrichment fails');
    } else {
      fail(`ultipro.fetch() lost the listing on a detail-fetch failure: ${JSON.stringify(jobs)}`);
    }
  }

  {
    // The "200 but marker absent" expired-posting case, exercised through
    // fetch(): the listing survives, description enrichment is silently skipped
    // (never "successfully" set to an empty string).
    const emptyShellHtml = '<html><body><div id="app"></div></body></html>';
    const listCtx = {
      sleep: async () => {},
      fetchJson: async () => ({ opportunities: [mkOpp('opp-1', 'Instructional Designer')], totalCount: 1 }),
      fetchText: async () => emptyShellHtml,
    };
    const jobs = await ultipro.fetch({ name: 'ExampleCo', careers_url: `https://recruiting.ultipro.ca/${TENANT}/JobBoard/${BOARD_ID}/`, ultipro: { fetchDetails: true } }, listCtx);
    if (jobs.length === 1 && jobs[0].description === undefined) {
      pass('ultipro.fetch() treats a 200-but-marker-absent detail page as not-found, not a successful empty description');
    } else {
      fail(`ultipro.fetch() mishandled the marker-absent detail case: ${JSON.stringify(jobs)}`);
    }
  }
} catch (e) {
  fail(`ultipro provider tests crashed: ${e.message}\n${e.stack}`);
}
