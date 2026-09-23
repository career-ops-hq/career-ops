// tests/providers/techinasia.test.mjs — Tech in Asia (Algolia-backed job board).
//
// Entirely offline: the Algolia app id/key discovery, the two board quirks this
// provider is built around (a shared external link across several postings, and
// shortener links), and the Algolia request wiring are all asserted against
// canned payloads in the shapes observed live on 2026-09-23 (300 live postings).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — techinasia');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/techinasia.mjs')).href);
  const techinasia = mod.default;
  const { findAppAssetPath, parseAlgoliaCredentials, resolveTechInAsiaUrl, normalizeTechInAsiaJob } = mod;

  if (techinasia.id === 'techinasia') pass('techinasia.id is "techinasia"');
  else fail(`techinasia.id is ${JSON.stringify(techinasia.id)}`);

  if (techinasia.detect({ name: 'X', careers_url: 'https://www.techinasia.com/jobs/search' }) === null) {
    pass('techinasia.detect() returns null — explicit provider only, no URL auto-detection');
  } else {
    fail('techinasia.detect() should return null for any URL');
  }

  // ── credential discovery ───────────────────────────────────────────────
  const sampleHtml = '<html><head><script src="//static.techinasia.com/assets/v5/runtime.6ab09311.js" defer></script>'
    + '<script src="//static.techinasia.com/assets/v5/app.a8ccb8ea.js" defer crossorigin></script></head></html>';

  if (findAppAssetPath(sampleHtml) === 'https://static.techinasia.com/assets/v5/app.a8ccb8ea.js') {
    pass('findAppAssetPath() resolves the hashed app bundle from the served HTML');
  } else {
    fail(`findAppAssetPath() returned ${JSON.stringify(findAppAssetPath(sampleHtml))}`);
  }

  let assetThrew = false;
  try { findAppAssetPath('<html><head></head></html>'); } catch (e) { assetThrew = /could not find the app bundle/.test(e.message); }
  if (assetThrew) pass('findAppAssetPath() throws when the app bundle reference is absent');
  else fail('findAppAssetPath() should throw when the bundle path cannot be found');

  const credentials = parseAlgoliaCredentials(
    'var d={algolia:{apiKey:"b528008a75dc1c4402bfe0d8db8b3f8e",appId:"219WX3MPV4",jobPostingIndex:"job_postings"}};',
  );
  if (credentials.appId === '219WX3MPV4' && credentials.apiKey === 'b528008a75dc1c4402bfe0d8db8b3f8e') {
    pass('parseAlgoliaCredentials() extracts appId + apiKey from the bundle config');
  } else {
    fail(`parseAlgoliaCredentials() returned ${JSON.stringify(credentials)}`);
  }

  let credThrew = false;
  try { parseAlgoliaCredentials('var x = 1;'); } catch (e) { credThrew = /credentials not found/.test(e.message); }
  if (credThrew) pass('parseAlgoliaCredentials() throws when the bundle carries no credentials');
  else fail('parseAlgoliaCredentials() should throw when the credentials are absent');

  // ── canonical URL resolution ───────────────────────────────────────────
  const employerLink = { id: 'abc', external_link: 'https://acme.wd3.myworkdayjobs.com/en-US/careers/job/123' };
  if (resolveTechInAsiaUrl(employerLink) === employerLink.external_link) {
    pass('resolveTechInAsiaUrl() prefers a verifiable employer application link (rule 2)');
  } else {
    fail(`resolveTechInAsiaUrl() employer link = ${JSON.stringify(resolveTechInAsiaUrl(employerLink))}`);
  }

  const shortener = { id: 'abc', external_link: 'https://bit.ly/LamarCO' };
  if (resolveTechInAsiaUrl(shortener) === 'https://www.techinasia.com/jobs/abc') {
    pass('resolveTechInAsiaUrl() rejects a URL shortener in favour of the posting page');
  } else {
    fail(`resolveTechInAsiaUrl() shortener = ${JSON.stringify(resolveTechInAsiaUrl(shortener))}`);
  }

  // The live collision: five roles sharing one intake form must stay five rows.
  const shared = 'https://noteforms.com/forms/playmakers-job-applicant-form-xufov8';
  const sharedLinks = new Set([shared]);
  const collided = { id: 'abc', external_link: shared };
  if (resolveTechInAsiaUrl(collided, sharedLinks) === 'https://www.techinasia.com/jobs/abc') {
    pass('resolveTechInAsiaUrl() rejects an external link shared by several postings');
  } else {
    fail(`resolveTechInAsiaUrl() shared link = ${JSON.stringify(resolveTechInAsiaUrl(collided, sharedLinks))}`);
  }

  if (resolveTechInAsiaUrl({ external_link: 'http://acme.example.com/x' }) === ''
      && resolveTechInAsiaUrl({}) === '') {
    pass('resolveTechInAsiaUrl() returns "" when nothing usable can be built');
  } else {
    fail('resolveTechInAsiaUrl() should return "" for non-https-only and empty rows');
  }

  // ── normalization ──────────────────────────────────────────────────────
  // `company` travels as a JSON-encoded string in the index (a live quirk).
  const liveHit = {
    id: 'be77acf6-950a-4615-be1a-8b5c62f89594',
    title: 'Senior Manager Operation',
    company: JSON.stringify({ name: 'PT. Wahana Pembayaran Digital', entity_slug: 'pt-wahana' }),
    city: { name: 'Jakarta', country_name: 'Indonesia' },
    published_at: '2026-09-23 09:35:45',
    is_remote: 0,
    external_link: '',
    description: '<p><strong>Job Description:</strong></p><ul><li>Own the payment gateway.</li></ul>',
    is_boosted: true,
  };

  const parsed = normalizeTechInAsiaJob(liveHit, 'Tech in Asia');
  if (
    parsed
    && parsed.title === 'Senior Manager Operation'
    && parsed.url === 'https://www.techinasia.com/jobs/be77acf6-950a-4615-be1a-8b5c62f89594'
  ) {
    pass('normalizeTechInAsiaJob builds the posting-page URL when there is no external link');
  } else {
    fail(`normalizeTechInAsiaJob returned ${JSON.stringify(parsed)}`);
  }

  if (parsed?.company === 'PT. Wahana Pembayaran Digital') {
    pass('normalizeTechInAsiaJob parses the JSON-encoded company string');
  } else {
    fail(`normalizeTechInAsiaJob company = ${JSON.stringify(parsed?.company)}`);
  }

  if (parsed?.location === 'Jakarta, Indonesia') pass('normalizeTechInAsiaJob joins city + country');
  else fail(`normalizeTechInAsiaJob location = ${JSON.stringify(parsed?.location)}`);

  if (parsed?.postedAt === Date.parse('2026-09-23T09:35:45Z')) {
    pass('normalizeTechInAsiaJob reads the zone-less published_at as UTC');
  } else {
    fail(`normalizeTechInAsiaJob postedAt = ${JSON.stringify(parsed?.postedAt)}`);
  }

  if (parsed?.description === 'Job Description: Own the payment gateway.') {
    pass('normalizeTechInAsiaJob flattens the HTML description to plain text');
  } else {
    fail(`normalizeTechInAsiaJob description = ${JSON.stringify(parsed?.description)}`);
  }

  if (parsed?.salary === undefined) pass('normalizeTechInAsiaJob never attaches salary (the index fields are flags, not money)');
  else fail(`normalizeTechInAsiaJob attached salary ${JSON.stringify(parsed?.salary)}`);

  const remoteHit = normalizeTechInAsiaJob({ id: 'r', title: 'Role', is_remote: 1, city: { name: 'Bandung' } }, 'X');
  if (remoteHit?.location === 'Bandung, Remote') pass('normalizeTechInAsiaJob appends "Remote" when is_remote is set');
  else fail(`normalizeTechInAsiaJob remote location = ${JSON.stringify(remoteHit?.location)}`);

  const objectCompany = normalizeTechInAsiaJob({ id: 'c', title: 'Role', company: { name: 'Acme' } }, 'X');
  if (objectCompany?.company === 'Acme') pass('normalizeTechInAsiaJob tolerates company as a real object');
  else fail(`normalizeTechInAsiaJob object company = ${JSON.stringify(objectCompany?.company)}`);

  const fallbackCompany = normalizeTechInAsiaJob({ id: 'f', title: 'Role', company: 'not-json' }, 'PortalName');
  if (fallbackCompany?.company === 'PortalName') pass('normalizeTechInAsiaJob falls back to the portal entry name');
  else fail(`normalizeTechInAsiaJob fallback company = ${JSON.stringify(fallbackCompany?.company)}`);

  if (normalizeTechInAsiaJob({ id: '1' }, 'X') === null) pass('normalizeTechInAsiaJob returns null for title-less hits');
  else fail('normalizeTechInAsiaJob should return null for a hit without a title');
  if (normalizeTechInAsiaJob({ title: 'Role' }, 'X') === null) pass('normalizeTechInAsiaJob returns null when no URL can be built');
  else fail('normalizeTechInAsiaJob should return null for a hit with neither id nor external link');
  if (normalizeTechInAsiaJob(null, 'X') === null && normalizeTechInAsiaJob(7, 'X') === null) {
    pass('normalizeTechInAsiaJob handles null/number input safely');
  } else {
    fail('normalizeTechInAsiaJob should return null for null/non-object input');
  }

  // ── fetch() ────────────────────────────────────────────────────────────
  const appJs = 'var d={algolia:{apiKey:"b528008a75dc1c4402bfe0d8db8b3f8e",appId:"219WX3MPV4",jobPostingIndex:"job_postings"}};';
  const hits = [
    { id: 'a', title: 'Engineer', city: { name: 'Jakarta', country_name: 'Indonesia' } },
    { id: 'b', title: 'Designer', city: { name: 'Jakarta', country_name: 'Indonesia' } },
  ];
  const textCalls = [];
  const jsonCalls = [];
  const fetched = await techinasia.fetch(
    { name: 'Tech in Asia', provider: 'techinasia' },
    {
      fetchText: async (url, opts) => { textCalls.push({ url, opts }); return url.includes('/jobs/search') ? sampleHtml : appJs; },
      fetchJson: async (url, opts) => { jsonCalls.push({ url, opts }); return { results: [{ hits, nbPages: 1 }] }; },
    },
  );

  if (textCalls.length === 2
      && textCalls[0].url === 'https://www.techinasia.com/jobs/search'
      && textCalls[1].url === 'https://static.techinasia.com/assets/v5/app.a8ccb8ea.js') {
    pass('techinasia.fetch() discovers credentials from the search page then its app bundle');
  } else {
    fail(`techinasia.fetch() text calls = ${JSON.stringify(textCalls.map((c) => c.url))}`);
  }

  if (textCalls.every((c) => c.opts?.redirect === 'error')) {
    pass('techinasia.fetch() passes redirect:"error" on every discovery request (SSRF guard)');
  } else {
    fail(`techinasia.fetch() discovery redirect = ${JSON.stringify(textCalls.map((c) => c.opts))}`);
  }

  const algoliaUrl = jsonCalls[0]?.url || '';
  // Parsed, not prefix-matched: `algoliaUrl.startsWith('https://<host>/…')` is the
  // same incomplete-URL-check shape CodeQL flags, and it would also accept a URL
  // carrying that text somewhere other than the host.
  const algoliaParsed = new URL(algoliaUrl || 'https://invalid.example/');
  const algoliaParams = algoliaParsed.searchParams;
  if (
    algoliaParsed.hostname === '219wx3mpv4-dsn.algolia.net'
    && algoliaParsed.pathname === '/1/indexes/*/queries'
    && algoliaParams.get('x-algolia-application-id') === '219WX3MPV4'
    && algoliaParams.get('x-algolia-api-key') === 'b528008a75dc1c4402bfe0d8db8b3f8e'
  ) {
    pass('techinasia.fetch() sends both credentials as Algolia query parameters (they are not headers)');
  } else {
    fail(`techinasia.fetch() Algolia URL = ${JSON.stringify(algoliaUrl)}`);
  }

  if (jsonCalls[0]?.opts?.method === 'POST' && jsonCalls[0]?.opts?.redirect === 'error') {
    pass('techinasia.fetch() POSTs the query with redirect:"error"');
  } else {
    fail(`techinasia.fetch() Algolia call opts = ${JSON.stringify(jsonCalls[0]?.opts)}`);
  }

  if (jsonCalls[0]?.opts?.headers?.referer === 'https://www.techinasia.com/') {
    pass('techinasia.fetch() sends the referer the key is gated on');
  } else {
    fail(`techinasia.fetch() referer = ${JSON.stringify(jsonCalls[0]?.opts?.headers)}`);
  }

  if (JSON.parse(jsonCalls[0]?.opts?.body || '{}').requests?.[0]?.indexName === 'job_postings') {
    pass('techinasia.fetch() queries the job_postings index');
  } else {
    fail(`techinasia.fetch() body = ${JSON.stringify(jsonCalls[0]?.opts?.body)}`);
  }

  if (fetched.length === 2 && fetched[0].title === 'Engineer') {
    pass('techinasia.fetch() returns the normalized hits');
  } else {
    fail(`techinasia.fetch() returned ${JSON.stringify(fetched)}`);
  }

  // The inventory regression this provider exists to avoid: one form, five roles.
  const sharedBatch = Array.from({ length: 5 }, (_, i) => ({
    id: `id-${i}`,
    title: `Role ${i}`,
    external_link: shared,
    city: { name: 'Jakarta', country_name: 'Indonesia' },
  }));
  const keptBatch = await techinasia.fetch(
    { name: 'Tech in Asia', provider: 'techinasia' },
    {
      fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
      fetchJson: async () => ({ results: [{ hits: sharedBatch, nbPages: 1 }] }),
    },
  );
  if (keptBatch.length === 5) {
    pass('techinasia.fetch() keeps all 5 postings that share one intake-form link (no inventory loss)');
  } else {
    fail(`techinasia.fetch() collapsed a shared-link batch to ${keptBatch.length} row(s) — expected 5`);
  }

  // One page of hits, nbPages=2 → the loop must follow it.
  let calls = 0;
  const paged = await techinasia.fetch(
    { name: 'Tech in Asia', provider: 'techinasia', maxPages: 3 },
    {
      fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
      fetchJson: async () => { calls += 1; return { results: [{ hits: [{ id: `p${calls}`, title: `Role ${calls}` }], nbPages: 2 }] }; },
    },
  );
  if (calls === 2 && paged.length === 2) pass('techinasia.fetch() follows nbPages and stops at the last page');
  else fail(`techinasia.fetch() pagination = ${calls} call(s), ${paged.length} job(s)`);

  // An empty index is an empty result, not an error.
  const emptyIndex = await techinasia.fetch(
    { name: 'X', provider: 'techinasia' },
    {
      fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
      fetchJson: async () => ({ results: [{ hits: [], nbPages: 0 }] }),
    },
  );
  if (Array.isArray(emptyIndex) && emptyIndex.length === 0) pass('techinasia.fetch() returns [] for an empty index');
  else fail(`techinasia.fetch() empty index = ${JSON.stringify(emptyIndex)}`);

  // The provider's own page cap stops a source that reports endless results.
  // console.warn is captured so the "raise max_pages" advice is asserted rather
  // than assumed: it must fire here, and must NOT fire for a ctx.maxPages cap or
  // after a fetch error.
  const realWarn = console.warn;
  const capWarnings = [];
  console.warn = (msg) => capWarnings.push(String(msg));
  let capCalls = 0;
  try {
    await techinasia.fetch(
      { name: 'X', provider: 'techinasia' },
      {
        fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
        fetchJson: async () => {
          capCalls += 1;
          return { results: [{ hits: [{ id: `h${capCalls}`, title: `Role ${capCalls}` }], nbPages: 999 }] };
        },
        sleep: async () => {},
      },
    );
  } finally {
    console.warn = realWarn;
  }
  if (capCalls === 5) pass('techinasia.fetch() stops at its own DEFAULT_MAX_PAGES (5) when the source reports more pages');
  else fail(`techinasia.fetch() page cap = ${capCalls} call(s) (expected 5)`);
  if (capWarnings.length === 1 && /raise max_pages/.test(capWarnings[0])) {
    pass('techinasia.fetch() warns that the cap cut a healthy board short');
  } else {
    fail(`techinasia.fetch() truncation warnings = ${JSON.stringify(capWarnings)}`);
  }

  // A probe asks whether the board is live, not what it contains.
  let probeCalls = 0;
  const probeWarnings = [];
  console.warn = (msg) => probeWarnings.push(String(msg));
  let probe;
  try {
    probe = await techinasia.fetch(
      { name: 'X', provider: 'techinasia', max_pages: 5 },
      {
        fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
        fetchJson: async () => {
          probeCalls += 1;
          return { results: [{ hits: [{ id: `q${probeCalls}`, title: `Role ${probeCalls}` }], nbPages: 999 }] };
        },
        sleep: async () => {},
        maxPages: 1,
      },
    );
  } finally {
    console.warn = realWarn;
  }
  if (probeCalls === 1 && probe.length === 1) {
    pass('techinasia.fetch() honors ctx.maxPages (health probe reads one page only)');
  } else {
    fail(`techinasia.fetch() probe = ${probeCalls} request(s), ${probe.length} job(s)`);
  }
  if (probeWarnings.length === 0) {
    pass('techinasia.fetch() does not advise raising max_pages for a ctx.maxPages cap');
  } else {
    fail(`techinasia.fetch() warned during a probe: ${JSON.stringify(probeWarnings)}`);
  }

  // ── Contentless bodies are an empty board, not a broken one ───────────
  for (const emptyBody of [null, {}, { results: [] }]) {
    let threwOnEmpty = false;
    let emptyResult = null;
    try {
      emptyResult = await techinasia.fetch(
        { name: 'X', provider: 'techinasia' },
        {
          fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
          fetchJson: async () => emptyBody,
          sleep: async () => {},
        },
      );
    } catch {
      threwOnEmpty = true;
    }
    if (!threwOnEmpty && Array.isArray(emptyResult) && emptyResult.length === 0) {
      pass(`techinasia.fetch() returns [] for a contentless body ${JSON.stringify(emptyBody)}`);
    } else {
      fail(`techinasia.fetch() contentless body ${JSON.stringify(emptyBody)} threw=${threwOnEmpty}`);
    }
  }

  // ── Bounded retry: a 429 is retried, then the policy applies ──────────
  let attempts = 0;
  let retriedThenThrew = false;
  try {
    await techinasia.fetch(
      { name: 'X', provider: 'techinasia' },
      {
        fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
        fetchJson: async () => {
          attempts += 1;
          const err = new Error('HTTP 429 Too Many Requests');
          err.status = 429;
          throw err;
        },
        sleep: async () => {},
      },
    );
  } catch (e) {
    retriedThenThrew = /429/.test(e.message);
  }
  if (retriedThenThrew && attempts === 3) {
    pass('techinasia.fetch() retries a 429 twice (3 attempts) then fails loud on page 1');
  } else {
    fail(`techinasia.fetch() retry exhaustion = ${attempts} attempt(s), threw=${retriedThenThrew}`);
  }

  // ── A lone surrogate in the host-controlled id drops only that row ────
  const surrogateRun = await techinasia.fetch(
    { name: 'X', provider: 'techinasia' },
    {
      fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
      fetchJson: async () => ({
        results: [
          {
            hits: [
              { id: 'ok-1', title: 'Good Role', city: { name: 'Jakarta' } },
              { id: '\uD800bad', title: 'Bad Id', city: { name: 'Jakarta' } },
            ],
            nbPages: 1,
          },
        ],
      }),
      sleep: async () => {},
    },
  );
  if (surrogateRun.length === 1 && surrogateRun[0].url === 'https://www.techinasia.com/jobs/ok-1') {
    pass('techinasia.fetch() drops only the hit whose id holds a lone surrogate (no URIError abort)');
  } else {
    fail(`techinasia.fetch() surrogate run = ${JSON.stringify(surrogateRun.map((j) => j.url))}`);
  }

  // Malformed payloads fail loudly.
  let threw = false;
  try {
    await techinasia.fetch(
      { name: 'X', provider: 'techinasia' },
      {
        fetchText: async (url) => (url.includes('/jobs/search') ? sampleHtml : appJs),
        fetchJson: async () => ({ nope: true }),
      },
    );
  } catch (e) {
    threw = /unexpected Algolia response/.test(e.message);
  }
  if (threw) pass('techinasia.fetch() throws on an unexpected Algolia response shape');
  else fail('techinasia.fetch() should throw when results[0].hits is absent');

  // An explicit credential override skips discovery entirely.
  let overrideText = 0;
  await techinasia.fetch(
    { name: 'X', provider: 'techinasia', techinasia: { appId: 'ABCDEF123456', apiKey: 'a'.repeat(32) } },
    {
      fetchText: async () => { overrideText += 1; return ''; },
      fetchJson: async (url) => {
        // Parsed hostname, not a substring sweep: `url.includes('<host>')` passes
        // for `https://evil.test/?<host>`, which is exactly what the CodeQL alert
        // (js/incomplete-url-substring-sanitization) is about.
        if (new URL(url).hostname !== 'abcdef123456-dsn.algolia.net') throw new Error(`wrong host: ${url}`);
        return { results: [{ hits: [], nbPages: 1 }] };
      },
    },
  );
  if (overrideText === 0) pass('techinasia.fetch() skips discovery when the entry supplies credentials');
  else fail(`techinasia.fetch() made ${overrideText} discovery request(s) despite an override`);
} catch (e) {
  fail(`techinasia suite crashed: ${e.message}`);
}
