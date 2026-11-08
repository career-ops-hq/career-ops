// tests/providers/successfactors.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — successfactors (SAP RMK tile parser)');


try {
  const successfactorsModule = await import(pathToFileURL(join(ROOT, 'providers/successfactors.mjs')).href);
  const sf = successfactorsModule.default;
  const { parseTiles, cityFromSlug, resolveConfig } = successfactorsModule;

  if (sf.id === 'successfactors') pass('successfactors.id is "successfactors"');
  else fail(`successfactors.id is ${JSON.stringify(sf.id)}`);

  // resolveConfig — multi-brand RMK tenants (#2010): a brand/tenant path
  // segment in the configured URL (careers.nemetschek.com/Bluebeam/) must
  // survive into tileApi/jobsApi/searchPage, not collapse to the shared
  // origin (which would silently return the parent brand's postings).
  const single = resolveConfig({ name: 'ZF', careers_url: 'https://jobs.zf.com' });
  if (single.base === 'https://jobs.zf.com' && single.tileApi === 'https://jobs.zf.com/tile-search-results/') {
    pass('resolveConfig: single-domain tenant is unaffected (base === origin, #2010)');
  } else {
    fail(`resolveConfig single-domain wrong: base=${single.base} tileApi=${single.tileApi}`);
  }

  const brandSearch = resolveConfig({ name: 'Bluebeam', api: 'https://careers.nemetschek.com/Bluebeam/search/' });
  if (
    brandSearch.base === 'https://careers.nemetschek.com/Bluebeam' &&
    brandSearch.tileApi === 'https://careers.nemetschek.com/Bluebeam/tile-search-results/' &&
    brandSearch.jobsApi === 'https://careers.nemetschek.com/Bluebeam/services/recruiting/v1/jobs' &&
    brandSearch.searchPage === 'https://careers.nemetschek.com/Bluebeam/search/'
  ) {
    pass('resolveConfig: multi-brand tenant keeps the brand path in tileApi/jobsApi/searchPage (#2010)');
  } else {
    fail(`resolveConfig multi-brand wrong: ${JSON.stringify(brandSearch)}`);
  }
  // jobBase deliberately stays origin-only: live RMK data-url paths for a
  // brand-scoped tenant already carry the brand segment (confirmed against
  // Nemetschek's own /Bluebeam/tile-search-results/ output), so prefixing
  // base there would double it up.
  if (brandSearch.jobBase === 'https://careers.nemetschek.com') {
    pass('resolveConfig: jobBase stays origin-only for a brand-scoped tenant (#2010)');
  } else {
    fail(`resolveConfig jobBase wrong: ${brandSearch.jobBase}`);
  }

  const brandNoSearch = resolveConfig({ name: 'Bluebeam', careers_url: 'https://careers.nemetschek.com/Bluebeam/' });
  if (brandNoSearch.base === 'https://careers.nemetschek.com/Bluebeam') {
    pass('resolveConfig: a brand path without a trailing /search/ segment still resolves correctly (#2010)');
  } else {
    fail(`resolveConfig brand-no-search wrong: base=${brandNoSearch.base}`);
  }

  if (resolveConfig({ name: 'X', careers_url: 'not a url' }) === null) {
    pass('resolveConfig: returns null for an unparseable URL');
  } else {
    fail('resolveConfig should return null for an unparseable URL');
  }

  // An `api:` override pointing straight at one of the endpoints this module
  // itself builds (rather than at the brand root or /search/) must not
  // double the segment onto the derived base (e.g. …/tile-search-results/
  // tile-search-results/).
  const brandTileEndpoint = resolveConfig({ name: 'Bluebeam', api: 'https://careers.nemetschek.com/Bluebeam/tile-search-results/' });
  if (brandTileEndpoint.base === 'https://careers.nemetschek.com/Bluebeam' && brandTileEndpoint.tileApi === 'https://careers.nemetschek.com/Bluebeam/tile-search-results/') {
    pass('resolveConfig: api: pointing at tile-search-results/ directly does not double the segment (#2010)');
  } else {
    fail(`resolveConfig tile-endpoint-as-api wrong: base=${brandTileEndpoint.base} tileApi=${brandTileEndpoint.tileApi}`);
  }
  const brandJobsEndpoint = resolveConfig({ name: 'Bluebeam', api: 'https://careers.nemetschek.com/Bluebeam/services/recruiting/v1/jobs' });
  if (brandJobsEndpoint.base === 'https://careers.nemetschek.com/Bluebeam' && brandJobsEndpoint.jobsApi === 'https://careers.nemetschek.com/Bluebeam/services/recruiting/v1/jobs') {
    pass('resolveConfig: api: pointing at services/recruiting/v1/jobs directly does not double the segment (#2010)');
  } else {
    fail(`resolveConfig jobs-endpoint-as-api wrong: base=${brandJobsEndpoint.base} jobsApi=${brandJobsEndpoint.jobsApi}`);
  }

  // A /go/<Category>/<id>/ saved-search page copied from a careers site is not a
  // brand prefix: it must resolve to the tenant root, where the tile endpoint
  // answers, not to .../go/<Category>/<id>/tile-search-results/ (200, zero tiles).
  const goRoot = 'https://jobs.canadalife.com';
  for (const [label, url] of [
    ['category page', `${goRoot}/go/All-Jobs/9170201/`],
    ['category page with a locale query', `${goRoot}/go/All-Jobs/9170201/?locale=en_US`],
    ['paginated category page', `${goRoot}/go/All-Jobs/9170201/25/`],
    ['category page without a trailing slash', `${goRoot}/go/All-Jobs/9170201`],
  ]) {
    const go = resolveConfig({ name: 'Canada Life', careers_url: url });
    if (go.base === goRoot && go.tileApi === `${goRoot}/tile-search-results/` && go.jobsApi === `${goRoot}/services/recruiting/v1/jobs`) {
      pass(`resolveConfig: /go/<Category>/<id>/ ${label} resolves to the tenant root`);
    } else {
      fail(`resolveConfig /go/ ${label} wrong: base=${go.base} tileApi=${go.tileApi}`);
    }
  }
  const brandGo = resolveConfig({ name: 'Bluebeam', careers_url: 'https://careers.nemetschek.com/Bluebeam/go/Sales/123/' });
  if (brandGo.base === 'https://careers.nemetschek.com/Bluebeam' && brandGo.tileApi === 'https://careers.nemetschek.com/Bluebeam/tile-search-results/') {
    pass('resolveConfig: a brand segment in front of /go/<Category>/<id>/ is kept');
  } else {
    fail(`resolveConfig brand + /go/ wrong: base=${brandGo.base} tileApi=${brandGo.tileApi}`);
  }
  // Only a /go/ page is stripped: a brand whose own name is "go", or a path that
  // merely contains /go/, must be left alone.
  const goBrand = resolveConfig({ name: 'X', careers_url: 'https://careers.example.com/go/' });
  const goDeep = resolveConfig({ name: 'X', careers_url: 'https://careers.example.com/Brand/go/jobs/' });
  if (goBrand.base === 'https://careers.example.com/go' && goDeep.base === 'https://careers.example.com/Brand/go/jobs') {
    pass('resolveConfig: a path that is not /go/<Category>/<numeric id>/ is left alone');
  } else {
    fail(`resolveConfig over-stripped a non-category /go/ path: ${goBrand.base} | ${goDeep.base}`);
  }

  // detect() — literal SF hosts auto-claim; branded RMK hosts (jobs.zf.com) do
  // NOT (they carry no "successfactors" string and rely on explicit provider:).
  if (sf.detect({ name: 'X', careers_url: 'https://acme.successfactors.eu/careers' })) {
    pass('successfactors.detect() claims a *.successfactors.eu URL');
  } else {
    fail('successfactors.detect() should claim *.successfactors.eu');
  }
  if (sf.detect({ name: 'X', api: 'https://company.jobs2web.com/x' })) {
    pass('successfactors.detect() claims a jobs2web.com URL');
  } else {
    fail('successfactors.detect() should claim jobs2web.com');
  }
  if (sf.detect({ name: 'ZF', careers_url: 'https://jobs.zf.com' }) === null) {
    pass('successfactors.detect() returns null for a branded RMK host (needs explicit provider:)');
  } else {
    fail('successfactors.detect() must not auto-claim branded hosts');
  }

  // cityFromSlug — recover the city prefix from an RMK /job/{City}-{Title}-{code}/ slug.
  if (cityFromSlug('/job/Hyderabad-Specialist-Low-Level-Driver-Development-TG-500032/1399717233/', 'Specialist -Low Level Driver Development') === 'Hyderabad') {
    pass('cityFromSlug extracts a single-word city');
  } else {
    fail(`cityFromSlug single-word wrong: ${cityFromSlug('/job/Hyderabad-Specialist-Low-Level-Driver-Development-TG-500032/1399717233/', 'Specialist -Low Level Driver Development')}`);
  }
  // Multi-word city (Levallois-Perret) — anchoring on the title's first two
  // words means the full city prefix survives, not just the first token.
  if (cityFromSlug('/job/Levallois-Perret-Data-Management-Engagement-Architect-92300/1400945133/', 'Data Management Engagement Architect') === 'Levallois Perret') {
    pass('cityFromSlug extracts a multi-word city');
  } else {
    fail(`cityFromSlug multi-word wrong: ${cityFromSlug('/job/Levallois-Perret-Data-Management-Engagement-Architect-92300/1400945133/', 'Data Management Engagement Architect')}`);
  }
  // Accented title (Ingénieur) — unicode word matching keeps the anchor intact.
  if (cityFromSlug('/job/Massy-Ing%C3%A9nieur-Commercial-91743/1351400755/', 'Ingénieur Commercial') === 'Massy') {
    pass('cityFromSlug handles accented (unicode) titles');
  } else {
    fail(`cityFromSlug accented wrong: ${cityFromSlug('/job/Massy-Ing%C3%A9nieur-Commercial-91743/1351400755/', 'Ingénieur Commercial')}`);
  }

  // parseTiles — a compact fragment covering the three things that bit during
  // development: the city-value div (not its "City" label), an &amp; in the
  // data-url path, a slug fallback when no city div is rendered, an entity in
  // the title, desktop/mobile duplication collapsed to one <li>, and a
  // title-less tile that must be dropped.
  const jobBase = 'https://jobs.example.com';
  const fragment = `
    <ul>
      <li class="job-tile job-id-111 job-row-index-1" data-url="/job/Schweinfurt-Ferienarbeiter-97421/111/">
        <a class="jobTitle-link fontcolorx" href="/job/Schweinfurt-Ferienarbeiter-97421/111/">Ferienarbeiter (m&#47;w&#47;d)</a>
        <div id="job-111-desktop-section-city" class="section-field city">
          <span id="job-111-desktop-section-city-label" aria-describedby="job-111-desktop-section-city-value" class="section-label sr-only">City</span>
          <div id="job-111-desktop-section-city-value">Schweinfurt                 </div>
        </div>
      </li>
      <li class="job-tile job-id-222 job-row-index-2" data-url="/job/Palo-Alto-Program-&amp;-Release-Manager-CA-94304/222/">
        <a class="jobTitle-link fontcolorx" href="/x">Program &amp; Release Manager</a>
      </li>
      <li class="job-tile job-id-333 job-row-index-3" data-url="/job/no-title/333/">
      </li>
    </ul>`;
  const parsed = parseTiles(fragment, jobBase);

  if (parsed.length === 2) pass('parseTiles returns 2 jobs (title-less tile dropped)');
  else fail(`parseTiles returned ${parsed.length} jobs, expected 2`);

  const j1 = parsed.find((j) => j.url.includes('/111/'));
  if (j1 && j1.title === 'Ferienarbeiter (m/w/d)') pass('parseTiles decodes entity in title');
  else fail(`parseTiles title wrong: ${JSON.stringify(j1 && j1.title)}`);
  if (j1 && j1.location === 'Schweinfurt') pass('parseTiles reads the city-value div, not the "City" label');
  else fail(`parseTiles city wrong: ${JSON.stringify(j1 && j1.location)}`);
  if (j1 && j1.url === 'https://jobs.example.com/job/Schweinfurt-Ferienarbeiter-97421/111/') pass('parseTiles builds an absolute URL from data-url');
  else fail(`parseTiles url wrong: ${JSON.stringify(j1 && j1.url)}`);

  const j2 = parsed.find((j) => j.url.includes('/222/'));
  if (j2 && j2.url === 'https://jobs.example.com/job/Palo-Alto-Program-&-Release-Manager-CA-94304/222/') {
    pass('parseTiles decodes &amp; in the data-url path');
  } else {
    fail(`parseTiles &amp; url wrong: ${JSON.stringify(j2 && j2.url)}`);
  }
  if (j2 && j2.location === 'Palo Alto') pass('parseTiles falls back to slug city when no city div is present');
  else fail(`parseTiles slug-fallback city wrong: ${JSON.stringify(j2 && j2.location)}`);

  // Empty fragment (MTU's zero-req case) → no jobs, no throw.
  if (parseTiles('<!DOCTYPE html>', jobBase).length === 0) pass('parseTiles returns [] for an empty fragment');
  else fail('parseTiles should return [] for an empty fragment');

  // ── CSB (Career Site Builder) strategy — JSON jobs API ────────────────────
  const { extractLocales, parseCsbDate, cleanCsbLocation, parseCsbJobs } = successfactorsModule;

  // extractLocales — pull the language-switcher locales from a /search/ page,
  // deduped and priority-ordered (de_DE, en_US first; then alphabetical).
  const switcherHtml =
    '<a href="/search/?q=&amp;startrow=0&amp;locale=fr_FR">FR</a>' +
    '<a href="/search/?q=&amp;startrow=0&amp;locale=en_US">EN</a>' +
    '<a href="/search/?q=&amp;startrow=0&amp;locale=de_DE">DE</a>' +
    '<a href="/search/?q=&amp;startrow=0&amp;locale=de_DE">DE dup</a>';
  const locs = extractLocales(switcherHtml);
  if (JSON.stringify(locs) === JSON.stringify(['de_DE', 'en_US', 'fr_FR'])) {
    pass('extractLocales dedups and priority-orders (de_DE, en_US, then alpha)');
  } else {
    fail(`extractLocales wrong: ${JSON.stringify(locs)}`);
  }
  if (extractLocales('<p>no locales here</p>').length === 0) pass('extractLocales returns [] when the page carries none');
  else fail('extractLocales should return [] for a page with no locale links');

  // The date format follows the query locale: BMW's fr_FR and pt_BR pages send
  // D/M/YYYY with slashes, and hu_HU sends "YYYY. MM. DD.".
  {
    const rec = (id, d) => ({ response: { id, unifiedStandardTitle: `Role ${id}`, unifiedStandardStart: d } });
    const posted = (d, locale) => parseCsbJobs({ jobSearchResult: [rec('1', d)] }, { origin: 'https://jobs.example.com' }, locale)[0].postedAt;
    const got = [
      posted('05/10/2026', 'fr_FR'),
      posted('13/10/2026', 'pt_BR'),
      posted('2025. 07. 03.', 'hu_HU'),
      posted('6/18/26', 'en_US'),
    ];
    const want = [Date.UTC(2026, 9, 5), Date.UTC(2026, 9, 13), Date.UTC(2025, 6, 3), Date.UTC(2026, 5, 18)];
    if (JSON.stringify(got) === JSON.stringify(want)) pass('parseCsbJobs reads the posting date in the query locale order');
    else fail(`parseCsbJobs locale dates wrong: ${JSON.stringify(got.map((t) => (t ? new Date(t).toISOString().slice(0, 10) : t)))}`);
  }
  // parseCsbDate — locale-dependent short date; separator infers field order.
  if (parseCsbDate('6/18/26') === Date.UTC(2026, 5, 18)) pass('parseCsbDate reads US M/D/YY');
  else fail(`parseCsbDate US wrong: ${parseCsbDate('6/18/26')}`);
  if (parseCsbDate('20.11.23') === Date.UTC(2023, 10, 20)) pass('parseCsbDate reads European D.M.YY (dots)');
  else fail(`parseCsbDate DE wrong: ${parseCsbDate('20.11.23')}`);
  if (parseCsbDate('garbage') === undefined && parseCsbDate('13/40/99') === undefined && parseCsbDate('') === undefined) {
    pass('parseCsbDate returns undefined for junk / out-of-range / empty');
  } else {
    fail('parseCsbDate should reject junk, out-of-range, and empty input');
  }

  // cleanCsbLocation — array of "City, CC, ZIP<br/>" strings → joined, stripped.
  if (cleanCsbLocation(['Karlovy Vary, CZE, 36004<br/>']) === 'Karlovy Vary, CZE, 36004') pass('cleanCsbLocation strips trailing <br/>');
  else fail(`cleanCsbLocation single wrong: ${JSON.stringify(cleanCsbLocation(['Karlovy Vary, CZE, 36004<br/>']))}`);
  if (cleanCsbLocation(['Munich<br/>', 'Berlin<br/>']) === 'Munich / Berlin') pass('cleanCsbLocation joins multiple locations with " / "');
  else fail(`cleanCsbLocation multi wrong: ${JSON.stringify(cleanCsbLocation(['Munich<br/>', 'Berlin<br/>']))}`);
  if (cleanCsbLocation(undefined) === '' && cleanCsbLocation([]) === '') pass('cleanCsbLocation tolerates missing/empty location');
  else fail('cleanCsbLocation should return "" for missing/empty input');

  // The jobs API appends a trailing comma ("City, Region, Country, ").
  // clean() alone would keep it, so cleanCsbLocation trims it after clean().
  // Interior commas and a trailing postal code stay.
  const commaCases = [
    [['Karlovy Vary, CZE, 36004,'], 'Karlovy Vary, CZE, 36004'],
    [['Bend, OR, USA, '], 'Bend, OR, USA'],
    [['Oslo, NOR,'], 'Oslo, NOR'],
    [['Columbus, OH, USA,<br/>'], 'Columbus, OH, USA'],
    [['Bend, OR, USA, ', 'Oslo, NOR,'], 'Bend, OR, USA / Oslo, NOR'],
  ];
  const commaBad = commaCases.filter(([raw, want]) => cleanCsbLocation(raw) !== want)
    .map(([raw, want]) => `${JSON.stringify(raw)} => ${JSON.stringify(cleanCsbLocation(raw))} (wanted ${JSON.stringify(want)})`);
  if (commaBad.length === 0) pass('cleanCsbLocation strips a trailing comma and keeps interior commas');
  else fail(`cleanCsbLocation trailing comma: ${commaBad.join('; ')}`);

  // parseCsbJobs — map the {response:{…}} records; build {id}-{locale} URLs and
  // sanitize the cosmetic slug (HTML entities, URL-structural chars).
  const csbJson = {
    totalJobs: 3,
    jobSearchResult: [
      { response: { id: '31099', unifiedStandardTitle: 'Analytical Lab Technician', unifiedUrlTitle: 'Analytical-Lab-Technician', jobLocationShort: ['Anyang, KOR, 14058<br/>'], unifiedStandardStart: '6/18/26' } },
      { response: { id: '1283', unifiedStandardTitle: 'Senior Expert Mergers & Acquisitions (m/f/d)', unifiedUrlTitle: 'Senior-Expert-Mergers-&amp;-Acquisitions-%28mfd%29', jobLocationShort: ['Munich<br/>'], unifiedStandardStart: '4/21/26' } },
      { response: { id: '', unifiedStandardTitle: 'No ID — dropped', unifiedUrlTitle: 'x' } },
      { response: { id: '999', unifiedStandardTitle: '', unifiedUrlTitle: 'no-title-dropped' } },
    ],
  };
  const csbCfg = { origin: 'https://jobs.example.com' };
  const csbJobs = parseCsbJobs(csbJson, csbCfg, 'en_US');
  if (csbJobs.length === 2) pass('parseCsbJobs drops records missing id or title');
  else fail(`parseCsbJobs returned ${csbJobs.length}, expected 2`);
  const c1 = csbJobs[0];
  if (c1 && c1.url === 'https://jobs.example.com/job/Analytical-Lab-Technician/31099-en_US') pass('parseCsbJobs builds {origin}/job/{slug}/{id}-{locale}');
  else fail(`parseCsbJobs url wrong: ${JSON.stringify(c1 && c1.url)}`);
  if (c1 && c1.location === 'Anyang, KOR, 14058') pass('parseCsbJobs cleans jobLocationShort');
  else fail(`parseCsbJobs location wrong: ${JSON.stringify(c1 && c1.location)}`);
  // A trailing comma is a location artifact. A title can end in a comma for
  // real, and titles get only clean(), so the comma trim in cleanCsbLocation
  // must not reach them.
  const commaParsed = parseCsbJobs({
    jobSearchResult: [{
      response: {
        id: '9001',
        unifiedStandardTitle: 'Ops Lead,',
        unifiedUrlTitle: 'Ops-Lead',
        jobLocationShort: ['Bend, OR, USA, '],
        unifiedStandardStart: '10/1/26',
      },
    }],
  }, csbCfg, 'en_US');
  if (commaParsed[0]?.location === 'Bend, OR, USA' && commaParsed[0]?.title === 'Ops Lead,') {
    pass('parseCsbJobs strips a trailing location comma and leaves a title comma');
  } else {
    fail(`parseCsbJobs comma row: ${JSON.stringify(commaParsed[0])}`);
  }
  if (c1 && c1.postedAt === Date.UTC(2026, 5, 18)) pass('parseCsbJobs sets postedAt from unifiedStandardStart');
  else fail(`parseCsbJobs postedAt wrong: ${JSON.stringify(c1 && c1.postedAt)}`);
  const c2 = csbJobs[1];
  if (c2 && !/[?#&]|&amp;/.test(new URL(c2.url).pathname)) pass('parseCsbJobs sanitizes &amp; / URL-structural chars out of the slug');
  else fail(`parseCsbJobs slug not sanitized: ${JSON.stringify(c2 && c2.url)}`);

  // parseCsbJobs (#2010): a brand-scoped cfg.base (from resolveConfig) must
  // flow into the built job URL, for a hypothetical multi-brand CSB tenant.
  const csbBrandCfg = { origin: 'https://careers.example.com', base: 'https://careers.example.com/Acme' };
  const csbBrandJobs = parseCsbJobs(csbJson, csbBrandCfg, 'en_US');
  if (csbBrandJobs[0]?.url === 'https://careers.example.com/Acme/job/Analytical-Lab-Technician/31099-en_US') {
    pass('parseCsbJobs uses cfg.base (brand-scoped) when present (#2010)');
  } else {
    fail(`parseCsbJobs did not honor cfg.base: ${JSON.stringify(csbBrandJobs[0]?.url)}`);
  }

  // Regression (#1639 lineage) — a numeric entity above U+10FFFF must not throw
  // RangeError out of the whole parse. The local decodeEntities copy guarded
  // only with Number.isFinite (no `<= 0x10FFFF` / surrogate check), so ONE
  // adversarial/malformed entity (&#99999999;, &#xFFFFFFFF;) crashed the entire
  // provider parse and scan.mjs's per-company catch dropped EVERY posting for
  // that run. parseTiles now routes through the shared guarded decoder, which
  // degrades an out-of-range or lone-surrogate entity to literal text while
  // still decoding valid ones (&amp;).
  {
    const badFrag2 = `<ul>
      <li class="job-tile job-id-9001" data-url="/job/City-Bad-Entity/9001/">
        <a class="jobTitle-link fontcolorx" href="/x">Overflow &#99999999; &amp; Hex &#xFFFFFFFF; Surrogate &#xD800;</a>
      </li>
    </ul>`;
    let badTiles, badThrew = null;
    try { badTiles = parseTiles(badFrag2, 'https://jobs.example.com'); } catch (e) { badThrew = e; }
    if (badThrew) fail(`successfactors.parseTiles() threw ${badThrew.name} on an out-of-range numeric entity (unguarded String.fromCodePoint): ${badThrew.message}`);
    else if (badTiles.length === 1 && badTiles[0].title === 'Overflow &#99999999; & Hex &#xFFFFFFFF; Surrogate &#xD800;') pass('successfactors.parseTiles() tolerates out-of-range / surrogate entities, degrading them to literal text while still decoding &amp; (no RangeError crash)');
    else fail(`successfactors.parseTiles() out-of-range entity wrong: ${JSON.stringify(badTiles)}`);
  }
  // CSB: when every locale fails without one successful jobs-API request, the
  // board is unreachable, not empty. fetch() must throw so scan/portal-health
  // record a failure instead of "live but empty".
  {
    let csbErr = null;
    let csbCalls = 0;
    try {
      await sf.fetch(
        { name: 'DeadCo', careers_url: 'https://careers.deadco.example', sfVariant: 'csb' },
        {
          sleep: async () => {},
          fetchText: async () => { throw new Error('discovery down'); }, // locale discovery is best-effort
          // Each locale fails with a DISTINCT message so the assertion below
          // pins WHICH failure fetch() surfaces, not merely THAT it throws.
          fetchJson: async () => { csbCalls++; throw new Error(`jobs api down (call ${csbCalls})`); },
        },
      );
    } catch (err) {
      csbErr = err;
    }
    // Discovery is down, so both default locales (de_DE, en_US) are tried and
    // fail → 2+ calls; the surfaced error must be the FIRST locale's, pinning
    // the deterministic firstErr retention.
    if (csbErr?.message === 'jobs api down (call 1)' && csbCalls >= 2) {
      pass('successfactors CSB fetch() throws the FIRST locale failure when every locale fails (dead board ≠ empty board, deterministic error)');
    } else {
      fail(`successfactors CSB fetch() wrong: ${csbErr ? `threw "${csbErr.message}"` : 'swallowed an all-locales failure into []'} after ${csbCalls} jobs-API calls`);
    }
  }
  // Dispatcher default path (NO sfVariant): a healthy RMK tenant with zero
  // postings triggers the post-RMK CSB probe. The probe failing on every
  // locale must NOT throw — RMK already answered, so the board is reachable
  // and legitimately empty, not a dead slug.
  {
    let probeErr = null;
    let probeJobs = null;
    let probeCalls = 0;
    try {
      probeJobs = await sf.fetch(
        { name: 'EmptyCo', careers_url: 'https://jobs.emptyco.example' },
        {
          sleep: async () => {},
          // Serves both the RMK tile endpoint (healthy 200, zero tiles) and
          // the best-effort /search/ locale discovery.
          fetchText: async () => '<!DOCTYPE html>',
          fetchJson: async () => { probeCalls++; throw new Error('no CSB endpoint on this tenant'); },
        },
      );
    } catch (err) {
      probeErr = err;
    }
    // probeCalls >= 1 pins that the CSB probe actually RAN — an empty array
    // straight off the RMK path would otherwise pass this test vacuously.
    if (!probeErr && Array.isArray(probeJobs) && probeJobs.length === 0 && probeCalls >= 1) {
      pass('successfactors fetch() without sfVariant: empty RMK + failing CSB probe returns [] (healthy empty board ≠ dead slug)');
    } else {
      fail(`successfactors fetch() empty-RMK CSB-probe wrong: ${probeErr ? `threw "${probeErr.message}"` : JSON.stringify(probeJobs)} after ${probeCalls} jobs-API calls`);
    }
  }
  // CSB paging against a server whose default sort reshuffles ties on every
  // request (BMW's live behavior): every posting must still come back.
  {
    const ids = Array.from({ length: 25 }, (_, i) => String(1000 + i));
    const rec = (id) => ({ response: { id, unifiedStandardTitle: `Role ${id}`, unifiedUrlTitle: `Role-${id}` } });
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let dateCalls = 0;
    const jobs = await sf.fetch(
      { name: 'ShuffleCo', careers_url: 'https://jobs.shuffleco.example', sfVariant: 'csb' },
      {
        sleep: async () => {},
        fetchText: async () => '<a href="/search/?locale=en_US">en</a>',
        fetchJson: async (_url, opts) => {
          const { pageNumber, sortBy } = JSON.parse(opts.body);
          let order;
          if (sortBy === 'date') {
            dateCalls++;
            order = [...ids];
            if (dateCalls <= 3 && pageNumber === 1) order[10] = order[9];
          } else {
            order = [...ids].sort(() => rand() - 0.5);
          }
          return { totalJobs: ids.length, jobSearchResult: order.slice(pageNumber * 10, pageNumber * 10 + 10).map(rec) };
        },
      },
    );
    const got = new Set(jobs.map((j) => j.url.split('/').pop().split('-')[0]));
    if (got.size === 25 && jobs.length === 25) pass('successfactors CSB returns every posting when the server reshuffles page order');
    else fail(`successfactors CSB lost postings under unstable paging: ${got.size} of 25`);
  }
  {
    let inFlight = 0;
    let peak = 0;
    const pagesAsked = [];
    const jobs = await sf.fetch(
      { name: 'ParallelCo', careers_url: 'https://careers.parallelco.example', sfVariant: 'csb' },
      {
        sleep: async () => {},
        fetchText: async () => '<a href="/search/?q=&startrow=0&locale=de_DE">de</a>',
        fetchJson: async (_url, opts) => {
          const { pageNumber } = JSON.parse(opts.body);
          pagesAsked.push(pageNumber);
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          const count = Math.max(0, Math.min(10, 125 - pageNumber * 10));
          return {
            totalJobs: 125,
            jobSearchResult: Array.from({ length: count }, (_, i) => ({ response: { id: String(pageNumber * 10 + i), unifiedStandardTitle: `Role ${pageNumber * 10 + i}`, unifiedUrlTitle: 'Role' } })),
          };
        },
      },
    );
    if (jobs.length === 125 && pagesAsked.length === 13 && peak === 6 && jobs[0].title === 'Role 0' && jobs[124].title === 'Role 124') {
      pass('successfactors CSB fetch() asks for the pages after page 0 six at a time and keeps board order');
    } else {
      fail(`successfactors CSB parallel pages: ${jobs.length} jobs, ${pagesAsked.length} requests, peak ${peak} in flight, first=${jobs[0]?.title} last=${jobs.at(-1)?.title}`);
    }
  }
  // Truncation warnings and the opt-in cap raise (robots.txt-gated).
  {
    const warns = [];
    const origErr = console.error;
    console.error = (...a) => warns.push(a.join(' '));
    const rec = (id) => ({ response: { id, unifiedStandardTitle: `Role ${id}`, unifiedUrlTitle: 'Role' } });
    const TOTAL = 1234;
    const csbCtx = (calls, robotsGate) => ({
      sleep: async () => {},
      robotsGate,
      fetchText: async () => '<a href="/search/?locale=en_US">en</a>',
      fetchJson: async (_u, opts) => {
        const { pageNumber } = JSON.parse(opts.body);
        calls.n++;
        const n = Math.max(0, Math.min(10, TOTAL - pageNumber * 10));
        return { totalJobs: TOTAL, jobSearchResult: Array.from({ length: n }, (_, i) => rec(String(pageNumber * 10 + i))) };
      },
    });
    const allow = async () => ({ allowed: true });
    const deny = async () => ({ allowed: false, reason: 'disallows /jobs' });
    try {
      const base = { name: 'BigCo', careers_url: 'https://careers.bigco.example', sfVariant: 'csb' };
      // Default: capped at 1000 of 1234, warns, request volume unchanged (100 pages), robots never consulted.
      let calls = { n: 0 }; let gateCalled = false;
      let jobs = await sf.fetch(base, csbCtx(calls, async () => { gateCalled = true; return { allowed: true }; }));
      if (jobs.length === 1000 && calls.n === 100 && !gateCalled && warns.length === 1 && /BigCo truncated/.test(warns[0]) && /en_US 1000 of 1234/.test(warns[0]) && /raise max_pages and\/or max_jobs/.test(warns[0])) pass('successfactors CSB default cap: 1000 jobs, 100 requests, no robots call, warns "N of M"');
      else fail(`successfactors CSB default cap wrong: ${jobs.length} jobs, ${calls.n} calls, gate=${gateCalled}, warns=${JSON.stringify(warns)}`);

      // Opt-in with robots allowing: whole board, no warning.
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ ...base, max_pages: 200, max_jobs: 5000 }, csbCtx(calls, allow));
      if (jobs.length === TOTAL && warns.length === 0) pass('successfactors CSB opt-in max_pages/max_jobs reads the full board without a warning');
      else fail(`successfactors CSB opt-in wrong: ${jobs.length} jobs, warns=${JSON.stringify(warns)}`);

      // Opt-in with robots disallowing: defaults kept, both warnings present.
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ ...base, max_pages: 200, max_jobs: 5000 }, csbCtx(calls, deny));
      if (jobs.length === 1000 && calls.n === 100 && warns.some((w) => /robots\.txt does not allow \/services/.test(w)) && warns.some((w) => /truncated/.test(w))) pass('successfactors CSB opt-in is refused when robots.txt disallows the endpoint');
      else fail(`successfactors CSB robots refusal wrong: ${jobs.length} jobs, ${calls.n} calls, warns=${JSON.stringify(warns)}`);

      // Ceilings: max_pages above the ceiling is clamped; lowering below default still works.
      const lim = successfactorsModule.resolveLimits;
      if (lim({ max_pages: 99999, max_jobs: 99999 }, 'csb').maxPages === 500 && lim({ max_pages: 99999, max_jobs: 99999 }, 'rmk').maxPages === 400 && lim({ max_jobs: 99999 }, 'rmk').maxJobs === 10000 && lim({ max_pages: 5 }, 'csb').maxPages === 5 && lim({ max_pages: 5 }, 'rmk').maxPages === 40 && !lim({}, 'csb').raised && !lim({ max_pages: 5 }, 'csb').raised) pass('successfactors resolveLimits: ceilings, default RMK ignores a lowering max_pages, defaults not "raised"');
      else fail('successfactors resolveLimits wrong');

      // RMK: 25 tiles/page, endless board. Default stops at 40 pages and warns; opt-in goes further.
      const tilePage = (startrow) => Array.from({ length: 25 }, (_, i) => `<li class="job-tile job-id-${startrow + i}"><a data-url="/job/x/${startrow + i}/" class="jobTitle-link" href="#">Role ${startrow + i}</a></li>`).join('');
      const rmkCtx = (c, robotsGate) => ({ sleep: async () => {}, robotsGate, fetchText: async (u) => { c.n++; return tilePage(Number(new URL(u).searchParams.get('startrow'))); } });
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ name: 'RmkCo', careers_url: 'https://jobs.rmkco.example' }, rmkCtx(calls, allow));
      if (jobs.length === 1000 && calls.n === 40 && warns.length === 1 && /RmkCo truncated at max_pages=40, max_jobs=1000/.test(warns[0])) pass('successfactors RMK default cap warns when still receiving new postings');
      else fail(`successfactors RMK default cap wrong: ${jobs.length} jobs, ${calls.n} calls, warns=${JSON.stringify(warns)}`);
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ name: 'RmkCo', careers_url: 'https://jobs.rmkco.example', max_pages: 60, max_jobs: 1500 }, rmkCtx(calls, allow));
      if (jobs.length === 1500 && calls.n === 60 && warns.length === 1) pass('successfactors RMK opt-in raises the cap (and still warns when the new cap is hit)');
      else fail(`successfactors RMK opt-in wrong: ${jobs.length} jobs, ${calls.n} calls, warns=${JSON.stringify(warns)}`);
      // Denied raise keeps a lower CSB max_pages; a probe (ctx.maxPages) stays at one page without warning or robots call.
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ ...base, max_pages: 5, max_jobs: 5000 }, csbCtx(calls, deny));
      if (jobs.length === 50 && calls.n <= 10) pass('successfactors robots denial keeps a lower CSB max_pages');
      else fail(`successfactors denial dropped lower max_pages: ${jobs.length} jobs, ${calls.n} calls`);
      warns.length = 0; calls = { n: 0 }; let probeGate = false;
      jobs = await sf.fetch({ name: 'RmkCo', careers_url: 'https://jobs.rmkco.example', max_pages: 60 }, { ...rmkCtx(calls, async () => { probeGate = true; return { allowed: true }; }), maxPages: 1 });
      if (jobs.length === 25 && calls.n === 1 && !probeGate && warns.length === 0) pass('successfactors RMK probe honors ctx.maxPages without robots check or warning');
      else fail(`successfactors RMK probe wrong: ${jobs.length} jobs, ${calls.n} calls, gate=${probeGate}, warns=${JSON.stringify(warns)}`);
      // Denial keeps a lower max_jobs; CSB probe after an empty RMK board never consults robots; short last page is not "capped".
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ ...base, max_pages: 200, max_jobs: 500 }, csbCtx(calls, deny));
      if (jobs.length === 500) pass('successfactors robots denial keeps a lower max_jobs');
      else fail(`successfactors denial dropped lower max_jobs: ${jobs.length}`);
      warns.length = 0; let g2 = 0;
      await sf.fetch({ name: 'EmptyRmk', careers_url: 'https://jobs.emptyrmk.example', max_pages: 200 }, { sleep: async () => {}, robotsGate: async (u) => { g2++; return { allowed: !/services/.test(u) }; }, fetchText: async () => '<!DOCTYPE html>', fetchJson: async () => ({ totalJobs: 0, jobSearchResult: [] }) });
      if (g2 === 1 && warns.length === 0) pass('successfactors CSB probe after an empty RMK board skips the robots gate and warns nothing');
      else fail(`successfactors CSB probe consulted robots: gateCalls=${g2}, warns=${JSON.stringify(warns)}`);
      warns.length = 0;
      const shortLast = (u) => { const r = Number(new URL(u).searchParams.get('startrow')); return r < 975 ? tilePage(r) : tilePage(r).split('</li>').slice(0, 10).join('</li>') + '</li>'; };
      jobs = await sf.fetch({ name: 'ShortLast', careers_url: 'https://jobs.shortlast.example' }, { sleep: async () => {}, robotsGate: allow, fetchText: async (u) => shortLast(u) });
      if (jobs.length === 985 && warns.length === 0) pass('successfactors RMK does not warn when the last page before the cap is short');
      else fail(`successfactors RMK short last page wrong: ${jobs.length} jobs, warns=${JSON.stringify(warns)}`);
      // CSB stop reasons: no total + full page at the cap warns; overstated total + short page does not.
      warns.length = 0;
      const noTotal = { name: 'NoTotal', careers_url: 'https://careers.nototal.example', sfVariant: 'csb', max_pages: 3 };
      jobs = await sf.fetch(noTotal, { sleep: async () => {}, robotsGate: allow, fetchText: async () => '', fetchJson: async (_u, o) => { const pn = JSON.parse(o.body).pageNumber; return { jobSearchResult: Array.from({ length: 10 }, (_, i) => rec(String(pn * 10 + i))) }; } });
      if (jobs.length === 30 && warns.length === 1 && /total unknown/.test(warns[0])) pass('successfactors CSB warns when a full page ends at the cap and the API gave no total');
      else fail(`successfactors CSB no-total cap wrong: ${jobs.length} jobs, warns=${JSON.stringify(warns)}`);
      warns.length = 0;
      jobs = await sf.fetch({ name: 'Over', careers_url: 'https://careers.over.example', sfVariant: 'csb' }, { sleep: async () => {}, robotsGate: allow, fetchText: async () => '', fetchJson: async (_u, o) => { const pn = JSON.parse(o.body).pageNumber; return { totalJobs: 5000, jobSearchResult: pn === 0 ? Array.from({ length: 4 }, (_, i) => rec(String(i))) : [] }; } });
      if (jobs.length === 4 && warns.length === 0) pass('successfactors CSB does not warn when a short page ends the read despite an overstated total');
      else fail(`successfactors CSB overstated total wrong: ${jobs.length} jobs, warns=${JSON.stringify(warns)}`);
      // Unflagged CSB entry that opts in: RMK empty -> CSB probe -> full gated read at the entry's limits.
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ name: 'AutoCsb', careers_url: 'https://careers.autocsb.example', max_pages: 200, max_jobs: 5000 }, { ...csbCtx(calls, allow), fetchText: async (u) => (/tile-search/.test(u) ? '<!DOCTYPE html>' : '<a href="/search/?locale=en_US">en</a>') });
      if (jobs.length === TOTAL && warns.length === 0 && calls.n <= 130) pass('successfactors unflagged CSB entry with raised limits is read at those limits after a one-job probe');
      else fail(`successfactors auto-CSB raise wrong: ${jobs.length} jobs, warns=${JSON.stringify(warns)}`);
      // RMK fullness uses raw tile rows: a full last page containing one title-less tile still counts as capped.
      warns.length = 0;
      const badTile = '<li class="job-tile job-id-999999"><a data-url="/job/x/999999/" href="#"></a></li>';
      jobs = await sf.fetch({ name: 'BadTile', careers_url: 'https://jobs.badtile.example' }, { sleep: async () => {}, robotsGate: allow, fetchText: async (u) => { const r = Number(new URL(u).searchParams.get('startrow')); return r === 975 ? tilePage(r).split('</li>').slice(0, 24).join('</li>') + '</li>' + badTile : tilePage(r); } });
      if (warns.length === 1 && /BadTile truncated/.test(warns[0])) pass('successfactors RMK counts source rows, not parsed tiles, when judging a full last page');
      else fail(`successfactors RMK raw-row fullness wrong: ${jobs.length} jobs, warns=${JSON.stringify(warns)}`);
      // RMK raised pages are gated per startrow URL: a rule that allows early offsets but not later ones stops the walk.
      warns.length = 0; calls = { n: 0 };
      jobs = await sf.fetch({ name: 'OffsetRule', careers_url: 'https://jobs.offsetrule.example', max_pages: 60, max_jobs: 5000 }, rmkCtx(calls, async (u) => ({ allowed: Number(new URL(u).searchParams.get('startrow')) < 1100 })));
      if (jobs.length === 1100 && calls.n === 44 && warns.some((w) => /does not allow \/tile-search-results\/\?startrow=1100/.test(w))) pass('successfactors RMK stops a raised walk at the first startrow robots.txt disallows');
      else fail(`successfactors RMK per-offset gate wrong: ${jobs.length} jobs, ${calls.n} calls, warns=${JSON.stringify(warns)}`);
      // 100 rows/page with max_jobs 2500: the default job cap (1000) is reached at page 10, well before page 40, and later offsets are still gated.
      warns.length = 0; calls = { n: 0 };
      const bigPage = (r) => Array.from({ length: 100 }, (_, i) => `<li class="job-tile job-id-${r + i}"><a data-url="/job/x/${r + i}/" class="jobTitle-link" href="#">Role ${r + i}</a></li>`).join('');
      jobs = await sf.fetch({ name: 'BigPages', careers_url: 'https://jobs.bigpages.example', max_pages: 30, max_jobs: 2500 }, { sleep: async () => {}, robotsGate: async (u) => ({ allowed: Number(new URL(u).searchParams.get('startrow')) < 1000 }), fetchText: async (u) => { calls.n++; return bigPage(Number(new URL(u).searchParams.get('startrow'))); } });
      if (jobs.length === 1000 && calls.n === 10 && warns.some((w) => /startrow=1000/.test(w))) pass('successfactors RMK gates each URL once the default job cap is reached, even before the default page cap');
      else fail(`successfactors RMK job-cap gate wrong: ${jobs.length} jobs, ${calls.n} calls, warns=${JSON.stringify(warns)}`);
      // RMK walks by source rows: a malformed tile neither ends the walk nor shifts the next offset.
      const asked = [];
      const bad2 = (id) => `<li class="job-tile job-id-${id}"><a data-url="/job/x/${id}/" href="#"></a></li>`;
      jobs = await sf.fetch({ name: 'Malformed', careers_url: 'https://jobs.malformed.example' }, { sleep: async () => {}, robotsGate: allow, fetchText: async (u) => { const r = Number(new URL(u).searchParams.get('startrow')); asked.push(r); if (r === 0) return bad2(9001) + bad2(9002); if (r === 2) return tilePage(100).split('</li>').slice(0, 5).join('</li>') + '</li>'; return ''; } });
      if (asked.join() === '0,2,7' && jobs.length === 5) pass('successfactors RMK advances by source rows and walks past a page of malformed tiles');
      else fail(`successfactors RMK malformed-tile walk wrong: asked=${asked.join()} jobs=${jobs.length}`);
      // RMK board that ends naturally: no warning.
      warns.length = 0;
      jobs = await sf.fetch({ name: 'SmallCo', careers_url: 'https://jobs.smallco.example' }, { sleep: async () => {}, fetchText: async (u) => (new URL(u).searchParams.get('startrow') === '0' ? tilePage(0) : '') });
      if (jobs.length === 25 && warns.length === 0) pass('successfactors RMK board that ends before the cap does not warn');
      else fail(`successfactors RMK natural end wrong: ${jobs.length} jobs, warns=${JSON.stringify(warns)}`);
    } finally {
      console.error = origErr;
    }
  }
} catch (err) {
  fail(`successfactors provider test threw: ${err.message}`);
}
