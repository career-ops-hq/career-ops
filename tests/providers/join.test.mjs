// tests/providers/join.test.mjs — join.com: company id from __NEXT_DATA__, jobs from the publicJobs GraphQL query.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join as joinPath } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — join (join.com __NEXT_DATA__ company id + publicJobs GraphQL)');
try {
  const joinModule = await import(pathToFileURL(joinPath(ROOT, 'providers/join.mjs')).href);
  const joinProvider = joinModule.default;
  const { extractSlug, extractNextData, extractCompany, formatLocation, parseCompanySitemap } = joinModule;

  if (joinProvider.id === 'join') pass('join.id is "join"');
  else fail(`join.id is ${JSON.stringify(joinProvider.id)}`);

  // extractSlug — anchored to the literal join.com host and /companies/<slug> path.
  if (extractSlug('https://join.com/companies/acme-corp') === 'acme-corp') {
    pass('join.extractSlug() extracts the slug from join.com/companies/<slug>');
  } else {
    fail(`join.extractSlug() wrong: ${JSON.stringify(extractSlug('https://join.com/companies/acme-corp'))}`);
  }
  if (extractSlug('https://join.com.evil.com/companies/acme-corp') === null && extractSlug('https://evil.com/join.com/companies/acme-corp') === null) {
    pass('join.extractSlug() rejects spoofed hosts (not the literal join.com hostname)');
  } else {
    fail('join.extractSlug() should reject spoofed hosts');
  }
  if (extractSlug('not a url') === null && extractSlug(undefined) === null && extractSlug(null) === null && extractSlug(42) === null) {
    pass('join.extractSlug() returns null for invalid/missing input');
  } else {
    fail('join.extractSlug() should return null for invalid/missing input');
  }
  if (extractSlug('http://join.com/companies/acme-corp') === null && joinProvider.detect({ careers_url: 'http://join.com/companies/acme-corp' }) === null) {
    pass('join.detect() returns null for a non-HTTPS join.com URL');
  } else {
    fail('join.detect() should return null for a non-HTTPS join.com URL');
  }
  if (joinProvider.detect({}) === null && joinProvider.detect({ careers_url: null }) === null) pass('join.detect() returns null when careers_url is missing');
  else fail('join.detect() should return null when careers_url is missing');

  // detect() — auto-detects from a valid join.com careers_url.
  const hit = joinProvider.detect({ careers_url: 'https://join.com/companies/acme-corp' });
  if (hit && hit.url === 'https://join.com/companies/acme-corp') pass('join.detect() resolves a join.com careers_url');
  else fail(`join.detect() wrong: ${JSON.stringify(hit)}`);
  if (joinProvider.detect({ careers_url: 'https://example.com/careers' }) === null) pass('join.detect() returns null for non-join.com URLs');
  else fail('join.detect() should return null for non-join.com URLs');

  // Careers-page HTML with the company record in either frontend shape.
  const pageHtml = (company, key = 'pageData') =>
    `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { [key]: { company, jobs: { items: [], pagination: { pageCount: 1 } } } } },
    })}</script></body></html>`;
  const acmeHtml = pageHtml({ id: 4242, domain: 'acme-corp' });

  // extractNextData — pulls and parses the __NEXT_DATA__ JSON blob.
  const data = extractNextData(acmeHtml);
  if (data?.props?.pageProps?.pageData?.company?.id === 4242) pass('join.extractNextData() parses the embedded __NEXT_DATA__ JSON');
  else fail(`join.extractNextData() wrong: ${JSON.stringify(data)}`);
  if (extractNextData('<html>no script here</html>') === null) pass('join.extractNextData() returns null when the script tag is absent');
  else fail('join.extractNextData() should return null without a __NEXT_DATA__ script');
  if (extractNextData('<html><script id="__NEXT_DATA__">not json</script></html>') === null) {
    pass('join.extractNextData() returns null on malformed JSON');
  } else {
    fail('join.extractNextData() should return null on malformed JSON');
  }
  if (extractNextData(undefined) === null && extractNextData(null) === null && extractNextData(42) === null) {
    pass('join.extractNextData() returns null for non-string input instead of throwing');
  } else {
    fail('join.extractNextData() should return null for non-string input');
  }

  // extractCompany — reads pageData (current frontend) or initialState (cached older pages).
  if (extractCompany(extractNextData(acmeHtml))?.id === 4242) pass('join.extractCompany() reads the company from pageProps.pageData');
  else fail('join.extractCompany() should read pageProps.pageData.company');
  if (extractCompany(extractNextData(pageHtml({ id: 7, domain: 'old' }, 'initialState')))?.id === 7) {
    pass('join.extractCompany() reads the company from pageProps.initialState');
  } else {
    fail('join.extractCompany() should read pageProps.initialState.company');
  }
  if (extractCompany(extractNextData(pageHtml(null))) === null && extractCompany(extractNextData(pageHtml({ id: '4242' }))) === null && extractCompany(null) === null) {
    pass('join.extractCompany() returns null without an integer company id');
  } else {
    fail('join.extractCompany() should return null when the company id is missing or not an integer');
  }

  // A GraphQL publicJobs response.
  const gqlPage = (items, pageCount = 1) => ({ data: { publicJobs: { items, pageInfo: { pageCount } } } });
  const job = (id, title = `Job ${id}`, cityName = 'Berlin') => ({ id, title, workplaceType: 'ONSITE', city: { cityName } });

  /**
   * A ctx whose fetchText serves the careers page and whose fetchJson answers
   * the GraphQL POSTs from `respond(variables, call)`. Records every request.
   */
  const makeCtx = (respond, { html = acmeHtml, ...extra } = {}) => {
    const ctx = {
      textCalls: [],
      jsonCalls: [],
      sleeps: [],
      fetchText: async (url, opts) => { ctx.textCalls.push({ url, opts }); return html; },
      fetchJson: async (url, opts) => {
        const body = JSON.parse(opts.body);
        ctx.jsonCalls.push({ url, opts, body });
        return respond(body.variables.input, ctx.jsonCalls.length);
      },
      sleep: async (ms) => { ctx.sleeps.push(ms); },
      ...extra,
    };
    return ctx;
  };
  const entry = { name: 'Acme', careers_url: 'https://join.com/companies/acme-corp' };

  // fetch() — one careers-page request for the company id, then one GraphQL page.
  const singleCtx = makeCtx(() => gqlPage([job(16751346, 'Senior AI Engineer', 'Remote')]));
  const singleJobs = await joinProvider.fetch(entry, singleCtx);
  const firstQuery = singleCtx.jsonCalls[0];
  if (
    singleCtx.textCalls.length === 1 &&
    singleCtx.textCalls[0].url === 'https://join.com/companies/acme-corp' &&
    singleCtx.jsonCalls.length === 1 &&
    firstQuery.url === 'https://join.com/candidate-api/graphql' &&
    firstQuery.opts.method === 'POST' &&
    firstQuery.body.variables.input.companyId === 4242 &&
    firstQuery.body.variables.input.paginationPage.page === 1 &&
    firstQuery.body.variables.input.paginationPage.pageSize === 100
  ) {
    pass('join.fetch() reads the company id from the careers page and POSTs publicJobs for it, 100 per page');
  } else {
    fail(`join.fetch() request shape wrong: ${JSON.stringify({ text: singleCtx.textCalls, json: singleCtx.jsonCalls.map(c => c.body) })}`);
  }
  if (
    singleJobs.length === 1 &&
    singleJobs[0].title === 'Senior AI Engineer' &&
    singleJobs[0].url === 'https://join.com/companies/acme-corp/16751346' &&
    singleJobs[0].company === 'Acme' &&
    singleJobs[0].location === 'Remote'
  ) {
    pass('join.fetch() maps items to the normalized job shape with a stable /companies/<slug>/<id> URL');
  } else {
    fail(`join.fetch() job shape wrong: ${JSON.stringify(singleJobs)}`);
  }

  // fetch() — postedAt from createdAt, description from descriptionHtml as plain text.
  const richCtx = makeCtx(() => gqlPage([
    { ...job(1), createdAt: '2025-03-11T09:30:00.000Z', descriptionHtml: '<p>Build <strong>Rust</strong> services &amp; tools.</p><ul><li>Visa sponsorship</li></ul>', language: { iso6391: 'en' } },
    { ...job(2), createdAt: 'not a date', descriptionHtml: '' },
    job(3),
  ]));
  const richJobs = await joinProvider.fetch(entry, richCtx);
  const richQuery = richCtx.jsonCalls[0].body.query;
  if (/\bcreatedAt\b/.test(richQuery) && /\bdescriptionHtml\b/.test(richQuery)) pass('join.fetch() requests createdAt and descriptionHtml in the list query');
  else fail(`join.fetch() list query should request createdAt and descriptionHtml: ${richQuery}`);
  if (richJobs[0].postedAt === Date.parse('2025-03-11T09:30:00.000Z')) pass('join.fetch() maps createdAt to postedAt (epoch ms)');
  else fail(`join.fetch() postedAt wrong: ${richJobs[0].postedAt}`);
  if (richJobs[0].description === 'Build Rust services & tools. Visa sponsorship') pass('join.fetch() maps descriptionHtml to plain-text description');
  else fail(`join.fetch() description wrong: ${JSON.stringify(richJobs[0].description)}`);
  if (!('postedAt' in richJobs[1]) && !('description' in richJobs[1]) && !('postedAt' in richJobs[2]) && !('description' in richJobs[2])) {
    pass('join.fetch() omits postedAt/description when createdAt is unparseable or the body is empty/absent');
  } else {
    fail(`join.fetch() should omit absent fields: ${JSON.stringify(richJobs.slice(1))}`);
  }
  if (/\blanguage\s*\{\s*iso6391\s*\}/.test(richQuery) && richJobs[0].language === 'en' && !('language' in richJobs[1])) {
    pass('join.fetch() sets language from language.iso6391 and omits it when absent');
  } else {
    fail(`join.fetch() language wrong: ${JSON.stringify(richJobs.map(j => j.language))}`);
  }

  // fetch() — a long description is kept whole, so text past the shared 4000-char cap still reaches the filters.
  const longBody = `<p>${'Lorem ipsum dolor sit amet. '.repeat(250)}</p><p>Visa sponsorship is not available.</p>`;
  const longJobs = await joinProvider.fetch(entry, makeCtx(() => gqlPage([{ ...job(1), descriptionHtml: longBody }])));
  if (longJobs[0].description.length > 4000 && longJobs[0].description.endsWith('Visa sponsorship is not available.')) {
    pass('join.fetch() keeps a description longer than DESCRIPTION_CAP whole');
  } else {
    fail(`join.fetch() long description was cut: length=${longJobs[0].description.length}`);
  }

  // fetch() — the URL uses the company's own domain from the page, not the careers_url slug.
  const renamedCtx = makeCtx(() => gqlPage([job(1)]), { html: pageHtml({ id: 4242, domain: 'acme-renamed' }) });
  const renamedJobs = await joinProvider.fetch(entry, renamedCtx);
  if (renamedJobs[0]?.url === 'https://join.com/companies/acme-corp/1') pass('join.fetch() builds the job URL from the careers_url slug, whatever the page reports as domain');
  else fail(`join.fetch() should use the slug in the job URL, got ${renamedJobs[0]?.url}`);

  // fetch() — an item without an integer id is dropped, not turned into a broken URL.
  const noIdJobs = await joinProvider.fetch(entry, makeCtx(() => gqlPage([job(1), { title: 'No id', city: {} }, job('2')])));
  if (noIdJobs.length === 1 && noIdJobs[0].url.endsWith('/1')) pass('join.fetch() drops items without an integer id');
  else fail(`join.fetch() should drop items without an integer id, got ${JSON.stringify(noIdJobs)}`);

  // fetch() — a row without a usable title is dropped; a padded title is trimmed.
  const titleJobs = await joinProvider.fetch(entry, makeCtx(() => gqlPage([
    job(1, '  Senior Engineer  '), { ...job(2), title: '   ' }, { ...job(3), title: undefined }, { ...job(4), title: 42 },
  ])));
  if (titleJobs.length === 1 && titleJobs[0].title === 'Senior Engineer') pass('join.fetch() drops rows with a missing or blank title and trims the rest');
  else fail(`join.fetch() title handling wrong: ${JSON.stringify(titleJobs.map(j => j.title))}`);

  // fetch() — paginates while pageInfo.pageCount says there are more pages.
  const pagedCtx = makeCtx(({ paginationPage }) => gqlPage([job(paginationPage.page)], 3));
  const pagedJobs = await joinProvider.fetch(entry, pagedCtx);
  if (pagedJobs.length === 3 && pagedCtx.jsonCalls.map(c => c.body.variables.input.paginationPage.page).join(',') === '1,2,3') {
    pass('join.fetch() paginates publicJobs up to pageInfo.pageCount');
  } else {
    fail(`join.fetch() pagination wrong: ${pagedJobs.length} jobs, pages ${pagedCtx.jsonCalls.map(c => c.body.variables.input.paginationPage.page)}`);
  }
  if (pagedCtx.sleeps.join(',') === '250,250') pass('join.fetch() waits 250 ms through ctx.sleep before each page after the first');
  else fail(`join.fetch() inter-page delay wrong: ${JSON.stringify(pagedCtx.sleeps)}`);
  if (singleCtx.sleeps.length === 0) pass('join.fetch() does not wait before the first page');
  else fail(`join.fetch() should not wait before the first page: ${JSON.stringify(singleCtx.sleeps)}`);

  // fetch() — an empty board (pageCount 0) is one request and an empty list.
  const emptyCtx = makeCtx(() => gqlPage([], 0));
  const emptyJobs = await joinProvider.fetch(entry, emptyCtx);
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0 && emptyCtx.jsonCalls.length === 1) pass('join.fetch() returns [] for an empty board after one request');
  else fail(`join.fetch() empty board wrong: ${JSON.stringify(emptyJobs)} after ${emptyCtx.jsonCalls.length} calls`);

  // fetch() — passes redirect:'error' on the careers page and every GraphQL request (SSRF hardening).
  if (pagedCtx.textCalls.every(c => c.opts?.redirect === 'error') && pagedCtx.jsonCalls.every(c => c.opts?.redirect === 'error')) {
    pass('join.fetch() passes redirect:"error" on the careers page and every GraphQL request');
  } else {
    fail(`join.fetch() redirect opts wrong: ${JSON.stringify([...pagedCtx.textCalls, ...pagedCtx.jsonCalls].map(c => c.opts?.redirect))}`);
  }

  // fetch() — honors ctx.maxPages (verify-portals' liveness probe passes 1)
  // so a health check never walks a tenant's full multi-page board.
  const cappedCtx = makeCtx(({ paginationPage }) => gqlPage([job(paginationPage.page)], 2), { maxPages: 1 });
  const cappedJobs = await joinProvider.fetch(entry, cappedCtx);
  if (cappedCtx.jsonCalls.length === 1 && cappedJobs.length === 1 && cappedJobs.joinTruncated === undefined) {
    pass('join.fetch() honors ctx.maxPages and stops after the first page, without a truncation tag');
  } else {
    fail(`join.fetch() ctx.maxPages wrong: calls=${cappedCtx.jsonCalls.length}, jobs=${cappedJobs.length}, tag=${cappedJobs.joinTruncated}`);
  }

  // fetch() — DEFAULT_MAX_PAGES caps pagination even when the reported
  // pageInfo.pageCount is far higher, and warns about it. Applies regardless
  // of ctx.maxPages (unset here), unlike the health-check cap.
  const bigBoardCtx = makeCtx(({ paginationPage }) => gqlPage([job(paginationPage.page)], 9999));
  const bigBoardWarnings = [];
  const realConsoleError = console.error;
  console.error = (...args) => bigBoardWarnings.push(args.join(' '));
  let bigBoardJobs;
  try {
    bigBoardJobs = await joinProvider.fetch(entry, bigBoardCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (bigBoardCtx.jsonCalls.length === 50 && bigBoardJobs.length === 50) {
    pass('join.fetch() caps pagination at DEFAULT_MAX_PAGES=50 even when pageInfo.pageCount reports far more');
  } else {
    fail(`join.fetch() DEFAULT_MAX_PAGES cap wrong: calls=${bigBoardCtx.jsonCalls.length}, jobs=${bigBoardJobs?.length}`);
  }
  if (bigBoardWarnings.some((w) => w.includes('truncated at max_pages=50'))) {
    pass('join.fetch() warns when DEFAULT_MAX_PAGES truncates the board');
  } else {
    fail(`join.fetch() truncation warning missing; captured = ${JSON.stringify(bigBoardWarnings)}`);
  }
  if (bigBoardJobs.joinTruncated === true) pass('join.fetch() tags a cap-truncated board joinTruncated');
  else fail(`join cap-truncated board should carry joinTruncated, got ${bigBoardJobs.joinTruncated}`);

  // fetch() — a board that ends exactly at the cap is complete, not truncated.
  const exactCtx = makeCtx(({ paginationPage }) => gqlPage([job(paginationPage.page)], 3));
  const exactJobs = await joinProvider.fetch({ ...entry, max_pages: 3 }, exactCtx);
  if (exactJobs.length === 3 && exactJobs.joinTruncated === undefined) pass('join.fetch() does not tag a board whose pageCount equals the cap');
  else fail(`join.fetch() exact-cap board wrong: jobs=${exactJobs.length}, tag=${exactJobs.joinTruncated}`);

  // fetch() — entry.max_pages overrides the default, clamped at MAX_PAGES_CAP.
  const overrideCtx = makeCtx(({ paginationPage }) => gqlPage([job(paginationPage.page)], 9999));
  const overrideJobs = await joinProvider.fetch({ ...entry, max_pages: 3 }, overrideCtx);
  if (overrideCtx.jsonCalls.length === 3 && overrideJobs.length === 3) {
    pass('join.fetch() honors entry.max_pages as an override on the default cap');
  } else {
    fail(`join.fetch() entry.max_pages override wrong: calls=${overrideCtx.jsonCalls.length}, jobs=${overrideJobs?.length}`);
  }

  // fetch() — the publicJobs rate-limit error (an HTTP 200 with a GraphQL
  // error) is retried with backoff through ctx.sleep.
  const rateLimited = { errors: [{ message: 'You are doing too many requests to publicJobs' }], data: { publicJobs: null } };
  const retryCtx = makeCtx((_input, call) => (call <= 2 ? rateLimited : gqlPage([job(1)])));
  const retryJobs = await joinProvider.fetch(entry, retryCtx);
  if (retryJobs.length === 1 && retryCtx.jsonCalls.length === 3 && retryCtx.sleeps.length === 2) {
    pass('join.fetch() retries the publicJobs rate-limit error with backoff and then returns the board');
  } else {
    fail(`join.fetch() rate-limit retry wrong: jobs=${retryJobs.length}, calls=${retryCtx.jsonCalls.length}, sleeps=${JSON.stringify(retryCtx.sleeps)}`);
  }

  // fetch() — a rate limit that never clears fails the board after the retries run out.
  const stuckCtx = makeCtx(() => rateLimited);
  let stuckError = null;
  try {
    await joinProvider.fetch(entry, stuckCtx);
  } catch (err) {
    stuckError = err;
  }
  if (stuckError && /too many requests/i.test(stuckError.message) && stuckCtx.jsonCalls.length === 6) {
    pass('join.fetch() throws after 6 attempts when the rate limit does not clear');
  } else {
    fail(`join.fetch() persistent rate limit wrong: error=${stuckError?.message}, calls=${stuckCtx.jsonCalls.length}`);
  }

  // fetch() — the refusal is recognised by extensions.code even without the usual message.
  const codeOnly = { errors: [{ message: 'Request refused', extensions: { code: 'TOO_MANY_REQUESTS' } }], data: { publicJobs: null } };
  const codeCtx = makeCtx((_input, call) => (call === 1 ? codeOnly : gqlPage([job(1)])));
  const codeJobs = await joinProvider.fetch(entry, codeCtx);
  if (codeJobs.length === 1 && codeCtx.jsonCalls.length === 2 && codeCtx.sleeps.length === 1) {
    pass('join.fetch() retries a refusal identified by extensions.code TOO_MANY_REQUESTS');
  } else {
    fail(`join.fetch() code-only rate limit wrong: jobs=${codeJobs.length}, calls=${codeCtx.jsonCalls.length}`);
  }

  // formatLocation — mirrors the careers page labels; a remote posting drops its default city.
  const loc = (workplaceType, extra = {}) => formatLocation({
    workplaceType, city: { cityName: 'Berlin', countryName: 'Germany' }, country: { name: 'Germany' }, ...extra,
  });
  const locationCases = [
    ['on-site', loc('ONSITE'), 'Berlin, Germany'],
    ['hybrid', loc('HYBRID'), 'Berlin, Germany (hybrid)'],
    ['remote within a country', loc('REMOTE', { remoteType: 'COUNTRY', country: { name: 'India' } }), 'Remote (India)'],
    ['remote anywhere', loc('REMOTE', { remoteType: 'ANYWHERE' }), 'Remote (worldwide)'],
    ['remote within a region', loc('REMOTE', { remoteType: 'REGION', remoteRegion: { name: 'European Union' } }), 'Remote (European Union)'],
    ['remote with no area', formatLocation({ workplaceType: 'REMOTE', remoteType: 'REGION' }), 'Remote'],
    ['no workplace type', formatLocation({ city: { cityName: 'Vienna' }, country: { name: 'Austria' } }), 'Vienna, Austria'],
    ['nothing known', formatLocation({}), ''],
  ];
  const badLocations = locationCases.filter(([, got, want]) => got !== want);
  if (badLocations.length === 0) pass('join.formatLocation() labels on-site, hybrid and remote postings like the careers page');
  else fail(`join.formatLocation() wrong: ${JSON.stringify(badLocations)}`);

  // fetch() — a later page that fails after every retry fails the board, and
  // the "raise max_pages" warning stays silent (it is for the page cap only).
  const brokenPage2Ctx = makeCtx(({ paginationPage }) => {
    if (paginationPage.page === 1) return gqlPage([job(1)], 3);
    throw Object.assign(new Error('HTTP 503'), { status: 503 });
  });
  const page2Warnings = [];
  const consoleErrorBefore = console.error;
  console.error = (...args) => page2Warnings.push(args.join(' '));
  let page2Error = null;
  try {
    await joinProvider.fetch(entry, brokenPage2Ctx);
  } catch (err) {
    page2Error = err;
  } finally {
    console.error = consoleErrorBefore;
  }
  if (page2Error?.status === 503 && brokenPage2Ctx.jsonCalls.length === 7 && !page2Warnings.some(w => w.includes('max_pages'))) {
    pass('join.fetch() fails the board when page 2 still fails after the retries, without the max_pages warning');
  } else {
    fail(`join.fetch() page-2 failure wrong: error=${page2Error?.message}, calls=${brokenPage2Ctx.jsonCalls.length}, warnings=${JSON.stringify(page2Warnings)}`);
  }

  // fetch() — under the health probe a ctx.fetch* rejection propagates unwrapped.
  const probeRejection = new Error('probe budget reached');
  const probeCtx = makeCtx(() => { throw probeRejection; }, { maxPages: 1 });
  let probeError = null;
  try {
    await joinProvider.fetch(entry, probeCtx);
  } catch (err) {
    probeError = err;
  }
  if (probeError === probeRejection) pass('join.fetch() propagates a ctx.fetchJson rejection unwrapped while ctx.maxPages is set');
  else fail(`join.fetch() should rethrow the probe rejection itself, got ${probeError?.message}`);

  // fetch() — failures that must throw instead of reading as an empty board.
  const expectThrow = async (label, run) => {
    let errored = false;
    try {
      await run();
    } catch {
      errored = true;
    }
    if (errored) pass(`join.fetch() throws when ${label}`);
    else fail(`join.fetch() should throw when ${label}`);
  };
  await expectThrow('__NEXT_DATA__ is missing', () => joinProvider.fetch(entry, makeCtx(() => gqlPage([]), { html: '<html>no next data</html>' })));
  await expectThrow('the page has no company id', () => joinProvider.fetch(entry, makeCtx(() => gqlPage([]), { html: pageHtml(null) })));
  await expectThrow('publicJobs returns any other GraphQL error', () =>
    joinProvider.fetch(entry, makeCtx(() => ({ errors: [{ message: 'Server error' }], data: { publicJobs: null } }))));
  await expectThrow('publicJobs items is not an array on the first page', () => joinProvider.fetch(entry, makeCtx(() => gqlPage({ not: 'an array' }))));
  await expectThrow('publicJobs items is not an array on a later page', () =>
    joinProvider.fetch(entry, makeCtx(({ paginationPage }) => (paginationPage.page === 1 ? gqlPage([job(1)], 2) : gqlPage(null, 2)))));
  await expectThrow('publicJobs has no pageInfo', () =>
    joinProvider.fetch(entry, makeCtx(() => ({ data: { publicJobs: { items: [job(1)] } } }))));
  await expectThrow('pageInfo.pageCount is not a non-negative integer', () =>
    joinProvider.fetch(entry, makeCtx(() => ({ data: { publicJobs: { items: [job(1)], pageInfo: { pageCount: '2' } } } }))));
  await expectThrow('a later page has no pageInfo.pageCount', () =>
    joinProvider.fetch(entry, makeCtx(({ paginationPage }) => (paginationPage.page === 1
      ? gqlPage([job(1)], 2)
      : { data: { publicJobs: { items: [job(2)], pageInfo: {} } } }))));
  await expectThrow('a page with jobs reports pageInfo.pageCount 0', () =>
    joinProvider.fetch(entry, makeCtx(() => gqlPage([job(1)], 0))));
  await expectThrow('a later page with jobs reports a pageCount below its own number', () =>
    joinProvider.fetch(entry, makeCtx(({ paginationPage }) => (paginationPage.page === 1
      ? gqlPage([job(1)], 2)
      : gqlPage([job(2)], 1)))));

  // ctx.idCache — the company id is kept per slug between scans.
  const memCache = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return { values, get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  };
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

  const freshCache = memCache({ 'acme-corp': { id: 777, checkedAt: recent } });
  const freshCtx = makeCtx(() => gqlPage([job(1)]), { idCache: freshCache });
  const freshJobs = await joinProvider.fetch(entry, freshCtx);
  if (freshCtx.textCalls.length === 0 && freshCtx.jsonCalls[0].body.variables.input.companyId === 777 && freshJobs[0].url === 'https://join.com/companies/acme-corp/1') {
    pass('join.fetch() uses a cached company id without reading the careers page');
  } else {
    fail(`join.fetch() cache hit wrong: textCalls=${freshCtx.textCalls.length}, companyId=${freshCtx.jsonCalls[0]?.body.variables.input.companyId}, url=${freshJobs[0]?.url}`);
  }

  const emptyCache = memCache();
  const missCtx = makeCtx(() => gqlPage([job(1)]), { idCache: emptyCache });
  await joinProvider.fetch(entry, missCtx);
  const stored = emptyCache.values.get('acme-corp');
  if (missCtx.textCalls.length === 1 && stored?.id === 4242 && !('domain' in stored) && Date.now() - Date.parse(stored.checkedAt) < 60_000) {
    pass('join.fetch() reads the careers page on a cache miss and stores { id, checkedAt }');
  } else {
    fail(`join.fetch() cache miss wrong: textCalls=${missCtx.textCalls.length}, stored=${JSON.stringify(stored)}`);
  }

  const reshapedCache = memCache({ 'acme-corp': { id: 777, domain: 'acme-corp', checkedAt: old } });
  const reshapedCtx = makeCtx(() => gqlPage([job(1)]), {
    idCache: reshapedCache,
    fetchText: async () => '<html><body>no next data</body></html>',
  });
  const reshapedJobs = await joinProvider.fetch(entry, reshapedCtx);
  if (reshapedJobs.length === 1 && reshapedCtx.jsonCalls[0].body.variables.input.companyId === 777 && reshapedCache.values.get('acme-corp').checkedAt === old) {
    pass('join.fetch() keeps using the cached id when the recheck returns a page without a company id');
  } else {
    fail(`join.fetch() reshaped recheck wrong: jobs=${reshapedJobs.length}, companyId=${reshapedCtx.jsonCalls[0]?.body.variables.input.companyId}, cached=${JSON.stringify(reshapedCache.values.get('acme-corp'))}`);
  }

  const goneCache = memCache({ 'acme-corp': { id: 777, domain: 'acme-corp', checkedAt: old } });
  const goneCtx = makeCtx(() => gqlPage([job(1)]), {
    idCache: goneCache,
    fetchText: async () => { throw Object.assign(new Error('HTTP 410 Gone'), { status: 410 }); },
  });
  let goneError = null;
  try {
    await joinProvider.fetch(entry, goneCtx);
  } catch (err) {
    goneError = err;
  }
  if (goneError?.status === 410 && !goneCache.values.has('acme-corp') && goneCtx.jsonCalls.length === 0) {
    pass('join.fetch() drops the cache entry and fails the board when the company page is gone');
  } else {
    fail(`join.fetch() gone company wrong: error=${goneError?.status}, cached=${goneCache.values.has('acme-corp')}, jsonCalls=${goneCtx.jsonCalls.length}`);
  }

  // entry.company_id — a directory that supplies the id skips the careers page and the cache.
  const idEntryCtx = makeCtx(() => gqlPage([job(1)]), { idCache: memCache() });
  const idEntryJobs = await joinProvider.fetch({ ...entry, company_id: 99 }, idEntryCtx);
  if (idEntryCtx.textCalls.length === 0 && idEntryCtx.jsonCalls[0].body.variables.input.companyId === 99 && idEntryJobs[0].url === 'https://join.com/companies/acme-corp/1') {
    pass('join.fetch() uses entry.company_id without a careers-page request');
  } else {
    fail(`join.fetch() entry.company_id wrong: textCalls=${idEntryCtx.textCalls.length}, url=${idEntryJobs[0]?.url}`);
  }

  // parseCompanySitemap — the company directory scan-ats-full.mjs sweeps.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://join.com/companies/acme-corp</loc><lastmod>2023-11-09T20:43:22.959Z</lastmod></url>
    <url><loc> https://join.com/companies/bigco/ </loc></url>
    <url><loc>https://join.com/companies/acme-corp</loc></url>
    <url><loc>https://join.com/companies/acme-corp/16854145-engineer</loc></url>
    <url><loc>https://example.com/companies/exampleco</loc></url>
  </urlset>`;
  const slugs = parseCompanySitemap(sitemap);
  if (JSON.stringify(slugs) === '["acme-corp","bigco"]') pass('join.parseCompanySitemap() returns each company slug once, skipping job paths and other hosts');
  else fail(`join.parseCompanySitemap() wrong: ${JSON.stringify(slugs)}`);
  let sitemapError = null;
  try {
    parseCompanySitemap('<html>Attention Required</html>');
  } catch (err) {
    sitemapError = err;
  }
  if (sitemapError && /urlset/.test(sitemapError.message)) pass('join.parseCompanySitemap() throws on a page that is not a sitemap');
  else fail('join.parseCompanySitemap() should throw when there is no <urlset>');
  const emptySlugs = parseCompanySitemap('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  if (Array.isArray(emptySlugs) && emptySlugs.length === 0) pass('join.parseCompanySitemap() returns [] for an empty <urlset>');
  else fail(`join.parseCompanySitemap() empty urlset wrong: ${JSON.stringify(emptySlugs)}`);
  const selfClosingSlugs = parseCompanySitemap('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
  if (Array.isArray(selfClosingSlugs) && selfClosingSlugs.length === 0) pass('join.parseCompanySitemap() returns [] for a self-closing <urlset/>');
  else fail(`join.parseCompanySitemap() self-closing urlset wrong: ${JSON.stringify(selfClosingSlugs)}`);
  let truncatedError = null;
  try {
    parseCompanySitemap('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://join.com/companies/acme-corp</loc></url><url><loc>https://join.com/compa');
  } catch (err) {
    truncatedError = err;
  }
  if (truncatedError && /complete <urlset>/.test(truncatedError.message)) pass('join.parseCompanySitemap() throws on a sitemap cut short before </urlset>');
  else fail('join.parseCompanySitemap() should throw when </urlset> is missing');
  const encodedSlugs = parseCompanySitemap('<urlset><url><loc>https://join.com/companies/m&amp;s-consulting</loc></url></urlset>');
  if (JSON.stringify(encodedSlugs) === '["m&s-consulting"]') pass('join.parseCompanySitemap() decodes XML entities in <loc>');
  else fail(`join.parseCompanySitemap() entity decoding wrong: ${JSON.stringify(encodedSlugs)}`);
  let noCompanyError = null;
  try {
    parseCompanySitemap('<urlset><url><loc>https://join.com/companies/acme-corp/16854145-engineer</loc></url><url><loc>https://example.com/companies/exampleco</loc></url></urlset>');
  } catch (err) {
    noCompanyError = err;
  }
  if (noCompanyError && /no company page/.test(noCompanyError.message)) pass('join.parseCompanySitemap() throws when <loc> entries hold no company page');
  else fail('join.parseCompanySitemap() should throw when no <loc> is a company page');
  let noLocError = null;
  try {
    parseCompanySitemap('<urlset><url><sm:loc>https://join.com/companies/acme-corp</sm:loc></url></urlset>');
  } catch (err) {
    noLocError = err;
  }
  if (noLocError && /no company page/.test(noLocError.message)) pass('join.parseCompanySitemap() throws when <url> entries hold no <loc> it can read');
  else fail('join.parseCompanySitemap() should throw when <url> entries hold no readable <loc>');

  // fetch() — a careers_url that fails extractSlug() throws before any request.
  const noRequestCtx = makeCtx(() => { throw new Error('should not be called'); }, {
    fetchText: async () => { throw new Error('should not be called'); },
  });
  let slugError = null;
  try {
    await joinProvider.fetch({ name: 'Acme', careers_url: 'https://example.com/careers' }, noRequestCtx);
  } catch (err) {
    slugError = err;
  }
  if (slugError && /cannot extract slug/.test(slugError.message)) pass('join.fetch() throws when careers_url is not a join.com URL');
  else fail(`join.fetch() should throw when the slug cannot be extracted, got ${slugError?.message}`);
} catch (e) {
  fail(`join provider tests crashed: ${e.message}`);
}
