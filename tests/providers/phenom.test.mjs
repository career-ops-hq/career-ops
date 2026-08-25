// tests/providers/phenom.test.mjs — Phenom People CareerConnect widgets API.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — phenom (Phenom People CareerConnect widgets API)');
try {
  const phenomModule = await import(pathToFileURL(join(ROOT, 'providers/phenom.mjs')).href);
  const phenom = phenomModule.default;
  const { resolveConfig: phConfig, slugify, parsePhenomDate, jobLocation, parseRefineSearch } = phenomModule;

  if (phenom.id === 'phenom') pass('phenom.id is "phenom"');
  else fail(`phenom.id is ${JSON.stringify(phenom.id)}`);

  // resolveConfig — defaults + phenom block overrides.
  const phCfg = phConfig({ api: 'https://careers.exampleco.com', phenom: { lang: 'en_global', country: 'global', urlPrefix: 'global/en', selectedFields: { country: ['Germany'] } } });
  if (
    phCfg && phCfg.widgetsApi === 'https://careers.exampleco.com/widgets' && phCfg.urlPrefix === 'global/en' && phCfg.selectedFields.country[0] === 'Germany'
  ) {
    pass('phenom.resolveConfig() parses origin and the phenom config block');
  } else {
    fail(`phenom.resolveConfig() wrong: ${JSON.stringify(phCfg)}`);
  }
  const phDefault = phConfig({ careers_url: 'https://x.example.com' });
  if (phDefault && phDefault.lang === 'en_global' && phDefault.country === 'global' && phDefault.urlPrefix === 'global/en') pass('phenom.resolveConfig() applies en_global/global/urlPrefix defaults');
  else fail(`phenom.resolveConfig() defaults wrong: ${JSON.stringify(phDefault)}`);

  // No detect(): every known phenompeople.com tenant host permanently
  // redirects to its own branded domain, which this provider's fetch()
  // can't follow (redirect: 'error') — so there is no URL pattern worth
  // auto-claiming. A tenant is always wired with an explicit `provider: phenom`.
  if (typeof phenom.detect !== 'function') pass('phenom has no detect() — always selected via explicit provider: phenom');
  else fail('phenom should not define detect()');

  // slugify — strips umlauts and specials, collapses to hyphens.
  if (slugify('Sr Economic & Financial Analyst') === 'Sr-Economic-Financial-Analyst') pass('phenom.slugify() collapses specials to hyphens');
  else fail(`phenom.slugify() wrong: ${slugify('Sr Economic & Financial Analyst')}`);
  if (slugify('München HR (m/w/d)') === 'Munchen-HR-m-w-d') pass('phenom.slugify() strips umlaut diacritics');
  else fail(`phenom.slugify() umlaut wrong: ${slugify('München HR (m/w/d)')}`);
  if (slugify('###') === 'job') pass('phenom.slugify() falls back to "job" for an all-symbol title');
  else fail(`phenom.slugify() fallback wrong: ${slugify('###')}`);

  if (parsePhenomDate('2026-05-07T18:25:30.000+0000') === Date.parse('2026-05-07T18:25:30.000+0000') && parsePhenomDate('') === undefined) pass('phenom.parsePhenomDate() reads ISO instants, rejects empty');
  else fail('phenom.parsePhenomDate() wrong');

  // jobLocation — prefers explicit location, else assembles city/state/country.
  if (jobLocation({ location: 'Munich, Germany' }) === 'Munich, Germany') pass('phenom.jobLocation() prefers the explicit location field');
  else fail('phenom.jobLocation() should prefer location');
  if (jobLocation({ city: 'Munich', state: 'Bavaria', country: 'Germany' }) === 'Munich, Bavaria, Germany') pass('phenom.jobLocation() assembles from city/state/country');
  else fail(`phenom.jobLocation() assembly wrong: ${jobLocation({ city: 'Munich', state: 'Bavaria', country: 'Germany' })}`);

  // parseRefineSearch — id/title required; URL from origin+prefix+jobId+slug,
  // with the jobId path segment percent-encoded.
  const phJson = { refineSearch: { status: 200, totalHits: 42, data: { jobs: [
    { jobId: '98098', title: 'Sr Analyst', location: 'France', postedDate: '2026-05-07T18:25:30.000+0000' },
    { jobId: '', title: 'No id — dropped' },
    { jobId: '5', title: '' },
    { jobId: '12/34', title: 'Slash Id' },
  ] } } };
  const { total: phTotal, rows: phRows } = parseRefineSearch(phJson, { origin: 'https://careers.exampleco.com', urlPrefix: 'global/en' });
  if (phTotal === 42 && phRows.length === 2) pass('phenom.parseRefineSearch() reads totalHits and drops id/title-less records');
  else fail(`phenom.parseRefineSearch() wrong: total=${phTotal} rows=${phRows.length}`);
  if (phRows[0]?.url === 'https://careers.exampleco.com/global/en/job/98098/Sr-Analyst') pass('phenom.parseRefineSearch() builds the {origin}/{prefix}/job/{id}/{slug} URL');
  else fail(`phenom.parseRefineSearch() url wrong: ${JSON.stringify(phRows[0]?.url)}`);
  if (phRows[1]?.url === 'https://careers.exampleco.com/global/en/job/12%2F34/Slash-Id') pass('phenom.parseRefineSearch() percent-encodes a jobId path segment');
  else fail(`phenom.parseRefineSearch() encoding wrong: ${JSON.stringify(phRows[1]?.url)}`);

  // fetch — paginates by from/size until totalHits, dedups, sends the facet.
  const mkJob = (id) => ({ jobId: String(id), title: `Job ${id}`, location: 'Germany', postedDate: '2026-05-07T18:25:30.000+0000' });
  const phPage = (ids) => ({ refineSearch: { status: 200, totalHits: 150, data: { jobs: ids.map(mkJob) } } });
  const phPages = [phPage(Array.from({ length: 100 }, (_, i) => i + 1)), phPage([100, 101, 102])];
  let phCalls = 0;
  let phSawFacet = null;
  const phCtx = { sleep: async () => {}, fetchJson: async (url, opts) => { const b = JSON.parse(opts.body); phSawFacet = b.selected_fields; if (b.from !== phCalls * 100) throw new Error('bad from offset'); return phPages[phCalls++] ?? phPage([]); } };
  const phJobs = await phenom.fetch({ name: 'ExampleCo', api: 'https://careers.exampleco.com', phenom: { selectedFields: { country: ['Germany'] } } }, phCtx);
  if (phJobs.length === 102 && phCalls === 2 && new Set(phJobs.map((j) => j.url)).size === 102) pass('phenom.fetch() paginates via from/size and dedups across pages');
  else fail(`phenom.fetch() returned ${phJobs.length} jobs after ${phCalls} calls`);
  if (phSawFacet && phSawFacet.country?.[0] === 'Germany') pass('phenom.fetch() forwards selected_fields facet filters');
  else fail(`phenom.fetch() dropped the facet: ${JSON.stringify(phSawFacet)}`);

  // fetch — a mid-scan failure preserves jobs already collected, never
  // discards earlier pages. Also must NOT fire the "raise max_pages"
  // truncation warning — this is a fetch failure, not a cap hit.
  // Page 2 fails on every attempt, so fetchJsonWithRetry exhausts its default
  // policy (2 retries = 3 total attempts) before the provider gives up:
  // 1 call for page 1 + 3 calls for page 2 = 4.
  let partialCalls = 0;
  const partialCtx = {
    sleep: async () => {},
    fetchJson: async () => {
      partialCalls++;
      if (partialCalls === 1) return phPage(Array.from({ length: 100 }, (_, i) => i + 1));
      throw new Error('network blip on page 2');
    },
  };
  const { result: partialJobs, errors: partialWarnings } = await captureConsoleErrors(() =>
    phenom.fetch({ name: 'ExampleCo', api: 'https://careers.exampleco.com' }, partialCtx));
  if (partialJobs.length === 100 && partialCalls === 4) pass('phenom.fetch() preserves jobs from earlier pages when a later page fetch exhausts retries');
  else fail(`phenom.fetch() partial-failure handling wrong: ${partialJobs.length} jobs after ${partialCalls} calls`);
  if (!partialWarnings.some(w => /raise max_pages/.test(w))) {
    pass('phenom.fetch() does NOT fire the "raise max_pages" warning on a fetch-error stop');
  } else {
    fail(`phenom fetch-error stop should not also warn about max_pages: ${JSON.stringify(partialWarnings)}`);
  }
  if (partialWarnings.some(w => /truncated at page 2 of \d+ \(100 of 150 jobs\): network blip on page 2/.test(w))) {
    pass('phenom.fetch() warns (console.error) when a page fetch fails mid-pagination, instead of failing silently');
  } else {
    fail(`phenom fetch-error stop should log a truncation warning: ${JSON.stringify(partialWarnings)}`);
  }

  // fetch — a page that fails once (transient) then succeeds is recovered by
  // fetchJsonWithRetry: no truncation, no warning, full board returned.
  let recoverCalls = 0;
  const recoverCtx = {
    sleep: async () => {},
    fetchJson: async () => {
      recoverCalls++;
      if (recoverCalls === 2) throw new Error('transient blip');
      return phPages[recoverCalls === 1 ? 0 : 1] ?? phPage([]);
    },
  };
  const { result: recoverJobs, errors: recoverWarnings } = await captureConsoleErrors(() =>
    phenom.fetch({ name: 'ExampleCo', api: 'https://careers.exampleco.com' }, recoverCtx));
  if (recoverJobs.length === 102 && recoverCalls === 3) {
    pass('phenom.fetch() recovers a page that fails once then succeeds (retry)');
  } else {
    fail(`phenom fetch retry-recovery wrong: ${recoverJobs.length} jobs after ${recoverCalls} calls`);
  }
  if (recoverWarnings.length === 0) {
    pass('phenom.fetch() logs no warning when a retry recovers the page');
  } else {
    fail(`phenom retry-recovery should be silent, got: ${JSON.stringify(recoverWarnings)}`);
  }

  // fetch — a non-retryable error (4xx other than 429) fails immediately,
  // without burning the retry budget.
  let nonRetryableCalls = 0;
  const nonRetryableCtx = {
    sleep: async () => {},
    fetchJson: async () => {
      nonRetryableCalls++;
      const err = new Error('Bad Request');
      err.status = 400;
      throw err;
    },
  };
  let nonRetryableThrew = false;
  await captureConsoleErrors(async () => {
    try {
      await phenom.fetch({ name: 'ExampleCo', api: 'https://careers.exampleco.com' }, nonRetryableCtx);
    } catch {
      nonRetryableThrew = true;
    }
  });
  if (nonRetryableThrew && nonRetryableCalls === 1) {
    pass('phenom.fetch() does not retry a non-retryable 4xx and rethrows when no page ever succeeded');
  } else {
    fail(`phenom fetch non-retryable error wrong: threw=${nonRetryableThrew} after ${nonRetryableCalls} calls`);
  }

  // fetch() pagination cap — an inflated `totalHits` must not trigger
  // unbounded requests (DEFAULT_MAX_PAGES = 20 in providers/phenom.mjs, i.e.
  // 2,000 postings), and hitting the cap must be visible (console.error), not
  // silent — real tenants (Allianz: ~1,900) sit close to this default, and a
  // bigger one would previously have been silently truncated by the old
  // fixed MAX_JOBS = 1000 cap.
  let hugeCalls = 0;
  const { result: hugeJobs, errors: hugeWarnings } = await captureConsoleErrors(() =>
    phenom.fetch({ name: 'HugeCo', api: 'https://careers.hugeco.com' }, {
      sleep: async () => {},
      fetchJson: async () => { hugeCalls++; return { refineSearch: { status: 200, totalHits: 1_000_000, data: { jobs: Array.from({ length: 100 }, (_, i) => mkJob(`${hugeCalls}-${i}`)) } } }; },
    }));
  if (hugeCalls === 20 && hugeJobs.length === 2000) {
    pass('phenom.fetch() caps pagination at DEFAULT_MAX_PAGES despite an inflated totalHits');
  } else {
    fail(`phenom fetch pagination cap: requests=${hugeCalls}, total=${hugeJobs.length} (expected 20/2000)`);
  }
  if (hugeWarnings.some(w => /truncated at max_pages=\d+/.test(w))) {
    pass('phenom.fetch() warns (console.error) when the cap truncates real results');
  } else {
    fail(`phenom fetch cap: expected a truncation warning, got ${JSON.stringify(hugeWarnings)}`);
  }

  // fetch() pagination cap — entry.max_pages raises the cap for a genuinely
  // large tenant.
  let overriddenCalls = 0;
  const bigEntry = { name: 'BigCo', api: 'https://careers.bigco.com', max_pages: 50 };
  const { result: overriddenJobs } = await captureConsoleErrors(() => phenom.fetch(bigEntry, {
    sleep: async () => {},
    fetchJson: async () => { overriddenCalls++; return { refineSearch: { status: 200, totalHits: 1_000_000, data: { jobs: Array.from({ length: 100 }, (_, i) => mkJob(`o${overriddenCalls}-${i}`)) } } }; },
  }));
  if (overriddenCalls === 50 && overriddenJobs.length === 5000) {
    pass('phenom.fetch() honors entry.max_pages to raise the cap above the default');
  } else {
    fail(`phenom fetch max_pages override: requests=${overriddenCalls}, total=${overriddenJobs.length} (expected 50/5000)`);
  }

  // entry.max_pages is itself capped (MAX_PAGES_CAP = 300) — an absurd
  // override can't turn this into an unbounded scan either.
  let absurdCalls = 0;
  const absurdEntry = { name: 'AbsurdCo', api: 'https://careers.absurdco.com', max_pages: 100_000 };
  const { result: absurdJobs } = await captureConsoleErrors(() => phenom.fetch(absurdEntry, {
    sleep: async () => {},
    fetchJson: async () => { absurdCalls++; return { refineSearch: { status: 200, totalHits: 10_000_000, data: { jobs: Array.from({ length: 100 }, (_, i) => mkJob(`a${absurdCalls}-${i}`)) } } }; },
  }));
  if (absurdCalls === 300 && absurdJobs.length === 30_000) {
    pass('phenom.fetch() caps an absurd entry.max_pages at MAX_PAGES_CAP');
  } else {
    fail(`phenom fetch max_pages hard cap: requests=${absurdCalls}, total=${absurdJobs.length} (expected 300/30000)`);
  }

  // Invalid max_pages values (negative, zero, non-numeric) fall back to
  // DEFAULT_MAX_PAGES, same as omitting max_pages entirely.
  for (const invalidMaxPages of [-5, 0, 'abc', NaN, null]) {
    let invalidCalls = 0;
    const invalidEntry = { name: 'InvalidCo', api: 'https://careers.invalidco.com', max_pages: invalidMaxPages };
    const { result: invalidJobs } = await captureConsoleErrors(() => phenom.fetch(invalidEntry, {
      sleep: async () => {},
      fetchJson: async () => { invalidCalls++; return { refineSearch: { status: 200, totalHits: 1_000_000, data: { jobs: Array.from({ length: 100 }, (_, i) => mkJob(`i${invalidCalls}-${i}`)) } } }; },
    }));
    const label = Number.isNaN(invalidMaxPages) ? 'NaN' : JSON.stringify(invalidMaxPages);
    if (invalidCalls === 20 && invalidJobs.length === 2000) {
      pass(`phenom.fetch() falls back to DEFAULT_MAX_PAGES for invalid max_pages=${label}`);
    } else {
      fail(`phenom fetch invalid max_pages=${label}: requests=${invalidCalls}, total=${invalidJobs.length} (expected 20/2000)`);
    }
  }

  // fetch() honors ctx.maxPages (verify-portals' liveness probe passes 1) so
  // a health check never crawls a tenant's full multi-page board. Also must
  // NOT fire the "raise max_pages" warning — that's the entry cap's advice,
  // meaningless for a probe-imposed stop.
  let ctxCapCalls = 0;
  const { result: ctxCapJobs, errors: ctxCapWarnings } = await captureConsoleErrors(() =>
    phenom.fetch({ name: 'ProbeCo', api: 'https://careers.probeco.com' }, {
      maxPages: 1,
      sleep: async () => {},
      fetchJson: async () => { ctxCapCalls++; return { refineSearch: { status: 200, totalHits: 1_000_000, data: { jobs: Array.from({ length: 100 }, (_, i) => mkJob(`p${ctxCapCalls}-${i}`)) } } }; },
    }));
  if (ctxCapCalls === 1 && ctxCapJobs.length === 100) {
    pass('phenom.fetch() honors ctx.maxPages and stops after the first page');
  } else {
    fail(`phenom fetch ctx.maxPages: requests=${ctxCapCalls}, total=${ctxCapJobs.length} (expected 1/100)`);
  }
  if (!ctxCapWarnings.some(w => /raise max_pages/.test(w))) {
    pass('phenom.fetch() does NOT fire the "raise max_pages" warning when ctx.maxPages (not the entry cap) stopped pagination');
  } else {
    fail(`phenom ctx.maxPages stop should not warn about raising max_pages: ${JSON.stringify(ctxCapWarnings)}`);
  }
} catch (e) {
  fail(`phenom provider tests crashed: ${e.message}`);
}
