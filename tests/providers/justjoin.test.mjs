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

  const dated = parseJustJoinResponse({
    data: [
      { slug: 'acme-refreshed', title: 'Refreshed', publishedAt: '2026-06-12T10:00:00.000Z', lastPublishedAt: '2026-05-20T08:00:00.000Z' },
      { slug: 'acme-legacy', title: 'Legacy', publishedAt: '2026-06-12T10:00:00.000Z' },
      { slug: 'acme-bad-last', title: 'Bad Last', publishedAt: '2026-06-12T10:00:00.000Z', lastPublishedAt: 'not a date' },
      { slug: 'acme-undated', title: 'Undated' },
    ],
  });
  const refreshedAt = Date.parse('2026-05-20T08:00:00.000Z');
  const bumpedAt = Date.parse('2026-06-12T10:00:00.000Z');
  if (dated[0].postedAt === refreshedAt) pass('justjoin parser dates a refreshed offer by lastPublishedAt, not the refresh date');
  else fail(`justjoin parser should prefer lastPublishedAt, got ${dated[0].postedAt}`);
  if (dated[1].postedAt === bumpedAt && dated[2].postedAt === bumpedAt) pass('justjoin parser falls back to publishedAt when lastPublishedAt is missing or invalid');
  else fail(`justjoin parser fallback wrong: ${dated[1].postedAt} / ${dated[2].postedAt}`);
  if (dated[3].postedAt === undefined) pass('justjoin parser leaves postedAt undefined when the offer carries no date');
  else fail(`justjoin parser should leave postedAt undefined, got ${dated[3].postedAt}`);

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

  // Optional workplace / open_to_ukrainians filters.
  const { offerFilters } = justjoinModule;
  const mixed = {
    data: [
      { slug: 'a-remote-ua', title: 'A', companyName: 'A', workplaceType: 'remote', isOpenToHireUkrainians: true },
      { slug: 'b-remote-no', title: 'B', companyName: 'B', workplaceType: 'remote', isOpenToHireUkrainians: false },
      { slug: 'c-hybrid-ua', title: 'C', companyName: 'C', workplaceType: 'hybrid', isOpenToHireUkrainians: true },
      { slug: 'd-office-no', title: 'D', companyName: 'D', workplaceType: 'office' },
    ],
    meta: { next: { cursor: null } },
  };
  const slugs = (rows) => rows.map(r => r.url.split('/').pop()).join(',');

  const unfiltered = parseJustJoinResponse(mixed, offerFilters({}));
  if (unfiltered.length === 4) pass('justjoin filters are off by default');
  else fail(`justjoin default should keep all 4 offers, got ${unfiltered.length}`);

  const remoteOnly = parseJustJoinResponse(mixed, offerFilters({ workplace: ['Remote'] }));
  if (slugs(remoteOnly) === 'a-remote-ua,b-remote-no') pass('justjoin workplace filter keeps remote only (case-insensitive)');
  else fail(`justjoin workplace filter returned ${slugs(remoteOnly)}`);

  const ukrOnly = parseJustJoinResponse(mixed, offerFilters({ open_to_ukrainians: true }));
  if (slugs(ukrOnly) === 'a-remote-ua,c-hybrid-ua') pass('justjoin open_to_ukrainians keeps flagged offers only');
  else fail(`justjoin open_to_ukrainians returned ${slugs(ukrOnly)}`);

  const both = parseJustJoinResponse(mixed, offerFilters({ workplace: ['remote'], open_to_ukrainians: true }));
  if (slugs(both) === 'a-remote-ua') pass('justjoin workplace + open_to_ukrainians combine');
  else fail(`justjoin combined filters returned ${slugs(both)}`);

  // max_polish_level filter.
  const langs = {
    data: [
      { slug: 'no-lang', title: 'N', companyName: 'N', languages: [] },
      { slug: 'en-only', title: 'E', companyName: 'E', languages: [{ code: 'en', level: 'C1' }] },
      { slug: 'pl-b1', title: 'B1', companyName: 'B', languages: [{ code: 'en', level: 'B2' }, { code: 'pl', level: 'B1' }] },
      { slug: 'pl-c1', title: 'C1', companyName: 'C', languages: [{ code: 'pl', level: 'C1' }, { code: 'en', level: 'B2' }] },
      { slug: 'polish-c2', title: 'C2', companyName: 'D', languages: [{ code: 'polish', level: 'C2' }] },
      { slug: 'pl-odd-level', title: 'O', companyName: 'O', languages: [{ code: 'pl', level: 'native' }] },
    ],
    meta: { next: { cursor: null } },
  };
  const b1 = slugs(parseJustJoinResponse(langs, offerFilters({ max_polish_level: 'B1' })));
  if (b1 === 'no-lang,en-only,pl-b1') pass('justjoin max_polish_level: B1 drops Polish above B1, keeps unspecified');
  else fail(`justjoin max_polish_level B1 returned ${b1}`);
  const none = slugs(parseJustJoinResponse(langs, offerFilters({ max_polish_level: 'a1' })));
  if (none === 'no-lang,en-only') pass('justjoin max_polish_level: A1 keeps only offers without Polish');
  else fail(`justjoin max_polish_level A1 returned ${none}`);
  if (parseJustJoinResponse(langs, offerFilters({ max_polish_level: 'bogus' })).length === 6) pass('justjoin ignores an invalid max_polish_level');
  else fail('justjoin invalid max_polish_level should disable the filter');

  // A page filtered down to nothing must not stop pagination.
  const pagesServed = [];
  const pageOne = { data: [{ slug: 'x-office', title: 'X', companyName: 'X', workplaceType: 'office' }], meta: { next: { cursor: 100 } } };
  const pageTwo = { data: [{ slug: 'y-remote', title: 'Y', companyName: 'Y', workplaceType: 'remote' }], meta: { next: { cursor: null } } };
  const paged = await jj.fetch(
    { name: 'JustJoin', careers_url: 'https://justjoin.it/job-offers/all-locations', workplace: ['remote'] },
    {
      transport: 'http',
      fetchJson: async (url) => { pagesServed.push(url); return pagesServed.length === 1 ? pageOne : pageTwo; },
      fetchText: async () => '',
    },
  );
  if (paged.length === 1 && pagesServed.length === 2) pass('justjoin keeps paging past a fully filtered page');
  else fail(`justjoin paging stopped early: ${pagesServed.length} pages, ${paged.length} jobs`);

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
