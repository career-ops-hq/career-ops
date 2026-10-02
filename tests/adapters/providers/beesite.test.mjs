// tests/providers/beesite.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — beesite (milch \& zucker GJB search API)');
try {
  const beesiteModule = await import(pathToFileURL(join(ROOT, 'adapters/node/providers/beesite.mjs')).href);
  const beesite = beesiteModule.default;
  const { resolveConfig: beeConfig, buildSearchUrl, parseBeesiteDate, parseSearchResult } = beesiteModule;

  if (beesite.id === 'beesite') pass('beesite.id is "beesite"');
  else fail(`beesite.id is ${JSON.stringify(beesite.id)}`);

  // resolveConfig — host-anchored, config block passthrough.
  const bCfg = beeConfig({
    api: 'https://mercedes-benz-beesite-production-gjb.app.beesite.de',
    beesite: { languageCode: 'DE', searchCriteria: [{ CriterionName: 'PositionLocation.Country', CriterionValue: [329] }] },
  });
  if (bCfg && bCfg.searchApi === 'https://mercedes-benz-beesite-production-gjb.app.beesite.de/search' && bCfg.languageCode === 'DE' && bCfg.searchCriteria.length === 1) {
    pass('beesite.resolveConfig() parses host and passes the beesite config block through');
  } else {
    fail(`beesite.resolveConfig() wrong: ${JSON.stringify(bCfg)}`);
  }
  if (beesite.detect({ careers_url: 'https://evil.com/x.beesite.de' }) === null && beesite.detect({ careers_url: 'https://beesite.de.evil.com/x' }) === null) {
    pass('beesite.detect() rejects path- and suffix-spoofed hosts');
  } else {
    fail('beesite.detect() should reject spoofed hosts');
  }

  // buildSearchUrl — FirstItem lands in the encoded payload.
  const bUrl = buildSearchUrl(bCfg, 101);
  if (bUrl.startsWith(bCfg.searchApi + '?data=') && decodeURIComponent(bUrl).includes('"FirstItem":101') && decodeURIComponent(bUrl).includes('"CriterionValue":[329]')) {
    pass('beesite.buildSearchUrl() encodes FirstItem and the pinned criteria');
  } else {
    fail(`beesite.buildSearchUrl() wrong: ${bUrl.slice(0, 140)}`);
  }

  if (parseBeesiteDate('2026-07-04') === Date.UTC(2026, 6, 4) && parseBeesiteDate('junk') === undefined) pass('beesite.parseBeesiteDate() reads YYYY-MM-DD, rejects junk');
  else fail('beesite.parseBeesiteDate() wrong');

  // parseSearchResult — id/title/absolute-URL required, cities joined.
  const mkItem = (id, title, uri) => ({ MatchedObjectId: String(id), MatchedObjectDescriptor: { PositionID: `x${id}`, PositionTitle: title, PositionURI: uri, PositionLocation: [{ CityName: 'Bremen' }, { CityName: 'Berlin' }], PublicationStartDate: '2026-07-04' } });
  const beeJson = { SearchResult: { SearchResultCount: 2, SearchResultCountAll: 42, SearchResultItems: [
    mkItem(1, 'IT Architect', 'https://jobs.example.com/a-1'),
    { MatchedObjectId: '2', MatchedObjectDescriptor: { PositionTitle: 'No URI — dropped', PositionURI: '/relative' } },
  ] } };
  const { total: beeTotal, rows: beeRows } = parseSearchResult(beeJson);
  if (beeTotal === 42 && beeRows.length === 1 && beeRows[0].location === 'Bremen / Berlin' && beeRows[0].postedAt === Date.UTC(2026, 6, 4)) {
    pass('beesite.parseSearchResult() maps items, joins cities, drops non-absolute URIs');
  } else {
    fail(`beesite.parseSearchResult() wrong: total=${beeTotal} rows=${JSON.stringify(beeRows)}`);
  }

  // fetch — paginates by FirstItem until SearchResultCountAll, dedups.
  const beePage = (ids) => ({ SearchResult: { SearchResultCount: ids.length, SearchResultCountAll: 150, SearchResultItems: ids.map((i) => mkItem(i, `Job ${i}`, `https://jobs.example.com/j-${i}`)) } });
  const beePages = [beePage(Array.from({ length: 100 }, (_, i) => i + 1)), beePage([100, 101, 102])];
  let beeCalls = 0;
  const beeSeen = [];
  const beeCtx = { sleep: async () => {}, fetchJson: async (url) => { beeSeen.push(decodeURIComponent(url)); return beePages[beeCalls++] ?? beePage([]); } };
  const beeJobs = await beesite.fetch({ name: 'MB', api: 'https://x.app.beesite.de' }, beeCtx);
  if (beeJobs.length === 102 && beeCalls === 2 && beeSeen[1].includes('"FirstItem":101')) pass('beesite.fetch() paginates via FirstItem and dedups across pages');
  else fail(`beesite.fetch() returned ${beeJobs.length} jobs after ${beeCalls} calls`);
  const cappedJobs = await beesite.fetch({ name: 'MB', api: 'https://x.app.beesite.de', max_pages: 1 },
    { sleep: async () => {}, fetchJson: async () => beePages[0] });
  if (cappedJobs.length === 100 && cappedJobs.collectionTruncated === true) pass('beesite.fetch() reports page-capped results');
  else fail('beesite.fetch() silently accepted a page-capped result');
  let pageNumber = 0;
  const largeBoard = await beesite.fetch({ name: 'MB', api: 'https://x.app.beesite.de' },
    { sleep: async () => {}, fetchJson: async () => {
      const first = pageNumber++ * 100;
      return { SearchResult: { SearchResultCount: Math.min(100, 1205 - first), SearchResultCountAll: 1205,
        SearchResultItems: Array.from({ length: Math.max(0, Math.min(100, 1205 - first)) }, (_, i) =>
          mkItem(first + i + 1, `Job ${first + i + 1}`, `https://jobs.example.com/j-${first + i + 1}`)) } };
    } });
  if (largeBoard.length === 1205 && largeBoard.collectionTruncated !== true) pass('beesite.fetch() completes a board above the old 1,000-job limit');
  else fail(`beesite.fetch() lost jobs above 1,000: ${largeBoard.length}`);
} catch (e) {
  fail(`beesite provider tests crashed: ${e.message}`);
}
