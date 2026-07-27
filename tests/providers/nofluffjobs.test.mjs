// tests/providers/nofluffjobs.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — nofluffjobs');

try {
  const nofluffjobsModule = await import(pathToFileURL(join(ROOT, 'providers/nofluffjobs.mjs')).href);
  const nfj = nofluffjobsModule.default;
  const { parseNoFluffJobsResponse } = nofluffjobsModule;

  if (nfj.id === 'nofluffjobs') pass('nofluffjobs.id is "nofluffjobs"');
  else fail(`nofluffjobs.id is ${JSON.stringify(nfj.id)}`);

  if (nfj.detect({ name: 'NoFluff', careers_url: 'https://nofluffjobs.com/pl' })?.url) {
    pass('nofluffjobs.detect() matches nofluffjobs.com URL');
  } else {
    fail('nofluffjobs.detect() should match nofluffjobs.com URL');
  }

  if (nfj.detect({ name: 'X', careers_url: 'https://evil.example/nofluffjobs.com/pl' }) === null) {
    pass('nofluffjobs.detect() rejects path-spoofed URLs');
  } else {
    fail('nofluffjobs.detect() must reject path-spoofed URLs');
  }

  const fakeResponse = {
    postings: [
      {
        title: 'Frontend Engineer',
        name: 'ExampleCo',
        url: 'frontend-engineer-remote',
        posted: 1781270000000,
        fullyRemote: true,
        location: { places: [{ city: 'Kraków' }] },
      },
      { title: '', name: 'Broken', url: 'missing-title' },
      7,
    ],
    totalPages: 1,
  };

  const parsed = parseNoFluffJobsResponse(fakeResponse);
  if (parsed.length === 1) pass('nofluffjobs parser filters malformed rows');
  else fail(`nofluffjobs parser returned ${parsed.length} rows, expected 1`);

  if (parsed[0].title === 'Frontend Engineer' && parsed[0].url === 'https://nofluffjobs.com/pl/job/frontend-engineer-remote') {
    pass('nofluffjobs parser maps title and URL');
  } else {
    fail(`nofluffjobs parser mapped title/url incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  if (parsed[0].company === 'ExampleCo' && parsed[0].location === 'Remote, Kraków' && parsed[0].postedAt === 1781270000000) {
    pass('nofluffjobs parser maps company, location, and postedAt');
  } else {
    fail(`nofluffjobs parser mapped fields incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  let capturedUrl = '';
  let capturedOpts = null;
  const fetched = await nfj.fetch(
    { name: 'NoFluffJobs', careers_url: 'https://nofluffjobs.com/pl', max_pages: 1 },
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
  if (fetched.length === 1 && capturedUrl.startsWith('https://nofluffjobs.com/api/search/posting?')) {
    pass('nofluffjobs.fetch() uses search posting API endpoint');
  } else {
    fail(`nofluffjobs.fetch() endpoint/result wrong: ${capturedUrl} ${JSON.stringify(fetched)}`);
  }

  if (capturedOpts && capturedOpts.method === 'POST' && capturedOpts.redirect === 'error') {
    pass('nofluffjobs.fetch() uses POST and redirect:"error"');
  } else {
    fail(`nofluffjobs.fetch() should use POST and redirect:"error", got ${JSON.stringify(capturedOpts)}`);
  }

  let ssrfRejected = false;
  try {
    await nfj.fetch({ name: 'Evil', careers_url: 'https://evil.example/pl' }, { transport: 'http', fetchJson: async () => fakeResponse, fetchText: async () => '' });
  } catch (e) {
    if (e.message.includes('trusted nofluffjobs.com')) ssrfRejected = true;
  }
  if (ssrfRejected) pass('nofluffjobs.fetch() rejects untrusted host');
  else fail('nofluffjobs.fetch() should reject untrusted host');

  let badShape = false;
  try {
    parseNoFluffJobsResponse({ jobs: [] });
  } catch (e) {
    if (e.message.includes('unexpected API response')) badShape = true;
  }
  if (badShape) pass('nofluffjobs parser throws on bad response shape');
  else fail('nofluffjobs parser should throw on bad response shape');
} catch (e) {
  fail(`nofluffjobs provider tests crashed: ${e.message}`);
}

