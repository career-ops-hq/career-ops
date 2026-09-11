// tests/providers/radancy.test.mjs — Radancy (TalentBrew) SSR search-results parser.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — radancy (TalentBrew SSR search-results parser)');
try {
  const radancyModule = await import(pathToFileURL(join(ROOT, 'providers/radancy.mjs')).href);
  const radancy = radancyModule.default;
  const { resolveListUrl: radListUrl, parseResults } = radancyModule;

  if (radancy.id === 'radancy') pass('radancy.id is "radancy"');
  else fail(`radancy.id is ${JSON.stringify(radancy.id)}`);

  // resolveListUrl — keeps explicit search-jobs URLs, defaults to /{lang}.
  if (radListUrl({ api: 'https://careers.munichre.com/en/search-jobs' }) === 'https://careers.munichre.com/en/search-jobs') pass('radancy.resolveListUrl() keeps an explicit search-jobs URL');
  else fail('radancy.resolveListUrl() should keep the search-jobs URL');
  if (radListUrl({ careers_url: 'https://careers.munichre.com/de/some-page' }) === 'https://careers.munichre.com/de/search-jobs') pass('radancy.resolveListUrl() defaults to /{lang}/search-jobs');
  else fail(`radancy.resolveListUrl() default wrong: ${radListUrl({ careers_url: 'https://careers.munichre.com/de/some-page' })}`);

  // detect — never auto-claims (branded hosts, wire explicitly).
  if (radancy.detect({ careers_url: 'https://careers.munichre.com/en/search-jobs' }) === null) pass('radancy.detect() returns null (explicit wiring only)');
  else fail('radancy.detect() should not auto-claim');

  // parseResults — the tricky part: anchor on the STABLE generic class prefix,
  // read title + location within one <li>, resolve the relative href.
  const card = (id, title, loc) =>
    '<li class="search-results-list__item job-list-01-list__item">' +
    '<div class="search-results-list__content">' +
    `<h5 class="search-results-list__job-title"><a class="search-results-list__job-link job-card-brand-hover--x" href="/en/job/city/${id}-slug/3193/${id}" data-job-id="${id}" id="job-${id}">${title}</a></h5>` +
    `<ul class="search-results-list__job-info-list"><li class="search-results-list__job-info job-list-01-list__job-info--location"><i class="icon"></i> <span>${loc}</span> </li></ul>` +
    '</li>';
  const html = '<html>' + card('40548453568', 'Innendienst f&#252;r Versicherungsagentur', 'Bingen am Rhein, Germany') + card('40546200896', 'Category Manager', 'London, United Kingdom') + '</html>';
  const rows = parseResults(html, 'https://careers.munichre.com');
  if (rows.length === 2) pass('radancy.parseResults() yields one row per search-results item');
  else fail(`radancy.parseResults() returned ${rows.length}, expected 2`);
  if (rows[0]?.title === 'Innendienst für Versicherungsagentur') pass('radancy.parseResults() decodes entities in titles');
  else fail(`radancy.parseResults() title wrong: ${JSON.stringify(rows[0]?.title)}`);
  if (rows[0]?.url === 'https://careers.munichre.com/en/job/city/40548453568-slug/3193/40548453568' && rows[0]?.location === 'Bingen am Rhein, Germany') pass('radancy.parseResults() builds absolute URLs and extracts the location span');
  else fail(`radancy.parseResults() url/loc wrong: ${JSON.stringify(rows[0])}`);
  if (parseResults('<html>no items</html>', 'https://x').length === 0 && parseResults(undefined, 'https://x').length === 0) pass('radancy.parseResults() returns [] for item-less / non-string input');
  else fail('radancy.parseResults() should return [] without items');

  // decodeEntities (exercised via parseResults) — a malformed/out-of-range
  // numeric entity (a lone surrogate half) must degrade to the literal text,
  // never throw RangeError and abort the whole parse.
  const badEntityCard = card('999', 'Bad&#xD800;Entity', 'Berlin, Germany');
  const badRows = parseResults('<html>' + badEntityCard + '</html>', 'https://careers.munichre.com');
  if (badRows.length === 1 && badRows[0].title === 'Bad&#xD800;Entity') pass('radancy.parseResults() tolerates an invalid numeric entity (no RangeError crash)');
  else fail(`radancy.parseResults() should degrade a malformed entity to literal text, got: ${JSON.stringify(badRows)}`);

  // fetch — paginates ?p=N, stops when a page brings no fresh ids.
  const radPages = [html, '<html>' + card('111', 'C', 'Kiel, Germany') + '</html>', '<html></html>'];
  let radCalls = 0;
  const radSeen = [];
  const radCtx = { sleep: async () => {}, fetchText: async (url) => { radSeen.push(url); return radPages[radCalls++] ?? '<html></html>'; } };
  const radJobs = await radancy.fetch({ name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' }, radCtx);
  if (radJobs.length === 3 && radCalls === 3) pass('radancy.fetch() paginates and stops on the first empty page');
  else fail(`radancy.fetch() returned ${radJobs.length} jobs after ${radCalls} calls`);
  if (radSeen[0]?.endsWith('?p=1') && radSeen[1]?.endsWith('?p=2')) pass('radancy.fetch() pages via ?p=N (1-based)');
  else fail(`radancy.fetch() paged wrong: ${JSON.stringify(radSeen)}`);

  // fetch — a mid-scan failure preserves jobs already collected, never
  // discards earlier pages.
  // Non-retryable (a definitive 404, not a transient 5xx/network blip) — this
  // test is about partial-page preservation, not about how many times
  // fetchTextWithRetry itself attempts a retryable failure.
  let partialCalls = 0;
  const partialCtx = {
    sleep: async () => {},
    fetchText: async () => {
      partialCalls++;
      if (partialCalls === 1) return html; // 2 jobs
      const err = new Error('network blip on page 2');
      err.status = 404;
      throw err;
    },
  };
  const partialJobs = await radancy.fetch({ name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' }, partialCtx);
  if (partialJobs.length === 2 && partialCalls === 2) pass('radancy.fetch() preserves jobs from earlier pages when a later page fetch throws');
  else fail(`radancy.fetch() partial-failure handling wrong: ${partialJobs.length} jobs after ${partialCalls} calls`);

  // A FIRST-page failure means the board is unreachable, not empty. It must
  // throw so scan/portal-health record a failure instead of "live but empty".
  let radFirstErr = null;
  try {
    await radancy.fetch(
      { name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' },
      { sleep: async () => {}, fetchText: async () => { throw new Error('tenant down'); } },
    );
  } catch (err) {
    radFirstErr = err;
  }
  if (radFirstErr?.message === 'tenant down') pass('radancy.fetch() throws when the first page fetch fails (dead board ≠ empty board)');
  else fail('radancy.fetch() swallowed a first-page failure into []');

  // fetch — stops on a page whose ids are all already-seen (server clamped
  // ?p= to the last page, or looped), NOT just on a literally empty page.
  // fresh === 0 must halt pagination without appending duplicate jobs.
  const dupPage = '<html>' + card('40548453568', 'Innendienst f&#252;r Versicherungsagentur', 'Bingen am Rhein, Germany') + '</html>';
  const dupPages = [html, dupPage, '<html>' + card('999', 'Never reached', 'X') + '</html>'];
  let dupCalls = 0;
  const dupCtx = { sleep: async () => {}, fetchText: async () => dupPages[dupCalls++] ?? '<html></html>' };
  const dupJobs = await radancy.fetch({ name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' }, dupCtx);
  if (dupJobs.length === 2 && dupCalls === 2) pass('radancy.fetch() stops when a page brings only already-seen ids (fresh === 0), without appending duplicates');
  else fail(`radancy.fetch() duplicate-page stop wrong: ${dupJobs.length} jobs after ${dupCalls} calls`);

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY markup + JSON results-fragment transport (added 2026-07-29)
  //
  // Fixtures trimmed from real responses. Both keep the sibling
  // <button class="js-save-job-btn" data-job-id="…"> that repeats the job id —
  // exactly what a naive data-job-id scan would turn into a phantom row.
  // ══════════════════════════════════════════════════════════════════════════
  const { parseLegacyResults, parseModernResults, buildFragmentUrl, readFragmentTotals } = radancyModule;

  // careers.unitedhealthgroup.com — wrapping <div>, req-number span, branded anchor class.
  const LEGACY_UHG = `
<section id="search-results" data-total-results="5889" data-total-pages="59" data-records-per-page="100">
<ul>
<li>
  <a href="/job/acton/patient-service-representative/34088/98479156752" data-job-id="98479156752"
     class="brand-facet brand-facet__optum">
    <div>
      <h2>Patient Service Representative</h2>
      <span class="job-id job-info">1062355</span>
      <span class="job-divider"> | </span>
      <span class="job-location 1">Acton, Massachusetts</span>
    </div>
  </a>
  <button type="button" class="js-save-job-btn" data-job-id="98479156752" data-org-id="34088"></button>
</li>
<li>
  <a href="/job/eden-prairie/principal-architect-interoperability/34088/98187357488" data-job-id="98187357488"
     class="brand-facet brand-facet__optum">
    <div>
      <h2>Principal Architect, Interoperability &amp; Integration</h2>
      <span class="job-id job-info">1062360</span>
      <span class="job-location 1">Eden Prairie, Minnesota</span>
    </div>
  </a>
  <button type="button" class="js-save-job-btn" data-job-id="98187357488"></button>
</li>
</ul></section>`;

  // www.kaiserpermanentejobs.org — same family, no wrapping div / class / req span.
  const LEGACY_KP = `
<section id="search-results" data-total-results="2714" data-total-pages="28">
<ul>
<li>
  <a href="/job/denver/sales-representative-ii-large-group/641/98493319104" data-job-id="98493319104">
    <h2>Sales Representative II - Large Group</h2>
    <span class="job-location">Denver, CO, Flexible, Full-time, Day</span>
  </a>
  <button type="button" class="js-save-job-btn" data-job-id="98493319104" data-org-id="641"></button>
</li>
</ul></section>`;

  // The modern parser must be untouched by the legacy addition.
  if (parseModernResults(html, 'https://careers.munichre.com').length === 2) pass('radancy.parseModernResults() still parses the search-results-list__item markup');
  else fail('radancy.parseModernResults() regressed on modern markup');
  if (parseModernResults(LEGACY_KP, 'https://x').length === 0) pass('radancy.parseModernResults() does not claim legacy markup');
  else fail('radancy.parseModernResults() wrongly matched legacy markup');

  // Legacy: UHG.
  const uhgRows = parseLegacyResults(LEGACY_UHG, 'https://careers.unitedhealthgroup.com');
  if (uhgRows.length === 2) pass('radancy.parseLegacyResults() yields 2 UHG rows (save-job button not double-counted)');
  else fail(`radancy.parseLegacyResults() UHG count = ${uhgRows.length}: ${JSON.stringify(uhgRows)}`);
  if (uhgRows[0]?.title === 'Patient Service Representative') pass('radancy.parseLegacyResults() takes the title from <h2>, excluding the req-number span');
  else fail(`radancy.parseLegacyResults() UHG title = ${JSON.stringify(uhgRows[0]?.title)}`);
  if (uhgRows[0]?.location === 'Acton, Massachusetts') pass('radancy.parseLegacyResults() reads .job-location (tolerates the trailing " 1" class token)');
  else fail(`radancy.parseLegacyResults() UHG location = ${JSON.stringify(uhgRows[0]?.location)}`);
  if (uhgRows[0]?.url === 'https://careers.unitedhealthgroup.com/job/acton/patient-service-representative/34088/98479156752') pass('radancy.parseLegacyResults() resolves the relative href against origin');
  else fail(`radancy.parseLegacyResults() UHG url = ${JSON.stringify(uhgRows[0]?.url)}`);
  if (uhgRows[1]?.title === 'Principal Architect, Interoperability & Integration') pass('radancy.parseLegacyResults() decodes entities in legacy titles');
  else fail(`radancy.parseLegacyResults() UHG title[1] = ${JSON.stringify(uhgRows[1]?.title)}`);

  // Legacy: Kaiser variant.
  const kpRows = parseLegacyResults(LEGACY_KP, 'https://www.kaiserpermanentejobs.org');
  if (kpRows.length === 1 && kpRows[0].title === 'Sales Representative II - Large Group' && kpRows[0].location === 'Denver, CO, Flexible, Full-time, Day') pass('radancy.parseLegacyResults() handles the Kaiser variant (no div / class / req span)');
  else fail(`radancy.parseLegacyResults() Kaiser = ${JSON.stringify(kpRows)}`);

  // parseResults must fall through to legacy only when modern finds nothing.
  if (parseResults(LEGACY_KP, 'https://www.kaiserpermanentejobs.org').length === 1) pass('radancy.parseResults() falls back to the legacy parser');
  else fail('radancy.parseResults() did not fall back to legacy markup');

  // Malformed rows degrade to nothing, never throw.
  const junkCases = [
    () => parseLegacyResults(null, 'https://x.example'),
    () => parseLegacyResults('<a data-job-id="1">no href</a>', 'https://x.example'),
    () => parseLegacyResults('<a href="/job/a/b/1/2">no data-job-id</a>', 'https://x.example'),
    () => parseLegacyResults('<a href="/not-a-job/x" data-job-id="1"><h2>T</h2></a>', 'https://x.example'),
    () => parseLegacyResults('<a href="/job/a/b/1/2" data-job-id="1"><h2></h2></a>', 'https://x.example'),
  ];
  let junkThrew = null;
  const junkCounts = [];
  for (const f of junkCases) {
    try { junkCounts.push(f().length); } catch (e2) { junkThrew = e2.message; break; }
  }
  if (!junkThrew && junkCounts.every((n) => n === 0)) pass('radancy.parseLegacyResults() rejects malformed rows without throwing');
  else fail(`radancy.parseLegacyResults() malformed: threw=${junkThrew} counts=${JSON.stringify(junkCounts)}`);

  if (parseLegacyResults(LEGACY_KP + LEGACY_KP, 'https://www.kaiserpermanentejobs.org').length === 1) pass('radancy.parseLegacyResults() dedupes a repeated data-job-id');
  else fail('radancy.parseLegacyResults() failed to dedupe repeated ids');

  // Fragment URL: the two params that decide whether this endpoint is usable.
  const fragUrl = new URL(buildFragmentUrl('https://careers.unitedhealthgroup.com/search-jobs', 3));
  if (fragUrl.pathname === '/search-jobs/results') pass('radancy.buildFragmentUrl() targets /search-jobs/results');
  else fail(`radancy.buildFragmentUrl() path = ${fragUrl.pathname}`);
  if (fragUrl.searchParams.get('SearchResultsModuleName') === 'Search Results') pass('radancy.buildFragmentUrl() sends SearchResultsModuleName (omitting it silently returns an empty result set)');
  else fail('radancy.buildFragmentUrl() must send SearchResultsModuleName');
  if (!fragUrl.searchParams.has('SearchFiltersModuleName')) pass('radancy.buildFragmentUrl() omits SearchFiltersModuleName (sending it re-attaches an ~8MB facet blob per page)');
  else fail('radancy.buildFragmentUrl() must NOT send SearchFiltersModuleName');
  if (fragUrl.searchParams.get('CurrentPage') === '3' && fragUrl.searchParams.get('RecordsPerPage') === '100') pass('radancy.buildFragmentUrl() sets CurrentPage and RecordsPerPage=100');
  else fail(`radancy.buildFragmentUrl() paging = ${fragUrl.searchParams.get('CurrentPage')}/${fragUrl.searchParams.get('RecordsPerPage')}`);

  // Totals drive pagination bounds.
  const totals = readFragmentTotals(LEGACY_UHG);
  if (totals.totalResults === 5889 && totals.totalPages === 59) pass('radancy.readFragmentTotals() reads data-total-results / data-total-pages');
  else fail(`radancy.readFragmentTotals() = ${JSON.stringify(totals)}`);
  if (readFragmentTotals('<div/>').totalPages === null && readFragmentTotals(null).totalResults === null) pass('radancy.readFragmentTotals() returns nulls for missing / non-string input');
  else fail('radancy.readFragmentTotals() should null out on bad input');

  // fetch(): fragment transport preferred, and it must NOT touch the heavy page.
  const fragCalls = [];
  const fragCtx = {
    sleep: async () => {},
    fetchJson: async (url) => {
      fragCalls.push(url);
      return Number(new URL(url).searchParams.get('CurrentPage')) === 1
        ? { results: LEGACY_UHG, hasJobs: true }
        : { results: '', hasJobs: true };
    },
    fetchText: async () => { throw new Error('fetchText must not run when the fragment works'); },
  };
  const fragJobs = await radancy.fetch({ name: 'Optum', careers_url: 'https://careers.unitedhealthgroup.com/search-jobs' }, fragCtx);
  if (fragJobs.length === 2 && fragJobs[0].company === 'Optum' && fragJobs[0].title === 'Patient Service Representative') pass('radancy.fetch() uses the JSON fragment transport and stamps company');
  else fail(`radancy.fetch() fragment jobs = ${JSON.stringify(fragJobs)}`);
  if (fragCalls.length && fragCalls.every((u) => u.includes('/search-jobs/results'))) pass('radancy.fetch() never requests the heavy ?p=N page when the fragment works');
  else fail(`radancy.fetch() fragment calls = ${JSON.stringify(fragCalls)}`);

  // A ctx with no fetchJson at all (older callers) must still work via HTML.
  let noJsonCalls = 0;
  const noJsonCtx = { sleep: async () => {}, fetchText: async () => (noJsonCalls++ === 0 ? html : '<html></html>') };
  const noJsonJobs = await radancy.fetch({ name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' }, noJsonCtx);
  if (noJsonJobs.length === 2) pass('radancy.fetch() works when ctx has no fetchJson (HTML transport)');
  else fail(`radancy.fetch() without fetchJson returned ${noJsonJobs.length}`);

  // Fragment endpoint throwing → fall back to the HTML walk.
  let fbText = 0;
  const fbCtx = {
    sleep: async () => {},
    fetchJson: async () => { throw new Error('no fragment endpoint on this tenant'); },
    fetchText: async () => (fbText++ === 0 ? html : '<html></html>'),
  };
  const fbJobs = await radancy.fetch({ name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' }, fbCtx);
  if (fbJobs.length === 2 && fbText > 0) pass('radancy.fetch() falls back to ?p=N when the fragment endpoint throws');
  else fail(`radancy.fetch() fragment-throw fallback = ${fbJobs.length} jobs, ${fbText} text calls`);

  // Fragment returning unparseable HTML → also fall back (not a silent empty).
  let emptyText = 0;
  const emptyFragCtx = {
    sleep: async () => {},
    fetchJson: async () => ({ results: '<div>no rows here</div>', hasJobs: true }),
    fetchText: async () => (emptyText++ === 0 ? html : '<html></html>'),
  };
  const emptyFragJobs = await radancy.fetch({ name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' }, emptyFragCtx);
  if (emptyFragJobs.length === 2 && emptyText > 0) pass('radancy.fetch() falls back when the fragment parses to zero rows');
  else fail(`radancy.fetch() empty-fragment fallback = ${emptyFragJobs.length} jobs, ${emptyText} text calls`);

  // A resolved fragment request is proof of life even with zero rows: when the
  // HTML fallback then fails (e.g. 403 on ?p=1), fetch() must NOT throw
  // "unreachable" for a tenant it just talked to — it returns what it has.
  {
    let zeroErr = null;
    let zeroJobs = null;
    try {
      zeroJobs = await radancy.fetch(
        { name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' },
        {
          sleep: async () => {},
          fetchJson: async () => ({ results: '', hasJobs: false }),
          fetchText: async () => { throw new Error('403 on the HTML page'); },
        },
      );
    } catch (err) {
      zeroErr = err;
    }
    if (!zeroErr && Array.isArray(zeroJobs) && zeroJobs.length === 0) {
      pass('radancy.fetch() does not throw when the fragment resolved (zero rows) and the HTML fallback fails (fragment success = proof of life)');
    } else {
      fail(`radancy.fetch() fragment proof-of-life wrong: ${zeroErr ? `threw "${zeroErr.message}"` : JSON.stringify(zeroJobs)}`);
    }
  }

  // max_jobs bounds the fragment walk.
  const capCtx = { sleep: async () => {}, fetchJson: async () => ({ results: LEGACY_UHG, hasJobs: true }), fetchText: async () => { throw new Error('unused'); } };
  const cappedJobs = await radancy.fetch({ name: 'Optum', careers_url: 'https://careers.unitedhealthgroup.com/search-jobs', max_jobs: 1 }, capCtx);
  if (cappedJobs.length === 1) pass('radancy.fetch() honors max_jobs on the fragment transport');
  else fail(`radancy.fetch() max_jobs=1 returned ${cappedJobs.length}`);

  // The truncation warning must report what was RETURNED, not the pre-slice
  // buffer. The page loop tests `jobs.length < maxJobs` before fetching, so a
  // final page can overshoot the cap — logging the buffer length would overstate
  // delivery in the one message whose entire job is accuracy about the shortfall.
  const rowFor = (id) => `<li><a href="/job/c/s/1/${id}" data-job-id="${id}"><h2>T${id}</h2><span class="job-location">X</span></a></li>`;
  let overshootPage = 0;
  const overshootWarnings = [];
  const realConsoleError = console.error;
  const overshootCtx = {
    sleep: async () => {},
    fetchJson: async () => {
      overshootPage++;
      const ids = [overshootPage * 10 + 1, overshootPage * 10 + 2, overshootPage * 10 + 3];
      return { results: `<section data-total-results="99" data-total-pages="9">${ids.map(rowFor).join('')}</section>`, hasJobs: true };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => overshootWarnings.push(String(m));
  let overshootJobs;
  try {
    // 3 rows/page with max_jobs 4 → page 2 pushes the buffer to 6, returns 4.
    overshootJobs = await radancy.fetch({ name: 'Overshoot', careers_url: 'https://x.example/search-jobs', max_jobs: 4 }, overshootCtx);
  } finally {
    console.error = realConsoleError;
  }
  const warned = (overshootWarnings.join(' ').match(/truncated at (\d+) of (\d+)/) || [])[1];
  if (overshootJobs.length === 4 && warned === '4') {
    pass('radancy truncation warning reports the returned count, not the pre-slice buffer');
  } else {
    fail(`radancy truncation warning: returned ${overshootJobs?.length}, warned "${warned}" (expected 4 / "4")`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ctx.maxPages / verify-portals probe handling (ADDING_A_PROVIDER.md's
  // ctx.maxPages convention — SHOULD cap the walk, MUST propagate a
  // ctx.fetch* rejection unwrapped instead of swallowing it)
  // ══════════════════════════════════════════════════════════════════════════

  // A non-string json.results on page 2+ must throw descriptively, not be
  // silently coerced to [] and read as a natural end — a real "no more jobs"
  // page is still a STRING (confirmed live: it can parse to zero rows
  // without being empty), so anything else is a malformed response.
  const malformedWarnings = [];
  const malformedCtx = {
    sleep: async () => {},
    fetchJson: async (u) => {
      const page = Number(new URL(u).searchParams.get('CurrentPage'));
      if (page === 2) return { results: { unexpected: 'shape' }, hasJobs: true };
      return {
        results: `<section data-total-results="500" data-total-pages="5">${rowFor(page * 10 + 1)}</section>`,
        hasJobs: true,
      };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => malformedWarnings.push(String(m));
  let malformedJobs;
  try {
    malformedJobs = await radancy.fetch({ name: 'MalformedResults', careers_url: 'https://t.example/search-jobs' }, malformedCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (malformedJobs.length === 1 && malformedWarnings.some((m) => m.includes('unexpected fragment response shape'))) {
    pass('radancy.fetch() throws on a non-string json.results instead of reading it as a natural end');
  } else {
    fail(`radancy.fetch() malformed-results handling: jobs=${malformedJobs?.length} warnings=${JSON.stringify(malformedWarnings)}`);
  }

  // ctx.maxPages caps the walk (SHOULD) — a source claiming far more pages
  // than the probe budget must not be walked past that budget, and no
  // "raise max_pages" advice fires for a limit that was the probe's own,
  // not the tenant's real config.
  let probeCapPage = 0;
  const probeCapWarnings = [];
  const probeCapCtx = {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async () => {
      probeCapPage++;
      return {
        results: `<section data-total-results="500" data-total-pages="5">${rowFor(probeCapPage * 10 + 1)}</section>`,
        hasJobs: true,
      };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => probeCapWarnings.push(String(m));
  let probeCapJobs;
  try {
    probeCapJobs = await radancy.fetch({ name: 'ProbeCapped', careers_url: 'https://s.example/search-jobs' }, probeCapCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (probeCapJobs.length === 1 && probeCapPage === 1 && probeCapWarnings.length === 0) {
    pass('radancy.fetch() caps the walk to ctx.maxPages while probing, with no cap warning');
  } else {
    fail(`radancy.fetch() probe-cap handling: jobs=${probeCapJobs?.length} pages=${probeCapPage} warnings=${JSON.stringify(probeCapWarnings)}`);
  }

  // A ctx.fetch* rejection while probing — the shape of verify-portals.mjs's
  // budget-exhaustion sentinel — must propagate unwrapped, not be absorbed
  // into a normal stopReason/partial-result path: a swallowed sentinel reads
  // to verify-portals as "board is down" instead of "live, partial".
  class FakeProbeBudgetReached extends Error {}
  const probeErrorCtx = {
    maxPages: 3,
    sleep: async () => {},
    fetchJson: async (u) => {
      const page = Number(new URL(u).searchParams.get('CurrentPage'));
      if (page === 2) throw new FakeProbeBudgetReached('budget exhausted');
      return {
        results: `<section data-total-results="500" data-total-pages="5">${rowFor(page * 10 + 1)}</section>`,
        hasJobs: true,
      };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  let probeErrorCaught = null;
  try {
    await radancy.fetch({ name: 'ProbeError', careers_url: 'https://r.example/search-jobs' }, probeErrorCtx);
  } catch (err) {
    probeErrorCaught = err;
  }
  if (probeErrorCaught instanceof FakeProbeBudgetReached) {
    pass('radancy.fetch() propagates a ctx.fetch* rejection unwrapped while probing (JSON transport)');
  } else {
    fail(`radancy.fetch() probe-error propagation (JSON): ${probeErrorCaught?.constructor?.name || probeErrorCaught}`);
  }

  // Same propagation requirement on the HTML fallback transport.
  const probeErrorHtmlCtx = {
    maxPages: 3,
    sleep: async () => {},
    fetchText: async (u) => {
      const p = Number(new URL(u).searchParams.get('p'));
      if (p === 2) throw new FakeProbeBudgetReached('budget exhausted');
      return html; // page 1: 2 jobs, proves succeededOnce would otherwise apply
    },
  };
  let probeErrorHtmlCaught = null;
  try {
    await radancy.fetch({ name: 'ProbeErrorHtml', api: 'https://qh.example/search-jobs' }, probeErrorHtmlCtx);
  } catch (err) {
    probeErrorHtmlCaught = err;
  }
  if (probeErrorHtmlCaught instanceof FakeProbeBudgetReached) {
    pass('radancy.fetch() propagates a ctx.fetch* rejection unwrapped while probing (HTML transport)');
  } else {
    fail(`radancy.fetch() probe-error propagation (HTML): ${probeErrorHtmlCaught?.constructor?.name || probeErrorHtmlCaught}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cache-buster + total-mismatch handling (added after a live investigation
  // of 11 TalentBrew tenants — see the transport note at the top of the file)
  // ══════════════════════════════════════════════════════════════════════════

  // jobs.length >= maxJobs alone is not proof max_jobs cut anything short —
  // a tenant whose real total exactly fills the page(s) already walked must
  // not false-positive into a 'cap' warning just because the count happens
  // to land exactly on max_jobs.
  const exactWarnings = [];
  const exactCtx = {
    sleep: async () => {},
    fetchJson: async () => ({
      results: `<section data-total-results="3" data-total-pages="1">${rowFor(1)}${rowFor(2)}${rowFor(3)}</section>`,
      hasJobs: true,
    }),
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => exactWarnings.push(String(m));
  let exactJobs;
  try {
    exactJobs = await radancy.fetch({ name: 'ExactFit', careers_url: 'https://u.example/search-jobs', max_jobs: 3 }, exactCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (exactJobs.length === 3 && exactWarnings.length === 0) {
    pass('radancy.fetch() does not warn when max_jobs exactly matches a naturally-complete result');
  } else {
    fail(`radancy.fetch() exact-max_jobs handling: jobs=${exactJobs?.length} warnings=${JSON.stringify(exactWarnings)}`);
  }

  // Every fetch call — both JSON fragment pages and the HTML fallback — must
  // refuse a redirect (#1440's mandatory SSRF guard, every peer provider
  // sets it; flagged as a pre-existing gap on radancy.mjs specifically in
  // review). A 3xx is still blocked at DNS resolution by the central
  // _ip-guard.mjs, so this is defense-in-depth, not a live bypass — but the
  // convention is per-provider, so it belongs here too.
  const redirectCallsJson = [];
  const redirectJsonCtx = {
    sleep: async () => {},
    fetchJson: async (u, o) => {
      redirectCallsJson.push(o?.redirect);
      const page = Number(new URL(u).searchParams.get('CurrentPage'));
      return page === 1
        ? { results: `<section data-total-results="4" data-total-pages="2">${rowFor(1)}${rowFor(2)}</section>`, hasJobs: true }
        : { results: `<section data-total-results="4" data-total-pages="2">${rowFor(3)}</section>`, hasJobs: true };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  await radancy.fetch({ name: 'RedirectCheckJson', careers_url: 'https://redirect-json.example/search-jobs' }, redirectJsonCtx);
  if (redirectCallsJson.length >= 2 && redirectCallsJson.every((r) => r === 'error')) {
    pass('radancy.fetch() sets redirect:"error" on every JSON fragment request');
  } else {
    fail(`radancy.fetch() JSON redirect option: ${JSON.stringify(redirectCallsJson)}`);
  }

  const redirectCallsHtml = [];
  const redirectHtmlCtx = {
    sleep: async () => {},
    fetchText: async (u, o) => {
      redirectCallsHtml.push(o?.redirect);
      return redirectCallsHtml.length === 1 ? html : '<html></html>';
    },
  };
  await radancy.fetch({ name: 'RedirectCheckHtml', careers_url: 'https://redirect-html.example/search-jobs' }, redirectHtmlCtx);
  if (redirectCallsHtml.length >= 2 && redirectCallsHtml.every((r) => r === 'error')) {
    pass('radancy.fetch() sets redirect:"error" on every HTML ?p=N request');
  } else {
    fail(`radancy.fetch() HTML redirect option: ${JSON.stringify(redirectCallsHtml)}`);
  }

  // max_jobs must be clamped the same way max_pages already is — a garbage
  // config value shouldn't be trusted just because it's a positive integer.
  // The clamp lands at MAX_PAGES * 100 (the JSON transport's true ceiling,
  // the more generous of the two transports), which happens to be
  // unobservable through fetch() itself (max_pages already produces the same
  // practical bound), so this is exercised directly.
  const { resolveMaxJobs } = radancyModule;
  if (resolveMaxJobs({ max_jobs: 999999999 }) === 20000) {
    pass('radancy.resolveMaxJobs() clamps an absurd max_jobs to the true JSON-transport ceiling');
  } else {
    fail(`radancy.resolveMaxJobs() did not clamp: ${resolveMaxJobs({ max_jobs: 999999999 })}`);
  }
  if (resolveMaxJobs({}) === 2000) {
    pass('radancy.resolveMaxJobs() defaults to 2000 when max_jobs is unset');
  } else {
    fail(`radancy.resolveMaxJobs() default wrong: ${resolveMaxJobs({})}`);
  }

  // The cache-buster must vary per call — a caching layer keying on the URL
  // still produces a stable, wrong result if the extra parameter is itself
  // deterministic (e.g. derived from `page`, which repeats across fetch()
  // calls for the same page number).
  const cbUrl1 = new URL(buildFragmentUrl('https://x.example/search-jobs', 1));
  const cbUrl2 = new URL(buildFragmentUrl('https://x.example/search-jobs', 1));
  if (cbUrl1.searchParams.get('_') && cbUrl1.searchParams.get('_') !== cbUrl2.searchParams.get('_')) {
    pass('radancy.buildFragmentUrl() appends a per-call random cache-buster');
  } else {
    fail(`radancy.buildFragmentUrl() cache-buster missing or not unique: ${cbUrl1.searchParams.get('_')} / ${cbUrl2.searchParams.get('_')}`);
  }

  // A source total overstating what pagination actually serves is routine
  // (verified live on 4 of 9 tenants) and must never fire the "raise
  // max_pages" warning — that advice cannot fix a source-side count, and
  // firing it here would be noise on a majority of real tenants.
  const overstateWarnings = [];
  const overstateCtx = {
    sleep: async () => {},
    fetchJson: async () => ({
      results: `<section data-total-results="10" data-total-pages="1">${rowFor('501')}</section>`,
      hasJobs: true,
    }),
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => overstateWarnings.push(String(m));
  let overstateJobs;
  try {
    overstateJobs = await radancy.fetch({ name: 'Understated', careers_url: 'https://y.example/search-jobs' }, overstateCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (overstateJobs.length === 1 && overstateWarnings.length === 0) {
    pass('radancy.fetch() does not warn when a natural page-1 end falls short of an inflated totalResults');
  } else {
    fail(`radancy.fetch() overstated-total handling: ${overstateJobs?.length} jobs, warnings=${JSON.stringify(overstateWarnings)}`);
  }

  // max_pages capping the walk short of the source's own LARGER totalPages IS
  // worth a warning — this is the one case where "raise max_pages" is
  // actually actionable.
  let capPage = 0;
  const capWarnings = [];
  const genuineCapCtx = {
    sleep: async () => {},
    fetchJson: async () => {
      capPage++;
      return {
        results: `<section data-total-results="500" data-total-pages="5">${rowFor(capPage * 10 + 1)}${rowFor(capPage * 10 + 2)}</section>`,
        hasJobs: true,
      };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => capWarnings.push(String(m));
  let genuineCapJobs;
  try {
    genuineCapJobs = await radancy.fetch({ name: 'CappedShort', careers_url: 'https://z.example/search-jobs', max_pages: 2 }, genuineCapCtx);
  } finally {
    console.error = realConsoleError;
  }
  const genuineCapWarned = capWarnings.some((m) => /raise max_jobs\/max_pages/.test(m));
  if (genuineCapJobs.length === 4 && capPage === 2 && genuineCapWarned) {
    pass('radancy.fetch() warns when max_pages caps the walk short of a larger source-reported totalPages');
  } else {
    fail(`radancy.fetch() genuine cap handling: jobs=${genuineCapJobs?.length} pages=${capPage} warned=${genuineCapWarned}`);
  }

  // A mid-walk JSON fetch error must keep earlier pages and log why
  // pagination stopped, distinct from — and without — cap advice. Page 2
  // fails on EVERY attempt (retries included, via fetchJsonWithRetry) — a
  // one-shot-then-recovers mock would silently "fix itself" on retry and
  // prove nothing about the error path.
  const errWarnings = [];
  const jsonErrorCtx = {
    sleep: async () => {},
    fetchJson: async (u) => {
      const page = Number(new URL(u).searchParams.get('CurrentPage'));
      if (page === 2) {
        const err = new Error('503 on page 2');
        err.status = 503;
        throw err;
      }
      return {
        results: `<section data-total-results="500" data-total-pages="5">${rowFor(page * 10 + 1)}</section>`,
        hasJobs: true,
      };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => errWarnings.push(String(m));
  let jsonErrorJobs;
  try {
    jsonErrorJobs = await radancy.fetch({ name: 'MidWalkError', careers_url: 'https://w.example/search-jobs' }, jsonErrorCtx);
  } finally {
    console.error = realConsoleError;
  }
  const errLogged = errWarnings.some((m) => m.includes('503 on page 2'));
  const noCapAdvice = !errWarnings.some((m) => /raise max_jobs\/max_pages/.test(m));
  if (jsonErrorJobs.length === 1 && errLogged && noCapAdvice) {
    pass('radancy.fetch() keeps earlier pages and logs the fetch error on a mid-walk JSON failure, without cap advice');
  } else {
    fail(`radancy.fetch() mid-walk JSON error handling: jobs=${jsonErrorJobs?.length} warnings=${JSON.stringify(errWarnings)}`);
  }

  // The actual point of routing through fetchJsonWithRetry: a page that
  // fails once transiently (429/5xx/network) then succeeds must recover
  // silently — no lost page, no error logged — where the old bare
  // ctx.fetchJson call would have permanently truncated the walk from
  // there on a single blip.
  let attemptsOnPage2 = 0;
  const transientWarnings = [];
  const transientCtx = {
    sleep: async () => {},
    fetchJson: async (u) => {
      const page = Number(new URL(u).searchParams.get('CurrentPage'));
      if (page === 2) {
        attemptsOnPage2++;
        if (attemptsOnPage2 === 1) {
          const err = new Error('503 Service Unavailable');
          err.status = 503;
          throw err;
        }
      }
      return {
        results: `<section data-total-results="500" data-total-pages="3">${rowFor(page * 10 + 1)}</section>`,
        hasJobs: true,
      };
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  console.error = (m) => transientWarnings.push(String(m));
  let transientJobs;
  try {
    transientJobs = await radancy.fetch({ name: 'TransientBlip', careers_url: 'https://v.example/search-jobs' }, transientCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (transientJobs.length === 3 && attemptsOnPage2 === 2 && transientWarnings.length === 0) {
    pass('radancy.fetch() recovers a page that fails once transiently, via fetchJsonWithRetry, with no data lost and no warning');
  } else {
    fail(`radancy.fetch() transient-recovery handling: jobs=${transientJobs?.length} attempts=${attemptsOnPage2} warnings=${JSON.stringify(transientWarnings)}`);
  }
} catch (e) {
  fail(`radancy provider tests crashed: ${e.message}`);
}
