// tests/providers/solidjobs.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — solidjobs');

try {
  const sj = (await import(pathToFileURL(join(ROOT, 'providers/solidjobs.mjs')).href)).default;

  if (sj.id === 'solidjobs') pass('solidjobs.id is "solidjobs"');
  else fail(`solidjobs.id is ${JSON.stringify(sj.id)}`);

  // detect() matches valid SolidJobs API URL
  const hit = sj.detect({ name: 'SJ', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' });
  if (hit && hit.url) pass('solidjobs.detect() matches valid API URL');
  else fail('solidjobs.detect() should match solid.jobs public-api URL');

  // detect() rejects non-SolidJobs URL
  if (sj.detect({ name: 'X', careers_url: 'https://example.com/jobs' }) === null) {
    pass('solidjobs.detect() rejects non-SolidJobs URL');
  } else {
    fail('solidjobs.detect() must reject non-SolidJobs URLs');
  }

  // detect() rejects path-spoofed URL (solid.jobs in path, not hostname)
  if (sj.detect({ name: 'X', careers_url: 'https://evil.example/solid.jobs/public-api/offers/it' }) === null) {
    pass('solidjobs.detect() rejects path-spoofed URLs');
  } else {
    fail('solidjobs.detect() must NOT misdetect URLs with solid.jobs in the path');
  }

  // detect() returns null for non-string careers_url
  if (sj.detect({ name: 'X', careers_url: 42 }) === null) {
    pass('solidjobs.detect() returns null for non-string careers_url (42)');
  } else {
    fail('solidjobs.detect() should treat non-string careers_url as missing');
  }

  // detect() returns null for missing careers_url
  if (sj.detect({ name: 'X' }) === null) {
    pass('solidjobs.detect() returns null for missing careers_url');
  } else {
    fail('solidjobs.detect() should return null when careers_url is missing');
  }

  // fetch() parses { jobs: [...] } response with company from API
  const fakeJobs = {
    jobs: [
      { title: 'Senior Dev', url: 'https://solid.jobs/o/abc123/career-ops', company: 'Acme Corp', locations: ['Warszawa', 'Remote'] },
      { title: 'Junior Dev', url: 'https://solid.jobs/o/def456/career-ops', company: 'Beta Inc', locations: ['Kraków'] },
    ],
  };
  const parsed = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => fakeJobs, fetchText: async () => '' },
  );
  if (parsed.length === 2) pass('solidjobs.fetch() returns 2 jobs from mock response');
  else fail(`solidjobs.fetch() returned ${parsed.length} jobs, expected 2`);

  if (parsed[0].company === 'Acme Corp') pass('solidjobs.fetch() uses j.company from API response');
  else fail(`solidjobs.fetch() company is ${JSON.stringify(parsed[0].company)}, expected "Acme Corp"`);

  if (parsed[0].location === 'Warszawa, Remote') pass('solidjobs.fetch() joins locations array');
  else fail(`solidjobs.fetch() location is ${JSON.stringify(parsed[0].location)}, expected "Warszawa, Remote"`);

  if (parsed[0].title === 'Senior Dev' && parsed[0].url === 'https://solid.jobs/o/abc123/career-ops') {
    pass('solidjobs.fetch() maps title and url correctly');
  } else {
    fail(`solidjobs.fetch() title/url wrong: ${JSON.stringify(parsed[0])}`);
  }

  // fetch() falls back to entry.name when j.company is missing
  const noCompanyJobs = { jobs: [{ title: 'Tester', url: 'https://solid.jobs/o/xyz/career-ops', locations: [] }] };
  const fallback = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => noCompanyJobs, fetchText: async () => '' },
  );
  if (fallback[0].company === 'SolidJobs IT') pass('solidjobs.fetch() falls back to entry.name when j.company missing');
  else fail(`solidjobs.fetch() fallback company is ${JSON.stringify(fallback[0].company)}`);

  // fetch() handles empty locations array
  if (fallback[0].location === '') pass('solidjobs.fetch() returns empty string for empty locations array');
  else fail(`solidjobs.fetch() location for empty array is ${JSON.stringify(fallback[0].location)}`);

  // fetch() rejects non-SolidJobs hostname (SSRF)
  let ssrfRejected = false;
  try {
    await sj.fetch(
      { name: 'Evil', careers_url: 'https://evil.com/public-api/offers/it' },
      { transport: 'http', fetchJson: async () => { throw new Error('SSRF! should not reach here'); }, fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('untrusted hostname')) ssrfRejected = true;
    else fail(`solidjobs.fetch() rejected with wrong error: ${e.message}`);
  }
  if (ssrfRejected) pass('solidjobs.fetch() rejects untrusted hostname (SSRF protection)');
  else fail('solidjobs.fetch() should reject non-solid.jobs hostnames');

  // fetch() throws on missing careers_url
  let missingUrl = false;
  try {
    await sj.fetch(
      { name: 'No URL' },
      { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('careers_url required')) missingUrl = true;
    else fail(`solidjobs.fetch() missing URL error: ${e.message}`);
  }
  if (missingUrl) pass('solidjobs.fetch() throws on missing careers_url');
  else fail('solidjobs.fetch() should throw when careers_url is missing');

  // fetch() rejects HTTP (non-HTTPS) URL
  let httpRejected = false;
  try {
    await sj.fetch(
      { name: 'HTTP', careers_url: 'http://solid.jobs/public-api/offers/it' },
      { transport: 'http', fetchJson: async () => { throw new Error('should not reach here'); }, fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('HTTPS')) httpRejected = true;
    else fail(`solidjobs.fetch() HTTP rejection wrong error: ${e.message}`);
  }
  if (httpRejected) pass('solidjobs.fetch() rejects HTTP URLs (HTTPS enforcement)');
  else fail('solidjobs.fetch() should reject non-HTTPS URLs');

  // fetch() rejects malformed/unparseable URL
  let malformedRejected = false;
  try {
    await sj.fetch(
      { name: 'Bad', careers_url: 'not-a-url' },
      { transport: 'http', fetchJson: async () => { throw new Error('should not reach here'); }, fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('invalid URL')) malformedRejected = true;
    else fail(`solidjobs.fetch() malformed URL wrong error: ${e.message}`);
  }
  if (malformedRejected) pass('solidjobs.fetch() rejects malformed URLs');
  else fail('solidjobs.fetch() should reject unparseable URLs');

  // fetch() throws on unexpected API response (no jobs array)
  const badResponses = [
    [{}, 'empty object'],
    [{ jobs: null }, 'jobs: null'],
    [{ jobs: 'not-array' }, 'jobs: string'],
    [{ offers: [] }, 'wrong key name'],
    [null, 'null response'],
  ];
  for (const [resp, label] of badResponses) {
    let threw = false;
    try {
      await sj.fetch(
        { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
        { transport: 'http', fetchJson: async () => resp, fetchText: async () => '' },
      );
    } catch (e) {
      if (e.message.includes('unexpected API response')) threw = true;
      else fail(`solidjobs.fetch() bad response (${label}) wrong error: ${e.message}`);
    }
    if (threw) pass(`solidjobs.fetch() throws on bad API response (${label})`);
    else fail(`solidjobs.fetch() should throw on bad API response (${label})`);
  }

  // fetch() filters out jobs with empty/missing url
  const mixedJobs = {
    jobs: [
      { title: 'Has URL', url: 'https://solid.jobs/o/1/career-ops', company: 'A', locations: [] },
      { title: 'No URL', url: '', company: 'B', locations: [] },
      { title: 'Missing URL', company: 'C', locations: [] },
    ],
  };
  const filtered = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => mixedJobs, fetchText: async () => '' },
  );
  if (filtered.length === 1 && filtered[0].title === 'Has URL') pass('solidjobs.fetch() filters out jobs with empty/missing url');
  else fail(`solidjobs.fetch() should filter empty URLs, got ${filtered.length} jobs: ${JSON.stringify(filtered)}`);

  // fetch() handles string locations (non-array)
  const stringLocJobs = { jobs: [{ title: 'Dev', url: 'https://solid.jobs/o/2/career-ops', company: 'X', locations: 'Warsaw' }] };
  const strLoc = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => stringLocJobs, fetchText: async () => '' },
  );
  if (strLoc[0].location === 'Warsaw') pass('solidjobs.fetch() handles string locations');
  else fail(`solidjobs.fetch() string location is ${JSON.stringify(strLoc[0].location)}, expected "Warsaw"`);

  // detect() returns null for valid hostname but wrong path
  if (sj.detect({ name: 'X', careers_url: 'https://solid.jobs/careers' }) === null) {
    pass('solidjobs.detect() rejects solid.jobs URL with wrong path');
  } else {
    fail('solidjobs.detect() should reject solid.jobs URLs not under /public-api/offers/');
  }

  // fetch() passes redirect:'error' to fetchJson
  let capturedOpts = null;
  await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async (_url, opts) => { capturedOpts = opts; return { jobs: [] }; }, fetchText: async () => '' },
  );
  if (capturedOpts && capturedOpts.redirect === 'error') pass('solidjobs.fetch() passes redirect:"error" to fetchJson');
  else fail(`solidjobs.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  // fetch() tolerates malformed array members without crashing
  const malformedMembers = { jobs: [null, 7, { title: 'OK', url: 'https://solid.jobs/o/3/career-ops', company: 'Z' }] };
  const safeParsed = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => malformedMembers, fetchText: async () => '' },
  );
  if (safeParsed.length === 1 && safeParsed[0].url === 'https://solid.jobs/o/3/career-ops') {
    pass('solidjobs.fetch() skips malformed jobs members without crashing');
  } else {
    fail(`solidjobs.fetch() malformed members handling failed: ${JSON.stringify(safeParsed)}`);
  }
} catch (e) {
  fail(`solidjobs provider tests crashed: ${e.message}`);
}

