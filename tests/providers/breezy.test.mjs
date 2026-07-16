// tests/providers/breezy.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — breezy');


try {
  const breezyModule = await import(pathToFileURL(join(ROOT, 'providers/breezy.mjs')).href);
  const breezy = breezyModule.default;
  const { parseBreezyResponse } = breezyModule;

  if (breezy.id === 'breezy') pass('breezy.id is "breezy"');
  else fail(`breezy.id is ${JSON.stringify(breezy.id)}`);

  // detect: careers_url with a path still resolves the tenant /json feed
  const hit = breezy.detect({ name: 'New Incentives', careers_url: 'https://new-incentives.breezy.hr/' });
  if (hit && hit.url === 'https://new-incentives.breezy.hr/json') {
    pass('breezy.detect() resolves <tenant>.breezy.hr → /json feed');
  } else {
    fail(`breezy.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: explicit api: URL is honoured over careers_url
  const apiHit = breezy.detect({ name: 'X', api: 'https://acme.breezy.hr', careers_url: 'https://example.com' });
  if (apiHit && apiHit.url === 'https://acme.breezy.hr/json') {
    pass('breezy.detect() honours an explicit api: URL');
  } else {
    fail(`breezy.detect() api: → ${JSON.stringify(apiHit)}`);
  }

  if (breezy.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('breezy.detect() returns null for non-breezy URLs');
  } else {
    fail('breezy.detect() should return null for non-breezy URLs');
  }

  if (breezy.detect({ name: 'X', careers_url: null }) === null && breezy.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('breezy.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('breezy.detect() should treat non-string careers_url as missing');
  }

  // SSRF: breezy.hr in the PATH (not host) must not be detected.
  if (breezy.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.breezy.hr/json' }) === null) {
    pass('breezy.detect() rejects path-spoofed URLs');
  } else {
    fail('breezy.detect() must NOT misdetect path-spoofed URLs');
  }

  // parseBreezyResponse — top-level array
  const sample = [
    {
      name: 'Assistant Field Manager',
      url: 'https://new-incentives.breezy.hr/p/b8e6-assistant-field-manager',
      published_date: '2026-05-25T14:45:23.799Z',
      location: { name: 'Niger, Sokoto, NG', city: 'Niger', country: { name: 'NG' }, is_remote: false },
    },
    {
      name: 'Remote Backend Engineer',
      url: 'https://new-incentives.breezy.hr/p/aa01-backend',
      location: { city: 'Lagos', state: 'Lagos', country: { name: 'NG' }, is_remote: true },
    },
    { name: 'No URL row', location: { name: 'Remote' } },
    { name: 'Insecure URL', url: 'http://new-incentives.breezy.hr/p/x', location: {} },
  ];
  const jobs = parseBreezyResponse(sample, 'New Incentives');

  if (jobs.length === 2) pass('parseBreezyResponse keeps 2 rows (drops missing/non-https url)');
  else fail(`parseBreezyResponse returned ${jobs.length} rows (expected 2)`);

  if (jobs[0]?.title === 'Assistant Field Manager' && jobs[0]?.company === 'New Incentives' && jobs[0]?.location === 'Niger, Sokoto, NG') {
    pass('parseBreezyResponse prefers ready-made location.name');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-05-25T14:45:23.799Z')) {
    pass('parseBreezyResponse parses published_date → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.location === 'Lagos, Lagos, NG, Remote') {
    pass('parseBreezyResponse assembles city/state/country and appends Remote');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Lagos, Lagos, NG, Remote"`);
  }

  if (jobs[1]?.postedAt === undefined) {
    pass('parseBreezyResponse omits postedAt when published_date is absent');
  } else {
    fail(`row 1 postedAt should be undefined, got ${JSON.stringify(jobs[1]?.postedAt)}`);
  }

  if (parseBreezyResponse(null, 'X').length === 0 && parseBreezyResponse({}, 'X').length === 0) {
    pass('non-array payload → empty result (no crash)');
  } else {
    fail('non-array payload should yield empty result');
  }

  // a row already containing "Remote" must not get a duplicate "Remote" suffix
  const noDup = parseBreezyResponse([{ name: 'R', url: 'https://acme.breezy.hr/p/r', location: { name: 'Remote, EMEA', is_remote: true } }], 'X');
  if (noDup[0]?.location === 'Remote, EMEA') pass('parseBreezyResponse does not double-append Remote');
  else fail(`expected "Remote, EMEA", got ${JSON.stringify(noDup[0]?.location)}`);

} catch (e) {
  fail(`breezy provider tests crashed: ${e.message}`);
}

