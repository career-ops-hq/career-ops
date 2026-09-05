// Fixture-based unit tests for the pure logic in scan-dayforce.mjs — input
// validation, URL building/host-pinning, pagination math, location joining,
// and JD header/body/footer concatenation.
//
// What this suite does NOT cover: the Playwright-driven parts (page.goto
// bootstrapping Cloudflare cookies, page.request riding that session, the
// actual browser lifecycle, retry-after-403 behavior). Mocking Playwright's
// APIRequestContext convincingly enough to exercise scanBoard()/main() would
// mostly test the mock, not the scanner — those paths are exercised by the
// live smoke test instead (see the task report, not this file).
import test from 'node:test';
import assert from 'node:assert';
import {
  validateTenant,
  validateBoardCode,
  validateCulture,
  validateJobBoardId,
  validateJobPostingId,
  normalizeBoardEntry,
  assertDayforceUrl,
  buildBoardUrl,
  buildJobUrl,
  buildCsrfUrl,
  buildSearchUrl,
  buildDetailUrl,
  nextPaginationStart,
  joinLocations,
  buildJobDescriptionText,
  scanBoard,
  ALLOWED_HOST,
} from '../scan-dayforce.mjs';

test('validateTenant/validateBoardCode — alphanumeric + _/- only', () => {
  assert.strictEqual(validateTenant('gnghcm'), true);
  assert.strictEqual(validateTenant('first-national'), true);
  assert.strictEqual(validateTenant('life_labs'), true);
  assert.strictEqual(validateTenant(''), false);
  assert.strictEqual(validateTenant('gng hcm'), false); // space
  assert.strictEqual(validateTenant('gng/hcm'), false); // path separator — SSRF-shaped
  assert.strictEqual(validateTenant('../etc'), false);
  assert.strictEqual(validateTenant(null), false);
  assert.strictEqual(validateTenant(123), false);

  assert.strictEqual(validateBoardCode('CANDIDATEPORTAL'), true);
  assert.strictEqual(validateBoardCode('candidate.portal'), false); // dot not allowed
  assert.strictEqual(validateBoardCode('a?b=c'), false);
});

test('validateCulture — xx-XX shape only', () => {
  assert.strictEqual(validateCulture('en-US'), true);
  assert.strictEqual(validateCulture('fr-CA'), true);
  assert.strictEqual(validateCulture('en-us'), false); // wrong case
  assert.strictEqual(validateCulture('en'), false);
  assert.strictEqual(validateCulture('english-US'), false);
  assert.strictEqual(validateCulture(''), false);
});

test('validateJobBoardId/validateJobPostingId — decimal integers only', () => {
  assert.strictEqual(validateJobBoardId('1'), true);
  assert.strictEqual(validateJobBoardId('42'), true);
  assert.strictEqual(validateJobBoardId('1a'), false);
  assert.strictEqual(validateJobBoardId('-1'), false);
  assert.strictEqual(validateJobBoardId(''), false);

  assert.strictEqual(validateJobPostingId('9001'), true);
  assert.strictEqual(validateJobPostingId(9001), true); // numbers coerce
  assert.strictEqual(validateJobPostingId('9001; DROP'), false);
  assert.strictEqual(validateJobPostingId(undefined), false);
});

test('normalizeBoardEntry — fills defaults, rejects malformed entries without throwing', () => {
  assert.deepStrictEqual(
    normalizeBoardEntry({ name: 'Give & Go Prepared Foods', tenant: 'gnghcm' }),
    { name: 'Give & Go Prepared Foods', tenant: 'gnghcm', board: 'CANDIDATEPORTAL', culture: 'en-US', jobBoardId: '1' }
  );
  assert.deepStrictEqual(
    normalizeBoardEntry({ name: 'Roots Canada', tenant: 'roots', board: 'CAREERS', culture: 'en-CA', jobBoardId: 2 }),
    { name: 'Roots Canada', tenant: 'roots', board: 'CAREERS', culture: 'en-CA', jobBoardId: '2' }
  );
  assert.strictEqual(normalizeBoardEntry({ tenant: 'gnghcm' }), null);
  assert.strictEqual(normalizeBoardEntry({ name: 'Company', tenant: 'bad tenant' }), null);
  assert.strictEqual(normalizeBoardEntry({ name: 'Company', tenant: 'ok', culture: 'not-a-culture' }), null);
  assert.strictEqual(normalizeBoardEntry({}), null);
  assert.strictEqual(normalizeBoardEntry(null), null);
  assert.strictEqual(normalizeBoardEntry('gnghcm'), null);
});

