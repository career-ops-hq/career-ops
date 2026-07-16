// tests/providers/dassault.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — dassault (Exalead card_search_api XML parser)');
try {
  const dassaultModule = await import(pathToFileURL(join(ROOT, 'providers/dassault.mjs')).href);
  const dassault = dassaultModule.default;
  const { parseHits, buildUrl } = dassaultModule;

  if (dassault.id === 'dassault') pass('dassault.id is "dassault"');
  else fail(`dassault.id is ${JSON.stringify(dassault.id)}`);

  // Build a minimal Exalead <Hit> block from field values.
  const mkHit = (f) => {
    const meta = (n, v) => (v === undefined ? '' : `<Meta name="${n}"><MetaString name="value">${v}</MetaString></Meta>`);
    return `<Hit did="d" url="x">${'<groups>ignored</groups>'}<metas>` +
      meta('content_title', f.title) +
      meta('content_cta_1_url', f.cta1) +
      meta('content_categories', f.cats) +
      meta('card_id', f.id) +
      meta('content_start_datetime', f.start) +
      meta('card_update_timestamp', f.update) +
      `</metas></Hit>`;
  };

  // Happy path — 2 distinct hits: entity decode, location parse, date fields.
  const xmlA = `<Answer nhits="2"><hits>` +
    mkHit({ id: '111', title: 'Software Engineer &amp; Data', cta1: 'https://www.3ds.com/careers/jobs/x-111?a=1&amp;b=2', cats: 'Category/R&amp;D Type/Regular Country/Germany City/Germany, Munich Products/CATIA Year/4 to 5 years', update: '2026/07/03 18:22:13' }) +
    mkHit({ id: '222', title: 'Data Scientist', cta1: 'https://www.3ds.com/careers/jobs/y-222', cats: 'Category/Sales Type/Regular Country/France City/France, Vélizy-Villacoublay Products/DELMIA', start: '2026/06/01 09:00:00' }) +
    `</hits></Answer>`;
  const a = parseHits(xmlA, 'Dassault Systèmes');
  if (a.length === 2) pass('dassault.parseHits() extracts 2 jobs');
  else fail(`dassault.parseHits() returned ${a.length} jobs`);

  if (a[0]?.title === 'Software Engineer & Data') pass('dassault.parseHits() decodes &amp; in title');
  else fail(`title = ${JSON.stringify(a[0]?.title)}`);

  if (a[0]?.url === 'https://www.3ds.com/careers/jobs/x-111?a=1&b=2') pass('dassault.parseHits() decodes &amp; in url');
  else fail(`url = ${JSON.stringify(a[0]?.url)}`);

  if (a[0]?.location === 'Germany, Munich') pass('dassault.parseHits() parses City from content_categories');
  else fail(`location = ${JSON.stringify(a[0]?.location)}`);

  if (a[0]?.company === 'Dassault Systèmes') pass('dassault.parseHits() sets company from entry name');
  else fail(`company = ${JSON.stringify(a[0]?.company)}`);

  // postedAt: hit 0 falls back to card_update_timestamp; hit 1 prefers content_start_datetime.
  if (a[0]?.postedAt === Date.UTC(2026, 6, 3, 18, 22, 13)) pass('dassault.parseHits() postedAt falls back to card_update_timestamp');
  else fail(`postedAt[0] = ${JSON.stringify(a[0]?.postedAt)}`);

  if (a[1]?.postedAt === Date.UTC(2026, 5, 1, 9, 0, 0)) pass('dassault.parseHits() postedAt prefers content_start_datetime');
  else fail(`postedAt[1] = ${JSON.stringify(a[1]?.postedAt)}`);

  if (a[1]?.location === 'France, Vélizy-Villacoublay') pass('dassault.parseHits() parses multi-word City value');
  else fail(`location[1] = ${JSON.stringify(a[1]?.location)}`);

  // parseHits carries an internal _id for cross-page dedup; fetch() strips it (asserted below).
  if ('_id' in a[0]) pass('dassault.parseHits() exposes internal _id for cross-page dedup');
  else fail('dassault.parseHits() should carry _id for the fetch loop');

  // Dedup by card_id — two hits with the same id collapse to one job.
  const xmlDup = `<Answer><hits>` +
    mkHit({ id: '333', title: 'Role A', cta1: 'https://www.3ds.com/careers/jobs/a-333' }) +
    mkHit({ id: '333', title: 'Role A (dup)', cta1: 'https://www.3ds.com/careers/jobs/a-333' }) +
    `</hits></Answer>`;
  const dup = parseHits(xmlDup, 'Dassault Systèmes');
  if (dup.length === 1) pass('dassault.parseHits() dedups by card_id');
  else fail(`dassault.parseHits() dedup returned ${dup.length} jobs`);

  // Safety net — a non-3ds.com posting (aggregated third-party content) is dropped.
  const xmlForeign = `<Answer><hits>` +
    mkHit({ id: '444', title: 'Real 3DS Job', cta1: 'https://www.3ds.com/careers/jobs/real-444' }) +
    mkHit({ id: 'abc', title: 'External Aggregated Job', cta1: 'https://careers.bcit.ca/postings/10516' }) +
    `</hits></Answer>`;
  const foreign = parseHits(xmlForeign, 'Dassault Systèmes');
  if (foreign.length === 1 && foreign[0].title === 'Real 3DS Job') pass('dassault.parseHits() drops non-3ds.com postings');
  else fail(`dassault.parseHits() foreign filter returned ${JSON.stringify(foreign.map(j => j.title))}`);

  // Empty / hit-less XML → []
  if (parseHits('', 'X').length === 0 && parseHits('<Answer nhits="0"><hits></hits></Answer>', 'X').length === 0) {
    pass('dassault.parseHits() returns [] for empty / hit-less XML');
  } else {
    fail('dassault.parseHits() should return [] for empty / hit-less XML');
  }

  // buildUrl — both refinements + start offset, correctly encoded.
  const u = buildUrl(20);
  if (u.includes('start=20') && u.includes('card_content_type%2Fcareer') && u.includes('cards+language%2Fen')) {
    pass('dassault.buildUrl() emits both refinements and the start offset');
  } else {
    fail(`dassault.buildUrl(20) = ${u}`);
  }

  // detect — *.3ds.com matches by host; spoofs and non-strings return null.
  if (dassault.detect({ careers_url: 'https://www.3ds.com/careers/jobs' })) pass('dassault.detect() matches www.3ds.com');
  else fail('dassault.detect() should match www.3ds.com');

  if (dassault.detect({ api: 'https://talentacquisition.3ds.com/x' })) pass('dassault.detect() matches *.3ds.com subdomains');
  else fail('dassault.detect() should match *.3ds.com');

  if (dassault.detect({ careers_url: 'https://evil.com/x.3ds.com' }) === null) pass('dassault.detect() rejects path-spoofed host');
  else fail('dassault.detect() should reject path-spoofed host');

  if (dassault.detect({ careers_url: 'https://3ds.com.evil.com/x' }) === null) pass('dassault.detect() rejects suffix-spoofed host');
  else fail('dassault.detect() should reject suffix-spoofed host');

  if (dassault.detect({ careers_url: 42 }) === null && dassault.detect({}) === null) pass('dassault.detect() returns null for non-string / missing url');
  else fail('dassault.detect() should return null for non-string / missing url');

  // fetch — paginates via mock ctx, dedups across pages, stops on empty page.
  const pages = [
    `<Answer><hits>${mkHit({ id: 'p1', title: 'A', cta1: 'https://www.3ds.com/careers/jobs/a-p1' })}${mkHit({ id: 'p2', title: 'B', cta1: 'https://www.3ds.com/careers/jobs/b-p2' })}</hits></Answer>`,
    `<Answer><hits>${mkHit({ id: 'p2', title: 'B dup', cta1: 'https://www.3ds.com/careers/jobs/b-p2' })}${mkHit({ id: 'p3', title: 'C', cta1: 'https://www.3ds.com/careers/jobs/c-p3' })}</hits></Answer>`,
    `<Answer><hits></hits></Answer>`,
  ];
  let calls = 0;
  const mockCtx = { fetchText: async () => pages[calls++] ?? '<Answer><hits></hits></Answer>' };
  const fetched = await dassault.fetch({ name: 'Dassault Systèmes' }, mockCtx);
  if (fetched.length === 3 && new Set(fetched.map(j => j.url)).size === 3) pass('dassault.fetch() paginates and dedups across pages');
  else fail(`dassault.fetch() returned ${fetched.length} jobs (${JSON.stringify(fetched.map(j => j.title))})`);

  if (fetched.every(j => !('_id' in j))) pass('dassault.fetch() strips the internal _id from returned jobs');
  else fail('dassault.fetch() leaked _id into returned jobs');

} catch (e) {
  fail(`dassault provider tests crashed: ${e.message}`);
}
