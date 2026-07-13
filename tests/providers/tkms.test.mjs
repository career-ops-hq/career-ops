// tests/providers/tkms.test.mjs — TKMS filter/query JSON API.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — tkms (filter/query JSON API)');
try {
  const tkmsModule = await import(pathToFileURL(join(ROOT, 'providers/tkms.mjs')).href);
  const tkms = tkmsModule.default;
  const { resolveConfig: tkConfig, slugify: tkSlug, parseTkmsDate, tkmsLocation, parseQuery } = tkmsModule;

  if (tkms.id === 'tkms') pass('tkms.id is "tkms"');
  else fail(`tkms.id is ${JSON.stringify(tkms.id)}`);

  const tkCfg = tkConfig({ api: 'https://jobs.tkmsgroup.com/en', tkms: { subclient: 'tkms', locale: 'en' } });
  if (tkCfg && tkCfg.queryApi === 'https://jobs.tkmsgroup.com/api/filter/query' && tkCfg.subclient === 'tkms' && tkCfg.locale === 'en') {
    pass('tkms.resolveConfig() parses host, subclient, locale');
  } else {
    fail(`tkms.resolveConfig() wrong: ${JSON.stringify(tkCfg)}`);
  }
  if (tkms.detect({ careers_url: 'https://evil.com/x.jobs.tkmsgroup.com' }) === null && tkms.detect({ careers_url: 'https://jobs.tkmsgroup.com.evil.com/x' }) === null) {
    pass('tkms.detect() rejects spoofed hosts');
  } else {
    fail('tkms.detect() should reject spoofed hosts');
  }

  // resolveConfig — HTTPS-only. The API fetch uses redirect: 'error', so a
  // plain-HTTP origin would both send the request in cleartext and hard-fail
  // on any HTTPS redirect; reject it up front instead.
  if (tkConfig({ api: 'http://jobs.tkmsgroup.com/en' }) === null) pass('tkms.resolveConfig() rejects a plain-HTTP origin');
  else fail('tkms.resolveConfig() should reject http:');

  if (tkSlug('Systemingenieur IT (m/w/d)') === 'Systemingenieur-IT-m-w-d') pass('tkms.slugify() builds a clean slug');
  else fail(`tkms.slugify() wrong: ${tkSlug('Systemingenieur IT (m/w/d)')}`);

  if (parseTkmsDate({ postingDate_timestamp: 1783029600 }) === 1783029600000) pass('tkms.parseTkmsDate() prefers the epoch-seconds timestamp');
  else fail('tkms.parseTkmsDate() timestamp wrong');
  if (parseTkmsDate({ postingDate: '2026-07-02T22:00:00' }) === Date.parse('2026-07-02T22:00:00Z')) pass('tkms.parseTkmsDate() falls back to the ISO stamp (as UTC)');
  else fail('tkms.parseTkmsDate() ISO fallback wrong');

  if (tkmsLocation({ locations: [{ cityState: 'Kiel, Schleswig-Holstein' }, { cityState: 'Emden, Lower Saxony' }] }) === 'Kiel, Schleswig-Holstein / Emden, Lower Saxony') pass('tkms.tkmsLocation() joins the locations array');
  else fail('tkms.tkmsLocation() array join wrong');
  if (tkmsLocation({ city: 'Kiel', country: 'Germany' }) === 'Kiel, Germany') pass('tkms.tkmsLocation() falls back to flat city/country');
  else fail('tkms.tkmsLocation() flat fallback wrong');

  // parseQuery — id/title required; URL from origin+locale+slug+id, with the
  // locale and id path segments percent-encoded.
  const tkJson = { totalHits: 330, nextPage: 1, jobs: [
    { data: { id: '964694', title: 'Schiffbauer (m/w/d)', city: 'Kiel', country: 'Germany', postingDate_timestamp: 1783029600, locations: [{ cityState: 'Kiel, Schleswig-Holstein' }] } },
    { data: { id: '', title: 'No id' } },
    { data: { id: '5', title: '' } },
    { data: { id: '12/34', title: 'Slash Id' } },
  ] };
  const { total: tkTotal, nextPage: tkNext, rows: tkRows } = parseQuery(tkJson, { origin: 'https://jobs.tkmsgroup.com', locale: 'en' });
  if (tkTotal === 330 && tkNext === 1 && tkRows.length === 2) pass('tkms.parseQuery() reads total/nextPage and drops id/title-less records');
  else fail(`tkms.parseQuery() wrong: total=${tkTotal} next=${tkNext} rows=${tkRows.length}`);
  if (tkRows[0]?.url === 'https://jobs.tkmsgroup.com/en/job/Schiffbauer-m-w-d/964694') pass('tkms.parseQuery() builds {origin}/{locale}/job/{slug}/{id}');
  else fail(`tkms.parseQuery() url wrong: ${JSON.stringify(tkRows[0]?.url)}`);
  if (tkRows[1]?.url === 'https://jobs.tkmsgroup.com/en/job/Slash-Id/12%2F34') pass('tkms.parseQuery() percent-encodes an id path segment');
  else fail(`tkms.parseQuery() encoding wrong: ${JSON.stringify(tkRows[1]?.url)}`);

  // fetch — paginates by page until nextPage===null, dedups, sends subclient.
  const tkPage = (ids, next) => ({ totalHits: 40, nextPage: next, jobs: ids.map((i) => ({ data: { id: String(i), title: `Job ${i}`, city: 'Kiel', country: 'Germany' } })) });
  const tkPages = [tkPage([1, 2], 1), tkPage([2, 3], null)];
  let tkCalls = 0;
  let tkSawSub = null;
  const tkCtx = { sleep: async () => {}, fetchJson: async (url, opts) => { const b = JSON.parse(opts.body); tkSawSub = b.subclient; if (b.page !== tkCalls) throw new Error('bad page'); return tkPages[tkCalls++] ?? tkPage([], null); } };
  const tkJobs = await tkms.fetch({ name: 'TKMS', api: 'https://jobs.tkmsgroup.com/en' }, tkCtx);
  if (tkJobs.length === 3 && tkCalls === 2 && tkSawSub === 'tkms') pass('tkms.fetch() paginates via page/nextPage, dedups, sends subclient');
  else fail(`tkms.fetch() returned ${tkJobs.length} jobs after ${tkCalls} calls (sub=${tkSawSub})`);
} catch (e) {
  fail(`tkms provider tests crashed: ${e.message}`);
}