test('scanBoard applies all list-level description gates before detail fetch and emits the human company name', async () => {
  const rows = [
    { jobPostingId: 1, jobTitle: 'Keep &amp; Acquire', jobDescription: 'keep', postingLocations: [{ formattedAddress: 'Toronto, ON' }] },
    { jobPostingId: 2, jobTitle: 'Content blocked', jobDescription: 'blocked-content', postingLocations: [{ formattedAddress: 'Toronto, ON' }] },
    { jobPostingId: 3, jobTitle: 'Country blocked', jobDescription: 'blocked-country', postingLocations: [{ formattedAddress: 'Toronto, ON' }] },
    { jobPostingId: 4, jobTitle: 'Visa blocked', jobDescription: 'blocked-visa', postingLocations: [{ formattedAddress: 'Toronto, ON' }] },
  ];
  const detailIds = [];
  const response = (json, status = 200) => ({
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => json,
  });
  const page = {
    goto: async () => {},
    url: () => 'https://jobs.dayforcehcm.com/en-US/tenant/CANDIDATEPORTAL',
    request: {
      post: async (url, options) => {
        assert.strictEqual(options.maxRedirects, 0);
        return response({ jobPostings: rows, offset: 0, count: rows.length, maxCount: rows.length });
      },
      get: async (url) => {
        if (String(url).endsWith('/api/auth/csrf')) return response({ csrfToken: 'token' });
        const id = String(url).split('/').at(-1);
        detailIds.push(id);
        return response({ jobTitle: 'Keep &amp; Acquire', jobPostingContent: { jobDescription: 'full detail' } });
      },
    },
  };
  const result = await scanBoard(
    page,
    { name: 'Human Company', tenant: 'tenant', board: 'CANDIDATEPORTAL', culture: 'en-US', jobBoardId: '1' },
    {
      titleFilter: () => true,
      locationFilter: () => true,
      contentFilter: (description) => description !== 'blocked-content',
      countryEligibilityFilter: (description) => description !== 'blocked-country',
      visaFilter: (description) => description !== 'blocked-visa',
      matchedTitleKeywords: () => [],
    },
  );

  assert.deepStrictEqual(detailIds, ['1']);
  assert.strictEqual(result.found.length, 1);
  assert.strictEqual(result.found[0].company, 'Human Company');
  assert.strictEqual(result.found[0].title, 'Keep & Acquire');
  assert.strictEqual(result.contentSkipped.length, 1);
  assert.strictEqual(result.countryEligibilitySkipped.length, 1);
  assert.strictEqual(result.visaSkipped.length, 1);
});

test('assertDayforceUrl — pins to https://jobs.dayforcehcm.com exactly', () => {
  assert.doesNotThrow(() => assertDayforceUrl(`https://${ALLOWED_HOST}/en-US/gnghcm/CANDIDATEPORTAL`));
  assert.throws(() => assertDayforceUrl('https://evil.example.com/en-US/gnghcm/CANDIDATEPORTAL'));
  assert.throws(() => assertDayforceUrl('https://jobs.dayforcehcm.com.evil.com/x'));
  assert.throws(() => assertDayforceUrl('http://jobs.dayforcehcm.com/x')); // must be https
});

