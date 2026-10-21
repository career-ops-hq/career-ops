// tests/providers/platsbanken.test.mjs
import { pass, fail, ROOT, rmSync } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — platsbanken');

/** One ad in the documented JobSearch shape, overridable per case. */
const ad = (over = {}) => ({
  id: '31581608',
  headline: 'Backend engineer',
  webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/31581608',
  publication_date: '2026-10-12T06:38:05',
  application_deadline: '2026-11-11T23:59:59',
  source_type: 'VIA_JOBPOSTING',
  employer: { name: 'Acme AB', workplace: 'Distans' },
  description: { text: 'Build the thing.' },
  workplace_address: { city: 'Stockholm', municipality: 'Stockholm', region: 'Stockholms län', country: 'Sverige' },
  ...over,
});

const response = (hits) => ({ total: { value: hits.length }, positions: hits.length, hits });

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/platsbanken.mjs')).href);
  const platsbanken = mod.default;
  const { parsePlatsbankenConfig, buildSearchUrl, postingUrl, parsePlatsbankenResponse, rawHitCount } = mod;

  if (platsbanken.id === 'platsbanken') pass('platsbanken.id is "platsbanken"');
  else fail(`platsbanken.id is ${JSON.stringify(platsbanken.id)}`);

  // ── detect(): explicit-only. There is no user-facing URL pattern that
  // identifies this API, so it must never claim an entry the user did not
  // point at it. ──
  {
    const hit = platsbanken.detect({ name: 'Platsbanken', provider: 'platsbanken' });
    if (hit && hit.url === 'https://jobsearch.api.jobtechdev.se/search') {
      pass('platsbanken.detect() claims explicit provider config');
    } else {
      fail(`platsbanken.detect() returned ${JSON.stringify(hit)}`);
    }

    for (const [label, entry] of [
      ['another provider id', { name: 'X', provider: 'arbeitsagentur' }],
      ['a bare careers_url', { name: 'X', careers_url: 'https://arbetsformedlingen.se/platsbanken/' }],
      ['junk input', null],
    ]) {
      let out;
      try {
        out = platsbanken.detect(entry);
      } catch (err) {
        fail(`platsbanken.detect() threw on ${label}: ${err.message}`);
        continue;
      }
      if (out === null) pass(`platsbanken.detect() returns null for ${label} (no throw)`);
      else fail(`platsbanken.detect() should return null for ${label}, got ${JSON.stringify(out)}`);
    }
  }

  // ── parsePlatsbankenConfig ──
  {
    const got = parsePlatsbankenConfig({ platsbanken: { keywords: [' engineer ', 'systemutvecklare', '', 42, null] } });
    if (JSON.stringify(got) === JSON.stringify({ keywords: ['engineer', 'systemutvecklare'] })) {
      pass('parsePlatsbankenConfig trims keywords and drops blank/non-string entries');
    } else {
      fail(`parsePlatsbankenConfig returned ${JSON.stringify(got)}`);
    }

    if (parsePlatsbankenConfig({}).keywords.length === 0 && parsePlatsbankenConfig({ platsbanken: {} }).keywords.length === 0) {
      pass('parsePlatsbankenConfig defaults to no keywords when the block or array is absent');
    } else {
      fail('parsePlatsbankenConfig should default to an empty keywords array');
    }
  }

  // ── buildSearchUrl: pins host, path and the source's own paging params.
  // Page 1 is offset 0 — `offset` is a row offset, not a page number. ──
  {
    const first = new URL(buildSearchUrl('backend developer', 1));
    const third = new URL(buildSearchUrl('backend developer', 3));
    const ok = first.origin + first.pathname === 'https://jobsearch.api.jobtechdev.se/search'
      && first.searchParams.get('q') === 'backend developer'
      && first.searchParams.get('limit') === '100'
      && first.searchParams.get('offset') === '0'
      && third.searchParams.get('offset') === '200';
    if (ok) pass('buildSearchUrl pins the search endpoint, q, limit=100 and offset=(page-1)*100');
    else fail(`buildSearchUrl returned ${buildSearchUrl('backend developer', 3)}`);
  }

  // ── postingUrl: rebuilt from the ad id against a fixed literal host, so the
  // payload's own webpage_url field is never trusted. ──
  {
    if (postingUrl('31581608') === 'https://arbetsformedlingen.se/platsbanken/annonser/31581608') {
      pass('postingUrl builds the permalink from the ad id');
    } else {
      fail(`postingUrl returned ${JSON.stringify(postingUrl('31581608'))}`);
    }

    if (postingUrl(null) === null && postingUrl(undefined) === null && postingUrl('') === null) {
      pass('postingUrl returns null for a missing/empty id');
    } else {
      fail('postingUrl should return null for a missing/empty id');
    }

    // A lone UTF-16 surrogate escapes JSON.parse; encodeURIComponent would
    // throw URIError and lose the whole page, so the helper must return null
    // and the caller must drop exactly that row (url-encoding-surrogate.test.mjs).
    if (postingUrl('\uD800') === null) {
      pass('postingUrl returns null for a lone surrogate rather than throwing');
    } else {
      fail(`postingUrl on a lone surrogate returned ${JSON.stringify(postingUrl('\uD800'))}`);
    }
  }

  // ── parsePlatsbankenResponse: normalization ──
  {
    const jobs = parsePlatsbankenResponse(response([ad()]));
    const job = jobs[0];
    if (jobs.length === 1 && job.title === 'Backend engineer' && job.company === 'Acme AB'
      && job.location === 'Stockholm' && job.description === 'Build the thing.'
      && job.url === 'https://arbetsformedlingen.se/platsbanken/annonser/31581608'
      && job.externalId === '31581608') {
      pass('parsePlatsbankenResponse maps headline/employer/location/description/url/externalId');
    } else {
      fail(`parsePlatsbankenResponse row = ${JSON.stringify(job)}`);
    }

    if (job.postedAt === Date.parse('2026-10-12T06:38:05')) {
      pass('parsePlatsbankenResponse parses publication_date to postedAt');
    } else {
      fail(`postedAt = ${JSON.stringify(job.postedAt)}`);
    }

    // `Date.parse(s) || undefined` would null a valid epoch 0 (1970-01-01).
    const epochJob = parsePlatsbankenResponse(response([ad({ publication_date: '1970-01-01T00:00:00Z' })]))[0];
    if (epochJob.postedAt === 0) {
      pass('parsePlatsbankenResponse keeps epoch 0 (a NaN-safe date helper, not `|| undefined`)');
    } else {
      fail(`epoch-0 postedAt = ${JSON.stringify(epochJob.postedAt)}`);
    }

    const undated = parsePlatsbankenResponse(response([ad({ publication_date: 'not a date' })]))[0];
    if (undated.postedAt === undefined && !('postedAt' in undated)) {
      pass('parsePlatsbankenResponse omits postedAt when the date does not parse');
    } else {
      fail(`unparseable date produced postedAt = ${JSON.stringify(undated.postedAt)}`);
    }

    // Location falls back city → municipality → region → country, and is '' —
    // never undefined — when the ad carries no address at all.
    const fallbacks = [
      [{ municipality: 'Göteborg', region: 'Västra Götalands län', country: 'Sverige' }, 'Göteborg'],
      [{ region: 'Skåne län', country: 'Sverige' }, 'Skåne län'],
      [{ country: 'Sverige' }, 'Sverige'],
      [{}, ''],
    ];
    let locationOk = true;
    for (const [address, expected] of fallbacks) {
      const got = parsePlatsbankenResponse(response([ad({ workplace_address: address })]))[0].location;
      if (got !== expected) { locationOk = false; fail(`location fallback ${JSON.stringify(address)} = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); }
    }
    if (locationOk) pass('parsePlatsbankenResponse falls back city → municipality → region → country → ""');

    const noDescription = parsePlatsbankenResponse(response([ad({ description: null })]))[0];
    if (noDescription.description === undefined && !('description' in noDescription)) {
      pass('parsePlatsbankenResponse omits description when the ad carries none');
    } else {
      fail(`missing description produced ${JSON.stringify(noDescription.description)}`);
    }

    const noEmployer = parsePlatsbankenResponse(response([ad({ employer: null })]))[0];
    if (noEmployer.company === '' && noEmployer.title === 'Backend engineer') {
      pass('parsePlatsbankenResponse keeps a row with no employer, with an empty company');
    } else {
      fail(`employer-less row = ${JSON.stringify(noEmployer)}`);
    }
  }

  // ── parsePlatsbankenResponse: one malformed row is skipped, not fatal ──
  {
    const jobs = parsePlatsbankenResponse(response([
      ad(),
      ad({ id: null }),
      ad({ id: '   ' }),
      ad({ headline: '' }),
      ad({ headline: '   ' }),
      null,
      'not an object',
      ad({ id: '31581609', headline: 'Second good row' }),
    ]));
    if (jobs.length === 2 && jobs[1].title === 'Second good row') {
      pass('parsePlatsbankenResponse drops rows missing title/id (and non-objects) and keeps the rest');
    } else {
      fail(`parsePlatsbankenResponse kept ${jobs.length} rows: ${JSON.stringify(jobs.map((j) => j.title))}`);
    }

    // A lone surrogate in one id must drop that row only.
    const surrogate = parsePlatsbankenResponse(response([ad({ id: '\uD800' }), ad({ id: '31581609', headline: 'Clean row' })]));
    if (surrogate.length === 1 && surrogate[0].title === 'Clean row') {
      pass('parsePlatsbankenResponse drops a lone-surrogate id without losing the clean rows beside it');
    } else {
      fail(`lone-surrogate batch returned ${JSON.stringify(surrogate.map((j) => j.title))}`);
    }
  }

  // ── parsePlatsbankenResponse: the empty-vs-broken split ──
  {
    const empty = parsePlatsbankenResponse({ total: { value: 0 }, positions: 0, hits: [] });
    if (Array.isArray(empty) && empty.length === 0) {
      pass('parsePlatsbankenResponse returns [] for a present-and-empty hits[]');
    } else {
      fail(`present-and-empty hits[] returned ${JSON.stringify(empty)}`);
    }

    for (const [label, input] of [
      ['{} (no hits key)', {}],
      ['{hits: null}', { hits: null }],
      ['{hits: {}}', { hits: {} }],
      ['{hits: "x"}', { hits: 'x' }],
      ['{results: []} (wrong container)', { results: [] }],
      ['a bare string', ''],
      ['a bare number', 42],
      ['a bare boolean', true],
      ['null', null],
    ]) {
      try {
        parsePlatsbankenResponse(input);
        fail(`parsePlatsbankenResponse should throw for ${label}`);
      } catch (err) {
        if (/unexpected response/.test(err.message)) pass(`parsePlatsbankenResponse throws a descriptive error for ${label}`);
        else fail(`parsePlatsbankenResponse threw an unexpected error for ${label}: ${err.message}`);
      }
    }

    // The throw has to name what it actually got — an enumeration gap that
    // returns [] instead is invisible until the board silently reads as empty.
    try {
      parsePlatsbankenResponse({ results: [] });
    } catch (err) {
      if (/results/.test(err.message)) pass('the envelope error names the keys it received');
      else fail(`the envelope error did not name the keys: ${err.message}`);
    }
  }

  // ── rawHitCount: the pagination stop reads the SOURCE's page shape, never
  // the rows that survived normalization. ──
  {
    if (rawHitCount({ hits: [1, 2, 3] }) === 3 && rawHitCount({}) === 0 && rawHitCount(null) === 0) {
      pass('rawHitCount counts the raw hits[] regardless of what parses');
    } else {
      fail('rawHitCount should count raw hits[] and answer 0 otherwise');
    }
  }

  // ── fetch(): keyword requirement + config/profile.yml fallback. Runs in an
  // isolated tmp cwd, never this checkout's own config/profile.yml. ──
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'career-ops-platsbanken-fallback-'));
      const cwdBefore = process.cwd();
      try {
        setup(tmp);
        process.chdir(tmp);
        return await run();
      } finally {
        process.chdir(cwdBefore);
        rmSync(tmp, { recursive: true, force: true });
      }
    };

    let sentQ = null;
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => platsbanken.fetch(
        { provider: 'platsbanken', name: 'No own keywords' },
        { sleep: async () => {}, fetchJson: async (url) => { sentQ = new URL(url).searchParams.get('q'); return response([]); } },
      ),
    );
    if (sentQ === 'Data Engineer') {
      pass('platsbanken.fetch() falls back to config/profile.yml target_roles when platsbanken.keywords[] is empty');
    } else {
      fail(`platsbanken.fetch() fallback q = ${JSON.stringify(sentQ)}`);
    }

    let threw = false;
    let message = '';
    try {
      await withTmpCwd(
        () => {},
        () => platsbanken.fetch({ provider: 'platsbanken', name: 'No Keywords' }, { sleep: async () => {}, fetchJson: async () => response([]) }),
      );
    } catch (err) {
      threw = true;
      message = err.message;
    }
    if (threw && /no platsbanken\.keywords/.test(message)) {
      pass('platsbanken.fetch() throws a clear error when no keywords and no profile.yml fallback exist');
    } else {
      fail(`platsbanken.fetch() should throw with no keywords from any source: threw=${threw} message=${JSON.stringify(message)}`);
    }
  }

  // ── fetch(): pagination ──
  {
    const fullPage = response(Array.from({ length: 100 }, (_, i) => ad({ id: `1${String(i).padStart(7, '0')}`, headline: `role ${i}` })));
    const shortPage = response([ad({ id: '19999999', headline: 'tail' })]);
    const requested = [];
    let slept = 0;

    const fetched = await platsbanken.fetch(
      { provider: 'platsbanken', name: 'Pagination', platsbanken: { keywords: ['developer'] } },
      {
        sleep: async (ms) => { slept += ms; },
        fetchJson: async (url) => {
          requested.push(url);
          return new URL(url).searchParams.get('offset') === '0' ? fullPage : shortPage;
        },
      },
    );

    if (requested.length === 2) pass('platsbanken.fetch() paginates: a full 100-row page requests the next offset');
    else fail(`platsbanken.fetch() made ${requested.length} requests (expected 2)`);

    if (fetched.length === 101) pass('platsbanken.fetch() stops on a short page and returns every collected row');
    else fail(`platsbanken.fetch() returned ${fetched.length} rows (expected 101)`);

    // Pacing applies to pages past the first only — page 1 is not delayed.
    if (slept === 1000) pass('platsbanken.fetch() paces between pages (1000ms), not before the first request');
    else fail(`platsbanken.fetch() slept ${slept}ms total for 2 requests (expected 1000)`);
  }

  // A full RAW page carrying one unparseable row must still request the next
  // page — keying the stop off surviving rows would end the walk a page early.
  {
    const rawFull = { total: { value: 100 }, positions: 100, hits: [
      ...Array.from({ length: 99 }, (_, i) => ad({ id: `2${String(i).padStart(7, '0')}` })),
      ad({ id: null }),
    ] };
    const requested = [];
    const fetched = await platsbanken.fetch(
      { provider: 'platsbanken', name: 'Raw page size', platsbanken: { keywords: ['developer'] } },
      {
        sleep: async () => {},
        fetchJson: async (url) => {
          requested.push(url);
          return new URL(url).searchParams.get('offset') === '0'
            ? rawFull
            : response([ad({ id: '29999999', headline: 'later page' })]);
        },
      },
    );
    if (requested.length === 2) pass('platsbanken.fetch() paginates after a full raw page even when one row is filtered');
    else fail(`platsbanken.fetch() made ${requested.length} request(s) after a full raw page with one bad row (expected 2)`);
    if (fetched.some((job) => job.title === 'later page')) pass('platsbanken.fetch() keeps rows from the later page');
    else fail('platsbanken.fetch() dropped the later page');
  }

  // ── fetch(): dedup across keywords by posting url ──
  {
    const fetched = await platsbanken.fetch(
      { provider: 'platsbanken', name: 'Dedup', platsbanken: { keywords: ['a', 'b'] } },
      {
        sleep: async () => {},
        // Both keywords serve the same ad plus one of their own.
        fetchJson: async (url) => {
          const q = new URL(url).searchParams.get('q');
          return response([ad({ id: '11111111' }), ad({ id: q === 'a' ? '22222222' : '33333333' })]);
        },
      },
    );
    if (fetched.length === 3) pass('platsbanken.fetch() dedups by posting url across keywords');
    else fail(`platsbanken.fetch() returned ${fetched.length} rows for 2 keywords sharing one ad (expected 3)`);
  }

  // ── fetch(): entry.max_pages is clamped to the source's own ceiling ──
  {
    let requests = 0;
    await platsbanken.fetch(
      // Every page full, so only the cap can stop the walk.
      { provider: 'platsbanken', name: 'Cap', platsbanken: { keywords: ['x'] }, max_pages: 100 },
      { sleep: async () => {}, fetchJson: async () => { requests += 1; return response(Array.from({ length: 100 }, (_, i) => ad({ id: `9${requests}${String(i).padStart(6, '0')}` }))); } },
    );
    if (requests === 21) pass('platsbanken.fetch() clamps entry.max_pages (100) to MAX_PAGES_CAP (21, the source\'s offset-2000 ceiling)');
    else fail(`platsbanken.fetch() made ${requests} requests with max_pages:100 (expected 21)`);
  }

  // ── fetch(): ctx.maxPages caps entry.max_pages, not the other way around,
  // and a probe is exactly one list request. ──
  {
    const requested = [];
    await platsbanken.fetch(
      { provider: 'platsbanken', name: 'Probe', platsbanken: { keywords: ['x'] }, max_pages: 10 },
      { maxPages: 1, sleep: async () => {}, fetchJson: async (url) => { requested.push(url); return response(Array.from({ length: 100 }, (_, i) => ad({ id: `8${i}` }))); } },
    );
    if (requested.length === 1) pass('platsbanken.fetch() honors ctx.maxPages:1 with exactly one list request');
    else fail(`platsbanken.fetch() made ${requested.length} requests under ctx.maxPages=1 (expected 1)`);
  }

  // ── fetch(): a ctx.fetch rejection during a probe propagates unwrapped ──
  {
    class ProbePageBudgetReached extends Error {}
    let caught = null;
    try {
      await platsbanken.fetch(
        { provider: 'platsbanken', name: 'Probe failure', platsbanken: { keywords: ['x'] } },
        { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw new ProbePageBudgetReached('budget'); } },
      );
    } catch (err) {
      caught = err;
    }
    if (caught instanceof ProbePageBudgetReached) {
      pass('platsbanken.fetch() propagates a ctx.fetch rejection unwrapped while ctx.maxPages is set');
    } else {
      fail(`probe rejection was rewrapped or swallowed: ${caught && caught.message}`);
    }
  }

  // ── fetch(): recall-first — one failed keyword does not abort the others ──
  {
    const fetched = await platsbanken.fetch(
      { provider: 'platsbanken', name: 'Partial failure', platsbanken: { keywords: ['bad', 'good'] } },
      {
        sleep: async () => {},
        fetchJson: async (url) => {
          if (new URL(url).searchParams.get('q') === 'bad') throw new Error('network error');
          return response([ad({ id: '12345678', headline: 'ok' })]);
        },
      },
    );
    if (fetched.length === 1 && fetched[0].title === 'ok') {
      pass('platsbanken.fetch(): a failed keyword does not abort keywords that still succeed');
    } else {
      fail(`platsbanken.fetch() with one failing keyword returned ${JSON.stringify(fetched.map((j) => j.title))}`);
    }
  }

  // A later-page failure keeps the pages already collected.
  {
    const fetched = await platsbanken.fetch(
      { provider: 'platsbanken', name: 'Later-page failure', platsbanken: { keywords: ['x'] } },
      {
        sleep: async () => {},
        fetchJson: async (url) => {
          if (new URL(url).searchParams.get('offset') !== '0') throw new Error('boom');
          return response(Array.from({ length: 100 }, (_, i) => ad({ id: `7${i}` })));
        },
      },
    );
    if (fetched.length === 100) pass('platsbanken.fetch() keeps the pages already collected when a later page fails');
    else fail(`platsbanken.fetch() returned ${fetched.length} rows after a later-page failure (expected 100)`);
  }

  // ── fetch(): total outage throws ──
  {
    try {
      await platsbanken.fetch(
        { provider: 'platsbanken', name: 'Outage', platsbanken: { keywords: ['a', 'b'] } },
        { sleep: async () => {}, fetchJson: async () => { throw new Error('boom'); } },
      );
      fail('platsbanken.fetch() should throw when every keyword request fails');
    } catch (err) {
      if (/all 2 keyword request\(s\) failed/.test(err.message)) pass('platsbanken.fetch() throws when every keyword fails (total outage)');
      else fail(`platsbanken.fetch() threw an unexpected error on total outage: ${err.message}`);
    }
  }

  // ── fetch(): request hygiene ──
  {
    let captured = null;
    await platsbanken.fetch(
      { provider: 'platsbanken', name: 'Hygiene', platsbanken: { keywords: ['x'] } },
      { sleep: async () => {}, fetchJson: async (url, opts) => { captured = opts; return response([]); } },
    );
    if (captured && captured.redirect === 'error') pass('platsbanken.fetch() passes redirect:"error" (SSRF-via-redirect guard)');
    else fail(`platsbanken.fetch() should pass redirect:"error", got ${JSON.stringify(captured)}`);
    if (captured && captured.headers && captured.headers['User-Agent']) pass('platsbanken.fetch() sends a User-Agent header');
    else fail(`platsbanken.fetch() should send a User-Agent header, got ${JSON.stringify(captured)}`);
  }

  // ── fetch(): truncation is announced, and silent during a probe ──
  {
    const captureStderr = async (run) => {
      const original = console.error;
      const lines = [];
      console.error = (...args) => lines.push(args.join(' '));
      try {
        await run();
      } finally {
        console.error = original;
      }
      return lines.join('\n');
    };

    const fullPages = (url) => response(Array.from({ length: 100 }, (_, i) => ad({ id: `${new URL(url).searchParams.get('offset')}${i}` })));

    const entryCapText = await captureStderr(() => platsbanken.fetch(
      { provider: 'platsbanken', name: 'CapEntry', platsbanken: { keywords: ['x'] }, max_pages: 2 },
      { sleep: async () => {}, fetchJson: async (url) => fullPages(url) },
    ));
    if (/raise max_pages on this entry/.test(entryCapText) && /CapEntry/.test(entryCapText)) {
      pass('platsbanken.fetch() warns to raise max_pages when the entry cap truncates the walk');
    } else {
      fail(`entry-cap truncation was not announced: ${JSON.stringify(entryCapText)}`);
    }
    // Both numbers answer "how much did the scan actually collect", so they must
    // be the keyword's running totals (2 pages x 100 rows), never the last
    // page's own count — a warning that under-reports is worse than none.
    if (/200 rows for "x"/.test(entryCapText)) {
      pass("the entry-cap warning reports the keyword's collected rows (200), not the last page's (100)");
    } else {
      fail(`entry-cap warning reported the wrong row count: ${JSON.stringify(entryCapText)}`);
    }

    // At the source's own ceiling the advice has to change: raising max_pages
    // cannot buy a page Platsbanken does not serve.
    const sourceCapText = await captureStderr(() => platsbanken.fetch(
      { provider: 'platsbanken', name: 'CapSource', platsbanken: { keywords: ['x'] }, max_pages: 21 },
      { sleep: async () => {}, fetchJson: async (url) => fullPages(url) },
    ));
    if (/offset ceiling/.test(sourceCapText) && !/raise max_pages/.test(sourceCapText)) {
      pass('platsbanken.fetch() names the source ceiling instead of advising raise max_pages when the source is the limit');
    } else {
      fail(`source-ceiling truncation message wrong: ${JSON.stringify(sourceCapText)}`);
    }
    if (/2100 rows \(21 pages\)/.test(sourceCapText)) {
      pass("the source-ceiling warning reports the keyword's collected rows (2100 over 21 pages), not the last page's (100)");
    } else {
      fail(`source-ceiling warning reported the wrong row count: ${JSON.stringify(sourceCapText)}`);
    }

    const probeText = await captureStderr(() => platsbanken.fetch(
      { provider: 'platsbanken', name: 'ProbeSilent', platsbanken: { keywords: ['x'] }, max_pages: 5 },
      { maxPages: 1, sleep: async () => {}, fetchJson: async (url) => fullPages(url) },
    ));
    if (probeText === '') pass('platsbanken.fetch() stays silent during a health probe');
    else fail(`a probe produced output: ${JSON.stringify(probeText)}`);
  }
} catch (e) {
  fail(`platsbanken provider tests crashed: ${e.message}`);
}
