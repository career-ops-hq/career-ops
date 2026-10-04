// Fixture-based unit tests for the pure logic in scan-dayforce.mjs — input
// validation, URL building/host-pinning, pagination math, location joining,
// and JD header/body/footer concatenation — plus challenge detection and the
// retry decision, against stubbed pages and a stubbed browser launch.
//
// What this suite does NOT cover: the real Playwright-driven parts (page.goto
// bootstrapping Cloudflare cookies, page.request riding that session, the
// actual browser lifecycle). Mocking Playwright's
// APIRequestContext convincingly enough to exercise scanBoard()/main() would
// mostly test the mock, not the scanner — those paths are exercised by the
// live smoke test instead (see the task report, not this file).
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
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
  parseArgs,
  scanBoard,
  scanBoardWithRetry,
  detectChallenge,
  DayforceChallengeError,
  ALLOWED_HOST,
} from '../scan-dayforce.mjs';

test('importing the scanner ignores the caller argv', () => {
  const moduleUrl = new URL('../scan-dayforce.mjs', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(moduleUrl)})`, '--', '--tenant'],
    { encoding: 'utf8' },
  );
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stderr, '');
});

test('parseArgs reads CLI options only when explicitly called', () => {
  assert.deepStrictEqual(parseArgs([]), { dryRun: false, debug: false, singleTenant: null });
  assert.deepStrictEqual(
    parseArgs(['--dry-run', '--tenant', 'gnghcm', '--debug']),
    { dryRun: true, debug: true, singleTenant: 'gnghcm' },
  );
  assert.throws(() => parseArgs(['--tenant']), /--tenant requires a value/);
  assert.throws(() => parseArgs(['--tenant', '--debug']), /--tenant requires a value/);
});

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
    title: async () => 'Careers',
    locator: () => ({ count: async () => 0 }),
    request: {
      post: async (url, options) => {
        assert.strictEqual(options.maxRedirects, 0);
        return response({ jobPostings: rows, offset: 0, count: rows.length, maxCount: rows.length });
      },
      get: async (url, options) => {
        assert.strictEqual(options.maxRedirects, 0);
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

// ── Interactive challenge (No bypass, #4675) ─────────────────────────

const BOARD = { name: 'Human Company', tenant: 'tenant', board: 'CANDIDATEPORTAL', culture: 'en-US', jobBoardId: '1' };

/**
 * Stub page whose board URL settles on `title`, with `selectors` present as
 * plain elements and `widgets` as { selector: [{ visible, token }] } — a
 * captcha widget's visibility and the answer it has filled in, if any.
 * Records every API request so a test can assert none were made.
 */
function stubPage({ title = 'Careers', selectors = [], widgets = {}, searchStatus = 200 } = {}) {
  const requests = [];
  const response = (json, status = 200) => ({
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => json,
  });
  return {
    requests,
    goto: async () => response(null),
    url: () => 'https://jobs.dayforcehcm.com/en-US/tenant/CANDIDATEPORTAL',
    title: async () => title,
    locator: (selector) => {
      const items = widgets[selector] ?? (selectors.includes(selector) ? [{ visible: true, token: '' }] : []);
      return {
        count: async () => items.length,
        nth: (i) => ({
          isVisible: async () => items[i].visible,
          evaluate: async () => items[i].token,
        }),
      };
    },
    request: {
      get: async (url) => {
        requests.push(['GET', url]);
        return response({ csrfToken: 'token' });
      },
      post: async (url) => {
        requests.push(['POST', url]);
        return response({ jobPostings: [], offset: 0, count: 0, maxCount: 0 }, searchStatus);
      },
    },
  };
}

/** Fake chromium.launch() that hands out `pages` in order and counts launches. */
function stubLaunch(pages) {
  const launch = async () => {
    launch.count++;
    const page = pages[Math.min(launch.count - 1, pages.length - 1)];
    return {
      newContext: async () => ({ newPage: async () => page, close: async () => {} }),
      close: async () => {},
    };
  };
  launch.count = 0;
  return launch;
}

test('detectChallenge — flags challenge titles and interstitial markup, passes a normal board', async () => {
  assert.strictEqual(await detectChallenge(stubPage()), null);
  assert.match(await detectChallenge(stubPage({ title: 'Just a moment...' })), /title "Just a moment\.\.\."/);
  assert.match(await detectChallenge(stubPage({ title: 'Attention Required! | Cloudflare' })), /title/);
  assert.match(await detectChallenge(stubPage({ selectors: ['#challenge-form'] })), /element #challenge-form/);
  assert.match(await detectChallenge(stubPage({ selectors: ['#challenge-stage'] })), /element #challenge-stage/);
});

test('detectChallenge — an embedded widget counts only while visible and unsolved', async () => {
  // Visible and waiting for an answer: that blocks the page.
  assert.match(
    await detectChallenge(stubPage({ widgets: { '.cf-turnstile': [{ visible: true, token: '' }] } })),
    /unsolved \.cf-turnstile widget/,
  );
  assert.match(
    await detectChallenge(stubPage({ widgets: { '.h-captcha': [{ visible: true, token: '' }] } })),
    /unsolved \.h-captcha widget/,
  );
  // Invisible / non-interactive Turnstile: not a challenge.
  assert.strictEqual(
    await detectChallenge(stubPage({ widgets: { '.cf-turnstile': [{ visible: false, token: '' }] } })),
    null,
  );
  // Already solved — the widget stays on the page with its token filled in.
  assert.strictEqual(
    await detectChallenge(stubPage({ widgets: { '.cf-turnstile': [{ visible: true, token: '0.abc123' }] } })),
    null,
  );
  assert.strictEqual(
    await detectChallenge(stubPage({ widgets: { '.h-captcha': [{ visible: true, token: 'P1_abc' }] } })),
    null,
  );
  // One solved widget doesn't hide a second, unsolved one.
  assert.match(
    await detectChallenge(stubPage({ widgets: { '.cf-turnstile': [
      { visible: true, token: '0.abc123' },
      { visible: true, token: '' },
    ] } })),
    /unsolved \.cf-turnstile widget/,
  );
});

test('scanBoard throws DayforceChallengeError on a challenge page and makes no API request', async () => {
  const page = stubPage({ title: 'Just a moment...', selectors: ['#challenge-form'] });
  await assert.rejects(
    () => scanBoard(page, BOARD),
    (err) => {
      assert.ok(err instanceof DayforceChallengeError);
      assert.strictEqual(err.name, 'DayforceChallengeError');
      assert.strictEqual(err.retriable, false);
      assert.strictEqual(err.tenant, 'tenant');
      assert.match(err.message, /tenant\/CANDIDATEPORTAL is behind an interactive challenge/);
      assert.match(err.message, /skipped, not retried/);
      return true;
    },
  );
  assert.deepStrictEqual(page.requests, [], 'never touches the CSRF/search API behind a challenge');
});

test('scanBoard reports a challenge even when goto times out waiting for networkidle', async () => {
  // A real challenge page keeps polling, so networkidle never fires.
  const timeout = new Error('page.goto: Timeout 30000ms exceeded.');
  const page = stubPage({ title: 'Just a moment...' });
  page.goto = async () => { throw timeout; };
  await assert.rejects(() => scanBoard(page, BOARD), DayforceChallengeError);
  assert.deepStrictEqual(page.requests, []);

  // A timeout on a page that is not a challenge keeps its original error.
  const plain = stubPage();
  plain.goto = async () => { throw timeout; };
  await assert.rejects(() => scanBoard(plain, BOARD), (err) => err === timeout);
});

test('scanBoardWithRetry — a challenge is reported once and never retried', async () => {
  const launch = stubLaunch([stubPage({ title: 'Just a moment...' })]);
  const { result, error } = await scanBoardWithRetry(BOARD, {}, { launch, retryDelayMs: 0 });
  assert.strictEqual(result, null);
  assert.ok(error instanceof DayforceChallengeError);
  assert.strictEqual(launch.count, 1);
});

test('scanBoardWithRetry — a plain 403 still gets one fresh-session retry', async () => {
  const launch = stubLaunch([stubPage({ searchStatus: 403 }), stubPage()]);
  const { result, error } = await scanBoardWithRetry(BOARD, {}, { launch, retryDelayMs: 0 });
  assert.strictEqual(error, null);
  assert.strictEqual(result.totalFound, 0);
  assert.strictEqual(launch.count, 2);
});

test('scanBoardWithRetry — a 403 on both attempts surfaces the generic error, not a challenge', async () => {
  const launch = stubLaunch([stubPage({ searchStatus: 403 })]);
  const { result, error } = await scanBoardWithRetry(BOARD, {}, { launch, retryDelayMs: 0 });
  assert.strictEqual(result, null);
  assert.ok(!(error instanceof DayforceChallengeError));
  assert.match(error.message, /search HTTP 403/);
  assert.strictEqual(launch.count, 2);
});

test('scanBoardWithRetry — a browser startup failure is returned for the board, not thrown', async () => {
  const boom = new Error('browserType.launch: Executable does not exist');
  const { result, error } = await scanBoardWithRetry(BOARD, {}, {
    launch: async () => { throw boom; },
    retryDelayMs: 0,
  });
  assert.strictEqual(result, null);
  assert.strictEqual(error, boom);
});

test('scanBoardWithRetry — closes the browser it opened when context setup fails', async () => {
  const boom = new Error('newContext failed');
  let browserClosed = false;
  const { result, error } = await scanBoardWithRetry(BOARD, {}, {
    launch: async () => ({
      newContext: async () => { throw boom; },
      close: async () => { browserClosed = true; },
    }),
    retryDelayMs: 0,
  });
  assert.strictEqual(result, null);
  assert.strictEqual(error, boom, 'the original error is kept');
  assert.strictEqual(browserClosed, true);
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
