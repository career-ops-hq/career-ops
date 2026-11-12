// tests/providers/rexx.test.mjs — rexx systems job portal (server-rendered
// list page walked with ?start=, posting dates joined from the Atom feed the
// page advertises). Fixtures are fictional; their markup mirrors the two card
// skins observed on live portals (newer <article> + job_standort, older <div>
// with plain-text information columns).
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — rexx (rexx systems job portal)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/rexx.mjs')).href);
  const rexx = mod.default;
  const { resolveListUrl, resolveMaxPages, parseListPage, assertListPage, findFeedUrl, parseFeedDates } = mod;
  const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
  const { buildTitleFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const HOST = 'jobs.acme.example';
  const LIST = `https://${HOST}/stellenangebote.html`;

  // ── fixtures ───────────────────────────────────────────────────────
  const newCard = (id, title, city, href) =>
    `<article class="joboffer_container" onclick="window.location.href='https://${HOST}/x-de-j${id}.html'">`
    + '<div class="joboffer_outer"><div class="joboffer_inner">'
    + `<div class="joboffer_title_text joboffer_box"><a target="_self" href="${href ?? `https://${HOST}/Job-${id}-de-j${id}.html`}">${title}</a>`
    + '<div class="job_details"><span class="job_details_second">mit Berufserfahrung</span></div><div class="job_teaser"></div></div>'
    + `<div class="joboffer_informations joboffer_box"><span class="job_standort">${city}</span><span class="distance"></span>`
    + '<div class="job_location">Präsenz</div><div class="jobcategory_details"></div></div>'
    + '</div></div></article>';
  const oldCard = (id, title, boxes) =>
    '<div class="joboffer_container">'
    + `<div class="joboffer_title_text joboffer_box"><a target="_self" href="https://${HOST}/Job-${id}-de-j${id}.html">${title}</a><div id="job_teaser"></div></div>`
    + boxes.map((b) => `<div class="joboffer_informations joboffer_box">\n${b}\n</div>`).join('')
    + '</div>';
  const feedLink = (href) => `<link rel="alternate" type="application/atom+xml" title="Jobs" href="${href}" />`;
  const listPage = (cards, { head = '', allCount = null } = {}) =>
    `<html><head>${head}</head><body><div id="joboffer_table_container"${allCount !== null ? ` data-count="${allCount}" data-all-count="${allCount}"` : ''}>`
    + `<div id="joboffers">${cards.join('\n')}</div></div>`
    + '<p><a href="https://jobs.acme.example/initiativbewerbung-de-f12.html">Initiativbewerbung</a></p></body></html>';
  const atom = (entries) =>
    '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Jobs</title>'
    + `<updated>2026-11-12T09:00:00+01:00</updated>`
    + entries.map(([id, date]) => `<entry><title>Job ${id}</title><link href="https://${HOST}/Job-${id}-de-j${id}.html"></link>`
      + `<summary type="html">Teaser…</summary><updated>${date}</updated></entry>`).join('')
    + '</feed>';

  /** ctx stub: routes by URL, records every call with its options. */
  const makeCtx = (routes, extra = {}) => {
    const calls = [];
    return {
      calls,
      sleep: async () => {},
      ...extra,
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        const r = routes[url];
        if (r === undefined) throw new Error(`unexpected request: ${url}`);
        if (r instanceof Error) throw r;
        return typeof r === 'function' ? r() : r;
      },
    };
  };

  // ── id / no detect() / registry ───────────────────────────────────
  if (rexx.id === 'rexx') pass('rexx.id is "rexx"');
  else fail(`rexx.id is ${JSON.stringify(rexx.id)}`);

  if (typeof rexx.detect !== 'function') pass('rexx has no detect() — a portal is selected only by an explicit provider: rexx');
  else fail('rexx should not define detect(): rexx portals run on branded hosts with no URL pattern');

  {
    const providers = await loadProviders(join(ROOT, 'providers'));
    const unclaimed = resolveProvider({ name: 'Acme', careers_url: LIST }, providers);
    if (unclaimed?.provider?.id !== 'rexx') pass('a portals entry without provider: rexx is not claimed by rexx');
    else fail('rexx claimed an entry that did not opt in');
    const claimed = resolveProvider({ name: 'Acme', careers_url: LIST, provider: 'rexx' }, providers);
    if (claimed?.provider?.id === 'rexx') pass('an entry with provider: rexx resolves to the rexx provider');
    else fail(`provider: rexx resolved to ${JSON.stringify(claimed)}`);
  }

  // ── resolveListUrl ────────────────────────────────────────────────
  {
    const cases = [
      [{ careers_url: `https://${HOST}` }, LIST, 'a bare host reads stellenangebote.html'],
      [{ careers_url: `https://${HOST}/?ac=jobad_rss` }, LIST, 'the query string is dropped and "/" gets the default list page'],
      [{ careers_url: 'https://karriere.exampleco.example/stellenmarkt/' }, 'https://karriere.exampleco.example/stellenmarkt/stellenangebote.html', 'a path prefix ending in "/" keeps the prefix'],
      [{ careers_url: 'https://karriere.exampleco.example/stellenmarkt/stellenangebote.html?start=20#top' }, 'https://karriere.exampleco.example/stellenmarkt/stellenangebote.html', 'an explicit list page is kept, query and fragment dropped'],
      [{ careers_url: `https://user:pw@${HOST}:8443/stellenangebote.html` }, LIST, 'credentials and port are discarded (origin rebuilt from the hostname)'],
      [{ api: `https://${HOST}/job-offers.html`, careers_url: 'https://www.acme.example/careers' }, `https://${HOST}/job-offers.html`, 'api: wins over careers_url'],
    ];
    for (const [entry, want, label] of cases) {
      const got = resolveListUrl(entry)?.listUrl;
      if (got === want) pass(`rexx.resolveListUrl(): ${label}`);
      else fail(`rexx.resolveListUrl(): ${label} — got ${JSON.stringify(got)}, want ${want}`);
    }
    const rejected = [{ careers_url: `http://${HOST}/stellenangebote.html` }, { careers_url: 'not a url' },
      { careers_url: 'https://169.254.169.254/latest/meta-data/' }, { careers_url: 'https://127.1/stellenangebote.html' },
      { careers_url: 'https://0x7f000001/' }, { careers_url: 'https://[::1]/' }, { careers_url: 'https://localhost/' },
      { careers_url: 'https://jobs.corp.internal/' }, { careers_url: 'https://intranet/' }, { careers_url: 'ftp://acme.example/x' }, { careers_url: 42 }, { careers_url: null }, {}, null];
    if (rejected.every((e) => resolveListUrl(e) === null)) pass('rexx.resolveListUrl() returns null (no throw) for http, malformed, non-string, missing, IP-literal, single-label and internal-suffix URLs');
    else fail(`rexx.resolveListUrl() accepted junk: ${JSON.stringify(rejected.map((e) => resolveListUrl(e)))}`);
  }

  if (resolveMaxPages({}) === 30 && resolveMaxPages({ max_pages: 5 }) === 5 && resolveMaxPages({ max_pages: 99999 }) === 200 && resolveMaxPages({ max_pages: -1 }) === 30) {
    pass('rexx.resolveMaxPages(): default 30, entry override, hard cap 200');
  } else {
    fail('rexx.resolveMaxPages() wrong');
  }

  // ── parseListPage ─────────────────────────────────────────────────
  {
    const html = listPage([
      newCard(101, 'R&amp;D Engineer (m/w/d)', 'M&#252;nchen'),
      oldCard(102, 'IT-Consultant', ['Defence &amp; Space', 'Festangestellte', 'Berlin, Bonn']),
      newCard(103, 'Relative Link Job', 'Hamburg', '/stellenmarkt/Relative-Link-Job-de-j103.html?agid=7&amp;x=1'),
      newCard(104, 'Off-host Job', 'Essen', 'https://evil.example/Off-host-Job-de-j104.html'),
      newCard(105, 'Not a posting', 'Köln', `https://${HOST}/about.html`),
      newCard(106, '   ', 'Köln'),
    ]);
    const page = parseListPage(html, LIST, HOST);
    const byId = Object.fromEntries(page.rows.map((r) => [r.id, r]));
    if (page.rawCount === 6) pass('rexx.parseListPage() counts every card the source rendered (rawCount)');
    else fail(`rexx.parseListPage() rawCount ${page.rawCount}, want 6`);
    if (page.rows.length === 3 && !byId['104'] && !byId['105'] && !byId['106']) pass('rexx.parseListPage() drops off-host, non-posting and title-less cards');
    else fail(`rexx.parseListPage() rows: ${JSON.stringify(page.rows.map((r) => r.id))}`);
    if (byId['101']?.title === 'R&D Engineer (m/w/d)' && byId['101']?.location === 'München') pass('rexx.parseListPage() decodes named and numeric entities in title and location');
    else fail(`rexx.parseListPage() decoding wrong: ${JSON.stringify(byId['101'])}`);
    const keepsRnD = buildTitleFilter({ positive: ['r&d'], negative: [] });
    if (keepsRnD(byId['101']?.title)) pass('rexx title with &amp; survives a positive "r&d" title_filter (decoded before matching)');
    else fail(`rexx title ${JSON.stringify(byId['101']?.title)} dropped by positive "r&d"`);
    if (byId['101']?.url === `https://${HOST}/Job-101-de-j101.html`) pass('rexx.parseListPage() keeps the absolute posting URL');
    else fail(`rexx.parseListPage() url wrong: ${byId['101']?.url}`);
    if (byId['103']?.url === `https://${HOST}/stellenmarkt/Relative-Link-Job-de-j103.html?agid=7&x=1`) pass('rexx.parseListPage() resolves a relative href against the page and decodes &amp; in it');
    else fail(`rexx.parseListPage() relative href wrong: ${byId['103']?.url}`);
    if (byId['102']?.location === 'Berlin, Bonn') pass('rexx.parseListPage() reads an older skin\'s last plain-text information column as the location');
    else fail(`rexx.parseListPage() old-skin location wrong: ${JSON.stringify(byId['102']?.location)}`);
    if (page.hasContainer && page.hasDetailLinks && page.total === null) pass('rexx.parseListPage() reports container / posting-link signals and no stated total');
    else fail(`rexx.parseListPage() signals wrong: ${JSON.stringify({ c: page.hasContainer, d: page.hasDetailLinks, t: page.total })}`);
    if (parseListPage(listPage([], { allCount: 278 }), LIST, HOST).total === 278) pass('rexx.parseListPage() reads data-all-count as the stated total');
    else fail('rexx.parseListPage() missed data-all-count');
  }

  // ── empty vs broken ───────────────────────────────────────────────
  {
    const emptyPage = parseListPage('<div id="joboffers"><div id="joboffers_message"><span>Keine Treffer</span></div></div>', LIST, HOST);
    let threw = null;
    try { assertListPage(emptyPage, LIST); } catch (e) { threw = e; }
    if (!threw) pass('rexx.assertListPage() accepts a #joboffers container with no cards (empty board)');
    else fail(`rexx.assertListPage() threw on an empty board: ${threw.message}`);

    const changed = parseListPage(`<div id="joboffers"><li class="job-row"><a href="https://${HOST}/Job-9-de-j9.html">Job</a></li></div>`, LIST, HOST);
    threw = null;
    try { assertListPage(changed, LIST); } catch (e) { threw = e; }
    if (threw && /markup changed/.test(threw.message)) pass('rexx.assertListPage() throws when posting links are present but no card parsed');
    else fail(`rexx.assertListPage() should flag a markup change, got ${threw?.message}`);

    const notRexx = parseListPage('<html><body><h1>Karriere</h1></body></html>', LIST, HOST);
    threw = null;
    try { assertListPage(notRexx, LIST); } catch (e) { threw = e; }
    if (threw && /not a rexx job list/.test(threw.message)) pass('rexx.assertListPage() throws on a page with neither cards nor the #joboffers container');
    else fail(`rexx.assertListPage() should reject a non-list page, got ${threw?.message}`);
  }

  // ── feed discovery + dates ────────────────────────────────────────
  {
    const same = findFeedUrl(feedLink(`https://${HOST}/rss_generator-rss0.php?unit=acme&amp;lang=de`), LIST, HOST);
    if (same === `https://${HOST}/rss_generator-rss0.php?unit=acme&lang=de`) pass('rexx.findFeedUrl() takes the advertised same-host Atom feed (entities decoded)');
    else fail(`rexx.findFeedUrl() same-host wrong: ${same}`);
    const rel = findFeedUrl(feedLink('rss_generator-rss0.php?unit=acme'), 'https://karriere.exampleco.example/stellenmarkt/stellenangebote.html', 'karriere.exampleco.example');
    if (rel === 'https://karriere.exampleco.example/stellenmarkt/rss_generator-rss0.php?unit=acme') pass('rexx.findFeedUrl() resolves a relative feed href against the list page');
    else fail(`rexx.findFeedUrl() relative wrong: ${rel}`);
    const offHost = [feedLink('https://169.254.169.254/latest/meta-data'), feedLink(`http://${HOST}/feed.xml`), feedLink('https://jobs.acme.example.evil.example/feed'), feedLink(`https://${HOST}:8443/feed.xml`),
      '<link rel="stylesheet" type="text/css" href="https://jobs.acme.example/a.css">'];
    if (offHost.every((h) => findFeedUrl(h, LIST, HOST) === null)) pass('rexx.findFeedUrl() ignores off-host, other-port, non-https and non-feed <link> tags');
    else fail('rexx.findFeedUrl() accepted a feed it must never fetch');

    const dates = parseFeedDates(atom([['101', '2026-11-10T00:00:00+01:00'], ['102', 'not a date'], ['103', '1970-01-01T00:00:00Z']])
      + '<entry><title>Off-host</title><link href="https://evil.example/X-de-j999.html"/><updated>2026-01-01</updated></entry>', LIST, HOST);
    if (dates.get('101') === Date.parse('2026-11-10T00:00:00+01:00') && !dates.has('102') && dates.get('103') === 0 && !dates.has('999')) {
      pass('rexx.parseFeedDates() maps job id → date, NaN-safe (epoch 0 kept, junk and off-host skipped)');
    } else {
      fail(`rexx.parseFeedDates() wrong: ${JSON.stringify([...dates])}`);
    }
    const rss = parseFeedDates(`<rss><channel><item><title>A</title><link>https://${HOST}/A-de-j7.html</link><pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`, LIST, HOST);
    if (rss.get('7') === Date.parse('Tue, 10 Nov 2026 08:00:00 GMT')) pass('rexx.parseFeedDates() also reads an RSS 2.0 <item>');
    else fail(`rexx.parseFeedDates() RSS wrong: ${JSON.stringify([...rss])}`);
    const selfFirst = parseFeedDates(`<feed><entry><link rel="self" href="https://${HOST}/feed/entry-8"/><link rel="alternate" href="https://${HOST}/H-de-j8.html"/>`
      + '<published>2026-10-01T00:00:00Z</published><updated>2026-11-01T00:00:00Z</updated></entry></feed>', LIST, HOST);
    if (selfFirst.get('8') === Date.parse('2026-11-01T00:00:00Z')) pass('rexx.parseFeedDates() skips a rel="self" link to the posting link and prefers <updated> over an earlier <published>');
    else fail(`rexx.parseFeedDates() link/date selection wrong: ${JSON.stringify([...selfFirst])}`);
    const postingFirst = parseFeedDates(`<feed><entry><link href="https://${HOST}/Q-de-j10.html"/><link rel="related" href="https://evil.example/x"/>`
      + '<updated>2026-11-02T00:00:00Z</updated></entry></feed>', LIST, HOST);
    if (postingFirst.get('10') === Date.parse('2026-11-02T00:00:00Z')) pass('rexx.parseFeedDates() keeps the first posting link when later links are not postings');
    else fail(`rexx.parseFeedDates() lost a posting link to a later non-posting link: ${JSON.stringify([...postingFirst])}`);
    const pubOnly = parseFeedDates(`<feed><entry><link href="https://${HOST}/P-de-j9.html"/><published>2026-10-05T00:00:00Z</published></entry></feed>`, LIST, HOST);
    if (pubOnly.get('9') === Date.parse('2026-10-05T00:00:00Z')) pass('rexx.parseFeedDates() falls back to <published> when an entry has no <updated>');
    else fail(`rexx.parseFeedDates() published fallback wrong: ${JSON.stringify([...pubOnly])}`);
    if (parseFeedDates(undefined, LIST, HOST).size === 0 && parseFeedDates('<html>404</html>', LIST, HOST).size === 0) pass('rexx.parseFeedDates() returns an empty map for a non-feed body');
    else fail('rexx.parseFeedDates() should tolerate a non-feed body');
  }

  // ── fetch: one-page board + feed ──────────────────────────────────
  {
    const FEED = `https://${HOST}/rss_generator-rss0.php?unit=acme&lang=de`;
    const ctx = makeCtx({
      [LIST]: listPage([newCard(1, 'Security Analyst', 'Essen'), oldCard(2, 'SOC Engineer', ['Defence', 'Festangestellte', 'Berlin'])], { head: feedLink(FEED.replaceAll('&', '&amp;')) }),
      [`${LIST}?start=2`]: listPage([]),
      [FEED]: atom([['1', '2026-11-03T00:00:00+01:00']]),
    });
    const jobs = await rexx.fetch({ name: 'Acme', careers_url: `https://${HOST}/`, provider: 'rexx' }, ctx);
    const urls = ctx.calls.map((c) => c.url);
    if (jobs.length === 2 && jobs[0].company === 'Acme' && jobs[0].location === 'Essen' && jobs[1].location === 'Berlin') pass('rexx.fetch() returns normalized jobs (company, title, url, location)');
    else fail(`rexx.fetch() jobs wrong: ${JSON.stringify(jobs)}`);
    if (jobs[0].postedAt === Date.parse('2026-11-03T00:00:00+01:00') && !('postedAt' in jobs[1])) pass('rexx.fetch() joins feed dates by job id and leaves an unmatched posting undated');
    else fail(`rexx.fetch() dates wrong: ${JSON.stringify(jobs.map((j) => j.postedAt))}`);
    if (JSON.stringify(urls) === JSON.stringify([LIST, `${LIST}?start=2`, FEED])) pass('rexx.fetch() reads the list, confirms the end with ?start=, then reads the feed once');
    else fail(`rexx.fetch() request sequence wrong: ${JSON.stringify(urls)}`);
    if (ctx.calls.length > 0 && ctx.calls.every((c) => c.opts?.redirect === 'error')) pass('rexx.fetch() passes redirect: "error" on every request (list pages and feed)');
    else fail(`rexx.fetch() request without redirect:error: ${JSON.stringify(ctx.calls.map((c) => c.opts?.redirect))}`);
    if (jobs.truncated === undefined && !jobs.some((j) => '_rexxId' in j || 'id' in j)) pass('rexx.fetch() returns plain Job objects with no truncation marker on a complete board');
    else fail('rexx.fetch() leaked internal fields or marked a complete board truncated');
  }

  // ── fetch: pagination, dedup, short-page end ──────────────────────
  {
    const ctx = makeCtx({
      [LIST]: listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')]),
      [`${LIST}?start=2`]: listPage([newCard(2, 'B again', 'X'), newCard(3, 'C', 'X')]),
      [`${LIST}?start=4`]: listPage([newCard(4, 'D', 'X')]),
    });
    const jobs = await rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx);
    if (jobs.length === 4 && new Set(jobs.map((j) => j.url)).size === 4 && ctx.calls.length === 3) pass('rexx.fetch() walks ?start= by the page\'s card count, dedups by job id, ends on a short page');
    else fail(`rexx.fetch() pagination wrong: ${jobs.length} jobs / ${ctx.calls.length} calls`);
  }

  // ── fetch: a malformed card still counts toward the next ?start= ──
  {
    const ctx = makeCtx({
      [LIST]: listPage([newCard(1, 'A', 'X'), newCard(2, 'Off-host', 'X', 'https://evil.example/B-de-j2.html')]),
      [`${LIST}?start=2`]: listPage([newCard(3, 'C', 'X'), newCard(4, 'D', 'X')]),
      [`${LIST}?start=4`]: listPage([]),
    });
    const jobs = await rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx);
    if (jobs.length === 3 && ctx.calls[1]?.url === `${LIST}?start=2`) pass('rexx.fetch() advances ?start= by the cards the source rendered, not the rows that parsed');
    else fail(`rexx.fetch() offset wrong after a dropped card: ${JSON.stringify(ctx.calls.map((c) => c.url))}`);
  }

  // ── fetch: a portal that ignores ?start= ──────────────────────────
  {
    const same = listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')]);
    const ctx = makeCtx({ [LIST]: same, [`${LIST}?start=2`]: same });
    const jobs = await rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx);
    if (jobs.length === 2 && ctx.calls.length === 2 && jobs.truncated === undefined) pass('rexx.fetch() stops when a page brings nothing new (portal ignored ?start=)');
    else fail(`rexx.fetch() repeat-page handling wrong: ${jobs.length} jobs / ${ctx.calls.length} calls`);

    // A repeated page whose stated total equals what was read is complete.
    const sameEq = listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')], { allCount: 2 });
    const eqCtx = makeCtx({ [LIST]: sameEq, [`${LIST}?start=2`]: sameEq });
    const eq = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST }, eqCtx));
    if (eq.result.length === 2 && eq.result.truncated === undefined && eq.errors.length === 0) pass('rexx.fetch() leaves a repeated page unmarked when data-all-count equals what was read');
    else fail(`rexx.fetch() marked a repeated page whose total was reached: ${JSON.stringify(eq.result.truncated)}`);

    // The same, on a portal that states more postings than were read: incomplete.
    const sameTot = listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')], { allCount: 30 });
    const totCtx = makeCtx({ [LIST]: sameTot, [`${LIST}?start=2`]: sameTot });
    const rep = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST }, totCtx));
    if (rep.result.length === 2 && totCtx.calls.length === 2 && rep.result.truncated?.reason === 'repeat-page' && rep.result.truncated.total === 30
      && rep.errors.some((e) => /repeated a page/.test(e))) pass('rexx.fetch() marks a repeated page as truncated (repeat-page) when data-all-count exceeds what was read');
    else fail(`rexx.fetch() repeat-page with a larger total wrong: ${JSON.stringify(rep.result.truncated)} ${JSON.stringify(rep.errors)}`);
  }

  // ── SSRF: the URL guard runs before any request ───────────────────
  for (const careers_url of [`http://${HOST}/stellenangebote.html`, 'https//broken', undefined, 'https://169.254.169.254/latest/meta-data/',
    'https://127.1/stellenangebote.html', 'https://0x7f000001/', 'https://[::1]/', 'https://localhost/', 'https://jobs.corp.internal/', 'https://intranet/']) {
    let entered = 0;
    const ctx = { sleep: async () => {}, fetchText: async () => { entered++; return ''; }, fetchJson: async () => { entered++; return {}; } };
    let threw = null;
    try { await rexx.fetch({ name: 'Acme', careers_url, provider: 'rexx' }, ctx); } catch (e) { threw = e; }
    if (threw && entered === 0) pass(`rexx.fetch() rejects careers_url ${JSON.stringify(careers_url)} before any fetch (0 calls)`);
    else fail(`rexx.fetch() guard did not run first for ${JSON.stringify(careers_url)}: threw=${!!threw}, fetch calls=${entered}`);
  }

  // ── SSRF: a feed link off the portal host is never requested ──────
  {
    const ctx = makeCtx({
      [LIST]: listPage([newCard(1, 'A', 'X')], { head: feedLink('https://169.254.169.254/latest/meta-data') }),
      [`${LIST}?start=1`]: listPage([]),
    });
    const jobs = await rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx);
    if (jobs.length === 1 && ctx.calls.every((c) => new URL(c.url).hostname === HOST)) pass('rexx.fetch() never requests a feed URL off the portal host');
    else fail(`rexx.fetch() requested ${JSON.stringify(ctx.calls.map((c) => c.url))}`);
  }

  // ── empty / broken boards through fetch ───────────────────────────
  {
    const FEED = `https://${HOST}/feed.xml`;
    const ctx = makeCtx({ [LIST]: listPage([], { head: feedLink(FEED) }) });
    const jobs = await rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx);
    if (Array.isArray(jobs) && jobs.length === 0 && ctx.calls.length === 1) pass('rexx.fetch() returns [] for an empty board, with no further requests');
    else fail(`rexx.fetch() empty board wrong: ${JSON.stringify(jobs)} after ${ctx.calls.length} calls`);

    let threw = null;
    try { await rexx.fetch({ name: 'Acme', careers_url: LIST }, makeCtx({ [LIST]: '<html><body>Wartungsarbeiten</body></html>' })); } catch (e) { threw = e; }
    if (threw && /not a rexx job list/.test(threw.message)) pass('rexx.fetch() throws on a page that is not a rexx list');
    else fail(`rexx.fetch() should throw on a non-list page, got ${threw?.message}`);
  }

  // ── health probe ──────────────────────────────────────────────────
  {
    const FEED = `https://${HOST}/feed.xml`;
    const ctx = makeCtx({ [LIST]: listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')], { head: feedLink(FEED) }) }, { maxPages: 1 });
    const { result: jobs, errors } = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx));
    if (ctx.calls.length === 1 && jobs.length === 2) pass('rexx.fetch() under ctx.maxPages: 1 issues exactly one list request and no feed request');
    else fail(`rexx.fetch() probe issued ${ctx.calls.length} requests: ${JSON.stringify(ctx.calls.map((c) => c.url))}`);
    if (errors.length === 0 && jobs.truncated === undefined) pass('rexx.fetch() probe cap neither warns about max_pages nor marks the board truncated');
    else fail(`rexx.fetch() probe warned/marked: ${JSON.stringify(errors)} ${JSON.stringify(jobs.truncated)}`);

    class ProbePageBudgetReached extends Error {}
    const budget = new ProbePageBudgetReached('budget');
    let caught = null;
    try { await rexx.fetch({ name: 'Acme', careers_url: LIST }, makeCtx({ [LIST]: budget }, { maxPages: 1 })); } catch (e) { caught = e; }
    if (caught === budget) pass('rexx.fetch() propagates a ctx.fetchText rejection unwrapped while probing');
    else fail(`rexx.fetch() wrapped or swallowed the probe rejection: ${caught}`);

    // A later page rejecting during a probe with a 2-page budget also
    // propagates unwrapped (not kept as a partial board).
    const later = new ProbePageBudgetReached('budget p2');
    caught = null;
    try {
      await rexx.fetch({ name: 'Acme', careers_url: LIST },
        makeCtx({ [LIST]: listPage([newCard(1, 'A', 'X')]), [`${LIST}?start=1`]: later }, { maxPages: 2 }));
    } catch (e) { caught = e; }
    if (caught === later) pass('rexx.fetch() propagates a later-page rejection unwrapped while probing');
    else fail(`rexx.fetch() swallowed a later-page probe rejection: ${caught}`);
  }

  // ── page cap ──────────────────────────────────────────────────────
  {
    const routes = {
      [LIST]: listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')]),
      [`${LIST}?start=2`]: listPage([newCard(3, 'C', 'X'), newCard(4, 'D', 'X')]),
      [`${LIST}?start=4`]: listPage([newCard(5, 'E', 'X'), newCard(6, 'F', 'X')]),
    };
    const ctx = makeCtx(routes);
    const { result: jobs, errors } = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST, max_pages: 2 }, ctx));
    if (jobs.length === 4 && ctx.calls.length === 2) pass('rexx.fetch() stops at the entry\'s max_pages');
    else fail(`rexx.fetch() cap wrong: ${jobs.length} jobs / ${ctx.calls.length} calls`);
    if (errors.some((e) => /raise max_pages/.test(e)) && jobs.truncated?.reason === 'page-cap') pass('rexx.fetch() warns "raise max_pages" and marks the board truncated (page-cap) when the cap cut a full page');
    else fail(`rexx.fetch() cap signal wrong: ${JSON.stringify(errors)} ${JSON.stringify(jobs.truncated)}`);

    // A short final page at the cap boundary is a natural end.
    const shortCtx = makeCtx({ [LIST]: routes[LIST], [`${LIST}?start=2`]: listPage([newCard(3, 'C', 'X')]) });
    const short = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST, max_pages: 2 }, shortCtx));
    if (short.errors.length === 0 && short.result.truncated === undefined && short.result.length === 3) pass('rexx.fetch() treats a short page at the cap boundary as complete (no warning, no marker)');
    else fail(`rexx.fetch() short boundary page misread as cap: ${JSON.stringify(short.errors)}`);

    // A full boundary page stays truncated even when data-all-count says it
    // was the last one: the count can be wrong, and here a third page exists.
    const totalCtx = makeCtx({
      [LIST]: listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')], { allCount: 4 }),
      [`${LIST}?start=2`]: listPage([newCard(3, 'C', 'X'), newCard(4, 'D', 'X')], { allCount: 4 }),
      [`${LIST}?start=4`]: listPage([newCard(5, 'E', 'X'), newCard(6, 'F', 'X')], { allCount: 4 }),
    });
    const tot = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST, max_pages: 2 }, totalCtx));
    if (tot.result.length === 4 && totalCtx.calls.length === 2 && tot.result.truncated?.reason === 'page-cap' && tot.errors.some((e) => /raise max_pages/.test(e))) {
      pass('rexx.fetch() keeps a full boundary page truncated (page-cap) even when data-all-count is reached');
    } else fail(`rexx.fetch() trusted data-all-count as proof of completion: ${JSON.stringify(tot.result.truncated)} ${JSON.stringify(tot.errors)}`);
  }

  // ── later-page fetch error: keep partial, never blame max_pages ───
  {
    let p2 = 0;
    const ctx = makeCtx({
      [LIST]: listPage([newCard(1, 'A', 'X'), newCard(2, 'B', 'X')]),
      [`${LIST}?start=2`]: () => { p2++; throw Object.assign(new Error('HTTP 503'), { status: 503 }); },
    });
    const { result: jobs, errors } = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx));
    if (jobs.length === 2 && p2 === 3) pass('rexx.fetch() retries a failing page (fetchTextWithRetry), then keeps the pages already read');
    else fail(`rexx.fetch() partial handling wrong: ${jobs.length} jobs, page-2 attempts ${p2}`);
    if (!errors.some((e) => /raise max_pages/.test(e)) && errors.some((e) => /stopped at page 2/.test(e)) && jobs.truncated?.reason === 'fetch-error') {
      pass('rexx.fetch() warns about the fetch error (not max_pages) and marks the board truncated (fetch-error)');
    } else {
      fail(`rexx.fetch() fetch-error signal wrong: ${JSON.stringify(errors)} ${JSON.stringify(jobs.truncated)}`);
    }

    let threw = null;
    try { await rexx.fetch({ name: 'Acme', careers_url: LIST }, makeCtx({ [LIST]: Object.assign(new Error('HTTP 404'), { status: 404 }) })); } catch (e) { threw = e; }
    if (threw && /404/.test(threw.message)) pass('rexx.fetch() fails loud when the first list page cannot be read');
    else fail(`rexx.fetch() first-page failure should throw, got ${threw}`);
  }

  // ── feed failure is best-effort ───────────────────────────────────
  {
    const FEED = `https://${HOST}/feed.xml`;
    const ctx = makeCtx({
      [LIST]: listPage([newCard(1, 'A', 'X')], { head: feedLink(FEED) }),
      [`${LIST}?start=1`]: listPage([]),
      [FEED]: Object.assign(new Error('HTTP 404'), { status: 404 }),
    });
    const { result: jobs, errors } = await captureConsoleErrors(() => rexx.fetch({ name: 'Acme', careers_url: LIST }, ctx));
    if (jobs.length === 1 && !('postedAt' in jobs[0]) && errors.some((e) => /feed unreadable/.test(e)) && jobs.truncated === undefined) {
      pass('rexx.fetch() keeps the postings undated when the feed cannot be read');
    } else {
      fail(`rexx.fetch() feed failure handling wrong: ${JSON.stringify(jobs)} ${JSON.stringify(errors)}`);
    }
  }
} catch (e) {
  fail(`rexx provider tests crashed: ${e.stack || e.message}`);
}
