// tests/providers/pinpoint.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — pinpoint');


try {
  const pinpointModule = await import(pathToFileURL(join(ROOT, 'providers/pinpoint.mjs')).href);
  const pinpoint = pinpointModule.default;
  const { parsePinpointResponse } = pinpointModule;

  if (pinpoint.id === 'pinpoint') pass('pinpoint.id is "pinpoint"');
  else fail(`pinpoint.id is ${JSON.stringify(pinpoint.id)}`);

  // detect(): <slug>.pinpointhq.com careers_url → postings.json endpoint.
  const hit = pinpoint.detect({ name: 'Pinpoint', careers_url: 'https://workwithus.pinpointhq.com' });
  if (hit && hit.url === 'https://workwithus.pinpointhq.com/postings.json') {
    pass('pinpoint.detect() resolves <slug>.pinpointhq.com → postings.json');
  } else {
    fail(`pinpoint.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect() ignores the path/locale on the careers_url — endpoint is host-rooted.
  const hitWithPath = pinpoint.detect({ name: 'X', careers_url: 'https://acme.pinpointhq.com/en/jobs' });
  if (hitWithPath && hitWithPath.url === 'https://acme.pinpointhq.com/postings.json') {
    pass('pinpoint.detect() ignores careers_url path and roots postings.json at the host');
  } else {
    fail(`pinpoint.detect() with path returned ${JSON.stringify(hitWithPath)}`);
  }

  if (pinpoint.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('pinpoint.detect() returns null for non-pinpoint URLs');
  } else {
    fail('pinpoint.detect() should return null for non-pinpoint URLs');
  }

  // careers_url with non-string value → detect() returns null without crashing.
  if (pinpoint.detect({ name: 'X', careers_url: null }) === null && pinpoint.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('pinpoint.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('pinpoint.detect() should treat non-string careers_url as missing');
  }

  // SSRF: a URL with pinpointhq.com in the PATH (not host) must not be detected.
  if (pinpoint.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.pinpointhq.com/foo' }) === null) {
    pass('pinpoint.detect() rejects path-spoofed URLs');
  } else {
    fail('pinpoint.detect() must NOT misdetect path-spoofed URLs');
  }

  // SSRF: non-https careers_url must not be detected.
  if (pinpoint.detect({ name: 'Insecure', careers_url: 'http://acme.pinpointhq.com' }) === null) {
    pass('pinpoint.detect() rejects non-https careers_url');
  } else {
    fail('pinpoint.detect() must reject non-https careers_url');
  }

  // Hostname label must be a valid DNS label — not end (or start) with a hyphen.
  if (pinpoint.detect({ name: 'Trailing', careers_url: 'https://acme-.pinpointhq.com' }) === null
      && pinpoint.detect({ name: 'Leading', careers_url: 'https://-acme.pinpointhq.com' }) === null) {
    pass('pinpoint.detect() rejects tenant labels that start or end with a hyphen');
  } else {
    fail('pinpoint.detect() must reject hyphen-edged tenant labels (e.g. acme-.pinpointhq.com)');
  }

  // A hyphen in the middle of the label is still valid.
  if (pinpoint.detect({ name: 'Mid', careers_url: 'https://acme-co.pinpointhq.com' })?.url
      === 'https://acme-co.pinpointhq.com/postings.json') {
    pass('pinpoint.detect() still accepts internal hyphens (acme-co.pinpointhq.com)');
  } else {
    fail('pinpoint.detect() should accept internal hyphens in the tenant label');
  }

  // parsePinpointResponse — deterministic sample, no network.
  const sample = {
    data: [
      {
        title: 'Senior Product Manager',
        url: 'https://workwithus.pinpointhq.com/en/postings/abc-123',
        location: { id: '283', city: 'London', province: 'London', name: 'Remote' },
      },
      {
        title: '  Backend Engineer  ',                                   // trimmed
        url: '  https://workwithus.pinpointhq.com/en/postings/def-456  ', // trimmed
        location: { city: 'Berlin', province: 'Berlin' },                // no name → assembled
      },
      {
        title: 'No Location Role',
        url: 'https://workwithus.pinpointhq.com/en/postings/ghi-789',
        // location omitted → ''
      },
      { title: '', url: 'https://workwithus.pinpointhq.com/en/postings/jkl' }, // dropped: empty title
      { title: 'Missing URL Role' },                                          // dropped: no url
      { title: 'Relative URL Role', url: '/en/postings/mno' },                // dropped: non-absolute
      { title: 'Insecure URL Role', url: 'http://workwithus.pinpointhq.com/en/postings/pqr' }, // dropped: non-https
    ],
  };
  const jobs = parsePinpointResponse(sample, 'Pinpoint');

  if (jobs.length === 3) pass('parsePinpointResponse keeps 3 valid postings (drops empty-title / no-url / non-absolute / non-https)');
  else fail(`parsePinpointResponse returned ${jobs.length} postings (expected 3)`);

  // Normalized shape: exactly { title, url, company, location }.
  if (jobs[0] && Object.keys(jobs[0]).sort().join(',') === 'company,location,title,url') {
    pass('parsePinpointResponse returns the normalized { title, url, company, location } shape');
  } else {
    fail(`parsePinpointResponse row 0 keys = ${JSON.stringify(jobs[0] && Object.keys(jobs[0]))}`);
  }

  if (jobs[0]?.title === 'Senior Product Manager'
      && jobs[0]?.url === 'https://workwithus.pinpointhq.com/en/postings/abc-123'
      && jobs[0]?.company === 'Pinpoint'
      && jobs[0]?.location === 'Remote') {
    pass('parsePinpointResponse maps title/url, sets company from entry name, prefers location.name');
  } else {
    fail(`parsePinpointResponse row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.title === 'Backend Engineer'
      && jobs[1]?.url === 'https://workwithus.pinpointhq.com/en/postings/def-456') {
    pass('parsePinpointResponse trims whitespace from title and url');
  } else {
    fail(`parsePinpointResponse row 1 title/url = ${JSON.stringify({ title: jobs[1]?.title, url: jobs[1]?.url })}`);
  }

  if (jobs[1]?.location === 'Berlin, Berlin') {
    pass('parsePinpointResponse assembles location from city/province when name is absent');
  } else {
    fail(`parsePinpointResponse row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Berlin, Berlin"`);
  }

  if (jobs[2]?.location === '') {
    pass('parsePinpointResponse yields empty location when the location object is absent');
  } else {
    fail(`parsePinpointResponse row 2 location = ${JSON.stringify(jobs[2]?.location)}`);
  }

  if (parsePinpointResponse({}, 'X').length === 0) pass('parsePinpointResponse: empty {} → empty result');
  else fail('parsePinpointResponse: empty {} should yield empty result');

  if (parsePinpointResponse({ data: null }, 'X').length === 0) {
    pass('parsePinpointResponse: null data → empty result (no crash)');
  } else {
    fail('parsePinpointResponse: null data should yield empty result');
  }

  // fetch(): requests the derived postings.json URL and passes the SSRF guard.
  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await pinpoint.fetch(
    { name: 'Pinpoint', careers_url: 'https://workwithus.pinpointhq.com' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://workwithus.pinpointhq.com/postings.json') {
    pass('pinpoint.fetch() requests the derived postings.json URL');
  } else {
    fail(`pinpoint.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('pinpoint.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  } else {
    fail(`pinpoint.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 3 && fetched[0]?.company === 'Pinpoint') {
    pass('pinpoint.fetch() returns normalized jobs with company from entry name');
  } else {
    fail(`pinpoint.fetch() returned ${fetched.length} jobs, row 0 = ${JSON.stringify(fetched[0])}`);
  }

  // fetch(): a non-pinpoint careers_url cannot derive an endpoint → throws.
  let badEntryThrew = false;
  try {
    await pinpoint.fetch(
      { name: 'X', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => ({ data: [] }) },
    );
  } catch (e) {
    badEntryThrew = /cannot derive API URL/.test(e.message);
  }
  if (badEntryThrew) pass('pinpoint.fetch() throws when the careers_url is not a pinpointhq.com host');
  else fail('pinpoint.fetch() should throw for a non-pinpoint careers_url');

} catch (e) {
  fail(`pinpoint provider tests crashed: ${e.message}`);
}

