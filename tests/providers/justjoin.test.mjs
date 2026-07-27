// tests/providers/justjoin.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — justjoin');

try {
  const justjoinModule = await import(pathToFileURL(join(ROOT, 'providers/justjoin.mjs')).href);
  const jj = justjoinModule.default;
  const { parseJustJoinResponse } = justjoinModule;

  if (jj.id === 'justjoin') pass('justjoin.id is "justjoin"');
  else fail(`justjoin.id is ${JSON.stringify(jj.id)}`);

  if (jj.detect({ name: 'JustJoin', careers_url: 'https://justjoin.it/job-offers/all-locations' })?.url) {
    pass('justjoin.detect() matches job-offers URL');
  } else {
    fail('justjoin.detect() should match justjoin.it job-offers URL');
  }

  if (jj.detect({ name: 'X', careers_url: 'https://evil.example/justjoin.it/job-offers' }) === null) {
    pass('justjoin.detect() rejects path-spoofed URLs');
  } else {
    fail('justjoin.detect() must reject path-spoofed URLs');
  }

  if (jj.detect({ name: 'X', api: 'https://justjoin.it/api/candidate-api/offers/count' }) === null) {
    pass('justjoin.detect() rejects non-offers API paths');
  } else {
    fail('justjoin.detect() must reject non-offers API paths');
  }

  const fakeResponse = {
    data: [
      {
        slug: 'acme-senior-dev-warsaw-javascript',
        title: 'Senior Developer',
        companyName: 'Acme',
        workplaceType: 'remote',
        locations: [{ city: 'Warszawa' }],
        publishedAt: '2026-06-12T10:00:00.000Z',
      },
      { slug: '', title: 'Missing Slug', companyName: 'Broken' },
      null,
    ],
    meta: { next: { cursor: null } },
  };

  const parsed = parseJustJoinResponse(fakeResponse);
  if (parsed.length === 1) pass('justjoin parser filters malformed rows');
  else fail(`justjoin parser returned ${parsed.length} rows, expected 1`);

  if (parsed[0].title === 'Senior Developer' && parsed[0].url === 'https://justjoin.it/job-offer/acme-senior-dev-warsaw-javascript') {
    pass('justjoin parser maps title and URL');
  } else {
    fail(`justjoin parser mapped title/url incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  if (parsed[0].company === 'Acme' && parsed[0].location === 'remote, Warszawa' && typeof parsed[0].postedAt === 'number') {
    pass('justjoin parser maps company, location, and postedAt');
  } else {
    fail(`justjoin parser mapped fields incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  let capturedUrl = '';
  let capturedOpts = null;
  const fetched = await jj.fetch(
    { name: 'JustJoin', careers_url: 'https://justjoin.it/job-offers/all-locations', max_pages: 1 },
    {
      transport: 'http',
      fetchJson: async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return fakeResponse;
      },
      fetchText: async () => '',
    },
  );
  if (fetched.length === 1 && capturedUrl.startsWith('https://justjoin.it/api/candidate-api/offers?')) {
    pass('justjoin.fetch() uses candidate API endpoint');
  } else {
    fail(`justjoin.fetch() endpoint/result wrong: ${capturedUrl} ${JSON.stringify(fetched)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') pass('justjoin.fetch() passes redirect:"error"');
  else fail(`justjoin.fetch() should pass redirect:"error", got ${JSON.stringify(capturedOpts)}`);

  let ssrfRejected = false;
  try {
    await jj.fetch(
      { name: 'Evil', careers_url: 'https://evil.example/job-offers/all-locations' },
      {
        transport: 'http',
        fetchJson: async () => { throw new Error('SSRF! should not reach here'); },
        fetchText: async () => '',
      },
    );
  } catch (e) {
    if (e.message.includes('trusted justjoin.it')) ssrfRejected = true;
  }
  if (ssrfRejected) pass('justjoin.fetch() rejects untrusted host');
  else fail('justjoin.fetch() should reject untrusted host');

  let badShape = false;
  try {
    parseJustJoinResponse({ jobs: [] });
  } catch (e) {
    if (e.message.includes('unexpected API response')) badShape = true;
  }
  if (badShape) pass('justjoin parser throws on bad response shape');
  else fail('justjoin parser should throw on bad response shape');
} catch (e) {
  fail(`justjoin provider tests crashed: ${e.message}`);
}
