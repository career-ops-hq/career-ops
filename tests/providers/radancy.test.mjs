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
  let partialCalls = 0;
  const partialCtx = {
    sleep: async () => {},
    fetchText: async () => {
      partialCalls++;
      if (partialCalls === 1) return html; // 2 jobs
      throw new Error('network blip on page 2');
    },
  };
  const partialJobs = await radancy.fetch({ name: 'Munich Re', api: 'https://careers.munichre.com/en/search-jobs' }, partialCtx);
  if (partialJobs.length === 2 && partialCalls === 2) pass('radancy.fetch() preserves jobs from earlier pages when a later page fetch throws');
  else fail(`radancy.fetch() partial-failure handling wrong: ${partialJobs.length} jobs after ${partialCalls} calls`);

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
} catch (e) {
  fail(`radancy provider tests crashed: ${e.message}`);
}
