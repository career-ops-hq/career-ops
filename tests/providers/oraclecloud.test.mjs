// tests/providers/oraclecloud.test.mjs — contract test for the Oracle Recruiting
// Cloud (ORC) provider. Auto-discovered by test-all.mjs under tests/**.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — oraclecloud');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/oraclecloud.mjs')).href);
  const oc = mod.default;
  const { parseOracleResponse, resolveSite, buildApiUrl, buildJobUrl } = mod;

  // Validate a derived URL by its parsed hostname, never by substring-matching
  // the whole URL string — a trusted host fragment can appear in a hostile
  // URL's path/query/userinfo (CodeQL js/incomplete-url-substring-sanitization).
  // Mirrors the provider's own assertOracleUrl discipline.
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };

  // ── id ──────────────────────────────────────────────────────────────
  if (oc.id === 'oraclecloud') pass('oraclecloud.id is "oraclecloud"');
  else fail(`oraclecloud.id is ${JSON.stringify(oc.id)}`);

  // ── detect ──────────────────────────────────────────────────────────
  const careers = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/jobs';
  const hit = oc.detect({ name: 'JPMC', careers_url: careers });
  if (hit && hostOf(hit.url) === 'jpmc.fa.oraclecloud.com'
      && new URL(hit.url).pathname === '/hcmRestApi/resources/latest/recruitingCEJobRequisitions'
      && hit.url.includes('findReqs;siteNumber=CX_1002')) {
    pass('oraclecloud.detect() derives the requisitions API URL with siteNumber from careers_url');
  } else {
    fail(`oraclecloud.detect(careers) returned ${JSON.stringify(hit)}`);
  }

  // finder grammar: `findReqs;` (semicolon) then comma-separated pairs
  if (hit && hit.url.includes('finder=findReqs;siteNumber=CX_1002,') && !hit.url.includes('findReqs,siteNumber')) {
    pass('oraclecloud.detect() uses findReqs; (semicolon) finder grammar');
  } else {
    fail(`finder grammar wrong in ${JSON.stringify(hit?.url)}`);
  }

  // region host variant (<tenant>.fa.<region>.oraclecloud.com)
  const regionHit = oc.detect({ name: 'Oracle', careers_url: 'https://oracle.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs' });
  if (regionHit && hostOf(regionHit.url) === 'oracle.fa.us2.oraclecloud.com') {
    pass('oraclecloud.detect() handles the <region> host variant (us2)');
  } else {
    fail(`region variant returned ${JSON.stringify(regionHit)}`);
  }

  // ocs host variant
  const ocsHit = oc.detect({ name: 'X', careers_url: 'https://acme.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs' });
  if (ocsHit && hostOf(ocsHit.url) === 'acme.fa.ocs.oraclecloud.com') {
    pass('oraclecloud.detect() handles the .ocs. host variant');
  } else {
    fail(`ocs variant returned ${JSON.stringify(ocsHit)}`);
  }

  // default siteNumber CX_1 when no /sites/<n>/ in the path
  const noSite = oc.detect({ name: 'X', careers_url: 'https://acme.fa.oraclecloud.com/hcmUI/CandidateExperience/en/' });
  if (noSite && noSite.url.includes('siteNumber=CX_1,')) {
    pass('oraclecloud.detect() falls back to siteNumber CX_1');
  } else {
    fail(`default site returned ${JSON.stringify(noSite?.url)}`);
  }

  // siteNumber override on the entry
  const override = oc.detect({ name: 'X', careers_url: careers, siteNumber: 'CX_2001' });
  if (override && override.url.includes('siteNumber=CX_2001,')) {
    pass('oraclecloud.detect() honors an explicit siteNumber override');
  } else {
    fail(`siteNumber override returned ${JSON.stringify(override?.url)}`);
  }

  // locationId override surfaces in the finder
  const locId = oc.detect({ name: 'X', careers_url: careers, locationId: 300000000123456 });
  if (locId && locId.url.includes('locationId=300000000123456')) {
    pass('oraclecloud.detect() includes locationId when provided');
  } else {
    fail(`locationId override returned ${JSON.stringify(locId?.url)}`);
  }

  // entry.api precedence over a branded careers_url
  const apiPinned = oc.detect({
    name: 'Branded',
    careers_url: 'https://careers.branded.com',
    api: 'https://tenant.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1005/jobs',
  });
  if (apiPinned && hostOf(apiPinned.url) === 'tenant.fa.oraclecloud.com' && apiPinned.url.includes('siteNumber=CX_1005')) {
    pass('oraclecloud.detect() honors api: over a branded careers_url');
  } else {
    fail(`api-pinned returned ${JSON.stringify(apiPinned)}`);
  }

  // non-Oracle URL → null
  if (oc.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('oraclecloud.detect() returns null for non-Oracle URLs');
  } else {
    fail('oraclecloud.detect() should return null for non-Oracle URLs');
  }

  // missing / null / non-string careers_url → null
  if (oc.detect({ name: 'X' }) === null
      && oc.detect({ name: 'X', careers_url: null }) === null
      && oc.detect({ name: 'X', careers_url: { foo: 'bar' } }) === null) {
    pass('oraclecloud.detect() returns null for missing/null/non-string careers_url');
  } else {
    fail('oraclecloud.detect() should treat missing/null/non-string careers_url as no-match');
  }

  // host-suffix spoof (oraclecloud.com in a longer evil host) → null
  if (oc.detect({ name: 'Spoof', careers_url: 'https://x.fa.oraclecloud.com.evil.example/hcmUI/CandidateExperience/en/sites/CX_1/jobs' }) === null) {
    pass('oraclecloud.detect() rejects host-suffix spoofing');
  } else {
    fail('oraclecloud.detect() must reject host-suffix spoofing');
  }

  // path-spoof (oracle host in the path, not the host) → null
  if (oc.detect({ name: 'Spoof2', careers_url: 'https://evil.example/x.fa.oraclecloud.com/sites/CX_1/jobs' }) === null) {
    pass('oraclecloud.detect() rejects path-spoofed URLs');
  } else {
    fail('oraclecloud.detect() must reject path-spoofed URLs');
  }

  // non-HTTPS → null
  if (oc.detect({ name: 'X', careers_url: 'http://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs' }) === null) {
    pass('oraclecloud.detect() rejects non-HTTPS URLs');
  } else {
    fail('oraclecloud.detect() must reject non-HTTPS URLs');
  }

  // ── parseOracleResponse (pure) ──────────────────────────────────────
  const site = { host: 'jpmc.fa.oraclecloud.com', lang: 'en', siteNumber: 'CX_1002' };
  const sample = {
    items: [{
      TotalJobsCount: 2,
      requisitionList: [
        {
          Id: '210577366',
          Title: 'Client Service Associate',
          PrimaryLocation: 'Newark, DE, United States',
          PostedDate: '2026-07-15',
          WorkplaceTypeCode: 'ORA_ON_SITE',
          ShortDescriptionStr: 'Support the Private Bank &amp; clients',
        },
        {
          Id: '999',
          Title: 'Remote Engineer',
          WorkplaceTypeCode: 'ORA_REMOTE',
          workLocation: [{ TownOrCity: 'Austin', Region: 'TX', Country: 'United States' }],
          ExternalURL: 'https://jpmc.fa.oraclecloud.com/some/external/link',
        },
      ],
    }],
  };
  const jobs = parseOracleResponse(sample, site, 'JPMorgan Chase');
  if (jobs.length === 2) pass('parseOracleResponse extracts 2 jobs');
  else fail(`parseOracleResponse returned ${jobs.length} jobs`);

  if (jobs[0]?.url === 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/job/210577366') {
    pass('parseOracleResponse builds the /sites/<site>/job/<Id> URL when ExternalURL is absent');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[1]?.url === 'https://jpmc.fa.oraclecloud.com/some/external/link') {
    pass('parseOracleResponse prefers ExternalURL when present');
  } else {
    fail(`row 1 url = ${JSON.stringify(jobs[1]?.url)}`);
  }

  if (jobs[0]?.location === 'Newark, DE, United States') {
    pass('parseOracleResponse uses PrimaryLocation');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);
  }

  if (jobs[1]?.location === 'Austin, TX, United States · Remote') {
    pass('parseOracleResponse assembles location from workLocation + remote hint');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}`);
  }

  if (jobs[0]?.description === 'Support the Private Bank & clients') {
    pass('parseOracleResponse decodes HTML entities in the description');
  } else {
    fail(`row 0 description = ${JSON.stringify(jobs[0]?.description)}`);
  }

  if (typeof jobs[0]?.postedAt === 'number' && !Number.isNaN(jobs[0].postedAt)) {
    pass('parseOracleResponse parses PostedDate to an epoch number');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  // row without Id AND without ExternalURL → dropped (no linkable URL)
  const dropped = parseOracleResponse(
    { items: [{ requisitionList: [{ Title: 'No Id No URL' }, { Id: '1', Title: 'Keep' }] }] },
    site, 'X',
  );
  if (dropped.length === 1 && dropped[0].title === 'Keep') {
    pass('parseOracleResponse drops rows with no resolvable URL');
  } else {
    fail(`expected 1 kept row, got ${JSON.stringify(dropped)}`);
  }

  // RequisitionNumber fallback when Id is absent
  const reqNum = parseOracleResponse(
    { items: [{ requisitionList: [{ RequisitionNumber: 'R-42', Title: 'Fallback' }] }] },
    site, 'X',
  );
  if (reqNum.length === 1 && reqNum[0].url.endsWith('/job/R-42')) {
    pass('parseOracleResponse falls back to RequisitionNumber for the URL');
  } else {
    fail(`RequisitionNumber fallback = ${JSON.stringify(reqNum[0]?.url)}`);
  }

  // malformed / empty bodies → [] (no crash)
  const safe = [null, {}, { items: null }, { items: [] }, { items: [{ requisitionList: 'nope' }] }, 'string'];
  if (safe.every((b) => parseOracleResponse(b, site, 'X').length === 0)) {
    pass('parseOracleResponse returns [] for null/{}/{items:null}/non-array (no crash)');
  } else {
    fail('parseOracleResponse should be empty-safe on malformed bodies');
  }

  // ── fetch: normalization + redirect:error + trusted host ────────────
  let capturedUrl = null;
  let capturedOpts = null;
  const okJobs = await oc.fetch(
    { name: 'JPMC', careers_url: careers, max_pages: 1 },
    {
      transport: 'http',
      fetchText: async () => { throw new Error('fetchText should not be called'); },
      fetchJson: async (url, opts) => {
        capturedUrl = url; capturedOpts = opts;
        return { items: [{ TotalJobsCount: 1, requisitionList: [{ Id: '5', Title: 'Solo' }] }], hasMore: false };
      },
    },
  );
  if (capturedOpts?.redirect === 'error') pass('oraclecloud.fetch() passes redirect:"error"');
  else fail(`fetch opts.redirect = ${JSON.stringify(capturedOpts?.redirect)}`);

  if (capturedOpts?.headers?.['User-Agent'] && capturedOpts.headers.Accept === 'application/json') {
    pass('oraclecloud.fetch() sends browser UA + Accept: application/json');
  } else {
    fail(`fetch headers = ${JSON.stringify(capturedOpts?.headers)}`);
  }

  if (capturedUrl && hostOf(capturedUrl) === 'jpmc.fa.oraclecloud.com'
      && new URL(capturedUrl).pathname.startsWith('/hcmRestApi/')) {
    pass('oraclecloud.fetch() requests the trusted Oracle host');
  } else {
    fail(`fetch url = ${JSON.stringify(capturedUrl)}`);
  }

  if (okJobs.length === 1 && okJobs[0].title === 'Solo' && okJobs[0].url.endsWith('/job/5')) {
    pass('oraclecloud.fetch() normalizes to the Job shape');
  } else {
    fail(`fetch normalized = ${JSON.stringify(okJobs)}`);
  }

  // ── fetch: untrusted host throws BEFORE any network call ────────────
  // The provider derives its own URL from careers_url, so to exercise the
  // assertOracleUrl guard we can't easily inject a bad host through resolveSite
  // (it already rejects non-Oracle hosts). Instead assert the derive-failure
  // path: an undetectable entry throws the documented message.
  let fetchCalled = false;
  try {
    await oc.fetch(
      { name: 'BadCo', careers_url: 'https://example.com/careers' },
      { transport: 'http', fetchJson: async () => { fetchCalled = true; return {}; }, fetchText: async () => {} },
    );
    fail('oraclecloud.fetch() should throw for an undetectable entry');
  } catch (e) {
    if (/cannot derive API URL for BadCo/.test(e.message) && !fetchCalled) {
      pass('oraclecloud.fetch() throws "cannot derive API URL" before any fetch');
    } else {
      fail(`unexpected fetch error / fetchCalled=${fetchCalled}: ${e.message}`);
    }
  }

  // ── fetch: pagination (2 full pages then a short page) ──────────────
  let pageReqs = 0;
  const paged = await oc.fetch(
    { name: 'PagedCo', careers_url: careers },
    {
      transport: 'http',
      fetchText: async () => {},
      fetchJson: async (url) => {
        pageReqs++;
        const offset = parseInt(new URL(url).searchParams.get('offset') || '0', 10);
        if (offset === 0) {
          return { items: [{ TotalJobsCount: 450, requisitionList: Array.from({ length: 200 }, (_, i) => ({ Id: `A${i}`, Title: `Role ${i}` })) }], hasMore: true };
        }
        if (offset === 200) {
          return { items: [{ TotalJobsCount: 450, requisitionList: Array.from({ length: 200 }, (_, i) => ({ Id: `B${i}`, Title: `Role ${i}` })) }], hasMore: true };
        }
        // offset 400: short page (50) → stop
        return { items: [{ TotalJobsCount: 450, requisitionList: Array.from({ length: 50 }, (_, i) => ({ Id: `C${i}`, Title: `Role ${i}` })) }], hasMore: true };
      },
    },
  );
  if (pageReqs === 3 && paged.length === 450) {
    pass('oraclecloud.fetch() paginates by offset and aggregates (3 pages → 450)');
  } else {
    fail(`pagination: pageReqs=${pageReqs}, total=${paged.length} (expected 3 / 450)`);
  }

  // ── fetch: hasMore:false is IGNORED (unreliable on JPMC — false on every
  //    page despite 7000+ jobs). Pagination is driven by list length + total,
  //    so a full page with hasMore:false must still advance. ────────────────
  let hasMoreReqs = 0;
  const keepGoing = await oc.fetch(
    { name: 'HasMoreCo', careers_url: careers },
    {
      transport: 'http',
      fetchText: async () => {},
      fetchJson: async (url) => {
        hasMoreReqs++;
        const offset = parseInt(new URL(url).searchParams.get('offset') || '0', 10);
        // total 350: page 0 full (200), page 1 short (150) → stop after 2 pages,
        // even though every response says hasMore:false.
        const len = offset === 0 ? 200 : 150;
        return { items: [{ TotalJobsCount: 350, requisitionList: Array.from({ length: len }, (_, i) => ({ Id: `H${offset}-${i}`, Title: `R${i}` })) }], hasMore: false };
      },
    },
  );
  if (hasMoreReqs === 2 && keepGoing.length === 350) {
    pass('oraclecloud.fetch() ignores unreliable hasMore:false and paginates by list length/total');
  } else {
    fail(`hasMore-ignored: reqs=${hasMoreReqs}, total=${keepGoing.length} (expected 2 / 350)`);
  }

  // ── fetch: retry on a 429 then success (via injected ctx.sleep) ─────
  let attempts = 0;
  let slept = 0;
  const retried = await oc.fetch(
    { name: 'RetryCo', careers_url: careers, max_pages: 1 },
    {
      transport: 'http',
      sleep: async () => { slept++; },
      fetchText: async () => {},
      fetchJson: async () => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('HTTP 429'); err.status = 429; throw err;
        }
        return { items: [{ TotalJobsCount: 1, requisitionList: [{ Id: '7', Title: 'Recovered' }] }], hasMore: false };
      },
    },
  );
  if (attempts === 2 && slept === 1 && retried.length === 1 && retried[0].title === 'Recovered') {
    pass('oraclecloud.fetch() retries a 429 and recovers (via injected ctx.sleep)');
  } else {
    fail(`retry: attempts=${attempts}, slept=${slept}, jobs=${JSON.stringify(retried)}`);
  }

} catch (e) {
  fail(`oraclecloud provider tests crashed: ${e.message}`);
}
