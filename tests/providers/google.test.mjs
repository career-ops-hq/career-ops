// tests/providers/google.test.mjs — google provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — google');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/google.mjs')).href);
  const provider = mod.default;
  const { resolveMaxPages } = mod;
  const PAGE_SIZE = 20; // must match providers/google.mjs

  if (provider.id === 'google') pass('google.id is "google"');
  else fail(`google.id is ${JSON.stringify(provider.id)}`);

  if (provider.detect({ name: 'X' }) === null) pass('google.detect() returns null with no config');
  else fail('google.detect() should return null with no config');

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('google.detect() ignores careers_url — config key only');
  } else {
    fail('google.detect() should not fire on careers_url alone');
  }

  if (typeof provider.fetch === 'function') pass('google.fetch() is callable');
  else fail('google.fetch() is not a function');

  // A ctx whose fetchText answers per URL. `respond(call)` returns the HTML for
  // that request; `call.url` carries the query string (q, page). redirect:'error'
  // is recorded so the robots/SSRF guard can be asserted. A no-op sleep keeps
  // pacing and retry backoff instant.
  const recordingCtx = (respond) => {
    const calls = [];
    const fetchText = async (url, opts = {}) => { const call = { url, opts, n: calls.length }; calls.push(call); return respond(call); };
    return { calls, ctx: { transport: 'http', sleep: async () => {}, fetchText, fetchJson: async () => { throw new Error('google must not call fetchJson'); } } };
  };
  // Run `fn` with console.error captured; returns the lines it logged.
  const captureErrors = async (fn) => {
    const real = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    try { await fn(); } finally { console.error = real; }
    return lines;
  };
  // page= of a recorded request URL (null on page 1, which omits the param).
  const pageOf = (url) => new URLSearchParams(url.split('?')[1] || '').get('page');
  const qOf = (url) => new URLSearchParams(url.split('?')[1] || '').get('q');
  // A bare-link results page (no card markup -> slug title + entry name).
  const link = (id, slug = 'role') => `<a href="/about/careers/applications/jobs/results/${id}-${slug}">x</a>`;
  const linkPage = (ids) => `<!doctype html>${ids.map((id) => link(id)).join('\n')}`;
  // A full page of PAGE_SIZE distinct ids starting at `start`.
  const fullPageIds = (start) => Array.from({ length: PAGE_SIZE }, (_, i) => String(start + i));

  const ENTRY = { name: 'Google', google: { queries: ['business strategy', 'corporate development'], location: 'United States' } };
  const RESULTS_HTML = linkPage(['123456789', '987654321']); // short page -> one request per query

  // ── request shape: sort_by=date, redirect guard, page= only past page 1 ──
  {
    const { ctx, calls } = recordingCtx(() => RESULTS_HTML);
    const jobs = await provider.fetch(ENTRY, ctx);

    calls.every((c) => /[?&]sort_by=date\b/.test(c.url))
      ? pass('google.fetch() asks for the newest postings (sort_by=date) on every request')
      : fail(`google URLs missing sort_by=date: ${calls.map((c) => c.url).join(' ')}`);

    calls.every((c) => c.opts?.redirect === 'error')
      ? pass('google.fetch() passes redirect:"error" on every request')
      : fail(`google redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);

    // Each query here is a short page (2 links < PAGE_SIZE), so the walk stops
    // after page 1 and page 1 never carries the page= parameter.
    calls.length === 2 && calls.every((c) => pageOf(c.url) === null)
      ? pass('google.fetch() makes one request per query on a short page, and page 1 omits page=')
      : fail(`google short-page requests: ${calls.map((c) => c.url).join(' ')}`);

    const j = jobs.find((x) => x.externalId === '123456789');
    j && j.title === 'Role'
      && j.url === 'https://www.google.com/about/careers/applications/jobs/results/123456789-role'
      && j.company === 'Google'
      ? pass('google.fetch() falls back to the slug title and entry name for a bare link with no card markup')
      : fail(`google mapping: ${JSON.stringify(jobs)}`);
  }

  // ── pagination: walks pages, 1-based page= from page 2, dedups, stops short ──
  {
    const query = (url) => {
      const page = Number(pageOf(url) || '1');
      if (page === 1) return linkPage(fullPageIds(100));          // 20 cards
      if (page === 2) return linkPage(fullPageIds(200));          // 20 cards
      if (page === 3) return linkPage(['300', '301', '302']);     // short -> last
      return linkPage([]); // never reached
    };
    const { ctx, calls } = recordingCtx((c) => query(c.url));
    const jobs = await provider.fetch({ name: 'Google', google: { queries: ['strategy'] }, max_pages: 10 }, ctx);

    calls.map((c) => pageOf(c.url) ?? 'none').join(',') === 'none,2,3'
      ? pass('google.fetch() walks pages, omitting page= on page 1 and sending the 1-based number after it')
      : fail(`google page sequence: ${calls.map((c) => pageOf(c.url) ?? 'none')}`);
    jobs.length === PAGE_SIZE * 2 + 3 && new Set(jobs.map((j) => j.externalId)).size === jobs.length
      ? pass('google.fetch() returns every page deduped (20 + 20 + 3 = 43 unique)')
      : fail(`google paginated jobs: ${jobs.length}`);
  }

  // A page that re-serves ids already seen in this query stops the walk.
  {
    const { ctx, calls } = recordingCtx(() => linkPage(fullPageIds(500)));
    const jobs = await provider.fetch({ name: 'Google', google: { queries: ['strategy'] }, max_pages: 10 }, ctx);
    calls.length === 2 && jobs.length === PAGE_SIZE
      ? pass('google.fetch() stops when a page repeats ids already seen in the same query')
      : fail(`google re-serve stop: ${calls.length} requests, ${jobs.length} jobs`);
  }

  // ── max_pages caps the per-query walk and warns; raising it adds pages ──
  {
    const { ctx, calls } = recordingCtx((c) => linkPage(fullPageIds(1000 + Number(pageOf(c.url) || '1') * PAGE_SIZE)));
    let jobs;
    const logged = await captureErrors(async () => { jobs = await provider.fetch({ name: 'Google', google: { queries: ['strategy'] }, max_pages: 2 }, ctx); });
    calls.length === 2 && jobs.length === PAGE_SIZE * 2 && jobs.truncated?.reason === 'page-cap' && jobs.truncated?.fetched === PAGE_SIZE * 2
      ? pass('google.fetch() stops at max_pages when every page is full and marks page-cap')
      : fail(`google max_pages cap: ${calls.length} requests, ${jobs?.length} jobs, truncated=${JSON.stringify(jobs?.truncated)}`);
    logged.some((l) => /hit the 2-page cap on at least one query — raise max_pages/.test(l))
      ? pass('google.fetch() warns when the page cap truncated a query')
      : fail(`google cap warning: ${JSON.stringify(logged)}`);
  }
  {
    const { ctx, calls } = recordingCtx((c) => linkPage(fullPageIds(2000 + Number(pageOf(c.url) || '1') * PAGE_SIZE)));
    await provider.fetch({ name: 'Google', google: { queries: ['strategy'] }, max_pages: 4 }, ctx);
    calls.length === 4
      ? pass('google.fetch() walks more pages when max_pages is raised')
      : fail(`google raised max_pages made ${calls.length} requests`);
  }
  {
    // A short page that lands exactly on the cap is the end of the results,
    // not a truncation: no cap warning.
    const { ctx, calls } = recordingCtx((c) => (Number(pageOf(c.url) || '1') === 1 ? linkPage(fullPageIds(3000)) : linkPage(['3100', '3101'])));
    const logged = await captureErrors(() => provider.fetch({ name: 'Google', google: { queries: ['strategy'] }, max_pages: 2 }, ctx));
    calls.length === 2 && !logged.some((l) => /-page cap/.test(l))
      ? pass('google.fetch() does not warn when the last page allowed is a short one')
      : fail(`google short page at the cap: ${calls.length} requests, ${JSON.stringify(logged)}`);
  }

  // resolveMaxPages(): positive integer up to the hard ceiling, else the default.
  resolveMaxPages({}) === 10 && resolveMaxPages({ max_pages: 3 }) === 3
    && resolveMaxPages({ max_pages: 99999 }) === 50
    && resolveMaxPages({ max_pages: 0 }) === 10 && resolveMaxPages({ max_pages: 'many' }) === 10
    ? pass('resolveMaxPages() honours a positive integer up to the 50-page ceiling')
    : fail('resolveMaxPages() wrong');

  // A later query whose first page overlaps an earlier query still walks its own
  // deeper pages (cross-query overlap must not shortcut the walk).
  {
    const q1p1 = fullPageIds(100);
    const query = (url) => {
      const page = Number(pageOf(url) || '1');
      if (qOf(url) === 'alpha') return page === 1 ? linkPage(q1p1) : linkPage(['150', '151']); // full, then short (new ids)
      // 'beta' page 1 re-serves alpha's 20 ids (all overlap byId), page 2 is new.
      return page === 1 ? linkPage(q1p1) : linkPage(['900', '901']);
    };
    const { ctx, calls } = recordingCtx((c) => query(c.url));
    const jobs = await provider.fetch({ name: 'Google', google: { queries: ['alpha', 'beta'] }, max_pages: 10 }, ctx);
    const ids = new Set(jobs.map((j) => j.externalId));
    calls.length === 4 && ids.size === PAGE_SIZE + 2 + 2 && ids.has('900') && ids.has('901')
      ? pass('google.fetch() walks a later query\'s deeper pages even when its first page overlaps an earlier query')
      : fail(`google cross-query overlap: ${calls.length} requests, ${ids.size} unique ids`);
  }

  // The live page's card markup (trimmed from a 2026-09-24 results page). The
  // same results list other Alphabet companies' postings, so the card's
  // employer is the company, the <h3> is the title (a slug loses "/", "&" and
  // casing), and "+N more" is Google collapsing the location list.
  const card = (id, slug, title, employerLine) => `<li class="lLd3Je"><div><h3 class="QJPWVe">${title}</h3>`
    + `<p class="l103df">${employerLine}</p><div class="Xsxa1e"><h4>Minimum qualifications</h4></div>`
    + `<a class="WpHeLc" href="jobs/results/${id}-${slug}?q=business+operations&amp;sort_by=date" aria-label="Learn more about ${title}" jsname="hSRGPd"></a></div></li>`;
  const CARDS_HTML = `<!doctype html><h3 class="mUzaXb">Filters</h3><ul>`
    + card('127792359805985478', 'product-manager-ii-youtube-ads', 'Product Manager II, YouTube Ads &amp; AI/ML',
      'YouTube | <span class="pwO9Dc"><span class="r0wTof ">Kirkland, WA, USA</span><span class="r0wTof p3oCrc">; Mountain View, CA, USA</span><span class="BVHzed">; +2 more</span><span class="Z2gFhf">; +1 more</span></span>')
    + card('95645113710977734', 'associate-business-operations-and-strategy', 'Associate, Business Operations and Strategy',
      'Google | <span class="pwO9Dc"><span class="r0wTof ">San Jose, CA, USA</span></span>')
    + `</ul>`;
  {
    const { ctx } = recordingCtx(() => CARDS_HTML);
    const jobs = await provider.fetch({ ...ENTRY, google: { queries: ['business operations'] } }, ctx);
    const yt = jobs.find((x) => x.externalId === '127792359805985478');
    const g = jobs.find((x) => x.externalId === '95645113710977734');
    yt?.company === 'YouTube' && g?.company === 'Google'
      ? pass('google.fetch() attributes each posting to the employer its card names, not the entry name')
      : fail(`google employer attribution: ${JSON.stringify(jobs.map((x) => [x.externalId, x.company]))}`);
    yt?.title === 'Product Manager II, YouTube Ads & AI/ML' && g?.title === 'Associate, Business Operations and Strategy'
      ? pass('google.fetch() takes the title from the card, entities decoded, not from the slug')
      : fail(`google card titles: ${JSON.stringify(jobs.map((x) => x.title))}`);
    yt?.location === 'Kirkland, WA, USA; Mountain View, CA, USA' && g?.location === 'San Jose, CA, USA'
      ? pass('google.fetch() reads the card locations and drops Google\'s "+N more" overflow')
      : fail(`google card locations: ${JSON.stringify(jobs.map((x) => x.location))}`);
    yt?.url === 'https://www.google.com/about/careers/applications/jobs/results/127792359805985478-product-manager-ii-youtube-ads'
      ? pass('google.fetch() rebuilds the public URL without the query string the card link carries')
      : fail(`google card url: ${yt?.url}`);
  }

  // Entity-escaped markup in a card must not decode into live markup.
  {
    const hostile = card('555000111', 'x', 'Analyst &lt;script&gt;alert(1)&lt;/script&gt; Ops',
      'Google &lt;img src=x onerror=alert(1)&gt; | <span class="r0wTof ">&lt;b&gt;Austin, TX, USA&lt;/b&gt;</span>');
    const { ctx } = recordingCtx(() => `<ul>${hostile}</ul>`);
    const [j] = await provider.fetch({ ...ENTRY, google: { queries: ['x'] } }, ctx);
    j && ![j.title, j.company, j.location].some((v) => /<\/?[a-z]/i.test(v))
      ? pass('google.fetch() never turns entity-escaped markup into live tags')
      : fail(`google decoded markup: ${JSON.stringify(j && [j.title, j.company, j.location])}`);
  }

  for (const queries of [[''], ['   '], ['', 'business strategy'], ['alpha', 'beta']]) {
    const { ctx } = recordingCtx(() => linkPage([]));
    const jobs = await provider.fetch({ name: 'Google', google: { queries } }, ctx);
    const expected = queries.every(q => q.trim()) ? { config: 'google.queries', queries } : undefined;
    JSON.stringify(jobs.queryScope) === JSON.stringify(expected)
      ? pass('Google query scope agrees with ' + JSON.stringify(queries))
      : fail('Unexpected query scope for ' + JSON.stringify(queries));
  }

  // ── probe: ctx.maxPages walks one query, one page, one request ──
  {
    const { ctx, calls } = recordingCtx(() => linkPage(fullPageIds(100))); // a full page
    await provider.fetch(ENTRY, { ...ctx, maxPages: 1 });
    calls.length === 1 && pageOf(calls[0].url) === null
      ? pass('google.fetch() spends exactly one request under ctx.maxPages, even with a full page and two queries')
      : fail(`google probe made ${calls.length} requests: ${calls.map((c) => c.url)}`);
  }

  // A failed unrestricted request leaves a keyword-only, truncated result.
  {
    const { ctx } = recordingCtx(({ url }) => {
      if (!qOf(url)) throw Object.assign(new Error('Not Found'), { status: 404 });
      return linkPage(['5000']);
    });
    let jobs;
    await captureErrors(async () => { jobs = await provider.fetch({ name: 'Google', google: { queries: ['', 'engineer'] } }, ctx); });
    jobs.length === 1 && jobs.truncated?.reason === 'fetch-error' && JSON.stringify(jobs.queryScope?.queries) === '["engineer"]'
      ? pass('google.fetch() reports keyword scope when the unrestricted request fails')
      : fail('google.fetch() lost keyword scope or truncation after the unrestricted request failed');
  }

  // ── error handling ──
  {
    // First request fails -> throws (broken board, not an empty one).
    const boom = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const { ctx } = recordingCtx(() => { throw boom; });
    let threw = null;
    try { await provider.fetch({ name: 'Google', google: { queries: ['strategy'] } }, ctx); } catch (e) { threw = e; }
    threw === boom
      ? pass('google.fetch() throws when the first request fails, rather than reading as empty')
      : fail(`google first-request failure: ${threw?.message}`);
  }
  {
    // A later page fails -> keep the pages already collected and warn, without
    // misfiring the max_pages warning.
    const err404 = Object.assign(new Error('Not Found'), { status: 404 });
    const query = (url) => { if (Number(pageOf(url) || '1') >= 2) throw err404; return linkPage(fullPageIds(100)); };
    const { ctx } = recordingCtx((c) => query(c.url));
    let jobs; let logged;
    logged = await captureErrors(async () => { jobs = await provider.fetch({ name: 'Google', google: { queries: ['strategy'] }, max_pages: 5 }, ctx); });
    jobs?.length === PAGE_SIZE && jobs.truncated?.reason === 'fetch-error' && jobs.truncated?.fetched === PAGE_SIZE && logged.some((l) => /stopped "strategy" at page 2/.test(l)) && !logged.some((l) => /raise max_pages/.test(l))
      ? pass('google.fetch() keeps the pages collected when a later page fails, warns, and marks fetch-error')
      : fail(`google later-page failure: ${jobs?.length} jobs, ${JSON.stringify(logged)}, truncated=${JSON.stringify(jobs?.truncated)}`);
  }
  {
    // A later query whose first request fails keeps the earlier query's jobs,
    // warns, and does not throw.
    const err404 = Object.assign(new Error('Not Found'), { status: 404 });
    const query = (url) => { if (qOf(url) === 'beta') throw err404; return linkPage(['4000', '4001']); };
    const { ctx } = recordingCtx((c) => query(c.url));
    let jobs; let threw = null;
    const logged = await captureErrors(async () => {
      try { jobs = await provider.fetch({ name: 'Google', google: { queries: ['alpha', 'beta'] } }, ctx); } catch (e) { threw = e; }
    });
    !threw && jobs?.length === 2 && jobs.truncated?.reason === 'fetch-error' && logged.some((l) => /stopped "beta" at page 1/.test(l))
      ? pass('google.fetch() keeps an earlier query\'s jobs when a later query\'s first request fails, warns, and marks fetch-error')
      : fail(`google later-query failure: threw=${threw?.message} jobs=${jobs?.length} ${JSON.stringify(logged)}, truncated=${JSON.stringify(jobs?.truncated)}`);
  }
  {
    // An earlier query whose first request fails keeps a later query's jobs,
    // warns, and does not throw.
    const err404 = Object.assign(new Error('Not Found'), { status: 404 });
    const query = (url) => { if (qOf(url) === 'alpha') throw err404; return linkPage(['5000', '5001']); };
    const { ctx } = recordingCtx((c) => query(c.url));
    let jobs; let threw = null;
    const logged = await captureErrors(async () => {
      try { jobs = await provider.fetch({ name: 'Google', google: { queries: ['alpha', 'beta'] } }, ctx); } catch (e) { threw = e; }
    });
    !threw && jobs?.length === 2 && jobs.truncated?.reason === 'fetch-error' && logged.some((l) => /stopped "alpha" at page 1/.test(l))
      ? pass('google.fetch() keeps a later query\'s jobs when an earlier query\'s first request fails, warns, and marks fetch-error')
      : fail(`google earlier-query failure: threw=${threw?.message} jobs=${jobs?.length} ${JSON.stringify(logged)}, truncated=${JSON.stringify(jobs?.truncated)}`);
  }
  {
    // When EVERY query fails on page 1, throws the first query's error (total outage).
    const errAlpha = Object.assign(new Error('alpha failed'), { status: 503 });
    const errBeta = Object.assign(new Error('beta failed'), { status: 500 });
    const query = (url) => {
      if (qOf(url) === 'alpha') throw errAlpha;
      throw errBeta;
    };
    const { ctx } = recordingCtx((c) => query(c.url));
    let threw = null;
    try { await provider.fetch({ name: 'Google', google: { queries: ['alpha', 'beta'] } }, ctx); } catch (e) { threw = e; }
    threw === errAlpha
      ? pass('google.fetch() throws the first failure when every query fails on page 1 (total outage)')
      : fail(`google total outage: threw=${threw?.message}, expected alpha failed`);
  }
  {
    // While probing, a rejection propagates unwrapped (verify-portals needs it).
    const boom = Object.assign(new Error('budget'), { status: 503 });
    const { ctx } = recordingCtx(() => { throw boom; });
    let threw = null;
    try { await provider.fetch(ENTRY, { ...ctx, maxPages: 1 }); } catch (e) { threw = e; }
    threw === boom
      ? pass('google.fetch() propagates a fetch rejection unwrapped during a probe')
      : fail(`google probe rejection: ${threw?.message}`);
  }

  // ── full_board: one unqueried walk of the whole listing ──
  {
    const FULL = { name: 'Google', google: { full_board: true, queries: ['strategy', 'ops'], location: 'United States' } };
    // Page 1 is the real card markup (title, employer, locations); pages 2..N
    // are full link pages; the last is short.
    const lastPage = 60;
    const respond = (c) => {
      const page = Number(pageOf(c.url) || '1');
      if (page === 1) return CARDS_HTML.replace('</ul>', linkPage(fullPageIds(900000).slice(0, PAGE_SIZE - 2)) + '</ul>');
      if (page < lastPage) return linkPage(fullPageIds(1000000 + page * PAGE_SIZE));
      return linkPage(['7', '8', '9']);
    };
    const { ctx, calls } = recordingCtx(respond);
    let jobs;
    const logged = await captureErrors(async () => { jobs = await provider.fetch(FULL, ctx); });

    calls.every((c) => qOf(c.url) === null && /[?&]location=United\+States\b/.test(c.url) && /[?&]sort_by=date\b/.test(c.url) && c.opts?.redirect === 'error')
      ? pass('full_board requests the listing with no q, keeps location and sort_by=date, redirect:"error" throughout')
      : fail(`full_board request URLs: ${calls.slice(0, 3).map((c) => c.url).join(' ')}`);
    calls.length === lastPage
      ? pass('full_board walks one listing past the 50-page query cap to its short last page, and ignores queries')
      : fail(`full_board made ${calls.length} requests, expected ${lastPage}`);
    jobs.truncated === undefined && !logged.some((l) => /cap/.test(l))
      ? pass('full_board that reaches the end of the listing is not marked partial')
      : fail(`full_board end: truncated=${JSON.stringify(jobs.truncated)}, logged ${JSON.stringify(logged)}`);
    const yt = jobs.find((x) => x.externalId === '127792359805985478');
    yt?.title === 'Product Manager II, YouTube Ads & AI/ML' && yt?.company === 'YouTube'
      && yt?.location === 'Kirkland, WA, USA; Mountain View, CA, USA'
      ? pass('full_board rows carry the card\'s real title, employer and locations, so title, blacklist and location filters see them')
      : fail(`full_board card row = ${JSON.stringify(yt)}`);
    JSON.stringify(yt?.locations) === JSON.stringify(['Kirkland, WA, USA', 'Mountain View, CA, USA'])
      && !('locations' in (jobs.find((x) => x.externalId === '7') || { locations: 1 }))
      ? pass('google.fetch() returns the card\'s separate locations as locations, omitted when the card names none')
      : fail(`locations = ${JSON.stringify(yt?.locations)}`);
  }
  {
    // The full-board budget: 200 pages by default, max_pages overrides up to 300.
    resolveMaxPages({ google: { full_board: true } }) === 200
      && resolveMaxPages({ google: { full_board: true }, max_pages: 120 }) === 120
      && resolveMaxPages({ google: { full_board: true }, max_pages: 9999 }) === 300
      && resolveMaxPages({ google: { queries: ['x'] }, max_pages: 9999 }) === 50
      && resolveMaxPages({ google: {} }) === 10
      ? pass('resolveMaxPages() gives full_board its own budget (default 200, cap 300) and leaves query mode at 10/50')
      : fail('resolveMaxPages() full_board budget wrong');
    const { ctx, calls } = recordingCtx((c) => linkPage(fullPageIds(5000000 + Number(pageOf(c.url) || '1') * PAGE_SIZE)));
    let jobs;
    const logged = await captureErrors(async () => { jobs = await provider.fetch({ name: 'Google', google: { full_board: true }, max_pages: 3 }, ctx); });
    calls.length === 3 && jobs.truncated?.reason === 'page-cap' && jobs.truncated?.fetched === PAGE_SIZE * 3
      && logged.some((l) => /3-page cap on the full board \(60 postings read\) — raise max_pages on this entry for more \(up to 300\)/.test(l))
      ? pass('full_board at its page cap marks page-cap and names the full-board budget')
      : fail(`full_board cap: ${calls.length} calls, truncated=${JSON.stringify(jobs?.truncated)}, logged ${JSON.stringify(logged)}`);
  }
  {
    const { ctx, calls } = recordingCtx((c) => linkPage(fullPageIds(6000000 + Number(pageOf(c.url) || '1') * PAGE_SIZE)));
    await provider.fetch({ name: 'Google', google: { full_board: true } }, { ...ctx, maxPages: 1 });
    calls.length === 1 && qOf(calls[0].url) === null
      ? pass('full_board under ctx.maxPages makes one request')
      : fail(`full_board probe: ${calls.length} calls`);
    const boom = new Error('down');
    let thrown = null;
    try {
      await provider.fetch({ name: 'Google', google: { full_board: true } }, { ...recordingCtx(() => { throw boom; }).ctx, maxPages: 1 });
    } catch (e) { thrown = e; }
    thrown === boom
      ? pass('full_board propagates a rejection unwrapped during a probe')
      : fail(`full_board probe rejection: ${thrown}`);
  }

  // ── page 1 links to postings but no card parses -> throw, not an empty board ──
  {
    // A posting ID that is not numeric: counted as a posting link, never parsed.
    const odd = (id) => `<a href="jobs/results/${id}-role">x</a>`;
    const page1 = `<!doctype html>${['aaa', 'bbb', 'ccc'].map(odd).join('\n')}`;
    let thrown = null;
    try {
      await provider.fetch({ name: 'Google', google: { full_board: true } }, recordingCtx(() => page1).ctx);
    } catch (e) { thrown = e; }
    thrown && /no card could be parsed/.test(thrown.message)
      ? pass('page 1 with posting links but no parsed cards throws')
      : fail(`unparsable page 1 should throw, got ${thrown}`);
    const empty = await provider.fetch({ name: 'Google', google: { full_board: true } },
      recordingCtx(() => '<!doctype html><a href="jobs/results/?location=US">all</a>').ctx);
    Array.isArray(empty) && empty.length === 0
      ? pass('page 1 with no posting links still returns []')
      : fail(`empty page 1 should return [], got ${JSON.stringify(empty)}`);
    const { ctx, calls } = recordingCtx(({ n }) => (n === 0 ? linkPage(fullPageIds(1000)) : page1));
    let later;
    const warned = await captureErrors(async () => { later = await provider.fetch({ name: 'Google', google: { full_board: true } }, ctx); });
    later.length === PAGE_SIZE && calls.length === 2
      && later.truncated?.reason === 'unparsable-page' && later.truncated?.fetched === PAGE_SIZE
      && warned.some((l) => /stopped the full board at page 2/.test(l))
      ? pass('an unparsable later page ends the walk, warns, and marks the result partial')
      : fail(`later unparsable page: ${later.length} jobs, ${calls.length} calls, truncated=${JSON.stringify(later.truncated)}`);
    const { ctx: endCtx } = recordingCtx(({ n }) => (n === 0 ? linkPage(fullPageIds(1000)) : '<!doctype html><p>No more results</p>'));
    const ended = await provider.fetch({ name: 'Google', google: { full_board: true } }, endCtx);
    ended.length === PAGE_SIZE && ended.truncated === undefined
      ? pass('a later page with no posting links is the normal end (no marker)')
      : fail(`later empty page: truncated=${JSON.stringify(ended.truncated)}`);
  }

  // ── short-page stop counts posting links, not parsed cards ──
  {
    const { countPostingLinks, postingLinkIds } = mod;
    // 19 cards + 1 posting whose ID the parser cannot read = a full page of 20.
    const mixed = (start) => `<!doctype html>${fullPageIds(start).slice(0, PAGE_SIZE - 1).map((id) => link(id)).join('\n')}
<a href="jobs/results/x${start}-odd">x</a>`;
    const { ctx, calls } = recordingCtx(({ n }) => (n === 0 ? mixed(2000) : linkPage(['3000', '3001'])));
    let jobs;
    const unreadWarn = await captureErrors(async () => { jobs = await provider.fetch({ name: 'Google', google: { full_board: true } }, ctx); });
    calls.length === 2 && jobs.length === PAGE_SIZE - 1 + 2
      ? pass('a full page with one unparsable posting link is not read as short')
      : fail(`mixed full page: ${calls.length} calls, ${jobs.length} jobs`);
    jobs.truncated?.reason === 'unread-postings' && jobs.truncated?.fetched === PAGE_SIZE + 1
      && unreadWarn.some((l) => /could not read 1 linked posting\(s\) \(21 read\)/.test(l))
      ? pass('a linked posting no card returned marks the result partial and warns')
      : fail(`unread posting: truncated=${JSON.stringify(jobs.truncated)}`);
    // Page 1 links a posting with no title anywhere; page 2 returns its card.
    // Every posting is in the result, so it is not marked partial.
    const titleless = `<!doctype html>${fullPageIds(5000).slice(0, PAGE_SIZE - 1).map((id) => link(id)).join('\n')}
<a href="jobs/results/5999">x</a>`;
    const { ctx: lateCtx, calls: lateCalls } = recordingCtx(({ n }) => (n === 0 ? titleless : linkPage(['5999', '6000'])));
    let late;
    const lateWarn = await captureErrors(async () => { late = await provider.fetch({ name: 'Google', google: { full_board: true } }, lateCtx); });
    lateCalls.length === 2 && late.length === PAGE_SIZE + 1 && late.truncated === undefined
      && !lateWarn.some((l) => /could not read/.test(l))
      ? pass('a posting a later page returns is not left marked unread')
      : fail(`late return: ${lateCalls.length} calls, ${late.length} jobs, truncated=${JSON.stringify(late.truncated)}`);
    // Single quotes, no slug, mixed case: the parser reads every link shape the counter counts.
    const shapes = `<!doctype html><h3>Single</h3><a href='jobs/results/71-single'>x</a>
<h3>Bare</h3><A HREF=jobs/results/72>x</A>`;
    const shaped = mod.parseResultsPage(shapes);
    shaped.map((c) => `${c.id}:${c.title}`).join(',') === '71:Single,72:Bare'
      && countPostingLinks(shapes) === shaped.length
      ? pass('parseResultsPage reads every link shape countPostingLinks counts')
      : fail(`link shapes: ${JSON.stringify(shaped)}`);
    const { ctx: bareCtx } = recordingCtx(() => `<!doctype html><h3>Bare</h3><a href="jobs/results/72">x</a>`);
    const bare = await provider.fetch({ name: 'Google', google: { full_board: true } }, bareCtx);
    bare[0]?.url.endsWith('/jobs/results/72') && bare.truncated === undefined
      ? pass('a posting link with no slug keeps a working URL')
      : fail(`bare link url: ${bare[0]?.url}`);
    // Page 2 repeats 19 postings from page 1 and adds one new posting whose
    // card does not parse: that is new content, so the walk goes on to page 3.
    const repeatPlusOdd = `<!doctype html>${fullPageIds(2000).slice(0, PAGE_SIZE - 1).map((id) => link(id)).join('\n')}
<a href='jobs/results/2500-odd'>x</a>`;
    const { ctx: rpCtx, calls: rpCalls } = recordingCtx(({ n }) => (n === 0 ? linkPage(fullPageIds(2000))
      : n === 1 ? repeatPlusOdd : linkPage(['4000', '4001'])));
    const rp = await provider.fetch({ name: 'Google', google: { full_board: true } }, rpCtx);
    rpCalls.length === 3 && rp.length === PAGE_SIZE + 1 + 2 && rp.truncated === undefined
      && rp.some((j) => j.externalId === '2500')
      ? pass('a repeated page with one new single-quoted posting returns it and walks on')
      : fail(`repeat + odd: ${rpCalls.length} calls, ${rp.length} jobs, truncated=${JSON.stringify(rp.truncated)}`);
    // A page that only repeats earlier postings still ends the walk.
    const { ctx: reCtx, calls: reCalls } = recordingCtx(() => linkPage(fullPageIds(2000)));
    await provider.fetch({ name: 'Google', google: { full_board: true } }, reCtx);
    reCalls.length === 2
      ? pass('a page that only repeats earlier postings still ends the walk')
      : fail(`re-served page: ${reCalls.length} calls`);
    [...postingLinkIds(`${link('77')}<a href='jobs/results/77-other'>y</a><a href="jobs/results/abc">z</a>`)].join(',') === '77,abc'
      ? pass('postingLinkIds keys a posting by its numeric ID')
      : fail('postingLinkIds keyed wrongly');
    countPostingLinks(mixed(2000)) === PAGE_SIZE
      && countPostingLinks('<a href="jobs/results/?q=x">a</a><a href="https://www.google.com/about/careers/applications/jobs/results/">b</a>') === 0
      && countPostingLinks(`${link('5')}${link('5')}`) === 1
      ? pass('countPostingLinks counts distinct postings and skips listing links')
      : fail('countPostingLinks miscounted');
  }

} catch (e) {
  fail(`google provider tests crashed: ${e.message}`);
}
