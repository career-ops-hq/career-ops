// tests/providers/rippling.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — rippling');

try {
  const ripplingModule = await import(pathToFileURL(join(ROOT, 'providers/rippling.mjs')).href);
  const rippling = ripplingModule.default;
  const { parseRipplingResponse } = ripplingModule;

  if (rippling.id === 'rippling') pass('rippling.id is "rippling"');
  else fail(`rippling.id is ${JSON.stringify(rippling.id)}`);

  // detect(): ats.rippling.com/<slug>/jobs → board API URL.
  const hit = rippling.detect({ name: 'Acme', careers_url: 'https://ats.rippling.com/acme-corp/jobs' });
  if (hit && hit.url === 'https://api.rippling.com/platform/api/ats/v1/board/acme-corp/jobs') {
    pass('rippling.detect() resolves ats.rippling.com/<slug>/jobs → board API URL');
  } else {
    fail(`rippling.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect() also works when careers_url is just /<slug> (no /jobs suffix).
  const hitNoJobs = rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/acme-corp' });
  if (hitNoJobs && hitNoJobs.url === 'https://api.rippling.com/platform/api/ats/v1/board/acme-corp/jobs') {
    pass('rippling.detect() derives the slug from the first path segment (no /jobs needed)');
  } else {
    fail(`rippling.detect() no-/jobs returned ${JSON.stringify(hitNoJobs)}`);
  }

  if (rippling.detect({ name: 'X', careers_url: 'https://example.com/acme/jobs' }) === null) {
    pass('rippling.detect() returns null for non-rippling hosts');
  } else {
    fail('rippling.detect() should return null for non-rippling hosts');
  }

  // careers_url with non-string value → detect() returns null without crashing.
  if (rippling.detect({ name: 'X', careers_url: null }) === null && rippling.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('rippling.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('rippling.detect() should treat non-string careers_url as missing');
  }

  // SSRF/format: non-https, empty path (no slug), and host-spoof in the path.
  if (rippling.detect({ name: 'X', careers_url: 'http://ats.rippling.com/acme/jobs' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://evil.example/ats.rippling.com/acme/jobs' }) === null) {
    pass('rippling.detect() rejects non-https, empty-path, and path-spoofed URLs');
  } else {
    fail('rippling.detect() must reject non-https / empty-path / path-spoofed URLs');
  }

  // Slug safety: a first segment that is not a clean token (space, dot, hyphen-edged) is rejected.
  if (rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/a%20b/jobs' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/acme.corp/jobs' }) === null
      && rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/-acme/jobs' }) === null) {
    pass('rippling.detect() rejects unsafe slugs (space, dot, leading hyphen)');
  } else {
    fail('rippling.detect() must reject unsafe slugs');
  }

  // Internal hyphens are valid.
  if (rippling.detect({ name: 'X', careers_url: 'https://ats.rippling.com/just-appraised-jobs/jobs' })?.url
      === 'https://api.rippling.com/platform/api/ats/v1/board/just-appraised-jobs/jobs') {
    pass('rippling.detect() accepts slugs with internal hyphens');
  } else {
    fail('rippling.detect() should accept internal hyphens in the slug');
  }

  // parseRipplingResponse — deterministic sample (top-level array).
  const sample = [
    { uuid: '1', name: 'Account Executive', url: 'https://ats.rippling.com/acme/jobs/uuid-1', department: { label: 'Sales' }, workLocation: { label: 'Remote (United States)', id: 'x' } },
    { uuid: '2', name: '  ML Engineer  ', url: '  https://ats.rippling.com/acme/jobs/uuid-2  ', workLocation: { label: 'Canada' } },
    { uuid: '3', name: 'String Loc Role', url: 'https://ats.rippling.com/acme/jobs/uuid-3', workLocation: 'New York' }, // workLocation as bare string
    { uuid: '4', name: 'No Loc Role', url: 'https://ats.rippling.com/acme/jobs/uuid-4', workLocation: null },           // null → ''
    { uuid: '5', name: '', url: 'https://ats.rippling.com/acme/jobs/uuid-5' },                                          // drop: empty name
    { uuid: '6', name: 'No URL Role' },                                                                                 // drop: no url
    { uuid: '7', name: 'Insecure', url: 'http://ats.rippling.com/acme/jobs/uuid-7' },                                   // drop: non-https
  ];
  const jobs = parseRipplingResponse(sample, 'Acme');

  if (jobs.length === 4) pass('parseRipplingResponse keeps 4 valid postings (drops empty-name / no-url / non-https)');
  else fail(`parseRipplingResponse returned ${jobs.length} postings (expected 4)`);

  if (jobs[0] && Object.keys(jobs[0]).sort().join(',') === 'company,location,title,url') {
    pass('parseRipplingResponse returns the normalized { title, url, company, location } shape');
  } else {
    fail(`parseRipplingResponse row 0 keys = ${JSON.stringify(jobs[0] && Object.keys(jobs[0]))}`);
  }

  if (jobs[0]?.title === 'Account Executive'
      && jobs[0]?.url === 'https://ats.rippling.com/acme/jobs/uuid-1'
      && jobs[0]?.company === 'Acme'
      && jobs[0]?.location === 'Remote (United States)') {
    pass('parseRipplingResponse maps name→title, url, company from entry name, workLocation.label→location');
  } else {
    fail(`parseRipplingResponse row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.title === 'ML Engineer' && jobs[1]?.url === 'https://ats.rippling.com/acme/jobs/uuid-2') {
    pass('parseRipplingResponse trims whitespace from name and url');
  } else {
    fail(`parseRipplingResponse row 1 title/url = ${JSON.stringify({ title: jobs[1]?.title, url: jobs[1]?.url })}`);
  }

  if (jobs[2]?.location === 'New York' && jobs[3]?.location === '') {
    pass('parseRipplingResponse accepts a bare-string workLocation and yields "" when workLocation is null');
  } else {
    fail(`parseRipplingResponse loc fallbacks = ${JSON.stringify({ str: jobs[2]?.location, none: jobs[3]?.location })}`);
  }

  if (parseRipplingResponse({}, 'X').length === 0 && parseRipplingResponse(null, 'X').length === 0) {
    pass('parseRipplingResponse: non-array input → empty result (no crash)');
  } else {
    fail('parseRipplingResponse should yield empty result for non-array input');
  }

  // Regression: the per-item url is host-locked to ats.rippling.com — an external
  // https URL is dropped, a valid ats.rippling.com posting URL is kept.
  const hostLocked = parseRipplingResponse(
    [
      { name: 'External Host', url: 'https://evil.example/acme/jobs/uuid-x' },
      { name: 'Valid Host', url: 'https://ats.rippling.com/acme/jobs/uuid-9' },
    ],
    'Acme',
  );
  if (hostLocked.length === 1 && hostLocked[0]?.title === 'Valid Host'
      && hostLocked[0]?.url === 'https://ats.rippling.com/acme/jobs/uuid-9') {
    pass('parseRipplingResponse host-locks the posting url to ats.rippling.com (drops external https URLs)');
  } else {
    fail(`parseRipplingResponse host-lock = ${JSON.stringify(hostLocked)}`);
  }

  // fetch(): requests the derived API URL and passes the SSRF guard.
  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await rippling.fetch(
    { name: 'Acme', careers_url: 'https://ats.rippling.com/acme-corp/jobs' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://api.rippling.com/platform/api/ats/v1/board/acme-corp/jobs') {
    pass('rippling.fetch() requests the derived board API URL');
  } else {
    fail(`rippling.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('rippling.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  } else {
    fail(`rippling.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 4 && fetched[0]?.company === 'Acme') {
    pass('rippling.fetch() returns normalized jobs with company from entry name');
  } else {
    fail(`rippling.fetch() returned ${fetched.length} jobs, row 0 = ${JSON.stringify(fetched[0])}`);
  }

  // fetch(): a non-rippling careers_url cannot derive an endpoint → throws.
  let badEntryThrew = false;
  try {
    await rippling.fetch(
      { name: 'X', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => [] },
    );
  } catch (e) {
    badEntryThrew = /cannot derive API URL/.test(e.message);
  }
  if (badEntryThrew) pass('rippling.fetch() throws when the careers_url is not an ats.rippling.com host');
  else fail('rippling.fetch() should throw for a non-rippling careers_url');

} catch (e) {
  fail(`rippling provider tests crashed: ${e.message}`);
}
