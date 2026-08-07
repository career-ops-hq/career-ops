// tests/providers/getro.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — getro');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/getro.mjs')).href);
  const provider = mod.default;
  const { normalizeGetroJob, extractCollectionId } = mod;

  if (provider.id === 'getro') pass('getro.id is "getro"');
  else fail(`getro.id is ${JSON.stringify(provider.id)}`);

  // detect() always returns null — opaque vanity domains, opt-in only.
  const detectHits = [
    provider.detect({ careers_url: 'https://careers.acme-vc.example/jobs' }),
    provider.detect({ careers_url: 'https://talent.beta-vc.example/jobs' }),
    provider.detect({ name: 'no urls' }),
    provider.detect(),
  ];
  if (detectHits.every((h) => h === null)) pass('detect() always returns null (opt-in only via provider: getro)');
  else fail(`detect() = ${JSON.stringify(detectHits)}`);

  // extractCollectionId: the verified shape (fixture models a live-verified board).
  const nextDataHtml = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { network: { id: '99001', description: 'Acme Ventures invests...' } } } })}</script></head></html>`;
  if (extractCollectionId(nextDataHtml) === '99001') pass('extractCollectionId reads network.id from __NEXT_DATA__');
  else fail(`extractCollectionId = ${JSON.stringify(extractCollectionId(nextDataHtml))}`);

  // extractCollectionId: numeric (not string) id also accepted.
  const numericIdHtml = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { network: { id: 234 } } } })}</script>`;
  if (extractCollectionId(numericIdHtml) === '234') pass('extractCollectionId accepts a numeric network.id');
  else fail(`extractCollectionId numeric = ${JSON.stringify(extractCollectionId(numericIdHtml))}`);

  // extractCollectionId: malformed/missing → null, no throw.
  const badCases = [
    extractCollectionId('<html>no next data here</html>'),
    extractCollectionId('<script id="__NEXT_DATA__" type="application/json">not json</script>'),
    extractCollectionId('<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>'),
    extractCollectionId(null),
    extractCollectionId(undefined),
  ];
  if (badCases.every((r) => r === null)) pass('extractCollectionId returns null on malformed/missing __NEXT_DATA__, never throws');
  else fail(`extractCollectionId bad cases = ${JSON.stringify(badCases)}`);

  // normalizeGetroJob — full mapping against the verified field shape.
  const realJob = {
    id: 88898704,
    title: 'Senior Backend Engineer',
    url: 'https://boards.greenhouse.io/exampleco/jobs/5379309008',
    source: 'career_page',
    work_mode: 'remote',
    locations: ['Remote'],
    searchable_locations: ['Remote'],
    created_at: 1785932237,
    organization: { name: 'Widgetly', slug: 'widgetly', id: 76746, stage: 'seed', head_count: 5 },
    compensation_public: true,
    compensation_amount_min_cents: null,
    compensation_amount_max_cents: null,
    compensation_currency: null,
    compensation_period: 'period_not_defined',
    slug: '88789668-provider-partnerships-area-director-tx',
  };
  const full = normalizeGetroJob(realJob, { name: 'Acme Ventures Portfolio' });
  if (full && full.title === 'Senior Backend Engineer'
      && full.url === 'https://boards.greenhouse.io/exampleco/jobs/5379309008'
      && full.company === 'Widgetly' && full.location === 'Remote'
      && full.postedAt === 1785932237 * 1000
      && !('salary' in full)) {
    pass('normalizeGetroJob maps the verified field shape; no salary when compensation_period is not "year"');
  } else {
    fail(`normalizeGetroJob full row = ${JSON.stringify(full)}`);
  }

  // company fallbacks: organization.name → entry.name → "Getro".
  const coOrg = normalizeGetroJob({ title: 'T', url: 'https://x.example/1', organization: { name: 'Acme' } }, { name: 'Entry Name' });
  const coEntry = normalizeGetroJob({ title: 'T', url: 'https://x.example/2' }, { name: 'Entry Name' });
  const coDefault = normalizeGetroJob({ title: 'T', url: 'https://x.example/3' });
  if (coOrg?.company === 'Acme' && coEntry?.company === 'Entry Name' && coDefault?.company === 'Getro') {
    pass('normalizeGetroJob falls back company → organization.name → entry.name → "Getro"');
  } else {
    fail(`normalizeGetroJob company fallbacks = ${JSON.stringify({ a: coOrg?.company, b: coEntry?.company, c: coDefault?.company })}`);
  }

  // location: searchable_locations fallback when locations[] is empty;
  // "Remote" appended once (not duplicated) when work_mode is remote.
  const locFallback = normalizeGetroJob({ title: 'T', url: 'https://x.example/4', locations: [], searchable_locations: ['Berlin, Germany'] });
  const remoteAppend = normalizeGetroJob({ title: 'T', url: 'https://x.example/5', locations: ['Berlin'], work_mode: 'remote' });
  const remoteNoDup = normalizeGetroJob({ title: 'T', url: 'https://x.example/6', locations: ['Remote'], work_mode: 'remote' });
  if (locFallback?.location === 'Berlin, Germany' && remoteAppend?.location === 'Berlin, Remote' && remoteNoDup?.location === 'Remote') {
    pass('normalizeGetroJob falls back to searchable_locations and appends Remote once, not duplicated');
  } else {
    fail(`normalizeGetroJob location = ${JSON.stringify({ a: locFallback?.location, b: remoteAppend?.location, c: remoteNoDup?.location })}`);
  }

  // salary: exposed only when compensation_period is absent or "year".
  const salaryYear = normalizeGetroJob({ title: 'T', url: 'https://x.example/7', compensation_amount_min_cents: 8000000, compensation_amount_max_cents: 12000000, compensation_currency: 'USD', compensation_period: 'year' });
  const salaryNoPeriod = normalizeGetroJob({ title: 'T', url: 'https://x.example/8', compensation_amount_min_cents: 8000000, compensation_currency: 'USD' });
  const salaryHourly = normalizeGetroJob({ title: 'T', url: 'https://x.example/9', compensation_amount_min_cents: 5000, compensation_period: 'hour' });
  if (salaryYear?.salary?.min === 80000 && salaryYear.salary.max === 120000 && salaryYear.salary.currency === 'USD'
      && salaryNoPeriod?.salary?.min === 80000 && salaryNoPeriod.salary.max === 80000
      && !('salary' in (salaryHourly || {}))) {
    pass('normalizeGetroJob exposes salary only for absent/"year" compensation_period, cents→units');
  } else {
    fail(`normalizeGetroJob salary = ${JSON.stringify({ salaryYear, salaryNoPeriod, salaryHourly })}`);
  }

  // Drops: missing/empty title, missing/malformed url, non-object.
  const drops = [
    normalizeGetroJob({ title: '', url: 'https://x.example/10' }),
    normalizeGetroJob({ title: 'T' }),
    normalizeGetroJob({ title: 'T', url: 'not a url' }),
    normalizeGetroJob(null),
    normalizeGetroJob(undefined),
  ];
  if (drops.every((r) => r === null)) pass('normalizeGetroJob drops postings with no title, no url, malformed url, or non-object input');
  else fail(`normalizeGetroJob drops = ${JSON.stringify(drops)}`);

  // fetch(): resolves collection_id via careers_url, POSTs the search API
  // with the right body/headers, paginates, stops on results.count.
  const mkJob = (i) => ({ title: `Role ${i}`, url: `https://ats.example/jobs/${i}`, organization: { name: 'Co' }, created_at: 1700000000 });
  {
    const calls = [];
    const ctx = {
      fetchText: async (url, opts) => {
        calls.push({ type: 'text', url, opts });
        return nextDataHtml;
      },
      fetchJson: async (url, opts) => {
        calls.push({ type: 'json', url, opts });
        const page = JSON.parse(opts.body).page;
        if (page === 1) return { results: { jobs: Array.from({ length: 20 }, (_, i) => mkJob(i)), count: 25 } };
        return { results: { jobs: Array.from({ length: 5 }, (_, i) => mkJob(20 + i)), count: 25 } };
      },
    };
    const jobs = await provider.fetch({ name: 'Acme Ventures Portfolio', careers_url: 'https://careers.acme-vc.example/jobs' }, ctx);
    const textCall = calls.find((c) => c.type === 'text');
    const jsonCalls = calls.filter((c) => c.type === 'json');
    const searchHost = jsonCalls.every((c) => c.url === 'https://api.getro.com/api/v2/collections/99001/search/jobs');
    const referersOk = jsonCalls.every((c) => c.opts.headers.referer === 'https://careers.acme-vc.example/');
    const redirectsOk = calls.every((c) => c.opts.redirect === 'error');
    if (textCall && textCall.url === 'https://careers.acme-vc.example/jobs' && jsonCalls.length === 2
        && searchHost && referersOk && redirectsOk && jobs.length === 25) {
      pass('fetch() auto-resolves collection_id, paginates the search API, stops once results.count is covered');
    } else {
      fail(`fetch() basic pagination = ${JSON.stringify({ textCall, jsonCallCount: jsonCalls.length, searchHost, referersOk, redirectsOk, jobsLen: jobs.length })}`);
    }
  }

  // fetch(): manual getro.collection_id override skips the resolution fetch entirely.
  {
    const calls = [];
    const ctx = {
      fetchText: async (url, opts) => { calls.push({ type: 'text', url, opts }); return nextDataHtml; },
      fetchJson: async (url, opts) => { calls.push({ type: 'json', url, opts }); return { results: { jobs: [mkJob(0)], count: 1 } }; },
    };
    const jobs = await provider.fetch({ name: 'Acme Ventures', careers_url: 'https://careers.acme-vc.example/jobs', getro: { collection_id: 99001 } }, ctx);
    const onlySearchCalled = calls.length === 1 && calls[0].type === 'json' && calls[0].url === 'https://api.getro.com/api/v2/collections/99001/search/jobs';
    if (onlySearchCalled && jobs.length === 1) pass('fetch() honors getro.collection_id override and skips the resolution fetch');
    else fail(`fetch() override = ${JSON.stringify({ calls: calls.map((c) => c.type), jobsLen: jobs.length })}`);
  }

  // fetch(): an all-zero string override ("0", "000") is rejected — a numeric
  // override of 0 already fails Number.isInteger(v) && v > 0; the string form
  // must reject it too, not silently accept it via a bare /^\d+$/ test.
  {
    const ctx = { fetchText: async () => nextDataHtml, fetchJson: async () => ({ results: { jobs: [] } }) };
    let threwZero = false;
    let threwZeroPadded = false;
    try { await provider.fetch({ name: 'Zero Override', careers_url: 'https://careers.acme-vc.example/jobs', getro: { collection_id: '0' } }, ctx); } catch (e) { threwZero = /invalid getro\.collection_id override/.test(String(e?.message)); }
    try { await provider.fetch({ name: 'Zero Override', careers_url: 'https://careers.acme-vc.example/jobs', getro: { collection_id: '000' } }, ctx); } catch (e) { threwZeroPadded = /invalid getro\.collection_id override/.test(String(e?.message)); }
    if (threwZero && threwZeroPadded) pass('fetch() rejects an all-zero string getro.collection_id override ("0", "000")');
    else fail(`fetch() all-zero override = ${JSON.stringify({ threwZero, threwZeroPadded })}`);
  }

  // fetch(): unresolvable network.id throws a clear error.
  {
    const ctx = { fetchText: async () => '<html>broken page</html>', fetchJson: async () => ({ results: { jobs: [] } }) };
    let threw = false;
    try {
      await provider.fetch({ name: 'Broken Board', careers_url: 'https://careers.example.com/jobs' }, ctx);
    } catch (e) {
      threw = /could not resolve collection_id/.test(String(e?.message));
    }
    if (threw) pass('fetch() throws a clear error when collection_id cannot be resolved from the page');
    else fail('fetch() did not throw on an unresolvable collection_id');
  }

  // fetch(): missing/malformed careers_url throws, even with an override present.
  {
    const ctx = { fetchText: async () => nextDataHtml, fetchJson: async () => ({ results: { jobs: [] } }) };
    let threwMissing = false;
    let threwMalformed = false;
    let threwWithOverride = false;
    try { await provider.fetch({ name: 'No URL' }, ctx); } catch (e) { threwMissing = /missing careers_url/.test(String(e?.message)); }
    try { await provider.fetch({ name: 'Bad URL', careers_url: 'not a url' }, ctx); } catch (e) { threwMalformed = /malformed careers_url/.test(String(e?.message)); }
    try { await provider.fetch({ name: 'Override no URL', getro: { collection_id: 1 } }, ctx); } catch (e) { threwWithOverride = /missing careers_url/.test(String(e?.message)); }
    if (threwMissing && threwMalformed && threwWithOverride) pass('fetch() throws on missing/malformed careers_url, even when getro.collection_id is set');
    else fail(`fetch() careers_url validation = ${JSON.stringify({ threwMissing, threwMalformed, threwWithOverride })}`);
  }

  // fetch(): malformed/empty response body → [], not a throw.
  {
    const ctx = { fetchText: async () => nextDataHtml, fetchJson: async () => null };
    const jobs = await provider.fetch({ name: 'Empty', careers_url: 'https://careers.acme-vc.example/jobs' }, ctx);
    if (Array.isArray(jobs) && jobs.length === 0) pass('fetch() returns [] on a null/malformed search response, no throw');
    else fail(`fetch() malformed response = ${JSON.stringify(jobs)}`);
  }

  // fetch(): a short page (< hitsPerPage) stops pagination even without results.count.
  {
    const calls = [];
    const ctx = {
      fetchText: async () => nextDataHtml,
      fetchJson: async (url, opts) => { calls.push(opts.body); return { results: { jobs: Array.from({ length: 7 }, (_, i) => mkJob(i)) } }; },
    };
    const jobs = await provider.fetch({ name: 'Short Board', careers_url: 'https://careers.acme-vc.example/jobs' }, ctx);
    if (calls.length === 1 && jobs.length === 7) pass('fetch() stops after one short page when results.count is absent');
    else fail(`fetch() short-page stop = ${JSON.stringify({ calls: calls.length, jobsLen: jobs.length })}`);
  }

  // fetch(): ctx.maxPages caps pagination ahead of the entry's own max_pages.
  {
    const calls = [];
    const ctx = {
      fetchText: async () => nextDataHtml,
      fetchJson: async (url, opts) => { calls.push(opts.body); return { results: { jobs: Array.from({ length: 20 }, (_, i) => mkJob(i)), count: 1000 } }; },
      maxPages: 1,
    };
    const jobs = await provider.fetch({ name: 'Big Board', careers_url: 'https://careers.acme-vc.example/jobs', max_pages: 50 }, ctx);
    if (calls.length === 1 && jobs.length === 20) pass('fetch() honors ctx.maxPages ahead of the entry\'s own max_pages');
    else fail(`fetch() ctx.maxPages = ${JSON.stringify({ calls: calls.length, jobsLen: jobs.length })}`);
  }

  // fetch(): DEFAULT_MAX_PAGES=100 caps pagination on its own — independent of
  // whatever results.count reports — when no entry.max_pages override is set
  // and ctx.maxPages is absent (per ADDING_A_PROVIDER.md's "absolute page cap"
  // requirement: the page count must never come from the source alone). An
  // Accel-scale board (24,766 jobs, results.count in the millions here to make
  // the point) must still stop at exactly 100 requests, with a warning.
  {
    const warnings = [];
    const realConsoleError = console.error;
    let calls = 0;
    const ctx = {
      fetchText: async () => nextDataHtml,
      fetchJson: async () => { calls += 1; return { results: { jobs: Array.from({ length: 20 }, (_, i) => mkJob(i)), count: 1_000_000 } }; },
      sleep: async () => {}, // no-op so inter-page delays don't slow the test suite down
    };
    let jobs;
    try {
      console.error = (...args) => warnings.push(args.join(' '));
      jobs = await provider.fetch({ name: 'Huge Board', careers_url: 'https://careers.acme-vc.example/jobs' }, ctx);
    } finally {
      console.error = realConsoleError;
    }
    if (calls === 100 && jobs.length === 2000 && warnings.some((w) => w.includes('truncated at max_pages=100'))) {
      pass('fetch() caps at DEFAULT_MAX_PAGES=100 independent of a huge results.count, and warns');
    } else {
      fail(`fetch() DEFAULT_MAX_PAGES cap = ${JSON.stringify({ calls, jobsLen: jobs?.length, warnings })}`);
    }
  }

  // fetch(): entry.max_pages caps pagination and warns (only entry-cap stops warn).
  {
    const warnings = [];
    const realConsoleError = console.error;
    const ctx = {
      fetchText: async () => nextDataHtml,
      fetchJson: async () => ({ results: { jobs: Array.from({ length: 20 }, (_, i) => mkJob(i)), count: 1000 } }),
    };
    let jobs;
    try {
      console.error = (...args) => warnings.push(args.join(' '));
      jobs = await provider.fetch({ name: 'Capped Board', careers_url: 'https://careers.acme-vc.example/jobs', max_pages: 3 }, ctx);
    } finally {
      console.error = realConsoleError;
    }
    if (jobs.length === 60 && warnings.some((w) => w.includes('truncated at max_pages=3'))) {
      pass('fetch() caps at entry.max_pages and warns with a "raise max_pages" suggestion');
    } else {
      fail(`fetch() max_pages cap = ${JSON.stringify({ jobsLen: jobs.length, warnings })}`);
    }
  }

  // fetch(): a fetch error mid-pagination stops cleanly, keeping already-gathered jobs.
  {
    const warnings = [];
    const realConsoleError = console.error;
    let calls = 0;
    const ctx = {
      fetchText: async () => nextDataHtml,
      fetchJson: async () => {
        calls += 1;
        if (calls === 1) return { results: { jobs: Array.from({ length: 20 }, (_, i) => mkJob(i)), count: 100 } };
        throw new Error('network error');
      },
    };
    let jobs;
    try {
      console.error = (...args) => warnings.push(args.join(' '));
      jobs = await provider.fetch({ name: 'Flaky Board', careers_url: 'https://careers.acme-vc.example/jobs' }, ctx);
    } finally {
      console.error = realConsoleError;
    }
    if (jobs.length === 20 && warnings.some((w) => w.includes('truncated at page 2'))) {
      pass('fetch() stops cleanly on a mid-pagination fetch error, keeping already-gathered jobs');
    } else {
      fail(`fetch() fetch-error handling = ${JSON.stringify({ jobsLen: jobs.length, warnings })}`);
    }
  }
} catch (e) {
  fail(`getro provider test crashed: ${e?.stack || e}`);
}