test('URL builders produce the documented shapes and reject invalid interpolation targets indirectly via assertDayforceUrl', () => {
  assert.strictEqual(
    buildBoardUrl('en-US', 'gnghcm', 'CANDIDATEPORTAL'),
    'https://jobs.dayforcehcm.com/en-US/gnghcm/CANDIDATEPORTAL'
  );
  assert.strictEqual(
    buildJobUrl('en-US', 'gnghcm', 'CANDIDATEPORTAL', 12345),
    'https://jobs.dayforcehcm.com/en-US/gnghcm/CANDIDATEPORTAL/jobs/12345'
  );
  assert.strictEqual(buildCsrfUrl(), 'https://jobs.dayforcehcm.com/api/auth/csrf');
  assert.strictEqual(
    buildSearchUrl('gnghcm'),
    'https://jobs.dayforcehcm.com/api/geo/gnghcm/jobposting/search'
  );
  assert.strictEqual(
    buildDetailUrl('gnghcm', 'en-US', '1', '12345'),
    'https://jobs.dayforcehcm.com/api/geo/gnghcm/jobposting/gnghcm/en-US/1/12345'
  );
});

test('nextPaginationStart — advances by returned offset+count, stops correctly', () => {
  // Mid-board: more pages to go.
  assert.strictEqual(nextPaginationStart(0, 25, 60), 25);
  assert.strictEqual(nextPaginationStart(25, 25, 60), 50);
  // Exactly exhausted.
  assert.strictEqual(nextPaginationStart(50, 10, 60), null);
  // Short/empty page — stop even if maxCount claims more (server truth wins).
  assert.strictEqual(nextPaginationStart(50, 0, 60), null);
  // Single-page board.
  assert.strictEqual(nextPaginationStart(0, 12, 12), null);
  // Malformed numeric fields never produce an infinite loop.
  assert.strictEqual(nextPaginationStart(NaN, 25, 60), null);
  assert.strictEqual(nextPaginationStart(0, NaN, 60), null);
  assert.strictEqual(nextPaginationStart(0, 25, NaN), null);
});

test('joinLocations — prefers formattedAddress, falls back to city/state/country, joins multiple', () => {
  assert.strictEqual(joinLocations(undefined), '');
  assert.strictEqual(joinLocations([]), '');
  assert.strictEqual(
    joinLocations([{ formattedAddress: 'Toronto, ON, Canada' }]),
    'Toronto, ON, Canada'
  );
  assert.strictEqual(
    joinLocations([{ cityName: 'Toronto', stateCode: 'ON', isoCountryCode: 'CA' }]),
    'Toronto, ON, CA'
  );
  // Per-location empty fields (not just board-wide) are tolerated.
  assert.strictEqual(
    joinLocations([{ cityName: 'Remote' }]),
    'Remote'
  );
  assert.strictEqual(
    joinLocations([
      { formattedAddress: 'Toronto, ON, Canada' },
      { cityName: 'Vancouver', stateCode: 'BC', isoCountryCode: 'CA' },
    ]),
    'Toronto, ON, Canada | Vancouver, BC, CA'
  );
  // A location object with nothing usable drops out rather than emitting ''.
  assert.strictEqual(joinLocations([{}, { formattedAddress: 'Ottawa, ON' }]), 'Ottawa, ON');
});

test('buildJobDescriptionText — header/body/footer concatenation with any piece legitimately empty', () => {
  assert.strictEqual(buildJobDescriptionText(undefined), '');
  assert.strictEqual(buildJobDescriptionText({}), '');
  assert.strictEqual(
    buildJobDescriptionText({ jobDescriptionHeader: '', jobDescription: '<p>Body only</p>', jobDescriptionFooter: '' }),
    'Body only'
  );
  assert.strictEqual(
    buildJobDescriptionText({
      jobDescriptionHeader: '<h1>Header</h1>',
      jobDescription: '<p>Body &amp; more</p>',
      jobDescriptionFooter: '<p>Footer</p>',
    }),
    'Header Body & more Footer'
  );
  // Only footer present.
  assert.strictEqual(
    buildJobDescriptionText({ jobDescriptionFooter: 'Equal opportunity employer.' }),
    'Equal opportunity employer.'
  );
});
