// tests/providers/successfactors-classic.test.mjs — SAP SuccessFactors "classic"
// career sites (career<N>.successfactors.eu/career?company=<ID>, DWR remoting).
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — successfactors-classic (SAP classic career site, DWR)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/successfactors-classic.mjs')).href);
  const rmk = (await import(pathToFileURL(join(ROOT, 'providers/successfactors.mjs')).href)).default;
  const { isOfferSeen, markOfferSeen } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const sfc = mod.default;
  const { resolveConfig, parseDwr, dwrParams, dateParser, parseSearchReply } = mod;

  if (sfc.id === 'successfactors-classic') pass('successfactors-classic.id is "successfactors-classic"');
  else fail(`successfactors-classic.id is ${JSON.stringify(sfc.id)}`);

  // ── detect() ────────────────────────────────────────────────────────────
  const URL_OK = 'https://career5.successfactors.eu/career?company=ACME001';
  const claims = [
    URL_OK,
    'https://career8.successfactors.com/career?company=ACME001',
    'https://career5.successfactors.eu/career?company=ACME001&navBarLevel=JOB_SEARCH',
    'https://career5.successfactors.eu/career/?company=ACME001',
  ].filter((u) => sfc.detect({ careers_url: u }) === null);
  if (claims.length === 0 && sfc.detect({ api: URL_OK })?.url === URL_OK) pass('detect() claims the classic /career?company= URL on a successfactors host (careers_url or api)');
  else fail(`detect() missed: ${JSON.stringify(claims)}`);

  const unclaimed = [
    'https://jobs.zf.com',
    'https://career5.successfactors.eu/careers',
    'https://career5.successfactors.eu/career',
    'https://career5.successfactors.eu/career?company=',
    'https://career5.successfactors.eu/career?company=a%20b',
    'http://career5.successfactors.eu/career?company=ACME001',
    'https://career5.successfactors.eu:8443/career?company=ACME001',
    'https://user:pw@career5.successfactors.eu/career?company=ACME001',
    'https://career5.successfactors.eu.evil.example/career?company=ACME001',
    'https://evilsuccessfactors.eu/career?company=ACME001',
    'https://evil.example/career5.successfactors.eu/career?company=ACME001',
    'https://a.b.successfactors.eu/career?company=ACME001',
    'not a url',
  ].filter((u) => sfc.detect({ careers_url: u }) !== null);
  if (unclaimed.length === 0) pass('detect() returns null for RMK/branded hosts, other paths, a missing company, http, a port, credentials and spoofed hosts');
  else fail(`detect() claimed: ${JSON.stringify(unclaimed)}`);
  if (sfc.detect({}) === null && sfc.detect({ careers_url: null }) === null && sfc.detect({ careers_url: 42 }) === null && sfc.detect(null) === null) pass('detect() never throws on junk input');
  else fail('detect() should return null for junk input');

  // No URL is claimed by both this provider and the RMK one.
  const both = [URL_OK, 'https://career8.successfactors.com/career?company=ACME001', 'https://acme.successfactors.eu/careers', 'https://acme.jobs2web.com/x']
    .filter((u) => sfc.detect({ careers_url: u }) && rmk.detect({ careers_url: u }));
  if (both.length === 0 && rmk.detect({ careers_url: URL_OK }) === null && rmk.detect({ careers_url: 'https://acme.successfactors.eu/careers' })) pass('successfactors.mjs leaves the classic URL to this provider and keeps claiming its own');
  else fail(`URLs claimed by both providers: ${JSON.stringify(both)}`);

  // resolveConfig rebuilds the origin and the path; only the host is trusted.
  const cfg = resolveConfig({ careers_url: 'https://CAREER5.successfactors.eu/career?company=ACME001&x=1#frag' });
  if (cfg?.origin === 'https://career5.successfactors.eu' && cfg.company === 'ACME001' && cfg.searchPage === '/career?company=ACME001&navBarLevel=JOB_SEARCH') pass('resolveConfig() rebuilds origin and search page from the host and company id');
  else fail(`resolveConfig() wrong: ${JSON.stringify(cfg)}`);

  // ── fixtures: replies modelled on career5.successfactors.eu, anonymised ──
  const DWR_HEAD = "throw 'allowScriptTagRemoting is false.';\n//#DWR-INSERT\n//#DWR-REPLY\n";
  const initReply = DWR_HEAD
    + 'var s0={};var s1={};var s2=[];var s3={};var s4={};var s5=[];var s6={};var s7={};var s8={};\n'
    + 's0.searchScope="1";\n'
    + 's2[0]=s3;s2[1]=s4;\n'
    + 's3.fieldName="keyword";s3.fieldType="text";s3.label="Keywords";\n'
    + 's4.fieldName="customFilter_filter2";s4.fieldType="picklist";s4.label="Level";\n'
    + 's5[0]=s6;s5[1]=s7;\ns6.label="English";s6.value="en_US";\ns7.label="Espa\\u00F1ol";s7.value="es_ES";\n'
    + 'dwr.engine._remoteHandleCallback(\'0\',\'0\',s1);\n';
  const updateReply = DWR_HEAD + "dwr.engine._remoteHandleCallback('1','0',null);\n";
  const PREFIX = '\\/career?career%5fns=job%5flisting&company=ACME001&navBarLevel=JOB%5fSEARCH&rcm%5fsite%5flocale=es%5fES&career_job_req_id=';
  /** @param {Array<Record<string, any>>} postings @param {number} [count] */
  function searchReply(postings, count = postings.length) {
    const decl = postings.map((_, i) => `var s${i + 2}={};`).join('');
    const str = (v) => JSON.stringify(v).split('/').join('\/');
    const sets = postings.map((p, i) => Object.entries(p).map(([k, v]) => `s${i + 2}.${k}=${typeof v === 'string' ? str(v) : v};`).join('')).join('\n');
    const list = postings.map((_, i) => `s0[${i}]=s${i + 2};`).join('');
    return `${DWR_HEAD}var s0=[];var s1={};${decl}\n${sets}\n${list}\ns1.detailURLPrefix="${PREFIX}";s1.postingCount=${count};s1.postings=s0;\ndwr.engine._remoteHandleCallback('2','0',s1);\n`;
  }
  const posting = (id, title, date = '17/11/2026', locale = 'es_ES') => ({ id, title, postingDate: date, defaultLocale: locale });
  const PAGE = '<html lang="es"><script>var ajaxSecKey="KEY123";AjaxService.setViewId(\'/ui/view.xhtml\');</script></html>';

  /** @param {{replies?: Record<string, (n: number, body: string) => string>, page?: string, calls?: any[]}} o */
  function makeCtx(o = {}) {
    const calls = o.calls ?? [];
    const searchCalls = { n: 0 };
    const ctx = {
      sleep: async () => {},
      calls,
      searchCalls,
      async fetchResponse(url, opts) {
        calls.push({ url, opts, kind: 'page' });
        return new Response(o.page ?? PAGE, { status: 200, headers: [['set-cookie', 'JSESSIONID=abc; Path=/; Secure; HttpOnly'], ['set-cookie', 'route=r1; Path=/']] });
      },
      async fetchText(url, opts) {
        const method = /plaincall\/[^.]+\.([^.]+)\.dwr$/.exec(url)?.[1];
        calls.push({ url, opts, kind: method });
        if (method === 'search') searchCalls.n++;
        const custom = o.replies?.[method];
        if (custom) return custom(method === 'search' ? searchCalls.n : 0, opts.body);
        if (method === 'getInitialJobSearchData') return initReply;
        if (method === 'updateUserSelectedValues') return updateReply;
        throw new Error(`unexpected request ${url}`);
      },
    };
    return ctx;
  }
  const entry = { name: 'Acme', careers_url: URL_OK };

  // ── parseDwr / dwrParams / dateParser ───────────────────────────────────
  const parsed = parseDwr(searchReply([posting(7, 'R&amp;D Ánalyst "Lead" / Ops')]));
  const row = parsed.find((o) => o && o.id === 7);
  if (row?.title === 'R&amp;D Ánalyst "Lead" / Ops' && row.postingDate === '17/11/2026') pass('parseDwr() reads strings, escapes and numbers into linked objects, without evaluating anything');
  else fail(`parseDwr() wrong: ${JSON.stringify(row)}`);
  let dwrErr = '';
  try { parseDwr(`${DWR_HEAD}dwr.engine._remoteHandleException('0','0',{"message":"Bad token"});`); } catch (e) { dwrErr = e.message; }
  let loginErr = '';
  try { parseDwr('<html>Please sign in</html>'); } catch (e) { loginErr = e.message; }
  if (/DWR error: Bad token/.test(dwrErr) && /not a DWR reply/.test(loginErr)) pass('parseDwr() throws on a DWR exception and on a body that is not a DWR reply');
  else fail(`parseDwr() errors: ${dwrErr} | ${loginErr}`);
  const enc = dwrParams([{ a: 'x y', b: [1] }, null]);
  if (enc.join('|') === 'c0-e1=string:x%20y|c0-e3=number:1|c0-e2=Array:[reference:c0-e3]|c0-param0=Object_Object:{a:reference:c0-e1, b:reference:c0-e2}|c0-param1=null:null') pass('dwrParams() encodes scalars inline and containers as references');
  else fail(`dwrParams() wrong: ${enc.join('|')}`);
  if (dateParser(['17/11/2026'], 'en')('17/11/2026') === Date.UTC(2026, 10, 17)
    && dateParser(['11/17/2026'], 'es')('11/17/2026') === Date.UTC(2026, 10, 17)
    && dateParser(['03/04/2026'], 'es')('03/04/2026') === Date.UTC(2026, 3, 3)
    && dateParser([], 'en')('03/04/2026') === Date.UTC(2026, 2, 4)
    && dateParser(['x'], 'es')('31/02/2026') === undefined) pass('dateParser() infers day- or month-first from the data, then the page language, and rejects impossible dates');
  else fail('dateParser() wrong');

  // ── fetch(): normalisation, session, requests ───────────────────────────
  const postings = [
    posting(13501, 'Analyst &amp; Planner (Madrid)'),
    posting(13572, 'Estagiário/a (Rio de Janeiro)', '01/09/2023', 'pt_BR'),
    posting(13600, '   '),
    { title: 'No id', postingDate: '17/11/2026' },
    posting('9\uD800', 'Lone surrogate id'),
    posting(13501, 'Duplicate of the first'),
  ];
  const ctx1 = makeCtx({ replies: { search: () => searchReply(postings) } });
  const jobs = await sfc.fetch(entry, ctx1);
  const [a, b] = jobs;
  if (jobs.length === 2 && a.title === 'Analyst & Planner (Madrid)' && a.location === '' && a.company === 'Acme' && a.postedAt === Date.UTC(2026, 10, 17)
    && a.url === 'https://career5.successfactors.eu/career?career_ns=job_listing&company=ACME001&navBarLevel=JOB_SEARCH&rcm_site_locale=es_ES&career_job_req_id=13501'
    && b.url.includes('rcm_site_locale=pt_BR') && b.url.endsWith('career_job_req_id=13572') && b.postedAt === Date.UTC(2023, 8, 1)) {
    pass('fetch() maps postings: decoded title, empty location, locale-aware detail URL, dates; drops untitled and id-less rows and repeated ids');
  } else {
    fail(`fetch() mapping wrong: ${JSON.stringify(jobs)}`);
  }
  const id = a.listingIdentity;
  if (id?.ats_provider === 'successfactors-classic' && id.board_slug === 'ACME001' && id.posting_id === '13501' && Object.keys(id).length === 3) pass('fetch() returns the successfactors-classic/<company>/<posting id> listingIdentity');
  else fail(`listingIdentity = ${JSON.stringify(id)}`);
  const seen = new Set();
  markOfferSeen(a, seen);
  const otherUrl = { ...a, url: a.url.replace('rcm_site_locale=es_ES', 'rcm_site_locale=en_US') };
  if (isOfferSeen(otherUrl, seen)) pass('the same posting at its en_US detail URL is already seen (one row, not two)');
  else fail('classic listingIdentity did not join the two locale URLs');

  const everyRedirectError = ctx1.calls.every((c) => c.opts.redirect === 'error');
  const post = ctx1.calls.filter((c) => c.kind !== 'page');
  const h = post[0]?.opts.headers;
  if (ctx1.calls.length === 4 && ctx1.calls[0].kind === 'page' && everyRedirectError && post.every((c) => c.opts.method === 'POST')
    && h['x-csrf-token'] === 'KEY123' && h.viewid === '/ui/view.xhtml' && h.cookie === 'JSESSIONID=abc; route=r1' && h['x-sap-page-info'] === 'companyId=ACME001') {
    pass('fetch() sends redirect: "error" on every request, one bootstrap + three DWR POSTs, each with the page cookies and CSRF key');
  } else {
    fail(`request shape wrong: ${JSON.stringify(ctx1.calls.map((c) => [c.kind, c.opts.redirect, c.opts.method]))}`);
  }
  const upd = post.find((c) => c.kind === 'updateUserSelectedValues').opts.body;
  if (/keywordLanguageSelectedValues:reference:c0-e\d+/.test(upd) && /string:en_US/.test(upd) && /string:es_ES/.test(upd) && /customFilter_filter2/.test(upd) && !/country/i.test(upd)) pass('fetch() asks for every keyword language and no filter: the whole inventory');
  else fail(`criteria body: ${upd}`);

  // Host guard: nothing is requested for an untrusted URL.
  {
    const ctx = makeCtx();
    let threw = 0;
    for (const u of ['https://localhost/career?company=A', 'https://career5.successfactors.eu.evil.example/career?company=A', 'http://career5.successfactors.eu/career?company=A', 'https://jobs.zf.com']) {
      try { await sfc.fetch({ name: 'X', careers_url: u }, ctx); } catch { threw++; }
    }
    if (threw === 4 && ctx.calls.length === 0) pass('fetch() rejects an untrusted host before any request');
    else fail(`guard: threw=${threw}, requests=${ctx.calls.length}`);
  }

  // ── empty vs broken ────────────────────────────────────────────────────
  const emptyJobs = await sfc.fetch(entry, makeCtx({ replies: { search: () => searchReply([], 0) } }));
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0) pass('a present, empty postings list is an empty board ([])');
  else fail('empty board should return []');
  const broken = {
    'no postings list': { replies: { search: () => `${DWR_HEAD}var s1={};s1.other=1;\ndwr.engine._remoteHandleCallback('2','0',s1);` } },
    'login page on a DWR call': { replies: { search: () => '<html>Sign in</html>' } },
    'no ajaxSecKey on the page': { page: '<html>login required</html>' },
    'no filter fields': { replies: { getInitialJobSearchData: () => `${DWR_HEAD}var s1={};\ndwr.engine._remoteHandleCallback('0','0',s1);` } },
    'counted but unreadable': { replies: { search: () => searchReply([{ id: 1, title: '' }], 5) } },
  };
  for (const [name, o] of Object.entries(broken)) {
    let msg = '';
    try { await sfc.fetch(entry, makeCtx(o)); } catch (e) { msg = e.message; }
    if (/^successfactors-classic: /.test(msg)) pass(`fetch() throws a descriptive error: ${name}`);
    else fail(`${name}: expected a successfactors-classic error, got ${JSON.stringify(msg)}`);
  }
  {
    const o = makeCtx();
    o.fetchResponse = async () => { const e = new Error('HTTP 403'); e.status = 403; throw e; };
    let status = 0;
    try { await sfc.fetch(entry, o); } catch (e) { status = e.status; }
    if (status === 403) pass('a 403 on the bootstrap is a loud failure, not worked around');
    else fail(`403 bootstrap: status=${status}`);
  }

  // ── pagination ─────────────────────────────────────────────────────────
  // Real board: 27 postings fit one call of 50; the page after the last
  // repeats it, so the counted total and the short page decide the end.
  const many = (from, n) => Array.from({ length: n }, (_, i) => posting(from + i, `Role ${from + i}`));
  const paged = (total) => (n) => searchReply(many((n - 1) * 50, Math.max(0, Math.min(50, total - (n - 1) * 50))), total);
  {
    const ctx = makeCtx({ replies: { search: paged(120) } });
    const out = await sfc.fetch(entry, ctx);
    if (ctx.calls.every((c) => c.opts.redirect === 'error')) pass('every request of a multi-page walk carries redirect: "error"');
    else fail('a later-page request lost redirect: "error"');
    if (out.length === 120 && ctx.searchCalls.n === 3 && !out.truncated) pass('fetch() walks 50 postings per call until the short last page (120 postings = 3 searches, not truncated)');
    else fail(`120-posting walk: ${out.length} jobs, ${ctx.searchCalls.n} searches`);
  }
  {
    const ctx = makeCtx({ replies: { search: paged(120) } });
    const { result: out, errors } = await captureConsoleErrors(() => sfc.fetch({ ...entry, max_pages: 2 }, ctx));
    if (out.length === 100 && ctx.searchCalls.n === 2 && out.truncated?.reason === 'page-cap' && out.truncated.total === 120 && errors.some((e) => /raise max_pages/.test(e))) pass('the entry max_pages cap stops the walk, warns "raise max_pages" and marks the board truncated');
    else fail(`cap: ${out.length} jobs, ${ctx.searchCalls.n} searches, truncated=${JSON.stringify(out.truncated)}, warns=${JSON.stringify(errors)}`);
  }
  {
    // A board whose last full page ends exactly at the cap is not truncated.
    const ctx = makeCtx({ replies: { search: paged(100) } });
    const { result: out, errors } = await captureConsoleErrors(() => sfc.fetch({ ...entry, max_pages: 2 }, ctx));
    if (out.length === 100 && !out.truncated && errors.length === 0) pass('a board that ends on its own at the cap is neither truncated nor warned about');
    else fail(`exact fit: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}, warns=${JSON.stringify(errors)}`);
  }
  {
    // A source that reports ever more postings is still stopped by DEFAULT_MAX_PAGES (20).
    const ctx = makeCtx({ replies: { search: (n) => searchReply(many((n - 1) * 50, 50), 999999) } });
    const { result: out } = await captureConsoleErrors(() => sfc.fetch(entry, ctx));
    if (ctx.searchCalls.n === 20 && out.length === 1000) pass('the provider\'s own page ceiling (20) stops a source that claims an endless board');
    else fail(`ceiling: ${ctx.searchCalls.n} searches, ${out.length} jobs`);
    const huge = makeCtx({ replies: { search: (n) => searchReply(many((n - 1) * 50, 50), 999999) } });
    await captureConsoleErrors(() => sfc.fetch({ ...entry, max_pages: 100000 }, huge));
    if (huge.searchCalls.n === 100) pass('a user max_pages is clamped to the hard cap (100)');
    else fail(`hard cap: ${huge.searchCalls.n} searches`);
  }
  {
    // A page that repeats (the server ignored the page number) ends the walk,
    // and the board is marked partial: the rest of it was out of reach.
    const ctx = makeCtx({ replies: { search: () => searchReply(many(0, 50), 500) } });
    const { result: out, errors } = await captureConsoleErrors(() => sfc.fetch(entry, ctx));
    if (out.length === 50 && ctx.searchCalls.n === 2 && out.truncated?.reason === 'page-ignored' && out.truncated.total === 500 && errors.length === 1 && !/raise max_pages/.test(errors[0])) pass('a page with nothing new ends the walk, warns and marks the board partial (page number ignored)');
    else fail(`repeat page: ${out.length} jobs, ${ctx.searchCalls.n} searches, truncated=${JSON.stringify(out.truncated)}, warns=${JSON.stringify(errors)}`);
  }
  {
    // A failure on page 2 that retry cannot clear: keep page 1, warn, mark partial, no "raise max_pages".
    const failing = (n) => { if (n >= 2) { const e = new Error('HTTP 503'); e.status = 503; throw e; } return paged(120)(n); };
    const ctx = makeCtx({ replies: { search: failing } });
    const { result: out, errors } = await captureConsoleErrors(() => sfc.fetch(entry, ctx));
    if (out.length === 50 && out.truncated?.reason === 'fetch-error' && errors.length === 1 && !/raise max_pages/.test(errors[0])) pass('a page-2 failure keeps page 1, warns and marks the board partial, without the "raise max_pages" message');
    else fail(`page-2 failure: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}, warns=${JSON.stringify(errors)}`);
    // On page 1 it is fatal.
    let msg = '';
    try { await sfc.fetch(entry, makeCtx({ replies: { search: () => { const e = new Error('HTTP 503'); e.status = 503; throw e; } } })); } catch (e) { msg = e.message; }
    if (msg === 'HTTP 503') pass('a failure on the first page propagates');
    else fail(`page-1 failure: ${msg}`);
  }
  {
    // Probe: ctx.maxPages = 1 is one search (plus the setup), and a rejection comes through unwrapped.
    const ctx = makeCtx({ replies: { search: paged(120) } });
    ctx.maxPages = 1;
    const out = await sfc.fetch(entry, ctx);
    if (out.length === 50 && ctx.searchCalls.n === 1 && !out.truncated) pass('with ctx.maxPages = 1 exactly one list request is made (probe), without a truncation mark');
    else fail(`probe: ${out.length} jobs, ${ctx.searchCalls.n} searches, truncated=${JSON.stringify(out.truncated)}`);
    const sentinel = new Error('probe budget');
    const rejecting = makeCtx({ replies: { search: () => { throw sentinel; } } });
    rejecting.maxPages = 1;
    let caught;
    try { await sfc.fetch(entry, rejecting); } catch (e) { caught = e; }
    if (caught === sentinel) pass('a ctx.fetch* rejection while ctx.maxPages is set propagates unwrapped');
    else fail(`probe rejection: ${caught?.message}`);
  }

  {
    // A title that holds the DWR handler names is data, not a DWR exception.
    const ctx = makeCtx({ replies: { search: () => searchReply([posting(1, 'Engineer: _remoteHandleException')]) } });
    const out = await sfc.fetch(entry, ctx);
    if (out.length === 1 && out[0].title === 'Engineer: _remoteHandleException') pass('a posting title naming a DWR handler is not mistaken for a DWR exception');
    else fail(`handler name in a title: ${JSON.stringify(out)}`);
  }
  {
    // Postings but no detail URL prefix: a broken page, not an empty or short one.
    const noPrefix = (n) => searchReply(many((n - 1) * 50, n === 1 ? 50 : 1), 51).split('s1.detailURLPrefix=').join('s1.unused=');
    let msg = '';
    try { await sfc.fetch(entry, makeCtx({ replies: { search: () => noPrefix(1) } })); } catch (e) { msg = e.message; }
    if (/detailURLPrefix/.test(msg)) pass('postings without a detail URL prefix on page 1 are an error');
    else fail(`no prefix, page 1: ${msg}`);
    const withLater = (n) => (n === 1 ? paged(51)(1) : noPrefix(2));
    const { result: out, errors } = await captureConsoleErrors(() => sfc.fetch(entry, makeCtx({ replies: { search: withLater } })));
    if (out.length === 50 && out.truncated?.reason === 'fetch-error' && errors.length === 1) pass('postings without a detail URL prefix on a later page keep the earlier pages, marked fetch-error');
    else fail(`no prefix, page 2: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}, warns=${JSON.stringify(errors)}`);
  }
  {
    // Probe: a search that keeps failing is that HTTP error, not a spent budget. Retries would
    // consume the probe's request budget and the sentinel would read as a live board.
    const ctx = makeCtx({ replies: { search: () => { const e = new Error('HTTP 503'); e.status = 503; throw e; } } });
    ctx.maxPages = 1;
    let status = 0;
    try { await sfc.fetch(entry, ctx); } catch (e) { status = e.status; }
    if (status === 503 && ctx.searchCalls.n === 1) pass('a failing search during a probe is not retried and surfaces its HTTP error');
    else fail(`probe 503: status=${status}, searches=${ctx.searchCalls.n}`);
  }
  {
    // A repeated page before the rows read reach the reported total: the server ignored the
    // page number, so the walk ends as partial.
    const ctx = makeCtx({ replies: { search: () => searchReply(many(0, 50), 100) } });
    const { result: out, errors } = await captureConsoleErrors(() => sfc.fetch(entry, ctx));
    if (out.length === 50 && ctx.searchCalls.n === 2 && out.truncated?.reason === 'page-ignored' && out.truncated.total === 100 && errors.length === 1) pass('a repeated page short of the reported total is marked page-ignored');
    else fail(`repeat short of total: ${out.length} jobs, ${ctx.searchCalls.n} searches, truncated=${JSON.stringify(out.truncated)}`);
  }
  {
    // The reported total is not the end of the walk: a stale count on a full first page
    // must not hide the next page.
    const stale = (n) => (n === 1 ? searchReply(many(0, 50), 50) : searchReply(many(50, 30), 80));
    const ctx = makeCtx({ replies: { search: stale } });
    const out = await sfc.fetch(entry, ctx);
    if (out.length === 80 && ctx.searchCalls.n === 2 && !out.truncated) pass('a full first page with a stale total of 50 does not end the walk: the next page is read');
    else fail(`stale total: ${out.length} jobs, ${ctx.searchCalls.n} searches, truncated=${JSON.stringify(out.truncated)}`);
  }
  {
    // A board of exactly PAGE_SIZE: the server answers the page past the end with the same
    // rows (checked live), which is the end once the rows read reach the count.
    const ctx = makeCtx({ replies: { search: () => searchReply(many(0, 50), 50) } });
    const { result: out, errors } = await captureConsoleErrors(() => sfc.fetch(entry, ctx));
    if (out.length === 50 && ctx.searchCalls.n === 2 && !out.truncated && errors.length === 0) pass('a board of exactly 50 postings ends as complete when the page past the end repeats it');
    else fail(`exact page: ${out.length} jobs, ${ctx.searchCalls.n} searches, truncated=${JSON.stringify(out.truncated)}, warns=${JSON.stringify(errors)}`);
    // An empty page past the end is the end as well.
    const empty = makeCtx({ replies: { search: (n) => (n === 1 ? searchReply(many(0, 50), 50) : searchReply([], 50)) } });
    const e = await sfc.fetch(entry, empty);
    if (e.length === 50 && empty.searchCalls.n === 2 && !e.truncated) pass('an empty page past the end ends the walk as complete');
    else fail(`empty past end: ${e.length} jobs, truncated=${JSON.stringify(e.truncated)}`);
  }
  {
    // A title holding DWR statements is data: neither the declaration scan nor the assignment
    // scan reads inside a string literal.
    const evil = [posting(1, 'Engineer var s0={};'), posting(2, 'Analyst s1.id=999; s1.title="x";'), posting(3, 'Plain')];
    const ctx = makeCtx({ replies: { search: () => searchReply(evil) } });
    const out = await sfc.fetch(entry, ctx);
    if (out.length === 3 && out[0].title === 'Engineer var s0={};' && out[1].title === 'Analyst s1.id=999; s1.title="x";' && out[1].listingIdentity.posting_id === '2') pass('a title containing DWR declarations or assignments does not corrupt the parse');
    else fail(`statements in titles: ${JSON.stringify(out.map((j) => [j.title, j.listingIdentity.posting_id]))}`);
  }
  {
    // language is the posting's own default locale, as the source names it, and absent without one.
    const ctx = makeCtx({ replies: { search: () => searchReply([posting(1, 'A', '17/11/2026', 'pt_BR'), { id: 2, title: 'B', postingDate: '17/11/2026' }]) } });
    const out = await sfc.fetch(entry, ctx);
    if (out[0].language === 'pt_BR' && !('language' in out[1])) pass('each job carries its own default locale as language, and none when the posting names no locale');
    else fail(`language: ${JSON.stringify(out.map((j) => j.language))}`);
  }
  {
    // A full page whose rows all fail normalization does not end the walk (the board omits its total).
    const noTotal = (r) => r.split(';').filter((x) => !x.includes('postingCount')).join(';');
    const untitled = Array.from({ length: 50 }, (_, i) => ({ id: 900 + i, title: '' }));
    const ctx = makeCtx({ replies: { search: (n) => noTotal(n === 1 ? searchReply(untitled) : searchReply(many(0, 3))) } });
    const out = await sfc.fetch(entry, ctx);
    if (out.length === 3 && ctx.searchCalls.n === 2 && !out.truncated) pass('a full page of unusable rows does not end the walk: the next page is read');
    else fail(`unusable page: ${out.length} jobs, ${ctx.searchCalls.n} searches, truncated=${JSON.stringify(out.truncated)}`);
  }

  // parseSearchReply on its own: pagination count is the source's, not the filtered one.
  const direct = parseSearchReply(parseDwr(searchReply([posting(1, 'A'), { id: 2, title: '' }], 40)), { origin: 'https://career5.successfactors.eu', company: 'ACME001' }, 'Acme', 'es');
  if (direct.jobs.length === 1 && direct.rawCount === 2 && direct.total === 40) pass('parseSearchReply() reports the source\'s own row count and total next to the kept jobs');
  else fail(`parseSearchReply(): ${JSON.stringify(direct)}`);
} catch (e) {
  fail(`successfactors-classic provider tests crashed: ${e.stack || e.message}`);
}
