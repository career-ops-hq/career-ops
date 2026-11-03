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

  // ctx.idCache — the collection id is kept per board host between scans.
  const memCache = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return { values, get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  };
  const searchOnly = (id) => async (url) => {
    if (url !== `https://api.getro.com/api/v2/collections/${id}/search/jobs`) throw new Error(`unexpected collection in URL: ${url}`);
    return { results: { count: 0, jobs: [] } };
  };
  const autoEntry = { name: 'Auto Fund', careers_url: 'https://Careers.ExampleVC.example/jobs' };

  const hitCache = memCache({ 'careers.examplevc.example': { id: '5555', checkedAt: new Date().toISOString() } });
  let hitPageCalls = 0;
  await getro.fetch(autoEntry, { idCache: hitCache, fetchText: async () => { hitPageCalls++; return nextDataHtml; }, fetchJson: searchOnly('5555') });
  if (hitPageCalls === 0) pass('getro.fetch() uses a cached collection id (keyed by the lower-cased board host) without reading the board page');
  else fail(`getro.fetch() cache hit still read the board page ${hitPageCalls} time(s)`);

  const missCache = memCache();
  await getro.fetch(autoEntry, { idCache: missCache, fetchText: async () => nextDataHtml, fetchJson: searchOnly('9911') });
  const storedCollection = missCache.values.get('careers.examplevc.example');
  if (storedCollection?.id === '9911' && Number.isFinite(Date.parse(storedCollection.checkedAt))) pass('getro.fetch() stores a resolved collection id as { id, checkedAt }');
  else fail(`getro.fetch() cache miss stored ${JSON.stringify(storedCollection)}`);

  const oldCheck = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const pageGoneCache = memCache({ 'careers.examplevc.example': { id: '5555', checkedAt: oldCheck } });
  let pageGoneSearchUrl = null;
  await getro.fetch(autoEntry, {
    idCache: pageGoneCache,
    fetchText: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); },
    fetchJson: async (url) => { pageGoneSearchUrl = url; return { results: { count: 0, jobs: [] } }; },
  });
  if (pageGoneSearchUrl?.includes('/collections/5555/') && pageGoneCache.values.get('careers.examplevc.example')?.id === '5555') {
    pass('getro.fetch() keeps a cached collection id when the recheck of the board page fails, even with 404');
  } else {
    fail(`getro.fetch() failed recheck wrong: search=${pageGoneSearchUrl}, cached=${JSON.stringify(pageGoneCache.values.get('careers.examplevc.example'))}`);
  }

  const apiGoneCache = memCache({ 'careers.examplevc.example': { id: '5555', checkedAt: new Date().toISOString() } });
  let apiGoneError = null;
  try {
    await getro.fetch(autoEntry, {
      idCache: apiGoneCache,
      fetchJson: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); },
    });
  } catch (err) {
    apiGoneError = err;
  }
  if (apiGoneError?.status === 404 && !apiGoneCache.values.has('careers.examplevc.example')) {
    pass('getro.fetch() drops the cached collection id when the search API answers 404, and still throws');
  } else {
    fail(`getro.fetch() API 404 wrong: error=${apiGoneError?.status}, cached=${apiGoneCache.values.has('careers.examplevc.example')}`);
  }

  const overrideCache = memCache({ 'jobs.examplevc.example': { id: '5555', checkedAt: new Date().toISOString() } });
  await getro.fetch(okEntry, { idCache: overrideCache, fetchJson: searchOnly('4283') });
  if (overrideCache.values.get('jobs.examplevc.example').id === '5555') pass('getro.fetch() lets getro_collection win over a cached id and leaves the cache alone');
  else fail('getro.fetch() should not touch the cache when getro_collection is set');

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

  // A board can pin `featured` postings above the newest-first order. An old pin
  // is dropped, but it must not stop the walk: the pages after it are still new.
  const freshCreatedAt = Math.floor((Date.now() - 2 * 86_400_000) / 1000);
  const row = (id, createdAt, featured = false) => ({ title: id, url: `https://jobs.examplevc.example/${id}`, organization: { name: 'Acme' }, created_at: createdAt, featured });
  const pinnedPages = [
    [row('pin-fresh', freshCreatedAt, true), row('pin-old', staleCreatedAt, true), row('a', freshCreatedAt)],
    [row('b', freshCreatedAt)],
    [row('c', staleCreatedAt), row('d', freshCreatedAt)],
    [row('never-read', freshCreatedAt)],
  ];
  let pinnedCalls = 0;
  const pinned = await getro.fetch({ ...okEntry, getro_max_age_days: 90 }, {
    fetchJson: async () => {
      const jobs = pinnedPages[pinnedCalls++] || [];
      return { results: { count: 80, jobs } };
    },
  });
  const pinnedTitles = pinned.map((j) => j.title).join(',');
  if (pinnedCalls === 3 && pinnedTitles === 'pin-fresh,a,b,d') {
    pass('getro.fetch() drops an old featured pin without stopping the walk, and still stops at an old posting in order');
  } else {
    fail(`getro.fetch() featured pin: ${pinnedCalls} pages, kept ${pinnedTitles}`);
  }

  // The page cap warns only when it is what ended the walk with postings left.
  // Undated rows, so the age cutoff never applies unless a case dates them.
  // `count: undefined` leaves the board's count out of the response; `lastPageRows`
  // shortens the last page; `failPage` makes that page throw.
  const capRun = async (entryExtra, { count, pages, maxPages, lastPageCreatedAt, lastPageRows = 20, failPage } = {}) => {
    const warnings = [];
    const origError = console.error;
    console.error = (m) => warnings.push(String(m));
    let calls = 0;
    let jobsOut = [];
    try {
      jobsOut = await getro.fetch({ ...okEntry, ...entryExtra }, {
        ...(maxPages ? { maxPages } : {}),
        sleep: async () => {},
        fetchJson: async (_url, opts) => {
          calls++;
          // The page index from the request body, not the call count, so a retry
          // of a failed page asks for that page again.
          const p = JSON.parse(opts.body).page;
          if (p === failPage) throw new Error(`page ${p} blew up`);
          const withCount = (jobs) => ({ results: { ...(count === undefined ? {} : { count }), jobs } });
          if (p >= pages) return withCount([]);
          const rows = p === pages - 1 ? lastPageRows : 20;
          return withCount(Array.from({ length: rows }, (_, i) => ({
            title: `t${p}-${i}`, url: `https://jobs.examplevc.example/cap-${p}-${i}`, organization: { name: 'Acme' },
            ...(p === pages - 1 && lastPageCreatedAt ? { created_at: lastPageCreatedAt } : {}),
          })));
        },
      });
    } finally {
      console.error = origError;
    }
    return { calls, jobs: jobsOut.length, warnings, capWarnings: warnings.filter((w) => w.includes('getro_max_pages')) };
  };

  const capHit = await capRun({ getro_max_pages: 2 }, { count: 100, pages: 5 });
  if (capHit.calls === 2 && capHit.capWarnings.length === 1
      && capHit.capWarnings[0].includes('ExampleVC truncated at getro_max_pages=2 (40 of 100 jobs)')) {
    pass('getro.fetch() warns, naming the entry, when getro_max_pages ends the walk with postings left');
  } else {
    fail(`getro.fetch() cap warning: ${capHit.calls} pages, warnings ${JSON.stringify(capHit.capWarnings)}`);
  }

  // At the hard cap, raising getro_max_pages reads nothing more, so the warning
  // must not tell the user to; below it, it does.
  const capHard = await capRun({ getro_max_pages: 5000 }, { count: 40000, pages: 1600 });
  if (capHard.calls === 1500 && capHard.capWarnings.length === 1
      && capHard.capWarnings[0].includes('truncated at getro_max_pages=1500 (30000 of 40000 jobs) — the 1500-page hard cap')
      && !capHard.capWarnings[0].includes('raise getro_max_pages on this entry')
      && capHit.capWarnings[0]?.includes('— raise getro_max_pages on this entry for more')) {
    pass('getro.fetch() names the hard cap instead of advising a higher getro_max_pages when it is the 1500-page ceiling');
  } else {
    fail(`getro.fetch() hard-cap warning: ${capHard.calls} pages, ${JSON.stringify(capHard.capWarnings)}`);
  }

  const capExact = await capRun({ getro_max_pages: 2 }, { count: 40, pages: 2 });
  const capProbe = await capRun({ getro_max_pages: 2 }, { count: 100, pages: 5, maxPages: 1 });
  const capAged = await capRun({ getro_max_pages: 2, getro_max_age_days: 90 }, { count: 100, pages: 2, lastPageCreatedAt: staleCreatedAt });
  if (capExact.capWarnings.length === 0 && capProbe.capWarnings.length === 0 && capAged.capWarnings.length === 0) {
    pass('getro.fetch() does not warn when the board ends at the cap, a ctx.maxPages probe cuts it, or the age cutoff ends the last page');
  } else {
    fail(`getro.fetch() cap warning misfired: exact ${capExact.capWarnings.length}, probe ${capProbe.capWarnings.length}, aged ${capAged.capWarnings.length}`);
  }

  // A short last page means the board ended there, even when the count is
  // missing or claims more.
  const capShortNoCount = await capRun({ getro_max_pages: 2 }, { count: undefined, pages: 2, lastPageRows: 15 });
  const capShortOverCount = await capRun({ getro_max_pages: 2 }, { count: 100, pages: 2, lastPageRows: 15 });
  const capFullNoCount = await capRun({ getro_max_pages: 2 }, { count: undefined, pages: 5 });
  if (capShortNoCount.capWarnings.length === 0 && capShortOverCount.capWarnings.length === 0
      && capFullNoCount.capWarnings.length === 1 && capFullNoCount.capWarnings[0].includes('(40 jobs)')) {
    pass('getro.fetch() treats a short last page as the board ending, with or without a count, and still warns on a full one with no count');
  } else {
    fail(`getro.fetch() short last page: no count ${capShortNoCount.capWarnings.length}, count 100 ${capShortOverCount.capWarnings.length}, full with no count ${JSON.stringify(capFullNoCount.capWarnings)}`);
  }

  // A probe cap equal to the entry's cap is still the probe's cut.
  const capProbeEqual = await capRun({ getro_max_pages: 1 }, { count: 100, pages: 5, maxPages: 1 });
  // The last allowed page failing ends the walk on the error, not the cap.
  const capFailLast = await capRun({ getro_max_pages: 2 }, { count: 100, pages: 5, failPage: 1 });
  if (capProbeEqual.capWarnings.length === 0 && capProbeEqual.calls === 1
      && capFailLast.capWarnings.length === 0 && capFailLast.jobs === 20
      && capFailLast.warnings.some((w) => w.includes('truncated at page 1 after retries'))) {
    pass('getro.fetch() does not warn on the cap when a probe cap equals it, or when the last allowed page fails');
  } else {
    fail(`getro.fetch() cap warning: probe=cap ${capProbeEqual.capWarnings.length} (${capProbeEqual.calls} calls), failed last page ${capFailLast.capWarnings.length} (${capFailLast.jobs} jobs, ${JSON.stringify(capFailLast.warnings)})`);
  }

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
