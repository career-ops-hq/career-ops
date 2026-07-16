// tests/providers/bamboohr.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — bamboohr');

try {
  const bamboohrModule = await import(pathToFileURL(join(ROOT, 'providers/bamboohr.mjs')).href);
  const bamboohr = bamboohrModule.default;
  const { parseBambooHRResponse } = bamboohrModule;

  if (bamboohr.id === 'bamboohr') pass('bamboohr.id is "bamboohr"');
  else fail(`bamboohr.id is ${JSON.stringify(bamboohr.id)}`);

  // detect: <tenant>.bamboohr.com → /careers/list
  const hit = bamboohr.detect({ name: 'Acme', careers_url: 'https://acme.bamboohr.com/careers' });
  if (hit && hit.url === 'https://acme.bamboohr.com/careers/list') {
    pass('bamboohr.detect() resolves <tenant>.bamboohr.com → /careers/list');
  } else {
    fail(`bamboohr.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: honours an explicit api: URL
  const apiHit = bamboohr.detect({ name: 'Acme', api: 'https://acme.bamboohr.com' });
  if (apiHit && apiHit.url === 'https://acme.bamboohr.com/careers/list') pass('bamboohr.detect() honours explicit api: URL');
  else fail(`bamboohr.detect() api: returned ${JSON.stringify(apiHit)}`);

  // detect: null for non-bamboohr URLs
  if (bamboohr.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('bamboohr.detect() returns null for non-bamboohr URLs');
  } else {
    fail('bamboohr.detect() should return null for non-bamboohr URLs');
  }

  // detect: null for non-string careers_url
  if (bamboohr.detect({ name: 'X', careers_url: null }) === null && bamboohr.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('bamboohr.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('bamboohr.detect() should treat non-string careers_url as missing');
  }

  // SSRF: bamboohr.com in the PATH (not host) must not be detected.
  if (bamboohr.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.bamboohr.com/foo' }) === null) {
    pass('bamboohr.detect() rejects path-spoofed URLs');
  } else {
    fail('bamboohr.detect() must reject path-spoofed URLs');
  }

  // parseBambooHRResponse — real BambooHR list shape
  const sample = {
    meta: {},
    result: [
      { id: '15', jobOpeningName: 'IT Security Engineer', location: { city: 'Mayfair', state: 'London, City of' }, isRemote: null },
      { id: 22, jobOpeningName: 'Android Engineer', location: { city: 'Bengaluru', state: 'Karnataka' }, isRemote: 1 },
      { id: '7', jobOpeningName: '', location: { city: 'X' } },          // no title → dropped
      { jobOpeningName: 'No ID Role', location: { city: 'Y' } },          // no id → dropped
      { id: '   ', jobOpeningName: 'Blank ID Role', location: { city: 'Z' } }, // blank/whitespace id → dropped
    ],
  };
  const jobs = parseBambooHRResponse(sample, 'Acme', 'https://acme.bamboohr.com');
  if (jobs.length === 2) pass('parseBambooHRResponse keeps rows with non-empty id + title, drops the rest');
  else fail(`parseBambooHRResponse returned ${jobs.length} jobs (expected 2)`);

  if (!jobs.some(j => j.title === 'Blank ID Role')) pass('parseBambooHRResponse drops blank/whitespace-id rows (no /careers/ URL)');
  else fail('parseBambooHRResponse should drop blank/whitespace-id rows');

  if (jobs[0]?.url === 'https://acme.bamboohr.com/careers/15' && jobs[0]?.company === 'Acme') {
    pass('parseBambooHRResponse builds <origin>/careers/<id> URL');
  } else {
    fail(`parseBambooHRResponse url was ${jobs[0]?.url}`);
  }

  if (jobs[0]?.location === 'Mayfair, London, City of') pass('parseBambooHRResponse joins city + state');
  else fail(`parseBambooHRResponse location[0] was ${JSON.stringify(jobs[0]?.location)}`);

  if (jobs[1]?.location === 'Bengaluru, Karnataka, Remote') pass('parseBambooHRResponse appends Remote when isRemote is set');
  else fail(`parseBambooHRResponse location[1] was ${JSON.stringify(jobs[1]?.location)}`);

  if (jobs[1]?.url === 'https://acme.bamboohr.com/careers/22') pass('parseBambooHRResponse coerces numeric id to URL');
  else fail(`parseBambooHRResponse numeric-id url was ${jobs[1]?.url}`);

  // empty / malformed payloads → []
  if (parseBambooHRResponse({}, 'X', 'https://x.bamboohr.com').length === 0) pass('parseBambooHRResponse empty {} → []');
  else fail('parseBambooHRResponse should return [] for {}');
  if (parseBambooHRResponse({ result: null }, 'X', 'https://x.bamboohr.com').length === 0) pass('parseBambooHRResponse result:null → []');
  else fail('parseBambooHRResponse should return [] for result:null');

  // fetch() — via mock ctx, asserts the resolved URL + SSRF redirect pinning + parsing
  let fetchedUrl = '';
  let fetchedOpts;
  const mockCtx = {
    fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return sample; },
  };
  const fetched = await bamboohr.fetch({ name: 'Acme', careers_url: 'https://acme.bamboohr.com/careers' }, mockCtx);
  if (fetchedUrl === 'https://acme.bamboohr.com/careers/list' && fetchedOpts?.redirect === 'error' && fetched.length === 2) {
    pass('bamboohr.fetch() calls /careers/list with redirect:error and returns parsed jobs');
  } else {
    fail(`bamboohr.fetch() url=${fetchedUrl} redirect=${JSON.stringify(fetchedOpts)} jobs=${fetched.length}`);
  }

} catch (e) {
  fail(`bamboohr provider tests crashed: ${e.message}`);
}

