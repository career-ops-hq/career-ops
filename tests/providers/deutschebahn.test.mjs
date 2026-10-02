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

  // A full page as the source returns it: PAGE_SIZE hit anchors. Cycling a
  // few ids keeps the fixture's unique postings small while the page still
  // reads as full, the shape tie-order drift produces on the live board.
  const PAGE_SIZE = 1000;
  const fullPage = (ids) => '<html>' + Array.from({ length: PAGE_SIZE }, (_, i) => dbHit(ids[i % ids.length], `Job ${ids[i % ids.length]}`, 'Berlin, Deutschland')).join('') + '</html>';
  if (dbModule.countHitAnchors(fullPage(['1', '2'])) === PAGE_SIZE && dbModule.countHitAnchors(dbHtml) === 2 && dbModule.countHitAnchors(undefined) === 0) pass('deutschebahn.countHitAnchors() counts raw hit anchors, repeats included');
  else fail(`deutschebahn.countHitAnchors() wrong: ${dbModule.countHitAnchors(fullPage(['1', '2']))}`);

  // fetch — paginates ?pageNum=N over full pages, stops on the first empty page.
  const dbPages = [fullPage(['630365', '631112']), fullPage(['700000']), '<html></html>'];
  let dbCalls = 0;
  const dbSeen = [];
  const dbOpts = [];
  const dbCtx = { sleep: async () => {}, fetchText: async (url, opts) => { dbSeen.push(url); dbOpts.push(opts); return dbPages[dbCalls++] ?? '<html></html>'; } };
  const dbJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, dbCtx);
  if (dbJobs.length === 3 && dbCalls === 3) pass('deutschebahn.fetch() paginates and stops on the first empty page');
  else fail(`deutschebahn.fetch() returned ${dbJobs.length} jobs after ${dbCalls} calls`);
  if (dbSeen[0]?.includes('pageNum=0') && dbSeen[1]?.includes('pageNum=1')) pass('deutschebahn.fetch() pages via pageNum=N (0-based)');
  else fail(`deutschebahn.fetch() paged wrong: ${JSON.stringify(dbSeen.map((u) => u.match(/pageNum=\d+/)?.[0]))}`);
  if (dbSeen.every((u) => u.includes(`itemsPerPage=${PAGE_SIZE}`))) pass('deutschebahn.fetch() requests 1000 hits per page');
  else fail(`deutschebahn.fetch() page size wrong: ${JSON.stringify(dbSeen.map((u) => u.match(/itemsPerPage=\d+/)?.[0]))}`);
  if (dbOpts.every((o) => o?.redirect === 'error')) pass('deutschebahn.fetch() passes redirect:\'error\' on every request');
  else fail(`deutschebahn.fetch() redirect option wrong: ${JSON.stringify(dbOpts.map((o) => o?.redirect))}`);
  if (dbOpts.every((o) => o?.timeoutMs >= 30_000)) pass('deutschebahn.fetch() raises the per-request timeout for the multi-megabyte page');
  else fail(`deutschebahn.fetch() timeout wrong: ${JSON.stringify(dbOpts.map((o) => o?.timeoutMs))}`);

  // The stop reads the source's own page size: a short page ends the walk,
  // while a full page whose hits all repeat earlier ones does not.
  let shortCalls = 0;
  const shortJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, { sleep: async () => {}, fetchText: async () => { shortCalls++; return dbHtml; } });
  if (shortJobs.length === 2 && shortCalls === 1) pass('deutschebahn.fetch() stops after a short page');
  else fail(`deutschebahn.fetch() short-page stop wrong: ${shortJobs.length} jobs after ${shortCalls} calls`);
  const repeatPages = [fullPage(['500001']), fullPage(['500001']), fullPage(['500002']), '<html></html>'];
  let repeatCalls = 0;
  const repeatJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, { sleep: async () => {}, fetchText: async () => repeatPages[repeatCalls++] ?? '<html></html>' });
  if (repeatJobs.length === 2 && repeatCalls === 4) pass('deutschebahn.fetch() walks past a full page of repeated hits');
  else fail(`deutschebahn.fetch() repeat-page walk wrong: ${repeatJobs.length} jobs after ${repeatCalls} calls`);

  // MAX_JOBS: one full page of unique postings is the whole scan.
  const uniquePage = fullPage(Array.from({ length: PAGE_SIZE }, (_, i) => String(600000 + i)));
  let capJobsCalls = 0;
  const capJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, { sleep: async () => {}, fetchText: async () => { capJobsCalls++; return uniquePage; } });
  if (capJobs.length === 1000 && capJobsCalls === 1) pass('deutschebahn.fetch() stops at MAX_JOBS after a single full page');
  else fail(`deutschebahn.fetch() MAX_JOBS stop wrong: ${capJobs.length} jobs after ${capJobsCalls} calls`);
  // An empty query sorted by `score` renders a results-less shell, so every
  // page must sort by publication date instead.
  if (dbSeen.every((u) => u.includes('sort=pubExternalDate_tdt') && !u.includes('sort=score'))) pass('deutschebahn.fetch() sorts by pubExternalDate_tdt, never score');
  else fail(`deutschebahn.fetch() sort wrong: ${JSON.stringify(dbSeen.map((u) => u.match(/sort=[^&]*/)?.[0]))}`);

  // parseResultCount — reads the results header, German thousands separator.
  const countHtml = (n) => `<div class="h1 o-searchpage__result-count"><span class="result-count" data-count="${n}">${n} Stellen</span> zu deinen Suchkriterien gefunden</div>`;
  if (dbModule.parseResultCount(countHtml('3.596')) === 3596 && dbModule.parseResultCount(countHtml('0')) === 0) pass('deutschebahn.parseResultCount() parses data-count incl. the thousands separator');
  else fail(`deutschebahn.parseResultCount() wrong: ${dbModule.parseResultCount(countHtml('3.596'))}, ${dbModule.parseResultCount(countHtml('0'))}`);
  if (dbModule.parseResultCount('<html>shell</html>') === null && dbModule.parseResultCount(undefined) === null) pass('deutschebahn.parseResultCount() returns null without a results header');
  else fail('deutschebahn.parseResultCount() should return null without a results header');

  // An empty first page: a genuinely empty search (data-count="0") is [],
  // while a page with no results section or a positive count with no parsed
  // hit throws instead of reading as "DB has no jobs".
  const firstPageOutcome = async (html) => {
    const ctx = { sleep: async () => {}, fetchText: async () => html };
    try {
      const jobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, ctx);
      return { jobs };
    } catch (e) {
      return { error: e.message };
    }
  };
  const emptyBoard = await firstPageOutcome(`<html>${countHtml('0')}<h3>Keine passenden Treffer</h3></html>`);
  if (Array.isArray(emptyBoard.jobs) && emptyBoard.jobs.length === 0) pass('deutschebahn.fetch() returns [] for a genuinely empty search (data-count="0")');
  else fail(`deutschebahn.fetch() empty search wrong: ${JSON.stringify(emptyBoard)}`);
  const shell = await firstPageOutcome('<html><main data-maintenance-mode="false"><h1>Suche</h1></main></html>');
  if (shell.error?.includes('no results section')) pass('deutschebahn.fetch() throws when the first page has no results section');
  else fail(`deutschebahn.fetch() should throw on a results-less first page, got: ${JSON.stringify(shell)}`);
  const markupDrift = await firstPageOutcome(`<html>${countHtml('3.596')}<div class="renamed-hit">x</div></html>`);
  if (markupDrift.error?.includes('3596 postings')) pass('deutschebahn.fetch() throws when the count is positive but no hit parses');
  else fail(`deutschebahn.fetch() should throw on a positive count with no hits, got: ${JSON.stringify(markupDrift)}`);

  // Posting-shaped links the hit selector no longer matches: a renamed hit
  // class keeps the `?jobId=` href, so a zero-count first page carrying one
  // and a later page carrying one both throw instead of ending the walk.
  const driftedHit = (id) => `<a href="/de-de/Suche/Job-1396${id}?jobId=${id}" class="m-renamed-hit" data-job-id="${id}"><span>Job ${id}</span></a>`;
  const zeroWithLinks = await firstPageOutcome(`<html>${countHtml('0')}${driftedHit('900001')}</html>`);
  if (zeroWithLinks.error?.includes('posting links')) pass('deutschebahn.fetch() rejects a data-count="0" first page that still carries posting links');
  else fail(`deutschebahn.fetch() should throw on a zero-count page with posting links, got: ${JSON.stringify(zeroWithLinks)}`);
  let laterCalls = 0;
  const laterCtx = { sleep: async () => {}, fetchText: async () => (++laterCalls === 1 ? fullPage(['630365', '631112']) : `<html>${countHtml('3.596')}${driftedHit('900002')}</html>`) };
  let laterError = null;
  try {
    await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, laterCtx);
  } catch (e) {
    laterError = e.message;
  }
  if (laterError?.includes('posting links') && laterCalls === 2) pass('deutschebahn.fetch() throws when a later page carries posting links but no hit parses');
  else fail(`deutschebahn.fetch() should throw on unparsed posting links past page 0, got error=${JSON.stringify(laterError)} calls=${laterCalls}`);

  // An empty later page: inside the reported total it is a truncated walk
  // (partials kept, warned); at/after the total or without a count it is
  // the natural end of the board (no warning).
  const laterEmpty = async (secondPage) => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      let calls = 0;
      const ctx = { sleep: async () => {}, fetchText: async () => (++calls === 1 ? fullPage(['630365', '631112']) : secondPage) };
      const jobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, ctx);
      return { jobs, warnings };
    } finally {
      console.warn = origWarn;
    }
  };
  const truncated = await laterEmpty(`<html>${countHtml('3.596')}</html>`);
  if (truncated.jobs.length === 2 && truncated.warnings.length === 1 && truncated.warnings[0].includes('3596 postings reported')) pass('deutschebahn.fetch() keeps partials and warns when a page inside the reported total is empty');
  else fail(`deutschebahn.fetch() truncated walk wrong: ${JSON.stringify(truncated)}`);
  const endOfBoard = await laterEmpty(`<html>${countHtml('2')}</html>`);
  const noCount = await laterEmpty('<html><h1>Suche</h1></html>');
  if (endOfBoard.jobs.length === 2 && endOfBoard.warnings.length === 0 && noCount.jobs.length === 2 && noCount.warnings.length === 0) pass('deutschebahn.fetch() ends silently when the offset reached the total or no count is reported');
  else fail(`deutschebahn.fetch() natural end wrong: end=${JSON.stringify(endOfBoard)} noCount=${JSON.stringify(noCount)}`);

  // max_pages safety valve — a small explicit cap stops the walk even though
  // every page keeps returning fresh ids (DB's board runs into the thousands,
  // so this cap is the only thing bounding a runaway scan).
  let capCalls = 0;
  const capCtx = { sleep: async () => {}, fetchText: async () => { capCalls++; return fullPage([String(700100 + capCalls)]); } };
  const cappedJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588', max_pages: 3 }, capCtx);
  if (cappedJobs.length === 3 && capCalls === 3) pass('deutschebahn.fetch() honors entry.max_pages and stops even with more pages available');
  else fail(`deutschebahn.fetch() max_pages cap wrong: ${cappedJobs.length} jobs after ${capCalls} calls`);

  // A transient (no-status) fetch failure is retried via fetchTextWithRetry;
  // the walk recovers instead of dying on a single flaky page.
  let retryCalls = 0;
  const retryCtx = {
    sleep: async () => {},
    fetchText: async () => {
      retryCalls++;
      if (retryCalls === 1) throw new Error('This operation was aborted');
      return dbHit('800001', 'Retried Job', 'Berlin, Deutschland'); // short page: the walk ends here
    },
  };
  const retriedJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, retryCtx);
  if (retriedJobs.length === 1 && retryCalls === 2) pass('deutschebahn.fetch() retries a transient failure and recovers');
  else fail(`deutschebahn.fetch() retry wrong: ${retriedJobs.length} jobs after ${retryCalls} calls`);

  // A deterministic (non-transient) failure — a 4xx other than 429 — must NOT
  // be retried: it is the server telling us the request itself is wrong.
  let noRetryCalls = 0;
  const noRetryCtx = {
    sleep: async () => {},
    fetchText: async () => {
      noRetryCalls++;
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    },
  };
  let dbThrew = false;
  try {
    await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588' }, noRetryCtx);
  } catch {
    dbThrew = true;
  }
  if (dbThrew && noRetryCalls === 1) pass('deutschebahn.fetch() does not retry a non-429 4xx');
  else fail(`deutschebahn.fetch() should fail fast on a 404, got threw=${dbThrew} calls=${noRetryCalls}`);

  // Non-positive/non-integer max_pages falls back to the provider default
  // (5) rather than collapsing to zero pages.
  let fallbackCalls = 0;
  const fallbackCtx = { sleep: async () => {}, fetchText: async () => { fallbackCalls++; return fullPage([String(700200 + fallbackCalls)]); } };
  const fallbackJobs = await db.fetch({ name: 'Deutsche Bahn', api: 'https://db.jobs/service/search/de-de/5441588', max_pages: 0 }, fallbackCtx);
  if (fallbackJobs.length === 5 && fallbackCalls === 5) pass('deutschebahn.fetch() falls back to the default page cap for a non-positive max_pages');
  else fail(`deutschebahn.fetch() max_pages fallback wrong: ${fallbackJobs.length} jobs after ${fallbackCalls} calls`);
} catch (e) {
  fail(`deutschebahn provider tests crashed: ${e.message}`);
}
