// tests/providers/deutschebahn.test.mjs — db.jobs search-fragment parser.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — deutschebahn (db.jobs search-fragment parser)');
try {
  const dbModule = await import(pathToFileURL(join(ROOT, 'providers/deutschebahn.mjs')).href);
  const db = dbModule.default;
  const { resolveConfig: dbConfig, parseHits: dbParseHits } = dbModule;

  if (db.id === 'deutschebahn') pass('deutschebahn.id is "deutschebahn"');
  else fail(`deutschebahn.id is ${JSON.stringify(db.id)}`);

  // resolveConfig — pins the search id from the URL, defaults when absent.
  const dbCfg = dbConfig({ api: 'https://db.jobs/service/search/de-de/5441588' });
  if (dbCfg && dbCfg.searchBase === 'https://db.jobs/service/search/de-de/5441588') pass('deutschebahn.resolveConfig() pins the search id from the URL');
  else fail(`deutschebahn.resolveConfig() wrong: ${JSON.stringify(dbCfg)}`);
  if (db.detect({ careers_url: 'https://evil.com/x.db.jobs' }) === null && db.detect({ careers_url: 'https://db.jobs.evil.com/x' }) === null) {
    pass('deutschebahn.detect() rejects spoofed hosts');
  } else {
    fail('deutschebahn.detect() should reject spoofed hosts');
  }

  // parseHits — the real markup shape: an <a class="m-search-hit" data-job-id>
  // wrapping the title span and an Arbeitsort <li>.
  const dbHit = (id, title, loc) =>
    `<div class="o-searchpage__item o-searchpage__item--careers"><a href="/de-de/Suche/${title.replace(/[^A-Za-z]+/g, '-')}-1396${id}?jobId=${id}" aria-label="Zum Stellenangebot" class="m-search-hit" data-job-id="${id}" data-unpub-external-date="31.12.2026"><header class="m-search-hit__header"><h3 class="m-search-hit__title"><span class="m-search-hit__title-text" > ${title} </span><span class="m-search-hit__badge">neu</span></h3></header><ul class="m-search-hit__items"><li class="m-search-hit__item"><i class="g-ficon" aria-label="Arbeitsort"></i> ${loc} </li><li class="m-search-hit__item"><i aria-label="Arbeitgeber:in"></i> DB InfraGO AG </li></ul></a></div>`;
  const dbHtml = '<html>' + dbHit('630365', 'Teilprojektleiter:in Tunnel / Logistik', 'München, Deutschland') + dbHit('631112', 'Bauleiter:in Vegetation', 'Koblenz, Deutschland') + '</html>';
  const dbRows = dbParseHits(dbHtml, 'https://db.jobs');
  if (dbRows.length === 2) pass('deutschebahn.parseHits() yields one row per m-search-hit anchor');
  else fail(`deutschebahn.parseHits() returned ${dbRows.length}, expected 2`);
  if (dbRows[0]?.title === 'Teilprojektleiter:in Tunnel / Logistik' && dbRows[0]?.location === 'München, Deutschland') pass('deutschebahn.parseHits() extracts the title span and the Arbeitsort location');
  else fail(`deutschebahn.parseHits() fields wrong: ${JSON.stringify(dbRows[0])}`);
  if (dbRows[0]?.url === 'https://db.jobs/de-de/Suche/Teilprojektleiter-in-Tunnel-Logistik-1396630365?jobId=630365') pass('deutschebahn.parseHits() builds the absolute posting URL');
  else fail(`deutschebahn.parseHits() url wrong: ${JSON.stringify(dbRows[0]?.url)}`);
  if (dbParseHits('<html>no hits</html>', 'https://db.jobs').length === 0 && dbParseHits(undefined, 'https://db.jobs').length === 0) pass('deutschebahn.parseHits() returns [] for hit-less / non-string input');
  else fail('deutschebahn.parseHits() should return [] without hits');

  // decodeEntities (exercised via parseHits) — a malformed/out-of-range
  // numeric entity (a lone surrogate half) must degrade to the literal text,
  // never throw RangeError and abort the whole parse.
  const badHtml = '<html>' + dbHit('700001', 'Bad&#xD800;Entity', 'Berlin, Deutschland') + '</html>';
  const badRows = dbParseHits(badHtml, 'https://db.jobs');
  if (badRows.length === 1 && badRows[0].title === 'Bad&#xD800;Entity') pass('deutschebahn.parseHits() tolerates an invalid numeric entity (no RangeError crash)');
  else fail(`deutschebahn.parseHits() should degrade a malformed entity to literal text, got: ${JSON.stringify(badRows)}`);

  // fetch — paginates ?pageNum=N, stops on the first no-fresh-ids page.
  const dbPages = [dbHtml, '<html>' + dbHit('700000', 'C', 'Berlin, Deutschland') + '</html>', '<html></html>'];
  let dbCalls = 0;
  const dbSeen = [];
  const dbCtx = { sleep: async () => {}, fetchText: async (url) => { dbSeen.push(url); return dbPages[dbCalls++] ?? '<html></html>'; } };
  const dbJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, dbCtx);
  if (dbJobs.length === 3 && dbCalls === 3) pass('deutschebahn.fetch() paginates and stops on the first empty page');
  else fail(`deutschebahn.fetch() returned ${dbJobs.length} jobs after ${dbCalls} calls`);
  if (dbSeen[0]?.includes('pageNum=0') && dbSeen[1]?.includes('pageNum=1')) pass('deutschebahn.fetch() pages via pageNum=N (0-based)');
  else fail(`deutschebahn.fetch() paged wrong: ${JSON.stringify(dbSeen.map((u) => u.match(/pageNum=\d+/)?.[0]))}`);

  // max_pages safety valve — a small explicit cap stops the walk even though
  // every page keeps returning fresh ids (DB's board runs into the thousands,
  // so this cap is the only thing bounding a runaway scan).
  let capCalls = 0;
  const capCtx = { sleep: async () => {}, fetchText: async () => { capCalls++; return dbHit(String(700100 + capCalls), `Job ${capCalls}`, 'Berlin, Deutschland'); } };
  const cappedJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588', max_pages: 3 }, capCtx);
  if (cappedJobs.length === 3 && capCalls === 3) pass('deutschebahn.fetch() honors entry.max_pages and stops even with more pages available');
  else fail(`deutschebahn.fetch() max_pages cap wrong: ${cappedJobs.length} jobs after ${capCalls} calls`);

  // Non-positive/non-integer max_pages falls back to the provider default
  // (60) rather than collapsing to zero pages.
  let fallbackCalls = 0;
  const fallbackCtx = { sleep: async () => {}, fetchText: async () => { fallbackCalls++; return fallbackCalls <= 5 ? dbHit(String(700200 + fallbackCalls), `Job ${fallbackCalls}`, 'Berlin, Deutschland') : '<html></html>'; } };
  const fallbackJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588', max_pages: 0 }, fallbackCtx);
  if (fallbackJobs.length === 5 && fallbackCalls === 6) pass('deutschebahn.fetch() falls back to the default page cap for a non-positive max_pages');
  else fail(`deutschebahn.fetch() max_pages fallback wrong: ${fallbackJobs.length} jobs after ${fallbackCalls} calls`);
} catch (e) {
  fail(`deutschebahn provider tests crashed: ${e.message}`);
}
