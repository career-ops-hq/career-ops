// tests/providers/hackernews.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hackernews');

try {
  const hackernewsModule = await import(pathToFileURL(join(ROOT, 'providers/hackernews.mjs')).href);
  const hn = hackernewsModule.default;
  const { parseHnComment, resolveLatestThreadId } = hackernewsModule;

  // resolveLatestThreadId ─ happy path
  const fakeSearch = {
    hits: [
      { objectID: '99999999', title: 'Ask HN: Who is hiring? (June 2025)' },
      { objectID: '88888888', title: 'Ask HN: Who wants to be hired? (June 2025)' },
    ],
  };
  if (resolveLatestThreadId(fakeSearch) === '99999999') {
    pass('resolveLatestThreadId picks the first matching "Who is hiring?" hit');
  } else {
    fail(`resolveLatestThreadId returned ${resolveLatestThreadId(fakeSearch)}`);
  }

  // resolveLatestThreadId ─ no matching hit
  const noMatch = { hits: [{ objectID: '11111', title: 'Ask HN: Who wants to be hired?' }] };
  if (resolveLatestThreadId(noMatch) === null) {
    pass('resolveLatestThreadId returns null when no thread matches');
  } else {
    fail('resolveLatestThreadId should return null for non-hiring threads');
  }

  // resolveLatestThreadId ─ bad input
  if (resolveLatestThreadId(null) === null && resolveLatestThreadId({}) === null) {
    pass('resolveLatestThreadId handles null / empty input gracefully');
  } else {
    fail('resolveLatestThreadId should return null for bad input');
  }

  // parseHnComment ─ full pipe-delimited format
  const fullFmt = 'Acme Corp | Senior Engineer | Remote | https://acme.com/jobs/123\nWe are hiring…';
  const parsed = parseHnComment(fullFmt, 'https://news.ycombinator.com/item?id=1');
  if (parsed && parsed.company === 'Acme Corp' && parsed.location === 'Remote') {
    pass('parseHnComment extracts company and location from pipe-delimited header');
  } else {
    fail(`parseHnComment pipe format: ${JSON.stringify(parsed)}`);
  }
  if (parsed && parsed.url === 'https://acme.com/jobs/123') {
    pass('parseHnComment extracts URL from comment text');
  } else {
    fail(`parseHnComment url: ${JSON.stringify(parsed?.url)}`);
  }

  // parseHnComment ─ URL in first line stripped from title
  if (parsed && !parsed.title.includes('https://')) {
    pass('parseHnComment strips URLs from the title field');
  } else {
    fail(`parseHnComment title still contains URL: ${JSON.stringify(parsed?.title)}`);
  }

  // parseHnComment ─ free-form (no pipes, no URL in text)
  const freeFmt = 'Looking for a Rails dev, anywhere, part-time.';
  const parsedFree = parseHnComment(freeFmt, 'https://news.ycombinator.com/item?id=1');
  if (parsedFree && parsedFree.title === freeFmt && parsedFree.url === 'https://news.ycombinator.com/item?id=1') {
    pass('parseHnComment handles free-form comment, falls back to thread URL');
  } else {
    fail(`parseHnComment free-form: ${JSON.stringify(parsedFree)}`);
  }
  if (parsedFree && parsedFree.company === '' && parsedFree.location === '') {
    pass('parseHnComment leaves company/location empty for free-form comments');
  } else {
    fail(`parseHnComment free-form company/location: ${JSON.stringify(parsedFree)}`);
  }

  // parseHnComment ─ HTML entities and tags
  const htmlFmt = '<p>Beta &amp; Co | Staff SWE | New York, NY | <a href="https://beta.io/jobs">https://beta.io/jobs</a></p>';
  const parsedHtml = parseHnComment(htmlFmt, '');
  if (parsedHtml && parsedHtml.company === 'Beta & Co') {
    pass('parseHnComment decodes HTML entities (company name)');
  } else {
    fail(`parseHnComment HTML entity decode: ${JSON.stringify(parsedHtml?.company)}`);
  }
  if (parsedHtml && parsedHtml.url === 'https://beta.io/jobs') {
    pass('parseHnComment extracts href URL from anchor tags');
  } else {
    fail(`parseHnComment anchor URL: ${JSON.stringify(parsedHtml?.url)}`);
  }

  // parseHnComment ─ <p> paragraph body must not bleed into location field
  // Real HN posts often have "Company | Role | Location<p>Body text..." where the
  // second <p> paragraph (job description) runs on without a 4th pipe segment.
  // The parser must convert block tags to newlines so parts[2] stays clean.
  const bleedFmt = '<p>Linear | Product Engineer | Remote<p>We are hiring at https://linear.app/careers/pe-2025';
  const parsedBleed = parseHnComment(bleedFmt, 'https://news.ycombinator.com/item?id=1');
  if (parsedBleed && parsedBleed.location === 'Remote') {
    pass('parseHnComment location does not bleed body paragraph text (block tag newline fix)');
  } else {
    fail(`parseHnComment location bleed: ${JSON.stringify(parsedBleed?.location)}`);
  }
  if (parsedBleed && parsedBleed.url === 'https://linear.app/careers/pe-2025') {
    pass('parseHnComment finds URL in body paragraph when absent from header line');
  } else {
    fail(`parseHnComment body-paragraph URL: ${JSON.stringify(parsedBleed?.url)}`);
  }

  // parseHnComment ─ deleted / empty comments return null
  if (parseHnComment('', '') === null && parseHnComment(null, '') === null) {
    pass('parseHnComment returns null for empty / null input');
  } else {
    fail('parseHnComment should return null for empty/null input');
  }

  // provider.fetch() — integration with mock ctx
  const FAKE_THREAD_ID = '42424242';
  const FAKE_THREAD_URL = `https://news.ycombinator.com/item?id=${FAKE_THREAD_ID}`;

  const fakeSearchResp = {
    hits: [{ objectID: FAKE_THREAD_ID, title: 'Ask HN: Who is hiring? (June 2025)' }],
  };
  const fakeItemResp = {
    id: FAKE_THREAD_ID,
    children: [
      {
        objectID: 'c1',
        text: 'Startup XYZ | Backend Engineer | San Francisco | https://xyz.io/careers',
        created_at: '2025-06-01T10:00:00Z',
      },
      { objectID: 'c2', deleted: true, text: '' },      // deleted — should be skipped
      { objectID: 'c3', text: '' },                      // empty — should be skipped
      {
        objectID: 'c4',
        text: 'Freelance gig, no URL here, DM me.',      // no URL — falls back to thread URL
        created_at: '2025-06-01T11:00:00Z',
      },
    ],
  };

  let searchFetched = false;
  let itemFetched = false;
  const mockCtx = {
    async fetchJson(url, _opts) {
      if (url.includes('search_by_date')) { searchFetched = true; return fakeSearchResp; }
      if (url.includes(`/items/${FAKE_THREAD_ID}`)) { itemFetched = true; return fakeItemResp; }
      throw new Error(`hackernews mock: unexpected fetch ${url}`);
    },
  };

  const jobs = await hn.fetch({ name: 'HN Hiring', provider: 'hackernews' }, mockCtx);

  if (searchFetched && itemFetched) {
    pass('hackernews.fetch() calls search API then items API');
  } else {
    fail(`hackernews.fetch() API calls: search=${searchFetched} item=${itemFetched}`);
  }

  if (jobs.length === 2) {
    pass('hackernews.fetch() returns 2 jobs (skips deleted + empty comments)');
  } else {
    fail(`hackernews.fetch() returned ${jobs.length} jobs (expected 2)`);
  }

  if (jobs[0]?.company === 'Startup XYZ' && jobs[0]?.location === 'San Francisco') {
    pass('hackernews.fetch() maps pipe-delimited company and location');
  } else {
    fail(`hackernews.fetch() row 0: ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://xyz.io/careers') {
    pass('hackernews.fetch() maps job URL from comment text');
  } else {
    fail(`hackernews.fetch() row 0 url: ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2025-06-01T10:00:00Z')) {
    pass('hackernews.fetch() parses created_at to postedAt epoch ms');
  } else {
    fail(`hackernews.fetch() postedAt: ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.url === FAKE_THREAD_URL) {
    pass('hackernews.fetch() falls back to thread URL for comments with no link');
  } else {
    fail(`hackernews.fetch() fallback url: ${JSON.stringify(jobs[1]?.url)}`);
  }

  // provider.fetch() — throws when no thread found
  let threw = false;
  try {
    await hn.fetch({ name: 'HN' }, {
      async fetchJson() { return { hits: [] }; },
    });
  } catch (e) {
    threw = true;
  }
  if (threw) {
    pass('hackernews.fetch() throws when "Who is hiring?" thread not found');
  } else {
    fail('hackernews.fetch() should throw when no matching thread found');
  }
} catch (e) {
  fail(`hackernews provider tests crashed: ${e.message}`);
}
