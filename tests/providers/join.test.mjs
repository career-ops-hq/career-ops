// tests/providers/join.test.mjs — join.com __NEXT_DATA__ SSR parser.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join as joinPath } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — join (join.com __NEXT_DATA__ SSR parser)');
try {
  const joinModule = await import(pathToFileURL(joinPath(ROOT, 'providers/join.mjs')).href);
  const joinProvider = joinModule.default;
  const { extractSlug, extractNextData } = joinModule;

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
  if (extractSlug('not a url') === null && extractSlug(undefined) === null) pass('join.extractSlug() returns null for invalid/missing input');
  else fail('join.extractSlug() should return null for invalid/missing input');

  // detect() — auto-detects from a valid join.com careers_url.
  const hit = joinProvider.detect({ careers_url: 'https://join.com/companies/acme-corp' });
  if (hit && hit.url === 'https://join.com/companies/acme-corp') pass('join.detect() resolves a join.com careers_url');
  else fail(`join.detect() wrong: ${JSON.stringify(hit)}`);
  if (joinProvider.detect({ careers_url: 'https://example.com/careers' }) === null) pass('join.detect() returns null for non-join.com URLs');
  else fail('join.detect() should return null for non-join.com URLs');

  // extractNextData — pulls and parses the __NEXT_DATA__ JSON blob.
  const nextDataHtml = (jobs, pageCount) =>
    `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { initialState: { company: { domain: 'acme-corp' }, jobs: { items: jobs, pagination: { pageCount } } } } },
    })}</script></body></html>`;
  const data = extractNextData(nextDataHtml([{ title: 'X', idParam: '1', city: { cityName: 'Berlin' } }], 1));
  if (data?.props?.pageProps?.initialState?.jobs?.items?.length === 1) pass('join.extractNextData() parses the embedded __NEXT_DATA__ JSON');
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

  // fetch() — single page, maps items to the normalized job shape.
  const entry = { name: 'Acme', careers_url: 'https://join.com/companies/acme-corp' };
  let singleCalls = 0;
  const singleCtx = {
    fetchText: async () => {
      singleCalls++;
      return nextDataHtml([{ title: 'Senior AI Engineer', idParam: 'abc123', city: { cityName: 'Remote' } }], 1);
    },
  };
  const singleJobs = await joinProvider.fetch(entry, singleCtx);
  if (
    singleCalls === 1 &&
    singleJobs.length === 1 &&
    singleJobs[0].title === 'Senior AI Engineer' &&
    singleJobs[0].url === 'https://join.com/companies/acme-corp/jobs/abc123' &&
    singleJobs[0].location === 'Remote'
  ) {
    pass('join.fetch() maps a single page of items to the normalized job shape');
  } else {
    fail(`join.fetch() single-page wrong: ${JSON.stringify(singleJobs)} after ${singleCalls} calls`);
  }

  // fetch() — paginates via ?page=N while pageCount > 1.
  const pages = [nextDataHtml([{ title: 'Job 1', idParam: '1', city: {} }], 2), nextDataHtml([{ title: 'Job 2', idParam: '2', city: {} }], 2)];
  let pagedCalls = 0;
  const seenUrls = [];
  const pagedCtx = {
    fetchText: async (url) => {
      seenUrls.push(url);
      return pages[pagedCalls++];
    },
  };
  const pagedJobs = await joinProvider.fetch(entry, pagedCtx);
  if (pagedJobs.length === 2 && pagedCalls === 2 && seenUrls[1] === 'https://join.com/companies/acme-corp?page=2') {
    pass('join.fetch() paginates via ?page=N while pagination.pageCount > 1');
  } else {
    fail(`join.fetch() pagination wrong: ${JSON.stringify(seenUrls)}, ${pagedJobs.length} jobs`);
  }

  // fetch() — passes redirect:'error' on every request (SSRF hardening).
  let redirectCalls = [];
  let redirectPagedCalls = 0;
  const redirectCtx = {
    fetchText: async (url, opts) => {
      redirectCalls.push(opts?.redirect);
      return pages[redirectPagedCalls++];
    },
  };
  await joinProvider.fetch(entry, redirectCtx);
  if (redirectCalls.length === 2 && redirectCalls.every((r) => r === 'error')) {
    pass('join.fetch() passes redirect:"error" on the first request and every paginated request');
  } else {
    fail(`join.fetch() redirect opts wrong: ${JSON.stringify(redirectCalls)}`);
  }

  // fetch() — honors ctx.maxPages (verify-portals' liveness probe passes 1)
  // so a health check never crawls a tenant's full multi-page board.
  let cappedCalls = 0;
  const cappedCtx = {
    maxPages: 1,
    fetchText: async () => {
      cappedCalls++;
      return nextDataHtml([{ title: 'Job 1', idParam: '1', city: {} }], 2);
    },
  };
  const cappedJobs = await joinProvider.fetch(entry, cappedCtx);
  if (cappedCalls === 1 && cappedJobs.length === 1) {
    pass('join.fetch() honors ctx.maxPages and stops after the first page even when pageCount is higher');
  } else {
    fail(`join.fetch() ctx.maxPages wrong: calls=${cappedCalls}, jobs=${cappedJobs.length}`);
  }

  // fetch() — DEFAULT_MAX_PAGES caps pagination even when the page's own
  // reported pagination.pageCount is far higher, and warns about it. Applies
  // regardless of ctx.maxPages (unset here), unlike the health-check cap.
  let bigBoardCalls = 0;
  const bigBoardCtx = {
    fetchText: async () => {
      bigBoardCalls++;
      return nextDataHtml([{ title: `Job ${bigBoardCalls}`, idParam: String(bigBoardCalls), city: {} }], 9999);
    },
  };
  const bigBoardWarnings = [];
  const realConsoleError = console.error;
  console.error = (...args) => bigBoardWarnings.push(args.join(' '));
  let bigBoardJobs;
  try {
    bigBoardJobs = await joinProvider.fetch(entry, bigBoardCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (bigBoardCalls === 50 && bigBoardJobs.length === 50) {
    pass('join.fetch() caps pagination at DEFAULT_MAX_PAGES=50 even when pagination.pageCount reports far more');
  } else {
    fail(`join.fetch() DEFAULT_MAX_PAGES cap wrong: calls=${bigBoardCalls}, jobs=${bigBoardJobs?.length}`);
  }
  if (bigBoardWarnings.some((w) => w.includes('truncated at max_pages=50'))) {
    pass('join.fetch() warns when DEFAULT_MAX_PAGES truncates the board');
  } else {
    fail(`join.fetch() truncation warning missing; captured = ${JSON.stringify(bigBoardWarnings)}`);
  }

  // fetch() — entry.max_pages overrides the default, clamped at MAX_PAGES_CAP.
  let overrideCalls = 0;
  const overrideCtx = {
    fetchText: async () => {
      overrideCalls++;
      return nextDataHtml([{ title: `Job ${overrideCalls}`, idParam: String(overrideCalls), city: {} }], 9999);
    },
  };
  const overrideEntry = { name: 'Acme', careers_url: 'https://join.com/companies/acme-corp', max_pages: 3 };
  const overrideJobs = await joinProvider.fetch(overrideEntry, overrideCtx);
  if (overrideCalls === 3 && overrideJobs.length === 3) {
    pass('join.fetch() honors entry.max_pages as an override on the default cap');
  } else {
    fail(`join.fetch() entry.max_pages override wrong: calls=${overrideCalls}, jobs=${overrideJobs?.length}`);
  }

  // fetch() — missing/unexpected __NEXT_DATA__ structure throws instead of
  // silently returning an empty list (so a scan doesn't mistake a parse
  // failure for a genuinely empty board).
  let throwErrored = false;
  try {
    await joinProvider.fetch(entry, { fetchText: async () => '<html>no next data</html>' });
  } catch {
    throwErrored = true;
  }
  if (throwErrored) pass('join.fetch() throws when __NEXT_DATA__ is missing or has an unexpected shape');
  else fail('join.fetch() should throw on missing/unexpected __NEXT_DATA__');

  // fetch() — a valid first page followed by a broken second page must throw,
  // not silently treat the second page as empty (that would mask a parse
  // failure as a genuinely short board).
  const brokenPagePages = [nextDataHtml([{ title: 'Job 1', idParam: '1', city: {} }], 2), '<html>no next data on page 2</html>'];
  let brokenPageCalls = 0;
  const brokenPageCtx = { fetchText: async () => brokenPagePages[brokenPageCalls++] };
  let brokenPageErrored = false;
  try {
    await joinProvider.fetch(entry, brokenPageCtx);
  } catch {
    brokenPageErrored = true;
  }
  if (brokenPageErrored) pass('join.fetch() throws when a paginated (non-first) page has missing/unexpected __NEXT_DATA__');
  else fail('join.fetch() should throw when a later page has missing/unexpected __NEXT_DATA__, not swallow it as empty');

  // fetch() — jobs.items present but not an array (first page) must throw,
  // not silently spread garbage or crash with a raw TypeError.
  let nonArrayFirstPageErrored = false;
  try {
    await joinProvider.fetch(entry, { fetchText: async () => nextDataHtml({ not: 'an array' }, 1) });
  } catch {
    nonArrayFirstPageErrored = true;
  }
  if (nonArrayFirstPageErrored) pass('join.fetch() throws when the first page\'s jobs.items is not an array');
  else fail('join.fetch() should throw when the first page\'s jobs.items is not an array');

  // fetch() — same check on a later page.
  const nonArrayPagePages = [nextDataHtml([{ title: 'Job 1', idParam: '1', city: {} }], 2), nextDataHtml({ not: 'an array' }, 2)];
  let nonArrayPageCalls = 0;
  let nonArrayPageErrored = false;
  try {
    await joinProvider.fetch(entry, { fetchText: async () => nonArrayPagePages[nonArrayPageCalls++] });
  } catch {
    nonArrayPageErrored = true;
  }
  if (nonArrayPageErrored) pass('join.fetch() throws when a paginated (non-first) page\'s jobs.items is not an array');
  else fail('join.fetch() should throw when a later page\'s jobs.items is not an array');

  // fetch() — careers_url that fails extractSlug() throws before any request.
  let slugErrored = false;
  try {
    await joinProvider.fetch({ name: 'Acme', careers_url: 'https://example.com/careers' }, { fetchText: async () => { throw new Error('should not be called'); } });
  } catch {
    slugErrored = true;
  }
  if (slugErrored) pass('join.fetch() throws when careers_url is not a join.com URL');
  else fail('join.fetch() should throw when the slug cannot be extracted');
} catch (e) {
  fail(`join provider tests crashed: ${e.message}`);
}
