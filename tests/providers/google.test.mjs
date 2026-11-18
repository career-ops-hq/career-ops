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

  // ── probe: ctx.maxPages walks one query, one page, one request ──
  {
    const { ctx, calls } = recordingCtx(() => linkPage(fullPageIds(100))); // a full page
    await provider.fetch(ENTRY, { ...ctx, maxPages: 1 });
    calls.length === 1 && pageOf(calls[0].url) === null
      ? pass('google.fetch() spends exactly one request under ctx.maxPages, even with a full page and two queries')
      : fail(`google probe made ${calls.length} requests: ${calls.map((c) => c.url)}`);
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

  // ── full_board: the whole board from the jobs sitemap ──
  {
    const { parseJobsSitemap, parsePostingBlob, resolveDetailLimit } = mod;
    const SITEMAP = 'https://www.google.com/about/careers/applications/jobs/sitemap.xml';
    const loc = (id, slug, host = 'https://careers.google.com/jobs/results/') => `<url><loc>${host}${id}-${slug}/</loc></url>`;
    const sitemap = (n, extra = '') => `<?xml version="1.0"?><urlset>${Array.from({ length: n }, (_, i) => loc(String(1000 + i), i % 2 ? 'strategy-associate' : 'software-engineer')).join('')}${extra}</urlset>`;
    // A posting page whose ds:0 record is [id, title, ..., employer@7, ..., locations@9];
    // the description carries a "]" and a quote so a naive bracket count would break.
    const blob = (id, title, employer, locs) => {
      const rec = [id, title, 'https://example.com/apply', [null, 'Own the plan [end-to-end] and "ship"'], [null, ''], 'projects/x', null, employer, 'en-US', locs.map((l) => [l, [l], l.split(',')[0], null, '', 'US'])];
      return `<html><script>AF_initDataCallback({key: 'ds:0', hash: '1', data:${JSON.stringify([rec, [['999', 'Related role']]])}, sideChannel: {}});</script></html>`;
    };
    const FULL = { name: 'Acme', google: { full_board: true } };

    const rows = parseJobsSitemap(sitemap(2, loc('1000', 'software-engineer') + loc('2000', 'ops-lead', 'https://www.google.com/about/careers/applications/jobs/results/') + '<url><loc>https://evil.example.com/jobs/results/3000-x/</loc></url>'));
    if (rows.length === 3 && rows[2].id === '2000' && rows[2].slug === 'ops-lead') pass('parseJobsSitemap() reads both URL forms, dedupes ids, ignores other hosts');
    else fail(`parseJobsSitemap() = ${JSON.stringify(rows)}`);

    const d = parsePostingBlob(blob('1001', 'Strategy Associate, YouTube', 'YouTube', ['San Bruno, CA, USA', 'New York, NY, USA', 'San Bruno, CA, USA']), '1001');
    if (d?.title === 'Strategy Associate, YouTube' && d.employer === 'YouTube' && d.locations.join('|') === 'San Bruno, CA, USA|New York, NY, USA') {
      pass('parsePostingBlob() reads title, employer and deduped locations string-aware');
    } else {
      fail(`parsePostingBlob() = ${JSON.stringify(d)}`);
    }
    if (parsePostingBlob(blob('1001', 'X', 'Y', []), '9999') === null && parsePostingBlob('<html></html>', '1') === null
        && parsePostingBlob("AF_initDataCallback({key: 'ds:0', data:[[\"1\", \"t\"", '1') === null) {
      pass('parsePostingBlob() returns null for another posting, no blob, or a truncated blob');
    } else {
      fail('parsePostingBlob() should return null for mismatched or broken blobs');
    }
    if (resolveDetailLimit({}) === 200 && resolveDetailLimit({ google: { detail_limit: 50 } }) === 50 && resolveDetailLimit({ google: { detail_limit: 99999 } }) === 1000) {
      pass('resolveDetailLimit() defaults to 200 and caps at 1000');
    } else {
      fail('resolveDetailLimit() mapping wrong');
    }

    const fullCtx = (n, calls, extra = {}) => ({
      sleep: async () => {},
      titleWanted: (t) => /strategy/i.test(t),
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        if (url === SITEMAP) return sitemap(n);
        const id = url.match(/results\/(\d+)-/)[1];
        return blob(id, `Strategy Associate ${id}, YouTube`, 'YouTube', ['San Bruno, CA, USA']);
      },
      ...extra,
    });
    const quietRun = async (fn) => {
      const lines = []; const orig = console.error;
      console.error = (...a) => { lines.push(a.join(' ')); };
      try { return { result: await fn(), lines }; } finally { console.error = orig; }
    };

    const calls = [];
    const full = await quietRun(() => provider.fetch(FULL, fullCtx(10, calls)));
    const detailed = full.result.filter((j) => j.company === 'YouTube');
    if (full.result.length === 10 && detailed.length === 5 && calls.length === 6 && calls[0].url === SITEMAP
        && calls.every((c) => c.opts?.redirect === 'error') && !full.result.truncated && full.lines.length === 0
        && detailed[0].location === 'San Bruno, CA, USA' && detailed[0].title.startsWith('Strategy Associate')) {
      pass('full_board lists every sitemap posting and reads detail (title, employer, location) only for title-matched ones, redirect:"error" throughout');
    } else {
      fail(`full_board: ${full.result.length} rows, ${detailed.length} detailed, ${calls.length} calls, lines ${JSON.stringify(full.lines)}`);
    }
    const plain = full.result.find((j) => j.company !== 'YouTube');
    if (plain?.company === 'Acme' && plain.title === 'Software Engineer' && plain.location === '' && plain.url.startsWith('https://www.google.com/about/careers/applications/jobs/results/')) {
      pass('full_board keeps an unmatched posting with its slug title, the entry name and no detail request');
    } else {
      fail(`full_board unmatched row = ${JSON.stringify(plain)}`);
    }

    const capCalls = [];
    const capped = await quietRun(() => provider.fetch({ name: 'Acme', google: { full_board: true, detail_limit: 2 } }, fullCtx(10, capCalls)));
    if (capCalls.length === 3 && capped.result.length === 10 && capped.result.truncated?.reason === 'detail-cap'
        && capped.result.truncated?.fetched === 2 && capped.result.truncated?.total === 5 && capped.lines.some((l) => l.includes('detail_limit'))) {
      pass('full_board stops detail reads at detail_limit and marks the board detail-cap (fetched of wanted)');
    } else {
      fail(`detail cap: ${capCalls.length} calls, ${JSON.stringify(capped.result.truncated)}, ${JSON.stringify(capped.lines)}`);
    }

    // A detail fetch that keeps failing is not fatal: the sitemap row stays.
    let detailTries = 0;
    const flaky = await quietRun(() => provider.fetch(FULL, fullCtx(4, [], {
      fetchText: async (url) => {
        if (url === SITEMAP) return sitemap(4);
        detailTries++;
        throw Object.assign(new Error('HTTP 503'), { status: 503 });
      },
    })));
    if (flaky.result.length === 4 && detailTries > 2 && flaky.result.every((j) => j.company === 'Acme')) {
      pass('full_board retries a failed detail read, then keeps the sitemap row');
    } else {
      fail(`full_board failed detail: ${flaky.result.length} rows, ${detailTries} tries`);
    }

    // Probe: one sitemap request, no detail reads, silent.
    const probeCalls = [];
    const probe = await quietRun(() => provider.fetch(FULL, { ...fullCtx(10, probeCalls), maxPages: 1 }));
    if (probeCalls.length === 1 && probe.result.length === 10 && !probe.result.truncated && probe.lines.length === 0) {
      pass('full_board under ctx.maxPages reads only the sitemap');
    } else {
      fail(`full_board probe: ${probeCalls.length} calls`);
    }
    const boom = new Error('budget');
    let thrown = null;
    try { await provider.fetch(FULL, { maxPages: 1, sleep: async () => {}, fetchText: async () => { throw boom; } }); } catch (e) { thrown = e; }
    if (thrown === boom) pass('full_board propagates a sitemap rejection unwrapped during a probe');
    else fail(`full_board probe rejection: ${thrown}`);

    // Broken sitemap: loud, named.
    let broken = 0;
    for (const body of ['<html>not a sitemap</html>', '<urlset></urlset>', '']) {
      try { await provider.fetch(FULL, { sleep: async () => {}, fetchText: async () => body }); } catch (e) { if (/google: .*sitemap/.test(e.message)) broken++; }
    }
    if (broken === 3) pass('full_board throws a named error when the sitemap lists no postings');
    else fail(`full_board broken sitemap: ${broken}/3 threw`);
  }

} catch (e) {
  fail(`google provider tests crashed: ${e.message}`);
}
