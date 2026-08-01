// tests/providers/phenom.test.mjs — Phenom People CareerConnect widgets API.
import { pass, fail, ROOT } from '../helpers.mjs';
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
  const phCfg = phConfig({ api: 'https://careers.allianz.com', phenom: { lang: 'en_global', country: 'global', urlPrefix: 'global/en', selectedFields: { country: ['Germany'] } } });
  if (
    phCfg && phCfg.widgetsApi === 'https://careers.allianz.com/widgets' && phCfg.urlPrefix === 'global/en' && phCfg.selectedFields.country[0] === 'Germany'
  ) {
    pass('phenom.resolveConfig() parses origin and the phenom config block');
  } else {
    fail(`phenom.resolveConfig() wrong: ${JSON.stringify(phCfg)}`);
  }
  const phDefault = phConfig({ careers_url: 'https://x.example.com' });
  if (phDefault && phDefault.lang === 'en_global' && phDefault.country === 'global' && phDefault.urlPrefix === 'global/en') pass('phenom.resolveConfig() applies en_global/global/urlPrefix defaults');
  else fail(`phenom.resolveConfig() defaults wrong: ${JSON.stringify(phDefault)}`);

  // detect — hostname-anchored (not a raw-string regex): only literal
  // *.phenompeople.com; branded tenants wire explicitly. A URL that merely
  // contains "phenompeople.com" in its path/query on a different host must
  // NOT match.
  if (phenom.detect({ api: 'https://x.phenompeople.com/y' })) pass('phenom.detect() matches *.phenompeople.com');
  else fail('phenom.detect() should match phenompeople.com');
  if (phenom.detect({ careers_url: 'https://careers.allianz.com' }) === null) pass('phenom.detect() returns null for branded hosts (wire explicitly)');
  else fail('phenom.detect() should not auto-claim a branded host');
  if (phenom.detect({ careers_url: 'https://evil.com/x?y=phenompeople.com' }) === null) pass('phenom.detect() rejects a host that merely contains "phenompeople.com" in path/query');
  else fail('phenom.detect() should check the hostname, not the raw URL string');
  if (phenom.detect({ careers_url: 'https://phenompeople.com.evil.com/x' }) === null) pass('phenom.detect() rejects suffix-spoofed host');
  else fail('phenom.detect() should reject suffix-spoofed host');

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
  const { total: phTotal, rows: phRows } = parseRefineSearch(phJson, { origin: 'https://careers.allianz.com', urlPrefix: 'global/en' });
  if (phTotal === 42 && phRows.length === 2) pass('phenom.parseRefineSearch() reads totalHits and drops id/title-less records');
  else fail(`phenom.parseRefineSearch() wrong: total=${phTotal} rows=${phRows.length}`);
  if (phRows[0]?.url === 'https://careers.allianz.com/global/en/job/98098/Sr-Analyst') pass('phenom.parseRefineSearch() builds the {origin}/{prefix}/job/{id}/{slug} URL');
  else fail(`phenom.parseRefineSearch() url wrong: ${JSON.stringify(phRows[0]?.url)}`);
  if (phRows[1]?.url === 'https://careers.allianz.com/global/en/job/12%2F34/Slash-Id') pass('phenom.parseRefineSearch() percent-encodes a jobId path segment');
  else fail(`phenom.parseRefineSearch() encoding wrong: ${JSON.stringify(phRows[1]?.url)}`);

  // fetch — paginates by from/size until totalHits, dedups, sends the facet.
  const mkJob = (id) => ({ jobId: String(id), title: `Job ${id}`, location: 'Germany', postedDate: '2026-05-07T18:25:30.000+0000' });
  const phPage = (ids) => ({ refineSearch: { status: 200, totalHits: 150, data: { jobs: ids.map(mkJob) } } });
  const phPages = [phPage(Array.from({ length: 100 }, (_, i) => i + 1)), phPage([100, 101, 102])];
  let phCalls = 0;
  let phSawFacet = null;
  const phCtx = { sleep: async () => {}, fetchJson: async (url, opts) => { const b = JSON.parse(opts.body); phSawFacet = b.selected_fields; if (b.from !== phCalls * 100) throw new Error('bad from offset'); return phPages[phCalls++] ?? phPage([]); } };
  const phJobs = await phenom.fetch({ name: 'Allianz', api: 'https://careers.allianz.com', phenom: { selectedFields: { country: ['Germany'] } } }, phCtx);
  if (phJobs.length === 102 && phCalls === 2 && new Set(phJobs.map((j) => j.url)).size === 102) pass('phenom.fetch() paginates via from/size and dedups across pages');
  else fail(`phenom.fetch() returned ${phJobs.length} jobs after ${phCalls} calls`);
  if (phSawFacet && phSawFacet.country?.[0] === 'Germany') pass('phenom.fetch() forwards selected_fields facet filters');
  else fail(`phenom.fetch() dropped the facet: ${JSON.stringify(phSawFacet)}`);

  // fetch — a mid-scan failure preserves jobs already collected, never
  // discards earlier pages.
  let partialCalls = 0;
  const partialCtx = {
    sleep: async () => {},
    fetchJson: async () => {
      partialCalls++;
      if (partialCalls === 1) return phPage(Array.from({ length: 100 }, (_, i) => i + 1));
      throw new Error('network blip on page 2');
    },
  };
  const partialJobs = await phenom.fetch({ name: 'Allianz', api: 'https://careers.allianz.com' }, partialCtx);
  if (partialJobs.length === 100 && partialCalls === 2) pass('phenom.fetch() preserves jobs from earlier pages when a later page fetch throws');
  else fail(`phenom.fetch() partial-failure handling wrong: ${partialJobs.length} jobs after ${partialCalls} calls`);
} catch (e) {
  fail(`phenom provider tests crashed: ${e.message}`);
}
