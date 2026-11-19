// tests/providers/nofluffjobs.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { buildWorkplacePolicy } from '../../providers/_country.mjs';

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
        location: { places: [{ city: 'Kraków', country: { name: 'Poland' } }] },
      },
      {
        title: 'Backend Engineer',
        name: 'ExampleCo',
        url: 'backend-engineer-remote',
        fullyRemote: true,
        location: { places: [{ city: 'Berlin', country: { name: 'Germany' } }] },
      },
      {
        title: 'Data Engineer',
        name: 'ExampleCo',
        url: 'data-engineer-remote',
        fullyRemote: true,
        location: { places: [] },
      },
      { title: '', name: 'Broken', url: 'missing-title' },
      7,
    ],
    totalPages: 1,
  };

  const parsed = parseNoFluffJobsResponse(fakeResponse);
  if (parsed.length === 3) pass('nofluffjobs parser filters malformed rows');
  else fail(`nofluffjobs parser returned ${parsed.length} rows, expected 3`);

  if (parsed[0].title === 'Frontend Engineer' && parsed[0].url === 'https://nofluffjobs.com/pl/job/frontend-engineer-remote') {
    pass('nofluffjobs parser maps title and URL');
  } else {
    fail(`nofluffjobs parser mapped title/url incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  if (parsed[0].company === 'ExampleCo' && parsed[0].location === 'Remote, Kraków, Poland' && parsed[0].postedAt === 1781270000000) {
    pass('nofluffjobs parser maps company, location, and postedAt');
  } else {
    fail(`nofluffjobs parser mapped fields incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  const polandPolicy = buildWorkplacePolicy({
    onsite_locations: ['Warsaw', 'Warszawa'],
    onsite_countries: ['Poland'],
    remote_countries: ['Poland'],
    remote_regions: ['EU', 'European Union'],
  });
  if (polandPolicy(parsed[0].location, parsed[0].title).eligible) {
    pass('remote Polish city posting retains country evidence for workplace policy');
  } else {
    fail('remote Polish city posting should pass the Poland workplace policy');
  }
  if (polandPolicy(parsed[1].location, parsed[1].title).reason === 'remote_country_restricted') {
    pass('remote German posting remains outside the Poland workplace policy');
  } else {
    fail('remote German posting should remain outside the Poland workplace policy');
  }
  if (polandPolicy(parsed[2].location, parsed[2].title).reason === 'remote_eligibility_unconfirmed') {
    pass('bare remote label remains unconfirmed without country evidence');
  } else {
    fail('bare remote label should remain unconfirmed without country evidence');
  }

  const multiPlace = parseNoFluffJobsResponse({
    postings: [{
      title: 'Backend Engineer',
      name: 'ExampleCo',
      url: 'backend-engineer-multiple-locations',
      location: {
        places: [
          { city: 'Warsaw' },
          { city: 'Berlin', country: { name: 'Germany' } },
        ],
      },
    }],
  })[0];
  if (multiPlace.location === 'Warsaw; Berlin, Germany' && polandPolicy(multiPlace.location, multiPlace.title).eligible) {
    pass('multiple places keep country evidence scoped to its city');
  } else {
    fail(`multiple places should retain distinct city-country groups: ${JSON.stringify(multiPlace)}`);
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
  if (fetched.length === 3 && capturedUrl.startsWith('https://nofluffjobs.com/api/search/posting?')) {
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

