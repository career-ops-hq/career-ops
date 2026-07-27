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
} catch (err) {
  fail(`successfactors provider test threw: ${err.message}`);
}
