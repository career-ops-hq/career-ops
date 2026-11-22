// tests/providers/velorahr.test.mjs — VeloraHR career sites (<tenant>.career.velorahr.com).
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — velorahr (VeloraHR career sites)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/velorahr.mjs')).href);
  const velorahr = mod.default;
  const { parseVeloraHrPage } = mod;
  const { isOfferSeen, markOfferSeen, listingIdentityToken } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const ORIGIN = 'https://acme.career.velorahr.com';
  const CAREERS = `${ORIGIN}/acme-careers-123`;
  const entry = { name: 'Acme', careers_url: CAREERS };

  if (velorahr.id === 'velorahr') pass('velorahr.id is "velorahr"');
  else fail(`velorahr.id is ${JSON.stringify(velorahr.id)}`);

  // --- detect() ---------------------------------------------------------
  const hit = velorahr.detect(entry);
  if (hit && hit.url === CAREERS) pass('velorahr.detect() claims <tenant>.career.velorahr.com/<slug>-<siteId>');
  else fail(`velorahr.detect() returned ${JSON.stringify(hit)}`);

  const deepHit = velorahr.detect({ name: 'Acme', careers_url: `${CAREERS}/offers/16120?utm=x#top` });
  if (deepHit && deepHit.url === CAREERS) pass('velorahr.detect() accepts a deeper link and drops its path, query and fragment');
  else fail(`velorahr.detect() deep link returned ${JSON.stringify(deepHit)}`);

  const rejected = [
    ['a custom domain', { careers_url: 'https://careers.acme.example.com/acme-careers-123' }],
    ['http', { careers_url: 'http://acme.career.velorahr.com/acme-careers-123' }],
    ['a host suffix spoof', { careers_url: 'https://acme.career.velorahr.com.evil.example/acme-careers-123' }],
    ['a look-alike host', { careers_url: 'https://acme.career.velorahrXcom/acme-careers-123' }],
    ['a path spoof', { careers_url: 'https://evil.example/acme.career.velorahr.com/acme-careers-123' }],
    ['the vendor root without a tenant', { careers_url: 'https://career.velorahr.com/acme-careers-123' }],
    ['a tenant page without a site id', { careers_url: `${ORIGIN}/acme-careers` }],
    ['the bare tenant host', { careers_url: `${ORIGIN}/` }],
    ['a malformed URL', { careers_url: 'not a url' }],
    ['a null careers_url', { careers_url: null }],
    ['a numeric careers_url', { careers_url: 7 }],
    ['no careers_url', {}],
  ];
  for (const [label, e] of rejected) {
    let out;
    try { out = velorahr.detect({ name: 'X', ...e }); } catch (err) { out = `threw ${err.message}`; }
    if (out === null) pass(`velorahr.detect() returns null for ${label}`);
    else fail(`velorahr.detect() for ${label} returned ${JSON.stringify(out)}`);
  }
  if (velorahr.detect(/** @type {any} */ (null)) === null) pass('velorahr.detect() returns null for a null entry');
  else fail('velorahr.detect() should return null for a null entry');

  // --- fixtures ---------------------------------------------------------
  // Shape of the real list API (captured 2026-11-18 from two tenants), reduced
  // to the fields the provider reads, with fictional names.
  const offer = (id, extra = {}) => ({
    id,
    title: `Analyst ${id} [REQ${id}]`,
    clean_title: `Analyst ${id}`,
    city: 'Madrid',
    province: 'Madrid',
    country: 'ES',
    work_mode: 'hibrido',
    description_html: '<p>Join <strong>Acme</strong> &amp; grow.</p><ul><li>Plan</li></ul>',
    requirements_html: '<p>3 years of experience</p>',
    created_at: '2026-11-12T12:23:50+00:00',
    offer_url: `${CAREERS}/offers/${id}`,
    ...extra,
  });
  const json = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers });
  const page = (rows, total = rows.length) => json({ data: rows, success: true }, { 'content-range': `Rest 0-99/${total}` });
  const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

  /** Stub ctx: `list(url, n)` answers every offers request; `text(url)` the careers page. */
  function makeCtx({ list, text, maxPages } = {}) {
    const calls = { list: [], text: [], sleeps: 0 };
    return {
      calls,
      maxPages,
      sleep: async () => { calls.sleeps++; },
      fetchResponse: async (url, opts) => {
        calls.list.push({ url, opts });
        return list(new URL(url), calls.list.length - 1);
      },
      fetchText: async (url, opts) => {
        calls.text.push({ url, opts });
        return text ? text(url) : '<html></html>';
      },
      fetchJson: async () => { throw new Error('velorahr must not call fetchJson'); },
    };
  }
  const rangeStart = (u) => Number(/^\[(\d+),/.exec(u.searchParams.get('range') || '')?.[1]);

  // --- fetch(): blank clean_title must not shadow a usable title --------
  {
    const rows = [
      offer(201, { clean_title: '   ', title: ' [REQ-1] Spaced title ' }),
      offer(202, { clean_title: { toString: null }, title: 'Object clean title' }),
      offer(203, { clean_title: '   ', title: '   ' }),
    ];
    const jobs = await velorahr.fetch(entry, makeCtx({ list: () => page(rows, rows.length) }));
    if (jobs.length === 2 && jobs[0].title === '[REQ-1] Spaced title' && jobs[1].title === 'Object clean title') {
      pass('velorahr.fetch() trims each title candidate before choosing the fallback');
    } else {
      fail(`velorahr.fetch() blank clean_title cases: ${JSON.stringify(jobs.map(j => j.title))}`);
    }
  }

  // --- fetch(): padded ids, stale totals, short pages, raw-count probe ---
  {
    const jobs = await velorahr.fetch(entry, makeCtx({ list: () => page([offer(' 301 '), offer(302), offer('303')]) }));
    const byUrl = Object.fromEntries(jobs.map(j => [j.url.split('/').pop(), j]));
    if (jobs.length === 3 && !('listingIdentity' in byUrl['301']) && byUrl['302'].listingIdentity?.posting_id === '302' && byUrl['303'].listingIdentity?.posting_id === '303') {
      pass('velorahr.fetch() omits listingIdentity for a padded id and keeps the row and its URL');
    } else {
      fail(`velorahr padded id: ${JSON.stringify(jobs.map(j => [j.url, j.listingIdentity]))}`);
    }

    // A later page without Content-Range must not reuse page 1's total (150 < the real 230).
    const all = Array.from({ length: 230 }, (_, i) => offer(1000 + i));
    const noHeader = makeCtx({ list: (u) => {
      const s = rangeStart(u);
      const rows = all.slice(s, s + 100);
      return s === 0 ? page(rows, 150) : json({ data: rows, success: true });
    } });
    const walked = await velorahr.fetch(entry, noHeader);
    if (walked.length === 230) pass('velorahr.fetch() drops a stale total when a page has no Content-Range');
    else fail(`velorahr stale total: ${walked.length} jobs after ${noHeader.calls.list.length} requests`);

    // An empty page while the total is unreached: partial, with its own reason and warning.
    const shortCtx = makeCtx({ list: (u) => (rangeStart(u) === 0 ? page(all.slice(0, 100), 230) : page([], 230)) });
    const { result: shortJobs, errors: shortErrors } = await captureConsoleErrors(() => velorahr.fetch(entry, shortCtx));
    if (shortJobs.length === 100 && shortJobs.truncated?.reason === 'short-page' && shortJobs.truncated.total === 230
        && shortErrors.length === 1 && !/raise max_pages/.test(String(shortErrors[0]))) {
      pass('velorahr.fetch() marks an empty page short of the reported total as a partial read, without the max_pages message');
    } else {
      fail(`velorahr short page: ${shortJobs.length} jobs, ${JSON.stringify(shortJobs.truncated)}, ${JSON.stringify(shortErrors)}`);
    }

    // Rows that all fail to parse are not an empty board: no careers-page check.
    const bad = makeCtx({ list: () => page([offer(null), { id: 5 }]), text: () => { throw httpError(500); } });
    const badJobs = await velorahr.fetch(entry, bad);
    if (badJobs.length === 0 && bad.calls.text.length === 0) pass('velorahr.fetch() checks the careers page only when the source returned no rows');
    else fail(`velorahr raw-count probe: ${badJobs.length} jobs, ${bad.calls.text.length} page checks`);
  }

  // --- fetch(): normalisation -------------------------------------------
  {
    const rows = [
      offer(101),
      offer(102, { clean_title: '', title: 'Fallback title', province: 'Barcelona', city: 'Sant Cugat', work_mode: 'remoto' }),
      offer(103, { work_mode: 'presencial', created_at: 'not a date', description_html: '', requirements_html: null }),
      offer('104', { country: 'xx' }),
      offer(105, { clean_title: '  ', title: '' }),      // no title: dropped
      offer(null),                                        // no id: dropped
      offer('abc'),                                       // unusable id: dropped
      offer(0),                                           // not a posting id: dropped
      offer('\uD800'),                                    // lone surrogate: not a posting id, dropped
      null,                                               // junk row: dropped
    ];
    const ctx = makeCtx({ list: () => page(rows, rows.length) });
    const jobs = await velorahr.fetch(entry, ctx);

    if (jobs.length === 4) pass('velorahr.fetch() keeps rows with a title and a positive integer id, drops the rest');
    else fail(`velorahr.fetch() returned ${jobs.length} jobs (expected 4): ${JSON.stringify(jobs.map(j => j.title))}`);

    const [a, b, c, d] = jobs;
    if (a.title === 'Analyst 101' && a.url === `${CAREERS}/offers/101` && a.company === 'Acme') {
      pass('velorahr.fetch() uses clean_title and builds <origin>/<slug>/offers/<id>');
    } else {
      fail(`velorahr.fetch() first row: ${JSON.stringify(a)}`);
    }
    if (b.title === 'Fallback title') pass('velorahr.fetch() falls back to title when clean_title is blank');
    else fail(`velorahr.fetch() fallback title was ${JSON.stringify(b.title)}`);
    if (a.location === 'Madrid, Spain' && b.location === 'Sant Cugat, Barcelona, Spain') {
      pass('velorahr.fetch() joins city, province (when it differs) and the English country name');
    } else {
      fail(`velorahr.fetch() locations: ${JSON.stringify([a.location, b.location])}`);
    }
    if (a.country === 'ES' && d.country === 'xx') pass('velorahr.fetch() passes the country code through as given');
    else fail(`velorahr.fetch() countries: ${JSON.stringify([a.country, d.country])}`);
    if (d.location === 'Madrid, xx') pass('velorahr.fetch() keeps an unresolvable country code in the location');
    else fail(`velorahr.fetch() unresolvable country location: ${JSON.stringify(d.location)}`);
    if (a.workplaceType === 'hybrid' && b.workplaceType === 'remote' && c.workplaceType === 'onsite') {
      pass('velorahr.fetch() maps work_mode to workplaceType');
    } else {
      fail(`velorahr.fetch() workplace: ${JSON.stringify([a.workplaceType, b.workplaceType, c.workplaceType])}`);
    }
    if (a.postedAt === Date.parse('2026-11-12T12:23:50+00:00') && !('postedAt' in c)) {
      pass('velorahr.fetch() reads created_at as postedAt and omits it when unparseable');
    } else {
      fail(`velorahr.fetch() postedAt: ${JSON.stringify([a.postedAt, c.postedAt])}`);
    }
    if (a.description === 'Join Acme & grow. Plan 3 years of experience' && !('description' in c)) {
      pass('velorahr.fetch() builds a decoded plain-text description from the list row');
    } else {
      fail(`velorahr.fetch() description: ${JSON.stringify([a.description, c.description])}`);
    }

    // One list request, no careers-page request, redirect: 'error' everywhere.
    if (ctx.calls.list.length === 1 && ctx.calls.text.length === 0) pass('velorahr.fetch() makes one request for a board that fits one page');
    else fail(`velorahr.fetch() made ${ctx.calls.list.length} list and ${ctx.calls.text.length} text requests`);
    const u = new URL(ctx.calls.list[0].url);
    if (u.origin === 'https://api.velorahr.com' && u.pathname === '/api/public/career-site/123/offers'
        && u.searchParams.get('range') === '[0,99]' && u.searchParams.get('sort') === '["created_at","DESC"]') {
      pass('velorahr.fetch() asks the public API for the site id taken from the careers URL');
    } else {
      fail(`velorahr.fetch() requested ${ctx.calls.list[0].url}`);
    }
    if (ctx.calls.list.every(c => c.opts?.redirect === 'error')) pass("velorahr.fetch() passes redirect: 'error' on every list request");
    else fail('velorahr.fetch() list request without redirect: error');

    // listingIdentity: provider / site id / payload id, never from the URL.
    const identity = a.listingIdentity;
    if (identity?.ats_provider === 'velorahr' && identity.board_slug === '123' && identity.posting_id === '101'
        && Object.keys(identity).length === 3 && d.listingIdentity?.posting_id === '104') {
      pass('velorahr.fetch() returns the velorahr/<site id>/<offer id> listingIdentity (numeric or string id)');
    } else {
      fail(`velorahr identity = ${JSON.stringify([identity, d.listingIdentity])}`);
    }
    // The same offer reached at another URL (a customer-branded domain) is one row.
    const branded = { ...a, url: 'https://careers.acme.example.com/acme-careers-123/offers/101' };
    const seen = new Set();
    markOfferSeen(a, seen);
    if (isOfferSeen(branded, seen)) pass('the same velorahr offer at a second URL is already seen');
    else fail('velorahr offer at a second URL was not recognised as the same posting');
    if (listingIdentityToken(b) !== listingIdentityToken(a) && !isOfferSeen(b, seen)) pass('a different offer id on the same site is a different listing');
    else fail('velorahr offers with different ids shared an identity');
  }

  // --- fetch(): config guard --------------------------------------------
  for (const bad of [
    { name: 'Evil', careers_url: 'https://evil.example/acme-careers-123' },
    { name: 'Evil', careers_url: 'https://acme.career.velorahr.com.evil.example/acme-careers-123' },
    { name: 'NoId', careers_url: `${ORIGIN}/acme-careers` },
    { name: 'None' },
  ]) {
    const ctx = makeCtx({ list: () => { throw new Error('must not be reached'); } });
    let err;
    try { await velorahr.fetch(bad, ctx); } catch (e) { err = e; }
    if (err && /cannot derive the site/.test(err.message) && ctx.calls.list.length === 0 && ctx.calls.text.length === 0) {
      pass(`velorahr.fetch() throws before any request for ${JSON.stringify(bad.careers_url ?? null)}`);
    } else {
      fail(`velorahr.fetch() guard for ${JSON.stringify(bad.careers_url ?? null)}: ${err?.message}, ${ctx.calls.list.length + ctx.calls.text.length} requests`);
    }
  }

  // --- empty vs broken ----------------------------------------------------
  {
    // Present-and-empty list on a real site: [] after the careers page answers.
    const ctx = makeCtx({ list: () => page([], 0), text: () => '<html>No openings</html>' });
    const jobs = await velorahr.fetch(entry, ctx);
    if (Array.isArray(jobs) && jobs.length === 0 && ctx.calls.text.length === 1 && ctx.calls.text[0].url === CAREERS
        && ctx.calls.text[0].opts?.redirect === 'error') {
      pass("velorahr.fetch() returns [] for an empty board whose careers page answers (redirect: 'error')");
    } else {
      fail(`velorahr empty board: ${JSON.stringify(jobs)}, text calls ${JSON.stringify(ctx.calls.text)}`);
    }

    // An unknown site id answers 200 with an empty list; its careers page is a 404.
    let err;
    try { await velorahr.fetch(entry, makeCtx({ list: () => page([], 0), text: () => { throw httpError(404); } })); } catch (e) { err = e; }
    if (err && err.status === 404) pass('velorahr.fetch() fails loudly for an unknown site id (empty list, careers page 404)');
    else fail(`velorahr unknown site: ${err?.message}`);

    // Envelope not the documented shape: a descriptive throw naming what came back.
    for (const [label, body] of [
      ['an empty object', {}],
      ['data: null', { data: null }],
      ['data as an object', { data: {} }],
      ['another container key', { offers: [] }],
      ['a bare string', 'oops'],
      ['null', null],
    ]) {
      let e2;
      try { await velorahr.fetch(entry, makeCtx({ list: () => json(body) })); } catch (e) { e2 = e; }
      if (e2 && /velorahr: unexpected response for Acme — expected data\[\], got: \[/.test(e2.message)) {
        pass(`velorahr.fetch() throws a descriptive error for ${label}`);
      } else {
        fail(`velorahr.fetch() for ${label}: ${e2?.message}`);
      }
    }
    let e3;
    try { await velorahr.fetch(entry, makeCtx({ list: () => new Response('<html>blocked</html>', { status: 200 }) })); } catch (e) { e3 = e; }
    if (e3 && /not JSON/.test(e3.message)) pass('velorahr.fetch() throws when the body is not JSON');
    else fail(`velorahr.fetch() non-JSON body: ${e3?.message}`);

    // A page of rows none of which parse is a skipped-rows board, not an error.
    const junk = await velorahr.fetch(entry, makeCtx({ list: () => page([offer(null), null], 2), text: () => 'ok' }));
    if (junk.length === 0) pass('velorahr.fetch() drops unusable rows without failing the board');
    else fail('velorahr.fetch() kept an unusable row');

    // parseVeloraHrPage on its own: bad container throws, empty container does not.
    const site = { companyName: 'Acme', origin: ORIGIN, slug: 'acme-careers-123', siteId: '123' };
    let e4;
    try { parseVeloraHrPage({ success: true }, site); } catch (e) { e4 = e; }
    if (e4 && /got: \[success\]/.test(e4.message)) pass('parseVeloraHrPage() names the keys it got');
    else fail(`parseVeloraHrPage() missing container: ${e4?.message}`);
    if (parseVeloraHrPage({ data: [] }, site).jobs.length === 0) pass('parseVeloraHrPage() accepts an empty data[]');
    else fail('parseVeloraHrPage() should accept an empty data[]');
  }

  // --- pagination ---------------------------------------------------------
  {
    // Two full pages and a short one: the walk follows the reported total.
    const all = Array.from({ length: 230 }, (_, i) => offer(1000 + i));
    const ctx = makeCtx({ list: (u) => { const s = rangeStart(u); return page(all.slice(s, s + 100), 230); } });
    const jobs = await velorahr.fetch(entry, ctx);
    if (jobs.length === 230 && ctx.calls.list.length === 3) pass('velorahr.fetch() walks 100-row pages until the reported total');
    else fail(`velorahr paging: ${jobs.length} jobs in ${ctx.calls.list.length} requests`);
    if (ctx.calls.sleeps === 2 && ctx.calls.list.every(c => c.opts?.redirect === 'error')) {
      pass("velorahr.fetch() paces pages after the first and passes redirect: 'error' on each");
    } else {
      fail(`velorahr pacing: ${ctx.calls.sleeps} sleeps`);
    }
    const starts = ctx.calls.list.map(c => rangeStart(new URL(c.url)));
    if (starts.join() === '0,100,200') pass('velorahr.fetch() advances the range by the rows the source returned');
    else fail(`velorahr range starts: ${starts}`);

    // A source that serves fewer rows per page than asked is still walked to its total.
    const ctx50 = makeCtx({ list: (u) => { const s = rangeStart(u); return page(all.slice(0, 120).slice(s, s + 50), 120); } });
    const jobs50 = await velorahr.fetch(entry, ctx50);
    if (jobs50.length === 120 && ctx50.calls.list.length === 3) pass('velorahr.fetch() does not stop on a page the source shortened while a total remains');
    else fail(`velorahr short pages: ${jobs50.length} jobs in ${ctx50.calls.list.length} requests`);

    // No Content-Range header: a short page ends the walk, a full one asks for more.
    const noHeader = makeCtx({ list: (u) => { const s = rangeStart(u); return json({ data: all.slice(s, s + 100).slice(0, s >= 100 ? 10 : 100) }); } });
    const jobsNoHeader = await velorahr.fetch(entry, noHeader);
    if (jobsNoHeader.length === 110 && noHeader.calls.list.length === 2) pass('velorahr.fetch() ends on a short page when no total is reported');
    else fail(`velorahr no-header paging: ${jobsNoHeader.length} jobs in ${noHeader.calls.list.length} requests`);

    // The page ceiling is the provider's own: a source claiming a huge total cannot extend it.
    const endless = (u) => { const s = rangeStart(u); return page(Array.from({ length: 100 }, (_, i) => offer(s + i + 1)), 1_000_000); };
    const capCtx = makeCtx({ list: endless });
    const { result: capped, errors } = await captureConsoleErrors(() => velorahr.fetch(entry, capCtx));
    if (capCtx.calls.list.length === 20 && capped.length === 2000) pass('velorahr.fetch() stops at its own DEFAULT_MAX_PAGES however large the reported total');
    else fail(`velorahr default cap: ${capCtx.calls.list.length} requests, ${capped.length} jobs`);
    if (errors.some(m => /truncated at max_pages=20/.test(String(m)) && /raise max_pages/.test(String(m)))
        && capped.truncated?.reason === 'page-cap' && capped.truncated?.total === 1_000_000) {
      pass('velorahr.fetch() warns and marks the list truncated when the ceiling cut it');
    } else {
      fail(`velorahr cap warning: ${JSON.stringify(errors)} / ${JSON.stringify(capped.truncated)}`);
    }

    // entry.max_pages lowers it; a user override is itself bounded.
    const smallCtx = makeCtx({ list: endless });
    await captureConsoleErrors(() => velorahr.fetch({ ...entry, max_pages: 2 }, smallCtx));
    const bigCtx = makeCtx({ list: endless });
    await captureConsoleErrors(() => velorahr.fetch({ ...entry, max_pages: 10_000 }, bigCtx));
    if (smallCtx.calls.list.length === 2 && bigCtx.calls.list.length === 100) pass('velorahr.fetch() honours entry.max_pages up to an absolute ceiling of 100');
    else fail(`velorahr max_pages: ${smallCtx.calls.list.length} / ${bigCtx.calls.list.length}`);

    // A board whose last page is exactly full and exactly at the cap is complete, not truncated.
    const exact = makeCtx({ list: (u) => { const s = rangeStart(u); return page(all.slice(s, s + 100), 200); } });
    const { result: exactJobs, errors: exactErrors } = await captureConsoleErrors(() => velorahr.fetch({ ...entry, max_pages: 2 }, exact));
    if (exactJobs.length === 200 && !exactJobs.truncated && exactErrors.length === 0) pass('velorahr.fetch() does not call a board truncated when the total was reached at the ceiling');
    else fail(`velorahr exact boundary: ${exactJobs.length} jobs, ${JSON.stringify(exactJobs.truncated)}, ${JSON.stringify(exactErrors)}`);

    // Probe: ctx.maxPages 1 means one list request, no truncation warning.
    const probe = makeCtx({ list: endless, maxPages: 1 });
    const { result: probed, errors: probeErrors } = await captureConsoleErrors(() => velorahr.fetch(entry, probe));
    if (probe.calls.list.length === 1 && probed.length === 100 && probeErrors.length === 0 && !probed.truncated) {
      pass('velorahr.fetch() makes exactly one list request under ctx.maxPages: 1, with no truncation warning');
    } else {
      fail(`velorahr probe: ${probe.calls.list.length} requests, ${probeErrors.length} warnings`);
    }

    // A rejection the shared retry policy treats as final (here a timeout) propagates as the
    // same object, unwrapped, after exactly one request and no retry sleep, on the list request
    // and on the empty-board careers-page check alike.
    class ProbeBudget extends Error {}
    const budget = Object.assign(new ProbeBudget('budget'), { timedOut: true });
    const listCtx = makeCtx({ maxPages: 1, list: () => { throw budget; } });
    let thrown;
    try { await velorahr.fetch(entry, listCtx); } catch (e) { thrown = e; }
    const textCtx = makeCtx({ maxPages: 1, list: () => page([], 0), text: () => { throw budget; } });
    let thrownText;
    try { await velorahr.fetch(entry, textCtx); } catch (e) { thrownText = e; }
    if (thrown === budget && thrownText === budget
        && listCtx.calls.list.length === 1 && textCtx.calls.list.length === 1 && textCtx.calls.text.length === 1
        && listCtx.calls.sleeps === 0 && textCtx.calls.sleeps === 0) {
      pass('velorahr.fetch() propagates a ctx.fetch* rejection unwrapped while probing, with one request and no retry');
    } else {
      fail(`velorahr probe rejection: ${thrown?.message}, ${thrownText?.message}, ${listCtx.calls.list.length}/${textCtx.calls.text.length} requests, ${listCtx.calls.sleeps + textCtx.calls.sleeps} sleeps`);
    }

    // Failure on page 2 that retry cannot clear fails the board (no silent partial list) and
    // never prints the "raise max_pages" warning.
    const flaky = makeCtx({ list: (u) => { if (rangeStart(u) === 0) return page(all.slice(0, 100), 230); throw httpError(404); } });
    const { result: flakyErr, errors: flakyErrors } = await captureConsoleErrors(async () => {
      try { await velorahr.fetch(entry, flaky); return null; } catch (e) { return e; }
    });
    if (flakyErr?.status === 404 && flaky.calls.list.length === 2 && !flakyErrors.some(m => /raise max_pages/.test(String(m)))) {
      pass('velorahr.fetch() fails the board when a later page cannot be read, without the max_pages warning');
    } else {
      fail(`velorahr page-2 failure: ${flakyErr?.message}, ${flakyErrors}`);
    }

    // Transient 5xx is retried through the shared helper (first attempt fails, second succeeds).
    let attempts = 0;
    const retry = makeCtx({ list: () => { attempts++; if (attempts === 1) throw httpError(503); return page([offer(1)]); } });
    const retried = await velorahr.fetch(entry, retry);
    if (retried.length === 1 && attempts === 2) pass('velorahr.fetch() retries a transient 503 through fetchResponseWithRetry');
    else fail(`velorahr retry: ${retried.length} jobs after ${attempts} attempts`);
  }
} catch (e) {
  fail(`velorahr provider tests crashed: ${e.stack || e.message}`);
}
