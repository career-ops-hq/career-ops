// tests/providers/greenhouse.test.mjs — direct provider-contract tests (#1499).
// Covers the id/detect/fetch contract scan.mjs calls: api: precedence with the
// host allowlist, careers_url auto-detection, normalization from the
// boards-api JSON shape, and the guard chain running before any request.
// (Indirect coverage elsewhere: liveness tests exercise Greenhouse URL
// resolution; this file tests the provider module itself.)
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — greenhouse');

try {
  const greenhouseModule = await import(pathToFileURL(join(ROOT, 'providers/greenhouse.mjs')).href);
  const greenhouse = greenhouseModule.default;
  const { isWorkModelOnly, officesUrlFor, buildOfficeMap } = greenhouseModule;

  if (greenhouse.id === 'greenhouse') pass('greenhouse.id is "greenhouse"');
  else fail(`greenhouse.id is ${JSON.stringify(greenhouse.id)}`);

  // detect() — careers_url auto-detection (job-boards host → boards-api endpoint)
  const hit = greenhouse.detect({ name: 'Acme', careers_url: 'https://job-boards.greenhouse.io/acme' });
  if (hit && hit.url === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs') {
    pass('greenhouse.detect() resolves job-boards.greenhouse.io/<slug> → boards-api jobs endpoint');
  } else {
    fail(`greenhouse.detect() returned ${JSON.stringify(hit)}`);
  }

  const hitEu = greenhouse.detect({ name: 'EuCo', careers_url: 'https://job-boards.eu.greenhouse.io/euco' });
  if (hitEu && hitEu.url === 'https://boards-api.greenhouse.io/v1/boards/euco/jobs') {
    pass('greenhouse.detect() extracts the slug from a job-boards.eu.greenhouse.io careers_url');
  } else {
    fail(`greenhouse.detect(eu) returned ${JSON.stringify(hitEu)}`);
  }

  // detect() — api: takes precedence over careers_url and is used verbatim
  // when its host is on the allowlist.
  const hitApi = greenhouse.detect({
    name: 'Pinned',
    careers_url: 'https://www.pinned.example/careers',
    api: 'https://boards-api.greenhouse.io/v1/boards/pinned/jobs',
  });
  if (hitApi && hitApi.url === 'https://boards-api.greenhouse.io/v1/boards/pinned/jobs') {
    pass('greenhouse.detect() honors an allowlisted api: over a branded careers_url');
  } else {
    fail(`greenhouse.detect(api-pinned) returned ${JSON.stringify(hitApi)}`);
  }

  // detect() — api: with an untrusted host must NOT be claimed (SSRF guard).
  if (greenhouse.detect({ name: 'Evil', api: 'https://evil.example/v1/boards/acme/jobs' }) === null) {
    pass('greenhouse.detect() returns null for an api: on an untrusted host');
  } else {
    fail('greenhouse.detect() must reject an untrusted api: host');
  }

  // detect() — api: must be HTTPS.
  if (greenhouse.detect({ name: 'Insecure', api: 'http://boards-api.greenhouse.io/v1/boards/acme/jobs' }) === null) {
    pass('greenhouse.detect() returns null for a non-HTTPS api:');
  } else {
    fail('greenhouse.detect() must reject an http:// api:');
  }

  // detect() — malformed api: URL → null, not a crash.
  if (greenhouse.detect({ name: 'Broken', api: 'not a url' }) === null) {
    pass('greenhouse.detect() returns null for a malformed api: URL');
  } else {
    fail('greenhouse.detect() should treat a malformed api: as unclaimable');
  }

  // detect() — negative and non-string careers_url cases.
  if (greenhouse.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('greenhouse.detect() returns null for a non-greenhouse careers_url');
  } else {
    fail('greenhouse.detect() should return null for non-greenhouse URLs');
  }

  if (greenhouse.detect({ name: 'X' }) === null
      && greenhouse.detect({ name: 'X', careers_url: null }) === null
      && greenhouse.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('greenhouse.detect() returns null for missing / null / non-string careers_url');
  } else {
    fail('greenhouse.detect() should treat non-string careers_url as missing');
  }

  // fetch() — request URL, SSRF guard, and normalization from the real
  // boards-api shape: { jobs: [{ title, absolute_url, location: {name}, first_published }] }.
  const sample = {
    jobs: [
      {
        id: 101,
        title: 'Senior Backend Engineer',
        absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/101',
        location: { name: 'Berlin, Germany' },
        first_published: '2026-07-01T09:30:00-04:00',
      },
      {
        id: 102,
        // no title → '' ; no location → '' ; no first_published → postedAt undefined
        absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/102',
      },
      { id: 103, title: 'Ghost Role' },                                    // no absolute_url — dropped
      { id: 104, title: 'Bad Date', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/104', first_published: 'not-a-date' },
    ],
  };

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await greenhouse.fetch(
    { name: 'Acme', careers_url: 'https://job-boards.greenhouse.io/acme' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs' && capturedOpts?.redirect === 'error') {
    pass('greenhouse.fetch() hits the derived boards-api URL with redirect:"error" (SSRF guard)');
  } else {
    fail(`greenhouse.fetch() url=${JSON.stringify(capturedUrl)} opts=${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 3)
    pass('greenhouse.fetch() drops rows without absolute_url (3 of 4 kept)');
  else fail(`greenhouse.fetch() returned ${fetched.length} jobs (expected 3)`);

  if (fetched[0]?.title === 'Senior Backend Engineer'
      && fetched[0]?.url === 'https://job-boards.greenhouse.io/acme/jobs/101'
      && fetched[0]?.company === 'Acme'
      && fetched[0]?.location === 'Berlin, Germany'
      && fetched[0]?.postedAt === Date.parse('2026-07-01T09:30:00-04:00'))
    pass('greenhouse.fetch() maps title/absolute_url/entry.name/location.name/first_published');
  else fail(`greenhouse.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.title === '' && fetched[1]?.location === '' && fetched[1]?.postedAt === undefined)
    pass('greenhouse.fetch() defaults missing title/location to "" and omits postedAt when first_published is absent');
  else fail(`greenhouse.fetch() row 1 = ${JSON.stringify(fetched[1])}`);

  if (fetched[2]?.postedAt === undefined)
    pass('greenhouse.fetch() yields undefined postedAt for an unparseable first_published (NaN-safe)');
  else fail(`greenhouse.fetch() row 2 postedAt = ${JSON.stringify(fetched[2]?.postedAt)}`);

  // Epoch-0 first_published must survive (the `|| undefined` trap toEpochMs avoids).
  const epochZero = await greenhouse.fetch(
    { name: 'Acme', careers_url: 'https://job-boards.greenhouse.io/acme' },
    { fetchJson: async () => ({ jobs: [{ title: 'Old', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', first_published: '1970-01-01T00:00:00.000Z' }] }) },
  );
  if (epochZero[0]?.postedAt === 0)
    pass('greenhouse.fetch() preserves a valid epoch-0 first_published as postedAt 0');
  else fail(`greenhouse.fetch() epoch-0 postedAt = ${JSON.stringify(epochZero[0]?.postedAt)}`);

  // Malformed response bodies → empty result, no crash.
  const emptyCases = [null, {}, { jobs: null }, { jobs: 'nope' }];
  let emptyOk = true;
  for (const body of emptyCases) {
    const out = await greenhouse.fetch(
      { name: 'Acme', careers_url: 'https://job-boards.greenhouse.io/acme' },
      { fetchJson: async () => body },
    );
    if (!Array.isArray(out) || out.length !== 0) { emptyOk = false; fail(`greenhouse.fetch() body=${JSON.stringify(body)} → ${JSON.stringify(out)}`); break; }
  }
  if (emptyOk) pass('greenhouse.fetch() returns [] for null / {} / non-array jobs response bodies');

  // Guard chain runs BEFORE any request: an untrusted api: must throw without
  // ever calling fetchJson.
  let untrustedFetchCalled = false;
  try {
    await greenhouse.fetch(
      { name: 'Evil', api: 'https://evil.example/v1/boards/acme/jobs' },
      { fetchJson: async () => { untrustedFetchCalled = true; return { jobs: [] }; } },
    );
    fail('greenhouse.fetch() should throw for an untrusted api: host');
  } catch (e) {
    if (!untrustedFetchCalled && /untrusted hostname/.test(e.message)) {
      pass('greenhouse.fetch() throws on an untrusted api: host before any request is made');
    } else {
      fail(`greenhouse.fetch() untrusted api: fetchCalled=${untrustedFetchCalled}, error=${e.message}`);
    }
  }

  // ── Office enrichment (work-model-only locations) ─────────────────
  // Boards like Cloudflare put "Hybrid"/"In-Office"/"Distributed" in
  // location.name and the city in offices[], which /jobs does not return.

  if (isWorkModelOnly('Hybrid') && isWorkModelOnly('In-Office') && isWorkModelOnly('Distributed')
      && isWorkModelOnly('Distributed; Hybrid') && isWorkModelOnly(' remote '))
    pass('isWorkModelOnly() detects bare work-model strings, incl. ";"-joined and padded');
  else fail('isWorkModelOnly() missed a bare work-model string');

  if (!isWorkModelOnly('Hybrid - London') && !isWorkModelOnly('Remote (Canada)')
      && !isWorkModelOnly('Austin, TX') && !isWorkModelOnly('') && !isWorkModelOnly(null))
    pass('isWorkModelOnly() leaves locations that already carry geography (and empty/non-string) alone');
  else fail('isWorkModelOnly() wrongly claimed a location that carries geography');

  if (officesUrlFor('https://boards-api.greenhouse.io/v1/boards/acme/jobs') === 'https://boards-api.greenhouse.io/v1/boards/acme/offices'
      && officesUrlFor('https://boards-api.greenhouse.io/v1/boards/acme/jobs/123') === null)
    pass('officesUrlFor() maps a board jobs URL to /offices and declines a single-job URL');
  else fail(`officesUrlFor() = ${JSON.stringify(officesUrlFor('https://boards-api.greenhouse.io/v1/boards/acme/jobs'))}`);

  const officesBody = {
    offices: [
      {
        name: 'Austin, TX',
        departments: [{ jobs: [{ id: 201 }, { id: 202 }] }, { jobs: null }],
        children: [{ name: 'Seattle, WA', departments: [{ jobs: [{ id: 202 }] }] }],
      },
      { name: '', departments: [{ jobs: [{ id: 203 }] }] },   // unnamed office — skipped
      null,                                                    // malformed — skipped
    ],
  };
  const officeMap = buildOfficeMap(officesBody);
  if (officeMap.get(201)?.has('Austin, TX') && officeMap.get(202)?.size === 2
      && officeMap.get(202)?.has('Seattle, WA') && !officeMap.has(203))
    pass('buildOfficeMap() walks nested offices/departments, unions multi-office jobs, skips unnamed');
  else fail(`buildOfficeMap() = ${JSON.stringify([...officeMap].map(([k, v]) => [k, [...v]]))}`);

  if (buildOfficeMap(null).size === 0 && buildOfficeMap({ offices: 'nope' }).size === 0)
    pass('buildOfficeMap() returns an empty map for malformed bodies');
  else fail('buildOfficeMap() should tolerate malformed bodies');

  // End-to-end: a Cloudflare-shaped board gets its cities folded in.
  const requested = [];
  const enriched = await greenhouse.fetch(
    { name: 'Cloudflare', careers_url: 'https://job-boards.greenhouse.io/cloudflare' },
    {
      fetchJson: async (url) => {
        requested.push(url);
        if (url.endsWith('/offices')) return officesBody;
        return {
          jobs: [
            { id: 201, title: 'Systems Engineer', absolute_url: 'https://job-boards.greenhouse.io/cloudflare/jobs/201', location: { name: 'In-Office' } },
            { id: 202, title: 'Staff SWE', absolute_url: 'https://job-boards.greenhouse.io/cloudflare/jobs/202', location: { name: 'Distributed; Hybrid' } },
            { id: 999, title: 'Unmapped', absolute_url: 'https://job-boards.greenhouse.io/cloudflare/jobs/999', location: { name: 'Hybrid' } },
          ],
        };
      },
    },
  );

  if (requested.length === 2 && requested[1] === 'https://boards-api.greenhouse.io/v1/boards/cloudflare/offices')
    pass('greenhouse.fetch() requests /offices when the board reports work-model-only locations');
  else fail(`greenhouse.fetch() requested ${JSON.stringify(requested)}`);

  if (enriched[0]?.location === 'In-Office · Austin, TX')
    pass('greenhouse.fetch() folds the office city into a work-model-only location');
  else fail(`greenhouse.fetch() enriched row 0 location = ${JSON.stringify(enriched[0]?.location)}`);

  if (enriched[1]?.location === 'Distributed; Hybrid · Austin, TX · Seattle, WA')
    pass('greenhouse.fetch() folds every office of a multi-site role, " · "-joined');
  else fail(`greenhouse.fetch() enriched row 1 location = ${JSON.stringify(enriched[1]?.location)}`);

  if (enriched[2]?.location === 'Hybrid')
    pass('greenhouse.fetch() leaves a job absent from /offices on its bare work-model string');
  else fail(`greenhouse.fetch() enriched row 2 location = ${JSON.stringify(enriched[2]?.location)}`);

  // Cost guard: a board that already reports cities must not pay for /offices.
  const geoRequests = [];
  await greenhouse.fetch(
    { name: 'Datadog', careers_url: 'https://job-boards.greenhouse.io/datadog' },
    {
      fetchJson: async (url) => {
        geoRequests.push(url);
        return { jobs: [{ id: 1, title: 'SRE', absolute_url: 'https://job-boards.greenhouse.io/datadog/jobs/1', location: { name: 'Paris, France' } }] };
      },
    },
  );
  if (geoRequests.length === 1)
    pass('greenhouse.fetch() skips /offices entirely when locations already carry geography');
  else fail(`greenhouse.fetch() made ${geoRequests.length} requests for a geo-location board (expected 1)`);

  // Enrichment is best-effort: a failing /offices must not fail the scan, but
  // it must say so — a silent catch makes a systemic /offices regression
  // indistinguishable from a board that simply has no /offices.
  const degradedWarnings = [];
  const originalConsoleError = console.error;
  console.error = (m) => degradedWarnings.push(m);
  let degraded;
  try {
    degraded = await greenhouse.fetch(
      { name: 'Cloudflare', careers_url: 'https://job-boards.greenhouse.io/cloudflare' },
      {
        fetchJson: async (url) => {
          if (url.endsWith('/offices')) throw new Error('404');
          return { jobs: [{ id: 201, title: 'Systems Engineer', absolute_url: 'https://job-boards.greenhouse.io/cloudflare/jobs/201', location: { name: 'In-Office' } }] };
        },
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  if (degraded.length === 1 && degraded[0]?.location === 'In-Office')
    pass('greenhouse.fetch() degrades to the bare work-model string when /offices fails');
  else fail(`greenhouse.fetch() degraded = ${JSON.stringify(degraded)}`);

  if (degradedWarnings.some((w) => /greenhouse: Cloudflare .*404/.test(String(w))))
    pass('greenhouse.fetch() logs the board and cause when /offices enrichment fails');
  else fail(`greenhouse.fetch() should warn on failed enrichment, got: ${JSON.stringify(degradedWarnings)}`);

  // A promise may reject with a non-Error. Reading .message off null would
  // throw *inside* the catch and abort the whole board — the exact failure the
  // best-effort fallback exists to prevent.
  for (const thrown of [null, undefined, 'plain string', 42]) {
    const nonErrWarnings = [];
    const nonErrConsole = console.error;
    console.error = (m) => nonErrWarnings.push(m);
    let nonErrRows;
    let threw = null;
    try {
      nonErrRows = await greenhouse.fetch(
        { name: 'Cloudflare', careers_url: 'https://job-boards.greenhouse.io/cloudflare' },
        {
          fetchJson: async (url) => {
            if (url.endsWith('/offices')) throw thrown;
            return { jobs: [{ id: 201, title: 'Systems Engineer', absolute_url: 'https://job-boards.greenhouse.io/cloudflare/jobs/201', location: { name: 'In-Office' } }] };
          },
        },
      );
    } catch (e) {
      threw = e;
    } finally {
      console.error = nonErrConsole;
    }
    const label = String(thrown);
    if (!threw && nonErrRows?.length === 1 && nonErrRows[0]?.location === 'In-Office' && nonErrWarnings.length === 1)
      pass(`greenhouse.fetch() survives a non-Error /offices rejection (${label}) and still warns`);
    else fail(`greenhouse.fetch() non-Error rejection (${label}): threw=${threw?.message}, rows=${JSON.stringify(nonErrRows)}, warnings=${JSON.stringify(nonErrWarnings)}`);
  }

  // Underivable entry → typed error, no request.
  try {
    await greenhouse.fetch(
      { name: 'NoBoard', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { throw new Error('must not be called'); } },
    );
    fail('greenhouse.fetch() should throw when no API URL can be derived');
  } catch (e) {
    if (/cannot derive API URL for NoBoard/.test(e.message)) {
      pass('greenhouse.fetch() throws "cannot derive API URL" for an undetectable entry');
    } else {
      fail(`greenhouse.fetch() threw the wrong error: ${e.message}`);
    }
  }

} catch (e) {
  fail(`greenhouse provider tests crashed: ${e.message}`);
}
