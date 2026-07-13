// tests/providers/ashby.test.mjs — direct provider-contract tests (#1499).
// Covers the id/detect/fetch contract scan.mjs calls plus the exported
// parseCompensation() normalizer: careers_url detection, the posting-api
// request shape (includeCompensation, 30s timeout, redirect:'error'),
// secondary-location folding, salary annualization, and the retry loop's
// recover/exhaust behavior.
// (Indirect coverage elsewhere: tests/providers/ats-ssrf-hardening.test.mjs
// asserts the redirect:'error' guard; this file tests the module contract.)
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — ashby');

try {
  const ashbyModule = await import(pathToFileURL(join(ROOT, 'providers/ashby.mjs')).href);
  const ashby = ashbyModule.default;
  const { parseCompensation } = ashbyModule;

  if (ashby.id === 'ashby') pass('ashby.id is "ashby"');
  else fail(`ashby.id is ${JSON.stringify(ashby.id)}`);

  // detect() — positive / negative cases.
  const hit = ashby.detect({ name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' });
  if (hit && hit.url === 'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true') {
    pass('ashby.detect() resolves jobs.ashbyhq.com/<slug> → posting-api URL with includeCompensation=true');
  } else {
    fail(`ashby.detect() returned ${JSON.stringify(hit)}`);
  }

  if (ashby.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('ashby.detect() returns null for a non-ashby careers_url');
  } else {
    fail('ashby.detect() should return null for non-ashby URLs');
  }

  if (ashby.detect({ name: 'X' }) === null && ashby.detect({ name: 'X', careers_url: null }) === null) {
    pass('ashby.detect() returns null for missing / null careers_url');
  } else {
    fail('ashby.detect() should return null when careers_url is absent');
  }

  // detect() — api: takes precedence over careers_url and is used verbatim
  // when its host is on the allowlist. Lets an entry keep a human-facing
  // corporate careers_url (e.g. https://openai.com/careers) while pinning
  // the Ashby board explicitly.
  const hitApi = ashby.detect({
    name: 'Pinned',
    careers_url: 'https://openai.com/careers',
    api: 'https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true',
  });
  if (hitApi && hitApi.url === 'https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true') {
    pass('ashby.detect() honors an allowlisted api: over a branded careers_url');
  } else {
    fail(`ashby.detect(api-pinned) returned ${JSON.stringify(hitApi)}`);
  }

  // detect() — api: with an untrusted host must NOT be claimed (SSRF guard).
  if (ashby.detect({ name: 'Evil', api: 'https://evil.example/posting-api/job-board/acme' }) === null) {
    pass('ashby.detect() returns null for an api: on an untrusted host');
  } else {
    fail('ashby.detect() must reject an untrusted api: host');
  }

  // detect() — api: must be HTTPS.
  if (ashby.detect({ name: 'Insecure', api: 'http://api.ashbyhq.com/posting-api/job-board/acme' }) === null) {
    pass('ashby.detect() returns null for a non-HTTPS api:');
  } else {
    fail('ashby.detect() must reject an http:// api:');
  }

  // detect() — malformed api: URL → null, not a crash.
  if (ashby.detect({ name: 'Broken', api: 'not a url' }) === null) {
    pass('ashby.detect() returns null for a malformed api: URL');
  } else {
    fail('ashby.detect() must reject a malformed api: URL');
  }

  // parseCompensation() — annualization, coercion, and rejection paths.
  const annual = parseCompensation({ compensation: { interval: '1 YEAR', minValue: 90000, maxValue: 120000, currency: 'usd' } });
  if (annual && annual.min === 90000 && annual.max === 120000 && annual.currency === 'USD') {
    pass('parseCompensation() keeps annual values as-is and uppercases the currency');
  } else {
    fail(`parseCompensation(annual) = ${JSON.stringify(annual)}`);
  }

  const hourly = parseCompensation({ compensation: { interval: '1 HOUR', minValue: 50, maxValue: 70, currency: 'USD' } });
  if (hourly && hourly.min === 50 * 2080 && hourly.max === 70 * 2080) {
    pass('parseCompensation() annualizes hourly compensation at 2080 hours/year');
  } else {
    fail(`parseCompensation(hourly) = ${JSON.stringify(hourly)}`);
  }

  const noInterval = parseCompensation({ compensation: { minValue: 80000, maxValue: 100000, currency: 'EUR' } });
  if (noInterval && noInterval.min === 80000 && noInterval.max === 100000) {
    pass('parseCompensation() defaults a missing interval to 1 YEAR');
  } else {
    fail(`parseCompensation(no interval) = ${JSON.stringify(noInterval)}`);
  }

  if (parseCompensation({ compensation: { interval: '7 MOON', minValue: 1, maxValue: 2 } }) === null) {
    pass('parseCompensation() returns null for an unknown interval');
  } else {
    fail('parseCompensation() should reject unknown intervals');
  }

  if (parseCompensation({}) === null && parseCompensation(null) === null && parseCompensation({ compensation: null }) === null) {
    pass('parseCompensation() returns null when compensation is absent (job {}, null job, null comp)');
  } else {
    fail('parseCompensation() should return null without compensation data');
  }

  if (parseCompensation({ compensation: { interval: '1 YEAR', minValue: '', maxValue: null, currency: 'USD' } }) === null) {
    pass('parseCompensation() returns null when neither min nor max is a usable number');
  } else {
    fail('parseCompensation() should reject empty-string/null min and max');
  }

  const coerced = parseCompensation({ compensation: { interval: '1 YEAR', minValue: '-5', maxValue: '110000', currency: 'usd' } });
  if (coerced && coerced.min === 110000 && coerced.max === 110000) {
    pass('parseCompensation() coerces numeric strings, drops negatives, and collapses to the surviving bound');
  } else {
    fail(`parseCompensation(coerced) = ${JSON.stringify(coerced)}`);
  }

  const swapped = parseCompensation({ compensation: { interval: '1 YEAR', minValue: 120000, maxValue: 90000, currency: 'USD' } });
  if (swapped && swapped.min === 90000 && swapped.max === 120000) {
    pass('parseCompensation() reorders an inverted min/max pair');
  } else {
    fail(`parseCompensation(swapped) = ${JSON.stringify(swapped)}`);
  }

  // fetch() — request shape and normalization from the real posting-api
  // payload: { jobs: [{ title, jobUrl, location, secondaryLocations, publishedAt, compensation }] }.
  const sample = {
    jobs: [
      {
        title: 'Head of Applied AI',
        jobUrl: 'https://jobs.ashbyhq.com/acme/1234',
        location: 'Canada',
        secondaryLocations: [
          { location: 'Europe', address: { postalAddress: { addressLocality: 'Berlin', addressCountry: 'Germany' } } },
          { location: 'Canada' },       // duplicate of the primary — must dedup
          null,                          // malformed secondary — must be skipped
        ],
        publishedAt: '2026-07-02T00:00:00.000Z',
        compensation: { interval: '1 YEAR', minValue: 150000, maxValue: 180000, currency: 'usd' },
      },
      {
        // no title/jobUrl → '' ; no locations → '' ; bad publishedAt → undefined ; no comp → null
        publishedAt: 'soon',
      },
    ],
  };

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await ashby.fetch(
    { name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true') {
    pass('ashby.fetch() hits the derived posting-api URL with includeCompensation=true');
  } else {
    fail(`ashby.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts?.redirect === 'error' && capturedOpts?.timeoutMs === 30_000) {
    pass('ashby.fetch() passes redirect:"error" (SSRF guard) and the 30s Ashby timeout');
  } else {
    fail(`ashby.fetch() opts = ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 2)
    pass('ashby.fetch() returns one normalized row per job');
  else fail(`ashby.fetch() returned ${fetched.length} rows (expected 2)`);

  if (fetched[0]?.title === 'Head of Applied AI'
      && fetched[0]?.url === 'https://jobs.ashbyhq.com/acme/1234'
      && fetched[0]?.company === 'Acme'
      && fetched[0]?.postedAt === Date.parse('2026-07-02T00:00:00.000Z')
      && fetched[0]?.salary && fetched[0].salary.min === 150000 && fetched[0].salary.max === 180000 && fetched[0].salary.currency === 'USD')
    pass('ashby.fetch() maps title/jobUrl/entry.name/publishedAt/compensation');
  else fail(`ashby.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[0]?.location === 'Canada · Europe · Berlin · Germany')
    pass('ashby.fetch() folds secondaryLocations (region/locality/country) into location, deduped, " · "-joined');
  else fail(`ashby.fetch() row 0 location = ${JSON.stringify(fetched[0]?.location)}`);

  if (fetched[1]?.title === '' && fetched[1]?.url === '' && fetched[1]?.location === ''
      && fetched[1]?.salary === null && fetched[1]?.postedAt === undefined)
    pass('ashby.fetch() tolerates a sparse job (empty strings, null salary, undefined postedAt for a bad date)');
  else fail(`ashby.fetch() row 1 = ${JSON.stringify(fetched[1])}`);

  // Malformed response bodies → [], no crash.
  const emptyCases = [null, {}, { jobs: null }, { jobs: 'nope' }];
  let emptyOk = true;
  for (const body of emptyCases) {
    const out = await ashby.fetch(
      { name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' },
      { fetchJson: async () => body },
    );
    if (!Array.isArray(out) || out.length !== 0) { emptyOk = false; fail(`ashby.fetch() body=${JSON.stringify(body)} → ${JSON.stringify(out)}`); break; }
  }
  if (emptyOk) pass('ashby.fetch() returns [] for null / {} / non-array jobs response bodies');

  // Retry loop — a transient failure on the first attempt recovers
  // transparently on the second (ASHBY_RETRIES=2 allows up to 3 attempts).
  // ctx.sleep replaces the real backoff setTimeout so the suite doesn't wait.
  let recoverAttempts = 0;
  const recoverSleeps = [];
  const recovered = await ashby.fetch(
    { name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' },
    { sleep: async (ms) => { recoverSleeps.push(ms); },
      fetchJson: async () => {
        recoverAttempts++;
        if (recoverAttempts === 1) throw new Error('HTTP 429');
        return { jobs: [{ title: 'Recovered Role', jobUrl: 'https://jobs.ashbyhq.com/acme/r1' }] };
      } },
  );
  if (recoverAttempts === 2 && recovered.length === 1 && recovered[0].title === 'Recovered Role'
      && recoverSleeps.length === 1 && recoverSleeps[0] >= 1000) {
    pass('ashby.fetch() retries a failed request and recovers transparently (2 attempts, 1 backoff via ctx.sleep)');
  } else {
    fail(`ashby.fetch() retry recovery: attempts=${recoverAttempts}, sleeps=${JSON.stringify(recoverSleeps)}, jobs=${JSON.stringify(recovered)}`);
  }

  // Retry loop — persistent failure exhausts all 3 attempts and rethrows the
  // LAST error (lastErr), not the first.
  let exhaustAttempts = 0;
  try {
    await ashby.fetch(
      { name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' },
      { sleep: async () => {},
        fetchJson: async () => { exhaustAttempts++; throw new Error(`boom #${exhaustAttempts}`); } },
    );
    fail('ashby.fetch() should rethrow after exhausting retries');
  } catch (e) {
    if (exhaustAttempts === 3 && e.message === 'boom #3') {
      pass('ashby.fetch() exhausts 3 attempts (ASHBY_RETRIES=2) and rethrows the last error');
    } else {
      fail(`ashby.fetch() retry exhaustion: attempts=${exhaustAttempts}, error=${e.message}`);
    }
  }

  // fetch() — a pinned api: is used verbatim, bypassing careers_url parsing entirely.
  let pinnedUrl = null;
  await ashby.fetch(
    { name: 'OpenAI', careers_url: 'https://openai.com/careers', api: 'https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true' },
    { fetchJson: async (url) => { pinnedUrl = url; return { jobs: [] }; } },
  );
  if (pinnedUrl === 'https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true') {
    pass('ashby.fetch() honors a pinned api: over a non-ashby careers_url');
  } else {
    fail(`ashby.fetch() pinned api: requested ${JSON.stringify(pinnedUrl)}`);
  }

  // fetch() — an untrusted api: host throws before any request (SSRF guard).
  let evilFetchCalled = false;
  try {
    await ashby.fetch(
      { name: 'Evil', api: 'https://evil.example/posting-api/job-board/acme' },
      { fetchJson: async () => { evilFetchCalled = true; return { jobs: [] }; } },
    );
    fail('ashby.fetch() should throw for an untrusted api: host');
  } catch (e) {
    if (!evilFetchCalled && /untrusted hostname/.test(e.message)) {
      pass('ashby.fetch() rejects an untrusted api: host before fetching');
    } else {
      fail(`ashby.fetch() untrusted api: fetchCalled=${evilFetchCalled}, error=${e.message}`);
    }
  }

  // Underivable entry → typed error before any request (and before the retry loop).
  let underiveFetchCalled = false;
  try {
    await ashby.fetch(
      { name: 'NoBoard', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { underiveFetchCalled = true; return { jobs: [] }; } },
    );
    fail('ashby.fetch() should throw when no API URL can be derived');
  } catch (e) {
    if (!underiveFetchCalled && /cannot derive API URL for NoBoard/.test(e.message)) {
      pass('ashby.fetch() throws "cannot derive API URL" before fetching for an undetectable entry');
    } else {
      fail(`ashby.fetch() underivable entry: fetchCalled=${underiveFetchCalled}, error=${e.message}`);
    }
  }

} catch (e) {
  fail(`ashby provider tests crashed: ${e.message}`);
}
