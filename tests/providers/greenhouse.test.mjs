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
