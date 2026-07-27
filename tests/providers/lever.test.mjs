// tests/providers/lever.test.mjs — direct provider-contract tests (#1499).
// Covers the id/detect/fetch contract scan.mjs calls: hostname-anchored
// detection for both jobs.lever.co and jobs.eu.lever.co, normalization from
// the v0 postings shape (including the free descriptionPlain for
// content_filter), and malformed-input tolerance.
// (Indirect coverage elsewhere: tests/providers/ats-ssrf-hardening.test.mjs
// asserts the redirect:'error' guard per instance; liveness tests cover URL
// resolution. This file tests the provider module contract itself.)
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — lever');

try {
  const leverModule = await import(pathToFileURL(join(ROOT, 'providers/lever.mjs')).href);
  const lever = leverModule.default;

  if (lever.id === 'lever') pass('lever.id is "lever"');
  else fail(`lever.id is ${JSON.stringify(lever.id)}`);

  // detect() — positive cases, both instances.
  const hit = lever.detect({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' });
  if (hit && hit.url === 'https://api.lever.co/v0/postings/acme') {
    pass('lever.detect() resolves jobs.lever.co/<slug> → api.lever.co postings endpoint');
  } else {
    fail(`lever.detect() returned ${JSON.stringify(hit)}`);
  }

  const hitEu = lever.detect({ name: 'EuCo', careers_url: 'https://jobs.eu.lever.co/euco/some-posting' });
  if (hitEu && hitEu.url === 'https://api.eu.lever.co/v0/postings/euco') {
    pass('lever.detect() resolves jobs.eu.lever.co → api.eu.lever.co and takes the first path segment as slug');
  } else {
    fail(`lever.detect(eu) returned ${JSON.stringify(hitEu)}`);
  }

  // detect() — negative / spoof / degenerate cases.
  if (lever.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('lever.detect() returns null for a non-lever careers_url');
  } else {
    fail('lever.detect() should return null for non-lever URLs');
  }

  if (lever.detect({ name: 'Spoof', careers_url: 'https://jobs.lever.co.evil.example/acme' }) === null) {
    pass('lever.detect() rejects a hostname-suffix spoof (jobs.lever.co.evil.example)');
  } else {
    fail('lever.detect() must NOT detect hostname-suffix spoofs');
  }

  if (lever.detect({ name: 'PathSpoof', careers_url: 'https://evil.example/jobs.lever.co/acme' }) === null) {
    pass('lever.detect() rejects a path-spoofed URL (lever host in path, not hostname)');
  } else {
    fail('lever.detect() must NOT detect path-spoofed URLs');
  }

  if (lever.detect({ name: 'NoSlug', careers_url: 'https://jobs.lever.co/' }) === null) {
    pass('lever.detect() returns null when the URL has no board slug');
  } else {
    fail('lever.detect() should return null for a slug-less lever URL');
  }

  if (lever.detect({ name: 'X' }) === null
      && lever.detect({ name: 'X', careers_url: null }) === null
      && lever.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('lever.detect() returns null for missing / null / non-string careers_url');
  } else {
    fail('lever.detect() should treat non-string careers_url as missing');
  }

  // detect() — api: takes precedence over careers_url and is used verbatim
  // when its host is on the allowlist. Lets an entry keep a human-facing
  // corporate careers_url (e.g. https://www.coalfire.com/careers) while
  // pinning the Lever board explicitly.
  const hitApi = lever.detect({
    name: 'Pinned',
    careers_url: 'https://www.coalfire.com/careers',
    api: 'https://api.lever.co/v0/postings/coalfire',
  });
  if (hitApi && hitApi.url === 'https://api.lever.co/v0/postings/coalfire') {
    pass('lever.detect() honors an allowlisted api: over a branded careers_url');
  } else {
    fail(`lever.detect(api-pinned) returned ${JSON.stringify(hitApi)}`);
  }

  // detect() — api: on the EU host is also allowlisted.
  const hitApiEu = lever.detect({ name: 'PinnedEu', api: 'https://api.eu.lever.co/v0/postings/euco' });
  if (hitApiEu && hitApiEu.url === 'https://api.eu.lever.co/v0/postings/euco') {
    pass('lever.detect() honors an allowlisted api: on the EU host');
  } else {
    fail(`lever.detect(api-pinned-eu) returned ${JSON.stringify(hitApiEu)}`);
  }

  // detect() — api: with an untrusted host must NOT be claimed (SSRF guard).
  if (lever.detect({ name: 'Evil', api: 'https://evil.example/v0/postings/acme' }) === null) {
    pass('lever.detect() returns null for an api: on an untrusted host');
  } else {
    fail('lever.detect() must reject an untrusted api: host');
  }

  // detect() — api: must be HTTPS.
  if (lever.detect({ name: 'Insecure', api: 'http://api.lever.co/v0/postings/acme' }) === null) {
    pass('lever.detect() returns null for a non-HTTPS api:');
  } else {
    fail('lever.detect() must reject an http:// api:');
  }

  // detect() — malformed api: URL → null, not a crash.
  if (lever.detect({ name: 'Broken', api: 'not a url' }) === null) {
    pass('lever.detect() returns null for a malformed api: URL');
  } else {
    fail('lever.detect() must reject a malformed api: URL');
  }

  // fetch() — request URL, SSRF guard, and normalization from the real v0
  // postings shape: [{ text, hostedUrl, categories: {location}, descriptionPlain, createdAt }].
  const sample = [
    {
      text: 'Staff Platform Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/1111-staff-platform-engineer',
      categories: { location: 'Remote — Europe', team: 'Platform', commitment: 'Full-time' },
      descriptionPlain: 'Build the platform that powers everything.',
      createdAt: 1751328000000,
    },
    {
      // no text/hostedUrl → '' ; no categories → location '' ;
      // descriptionPlain non-string → '' ; createdAt non-number → undefined
      descriptionPlain: { html: true },
      createdAt: '2026-07-01',
    },
    {},                                                                   // fully empty posting object
  ];

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await lever.fetch(
    { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://api.lever.co/v0/postings/acme' && capturedOpts?.redirect === 'error') {
    pass('lever.fetch() hits the derived api.lever.co URL with redirect:"error" (SSRF guard)');
  } else {
    fail(`lever.fetch() url=${JSON.stringify(capturedUrl)} opts=${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 3)
    pass('lever.fetch() returns one normalized row per posting (no silent drops)');
  else fail(`lever.fetch() returned ${fetched.length} rows (expected 3)`);

  if (fetched[0]?.title === 'Staff Platform Engineer'
      && fetched[0]?.url === 'https://jobs.lever.co/acme/1111-staff-platform-engineer'
      && fetched[0]?.company === 'Acme'
      && fetched[0]?.location === 'Remote — Europe'
      && fetched[0]?.description === 'Build the platform that powers everything.'
      && fetched[0]?.postedAt === 1751328000000)
    pass('lever.fetch() maps text/hostedUrl/entry.name/categories.location/descriptionPlain/createdAt');
  else fail(`lever.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.description === '' && fetched[1]?.postedAt === undefined)
    pass('lever.fetch() coerces a non-string descriptionPlain to "" and a non-number createdAt to undefined');
  else fail(`lever.fetch() row 1 = ${JSON.stringify(fetched[1])}`);

  if (fetched[2]?.title === '' && fetched[2]?.url === '' && fetched[2]?.location === ''
      && fetched[2]?.company === 'Acme' && fetched[2]?.description === '' && fetched[2]?.postedAt === undefined)
    pass('lever.fetch() maps an empty posting object to empty-string fields without crashing');
  else fail(`lever.fetch() row 2 = ${JSON.stringify(fetched[2])}`);

  // Non-array response bodies → [], no crash.
  const emptyCases = [null, {}, { postings: [] }, 'nope'];
  let emptyOk = true;
  for (const body of emptyCases) {
    const out = await lever.fetch(
      { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
      { fetchJson: async () => body },
    );
    if (!Array.isArray(out) || out.length !== 0) { emptyOk = false; fail(`lever.fetch() body=${JSON.stringify(body)} → ${JSON.stringify(out)}`); break; }
  }
  if (emptyOk) pass('lever.fetch() returns [] for non-array response bodies (null / {} / string)');

  // fetch() — a pinned api: is used verbatim, bypassing careers_url parsing entirely.
  let pinnedUrl = null;
  await lever.fetch(
    { name: 'Coalfire', careers_url: 'https://www.coalfire.com/careers', api: 'https://api.lever.co/v0/postings/coalfire' },
    { fetchJson: async (url) => { pinnedUrl = url; return []; } },
  );
  if (pinnedUrl === 'https://api.lever.co/v0/postings/coalfire') {
    pass('lever.fetch() honors a pinned api: over a non-lever careers_url');
  } else {
    fail(`lever.fetch() pinned api: requested ${JSON.stringify(pinnedUrl)}`);
  }

  // fetch() — an untrusted api: host throws before any request (SSRF guard).
  let evilFetchCalled = false;
  try {
    await lever.fetch(
      { name: 'Evil', api: 'https://evil.example/v0/postings/acme' },
      { fetchJson: async () => { evilFetchCalled = true; return []; } },
    );
    fail('lever.fetch() should throw for an untrusted api: host');
  } catch (e) {
    if (!evilFetchCalled && /untrusted hostname/.test(e.message)) {
      pass('lever.fetch() rejects an untrusted api: host before fetching');
    } else {
      fail(`lever.fetch() untrusted api: fetchCalled=${evilFetchCalled}, error=${e.message}`);
    }
  }

  // Underivable entry → typed error before any request.
  try {
    await lever.fetch(
      { name: 'NoBoard', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { throw new Error('must not be called'); } },
    );
    fail('lever.fetch() should throw when no API URL can be derived');
  } catch (e) {
    if (/cannot derive API URL for NoBoard/.test(e.message)) {
      pass('lever.fetch() throws "cannot derive API URL" before fetching for an undetectable entry');
    } else {
      fail(`lever.fetch() threw the wrong error: ${e.message}`);
    }
  }

} catch (e) {
  fail(`lever provider tests crashed: ${e.message}`);
}
