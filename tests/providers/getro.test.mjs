// tests/providers/getro.test.mjs — direct provider-contract tests.
// Getro boards are addressed by a numeric collection id. It can be set
// explicitly (`getro_collection`) or auto-resolved from `careers_url`'s own
// __NEXT_DATA__ blob. `careers_url` is locally-authored portals.yml config
// (not external/untrusted input), so only an https check applies — no host
// allowlist. Also covers the redirect:'error' guard, ctx.maxPages/getro_max_pages
// clamping, the age-cutoff pagination bound, and malformed-payload tolerance.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — getro');

try {
  const getro = (await import(pathToFileURL(join(ROOT, 'providers/getro.mjs')).href)).default;
  const { extractCollectionId } = await import(pathToFileURL(join(ROOT, 'providers/getro.mjs')).href);

  if (getro.id === 'getro') pass('getro.id is "getro"');
  else fail(`getro.id is ${JSON.stringify(getro.id)}`);

  const okEntry = { name: 'ExampleVC', careers_url: 'https://jobs.examplevc.example', getro_collection: 4283 };

  const getHit = getro.detect(okEntry);
  if (getHit && getHit.url === 'https://api.getro.com/api/v2/collections/4283/search/jobs') pass('getro.detect() claims an explicit collection');
  else fail(`getro.detect() returned ${JSON.stringify(getHit)}`);

  if (getro.detect({ name: 'X', careers_url: 'https://jobs.examplevc.example' }) === null) {
    pass('getro.detect() returns null without an explicit getro_collection (auto-resolve entries opt in via provider: getro instead)');
  } else {
    fail('getro.detect() should not report a hit without getro_collection');
  }

  // Injection-ish / non-numeric collection ids are rejected (the id is interpolated into the API URL).
  let getroRejected = true;
  for (const bad of ['abc', '4283; DROP', '../evil', '4283/../../x', '', '0']) {
    if (getro.detect({ name: 'X', careers_url: 'https://jobs.examplevc.example', getro_collection: bad }) !== null) {
      fail(`getro.detect() should reject a bad collection id: ${JSON.stringify(bad)}`);
      getroRejected = false;
    }
  }
  if (getroRejected) pass('getro.detect() rejects non-numeric / all-zero collection ids');

  // A non-https careers_url is rejected — needed to build a valid referer origin.
  let getroNonHttpsThrew = false;
  try {
    await getro.fetch({ name: 'Plaintext', careers_url: 'http://jobs.examplevc.example', getro_collection: 4283 }, {
      fetchJson: async () => { throw new Error('should not reach here'); },
    });
  } catch (e) { getroNonHttpsThrew = /https/.test(e.message); }
  if (getroNonHttpsThrew) pass('getro.fetch() rejects a non-https careers_url before fetching');
  else fail('getro.fetch() should reject a non-https careers_url');

  // extractCollectionId() parses network.id out of a __NEXT_DATA__ blob.
  const nextDataHtml = '<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"network":{"id":9911}}}}</script></html>';
  if (extractCollectionId(nextDataHtml) === '9911') pass('extractCollectionId() reads network.id from __NEXT_DATA__');
  else fail(`extractCollectionId() returned ${JSON.stringify(extractCollectionId(nextDataHtml))}`);
  if (extractCollectionId('<html>no next data here</html>') === null) pass('extractCollectionId() returns null when __NEXT_DATA__ is missing');
  else fail('extractCollectionId() should return null on a missing __NEXT_DATA__ blob');
  if (extractCollectionId('<script id="__NEXT_DATA__" type="application/json">not json</script>') === null) {
    pass('extractCollectionId() returns null on malformed JSON');
  } else {
    fail('extractCollectionId() should return null on malformed JSON');
  }

  // Attribute order/whitespace/extra attributes (e.g. a CSP nonce) shouldn't
  // matter — only the id attribute is load-bearing for the match.
  const reorderedNextDataHtml = '<html><script type="application/json" nonce="abc123" id="__NEXT_DATA__">{"props":{"pageProps":{"network":{"id":9911}}}}</script></html>';
  if (extractCollectionId(reorderedNextDataHtml) === '9911') pass('extractCollectionId() tolerates reordered/extra script attributes');
  else fail(`extractCollectionId() with reordered attributes returned ${JSON.stringify(extractCollectionId(reorderedNextDataHtml))}`);

  // Single quotes and spaced-out `id = '...'` are valid HTML too.
  const singleQuoteNextDataHtml = "<html><script id = '__NEXT_DATA__' type='application/json'>{\"props\":{\"pageProps\":{\"network\":{\"id\":9911}}}}</script></html>";
  if (extractCollectionId(singleQuoteNextDataHtml) === '9911') pass('extractCollectionId() tolerates single-quoted / spaced id attribute');
  else fail(`extractCollectionId() with single quotes returned ${JSON.stringify(extractCollectionId(singleQuoteNextDataHtml))}`);

  // A `data-id="__NEXT_DATA__"` attribute must NOT false-match a real `id`
  // attribute — the two are unrelated, and a naive \b-based match fires on
  // the "-"→"i" transition inside "data-id".
  const dataIdOnlyHtml = '<html><script data-id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"network":{"id":9911}}}}</script></html>';
  if (extractCollectionId(dataIdOnlyHtml) === null) pass('extractCollectionId() does not false-match a data-id attribute');
  else fail(`extractCollectionId() should return null for data-id-only, got ${JSON.stringify(extractCollectionId(dataIdOnlyHtml))}`);

  // fetch() auto-resolves collection_id from careers_url when getro_collection is absent.
  let fetchTextUrl = null;
  const autoJobs = await getro.fetch({ name: 'Auto Fund', careers_url: 'https://careers.examplevc.example/jobs' }, {
    fetchText: async (url) => { fetchTextUrl = url; return nextDataHtml; },
    fetchJson: async (url) => {
      if (url !== 'https://api.getro.com/api/v2/collections/9911/search/jobs') throw new Error(`unexpected collection in URL: ${url}`);
      return { results: { count: 1, jobs: [{ title: 'PM', url: 'https://careers.examplevc.example/x', organization: { name: 'Acme' } }] } };
    },
  });
  if (fetchTextUrl === 'https://careers.examplevc.example/jobs') pass('getro.fetch() auto-resolves collection_id by fetching careers_url');
  else fail(`getro.fetch() fetched careers_url = ${JSON.stringify(fetchTextUrl)}`);
  if (autoJobs.length === 1 && autoJobs[0].company === 'Acme') pass('getro.fetch() (auto-resolve) normalizes a job row');
  else fail(`getro.fetch() (auto-resolve) row = ${JSON.stringify(autoJobs[0])}`);

  // An explicit getro_collection override skips the careers_url fetch entirely.
  let overrideFetchTextCalled = false;
  await getro.fetch(okEntry, {
    fetchText: async () => { overrideFetchTextCalled = true; return nextDataHtml; },
    fetchJson: async () => ({ results: { count: 0, jobs: [] } }),
  });
  if (!overrideFetchTextCalled) pass('getro.fetch() skips the careers_url fetch when getro_collection is set');
  else fail('getro.fetch() should not fetch careers_url when getro_collection already resolves the id');

  // The auto-resolve careers_url fetch is retried too — a single request that
  // ran BEFORE pagination even started used to have no retry at all, so one
  // DNS/TLS/connection blip on it failed the whole board with zero pages fetched.
  let getroCollectionResolveAttempts = 0;
  const getroResolveRecovered = await getro.fetch({ name: 'Flaky Fund', careers_url: 'https://careers.examplevc.example/jobs' }, {
    sleep: async () => {},
    fetchText: async () => {
      getroCollectionResolveAttempts++;
      if (getroCollectionResolveAttempts < 3) throw new Error('fetch failed');
      return nextDataHtml;
    },
    fetchJson: async () => ({ results: { count: 1, jobs: [{ title: 'Recovered', url: 'https://careers.examplevc.example/x', organization: { name: 'Acme' } }] } }),
  });
  if (getroCollectionResolveAttempts === 3 && getroResolveRecovered.length === 1) {
    pass(`getro.fetch() retries the collection_id auto-resolve fetch and recovers (${getroCollectionResolveAttempts} attempts)`);
  } else {
    fail(`getro.fetch() collection_id resolve retry: ${getroCollectionResolveAttempts} attempts, ${getroResolveRecovered.length} jobs`);
  }

  // A missing/unresolvable __NEXT_DATA__ blob fails closed with an actionable message.
  let unresolvedThrew = false;
  try {
    await getro.fetch({ name: 'Broken Fund', careers_url: 'https://careers.example.com/jobs' }, {
      fetchText: async () => '<html>no next data</html>',
      fetchJson: async () => { throw new Error('should not reach the search API'); },
    });
  } catch (e) { unresolvedThrew = /could not resolve collection_id/.test(e.message); }
  if (unresolvedThrew) pass('getro.fetch() throws an actionable error when collection_id cannot be resolved');
  else fail('getro.fetch() should throw when __NEXT_DATA__ has no network.id');

  // fetch() passes redirect:'error' and a referer derived from careers_url.
  let getroOpts = null;
  const getroJobs = await getro.fetch(okEntry, {
    fetchJson: async (_url, opts) => {
      getroOpts = opts;
      // No created_at → undated job is kept ("missing = pass"), so this test is
      // robust against the rolling 90-day pagination cutoff.
      return { results: { count: 1, jobs: [{ title: 'Principal', url: 'https://jobs.examplevc.example/x', organization: { name: 'Acme' }, locations: ['Zurich'] }] } };
    },
  });
  if (getroOpts?.redirect === 'error') pass('getro.fetch() passes redirect:"error"');
  else fail(`getro.fetch() should pass redirect:"error", got ${JSON.stringify(getroOpts)}`);
  if (getroOpts?.headers?.referer === 'https://jobs.examplevc.example/') pass('getro.fetch() sends a referer derived from careers_url');
  else fail(`getro.fetch() referer header = ${JSON.stringify(getroOpts?.headers?.referer)}`);
  if (getroJobs.length === 1 && getroJobs[0].company === 'Acme' && getroJobs[0].location === 'Zurich') pass('getro.fetch() normalizes a job row');
  else fail(`getro.fetch() row = ${JSON.stringify(getroJobs[0])}`);

  // Multiple locations are joined, and a "Remote" tag is appended from work_mode.
  const getroLocations = await getro.fetch(okEntry, {
    fetchJson: async () => ({
      results: { count: 1, jobs: [{ title: 'Eng', url: 'https://jobs.examplevc.example/loc', organization: { name: 'Acme' }, locations: ['Zurich', 'Bern'], work_mode: 'remote' }] },
    }),
  });
  if (getroLocations[0]?.location === 'Zurich, Bern, Remote') pass('getro.fetch() joins multiple locations and appends a Remote tag from work_mode');
  else fail(`getro.fetch() location = ${JSON.stringify(getroLocations[0]?.location)}`);

  // Salary is extracted from the cents fields when the compensation_period is annual.
  const getroSalary = await getro.fetch(okEntry, {
    fetchJson: async () => ({
      results: {
        count: 1,
        jobs: [{
          title: 'VP Eng', url: 'https://jobs.examplevc.example/sal', organization: { name: 'Acme' },
          compensation_amount_min_cents: 12_000_000, compensation_amount_max_cents: 15_000_000,
          compensation_currency: 'EUR', compensation_period: 'year',
        }],
      },
    }),
  });
  if (getroSalary[0]?.salary?.min === 120_000 && getroSalary[0]?.salary?.max === 150_000 && getroSalary[0]?.salary?.currency === 'EUR') {
    pass('getro.fetch() extracts an annual salary range from the cents fields');
  } else {
    fail(`getro.fetch() salary = ${JSON.stringify(getroSalary[0]?.salary)}`);
  }
  const getroHourly = await getro.fetch(okEntry, {
    fetchJson: async () => ({
      results: { count: 1, jobs: [{ title: 'Contractor', url: 'https://jobs.examplevc.example/hr', organization: { name: 'Acme' }, compensation_amount_min_cents: 5000, compensation_period: 'hour' }] },
    }),
  });
  if (getroHourly[0]?.salary === undefined) pass('getro.fetch() ignores a non-annual compensation_period');
  else fail(`getro.fetch() should omit salary for compensation_period="hour", got ${JSON.stringify(getroHourly[0]?.salary)}`);

  // created_at arrives as Unix seconds; postedAt must be milliseconds.
  const getroDated = await getro.fetch(okEntry, {
    fetchJson: async () => ({
      results: { count: 1, jobs: [{ title: 'Recent', url: 'https://jobs.examplevc.example/y', organization: { name: 'Acme' }, created_at: 1_900_000_000 }] },
    }),
  });
  if (getroDated[0]?.postedAt === 1_900_000_000_000) pass('getro.fetch() converts created_at Unix seconds to epoch ms');
  else fail(`getro.fetch() postedAt = ${JSON.stringify(getroDated[0]?.postedAt)}`);

  // A pagination override must not let a board drive unbounded requests.
  let getroPages = 0;
  await getro.fetch({ ...okEntry, getro_max_pages: 1_000_000 }, {
    sleep: async () => {}, // skip the real inter-page pacing delay for this 1500-iteration test
    fetchJson: async () => {
      getroPages++;
      if (getroPages > 1500) throw new Error('getro paginated past any sane bound');
      return { results: { count: 1_000_000_000, jobs: [{ title: 'T', url: `https://jobs.examplevc.example/${getroPages}`, organization: { name: 'Acme' } }] } };
    },
  });
  if (getroPages <= 1500) pass(`getro.fetch() clamps an oversized getro_max_pages override (${getroPages} pages)`);
  else fail(`getro.fetch() made ${getroPages} requests despite the clamp`);

  // ctx.maxPages (the portal health probe passes 1) caps pagination independently of getro_max_pages.
  let getroProbePages = 0;
  await getro.fetch(okEntry, {
    maxPages: 1,
    fetchJson: async () => {
      getroProbePages++;
      return { results: { count: 100, jobs: [{ title: 'T', url: 'https://jobs.examplevc.example/p', organization: { name: 'Acme' } }] } };
    },
  });
  if (getroProbePages === 1) pass('getro.fetch() honors ctx.maxPages as a health-probe cap');
  else fail(`getro.fetch() made ${getroProbePages} requests despite ctx.maxPages=1`);

  // Postings older than getro_max_age_days stop the walk (newest-first pagination bound).
  const staleCreatedAt = Math.floor((Date.now() - 200 * 86_400_000) / 1000);
  let getroAgePages = 0;
  const getroAged = await getro.fetch({ ...okEntry, getro_max_age_days: 90 }, {
    fetchJson: async () => {
      getroAgePages++;
      return { results: { count: 100, jobs: [{ title: 'Stale', url: `https://jobs.examplevc.example/s${getroAgePages}`, organization: { name: 'Acme' }, created_at: staleCreatedAt }] } };
    },
  });
  if (getroAged.length === 0 && getroAgePages === 1) pass('getro.fetch() stops pagination once postings cross getro_max_age_days');
  else fail(`getro.fetch() age-cutoff handling: ${getroAgePages} pages, ${getroAged.length} jobs kept`);

  // A transient failure (timeout/abort — no .status set, matching a real AbortError)
  // is retried and recovers transparently instead of truncating the board (#2506).
  let getroRetryAttempts = 0;
  const getroRecovered = await getro.fetch(okEntry, {
    sleep: async () => {},
    fetchJson: async () => {
      getroRetryAttempts++;
      if (getroRetryAttempts < 3) { const err = new Error('This operation was aborted'); throw err; }
      return { results: { count: 1, jobs: [{ title: 'Recovered', url: 'https://jobs.examplevc.example/r', organization: { name: 'Acme' } }] } };
    },
  });
  if (getroRetryAttempts === 3 && getroRecovered.length === 1) pass(`getro.fetch() retries a transient failure and recovers (${getroRetryAttempts} attempts)`);
  else fail(`getro.fetch() retry recovery: ${getroRetryAttempts} attempts, ${getroRecovered.length} jobs`);

  // Once retries are exhausted on the FIRST page, fetch() throws instead of
  // returning [] — a dead/unreachable board must not be misreported as "0
  // open roles" (same rule every other paginating provider in this codebase
  // follows: radancy.mjs, phenom.mjs, cryptocurrencyjobs.mjs, etc.). Non-Error
  // rejections (a promise can reject with anything) must not crash the catch
  // itself either.
  let getroFirstPageThrew = false;
  try {
    await getro.fetch(okEntry, { sleep: async () => {}, fetchJson: async () => { throw 'plain string rejection'; } });
  } catch (e) { getroFirstPageThrew = e.message === 'plain string rejection'; }
  if (getroFirstPageThrew) pass('getro.fetch() throws (not []) when the first page fails after exhausting retries, tolerating a non-Error rejection');
  else fail('getro.fetch() should throw when the first page fails, even on a non-Error rejection');

  // A LATER page failing after retries is a graceful, partial truncation —
  // the board is alive (page 0 proved it), so keep what was already fetched.
  const getroLaterPageFail = await getro.fetch(okEntry, {
    sleep: async () => {},
    fetchJson: async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.page === 0) return { results: { count: 100, jobs: [{ title: 'First', url: 'https://jobs.examplevc.example/f', organization: { name: 'Acme' } }] } };
      throw new Error('page 1 blew up');
    },
  });
  if (getroLaterPageFail.length === 1 && getroLaterPageFail[0].title === 'First') {
    pass('getro.fetch() truncates gracefully (keeps page 0) when a LATER page fails after exhausting retries');
  } else {
    fail(`getro.fetch() later-page failure handling: ${JSON.stringify(getroLaterPageFail)}`);
  }

  // Malformed / empty payload → empty array, no crash, no infinite pagination.
  const getroEmpty = await getro.fetch(okEntry, { fetchJson: async () => ({}) });
  if (Array.isArray(getroEmpty) && getroEmpty.length === 0) pass('getro.fetch() tolerates an empty payload');
  else fail(`getro.fetch() empty handling: ${JSON.stringify(getroEmpty)}`);
} catch (e) {
  fail(`getro provider tests crashed: ${e.message}`);
}
