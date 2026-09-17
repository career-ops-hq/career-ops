// tests/providers/title-entity-decode.test.mjs — titles must be entity-decoded
// before they reach title_filter (#2921).
//
// Not cosmetic. scan.mjs's buildTitleFilter lowercases and substring-matches,
// so an undecoded "R&amp;D Engineer" fails a positive keyword "r&d" and the
// posting is silently dropped — it never reaches pipeline.md and the user
// never learns it existed. A negative keyword fails the opposite way: the veto
// never fires. Zero-token scanning is what makes this invisible; there is no
// LLM pass downstream that would notice the mangled title.
//
// #2487 fixed this shape in softgarden and radancy; these five were the
// remainder. Numeric entities matter as much as &amp; here: beesite and tkms
// point at DACH postings where "Syst&#232;mes" and "&#8211;" are routine.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const load = (f) => import(pathToFileURL(join(ROOT, `providers/${f}`)).href);

console.log('\nProviders — title entity decoding (#2921)');
try {
  const { buildTitleFilter } = await load('../scan.mjs');

  // The end-to-end claim: the decoded title survives the user's own filter.
  const keepsRnD = buildTitleFilter({ positive: ['r&d'], negative: [] });
  const vetoesSales = buildTitleFilter({ positive: [], negative: ['sales & marketing'] });

  const check = (name, title) => {
    if (title === 'R&D Engineer') pass(`${name} decodes &amp; in the title`);
    else fail(`${name} title is ${JSON.stringify(title)}, want "R&D Engineer"`);
    if (keepsRnD(title)) pass(`${name} title survives a positive "r&d" filter`);
    else fail(`${name} title ${JSON.stringify(title)} was dropped by positive "r&d"`);
  };

  // ── beesite ── (parseSearchResult -> { jobs })
  {
    const { parseSearchResult } = await load('beesite.mjs');
    const json = { SearchResult: { SearchResultCount: 1, SearchResultCountAll: 1, SearchResultItems: [{
      MatchedObjectId: '1',
      MatchedObjectDescriptor: {
        PositionID: 'x1', PositionTitle: 'R&amp;D Engineer',
        PositionURI: 'https://jobs.example.com/a-1',
        PositionLocation: [{ CityName: 'Bremen' }], PublicationStartDate: '2026-07-04',
      },
    }] } };
    const out = parseSearchResult(json);
    check('beesite', (out.jobs ?? out.rows ?? out)[0].title);
  }

  // ── csod ── (parseRequisitions -> array)
  {
    const { parseRequisitions } = await load('csod.mjs');
    const json = { data: { totalCount: 1, requisitions: [
      { requisitionId: 8410, postingEffectiveDate: '7/3/2026', displayJobTitle: 'R&amp;D Engineer', locations: [{ city: 'Bremen', country: 'DE' }] },
    ] } };
    const reqs = parseRequisitions(json, { origin: 'https://career-ohb.csod.com', siteId: 4, corpName: 'career-ohb' });
    check('csod', reqs[0].title);
  }

  // ── tkms ── (parseQuery -> { rows })
  {
    const { parseQuery } = await load('tkms.mjs');
    const json = { totalHits: 1, nextPage: null, jobs: [
      { data: { id: '964694', title: 'R&amp;D Engineer', city: 'Kiel', country: 'Germany' } },
    ] };
    const { rows } = parseQuery(json, { origin: 'https://jobs.tkmsgroup.com', locale: 'en' });
    check('tkms', rows[0].title);
  }

  // ── phenom ── (parseRefineSearch -> { rows }); title AND location
  {
    const { parseRefineSearch, jobLocation } = await load('phenom.mjs');
    const json = { refineSearch: { status: 200, totalHits: 1, data: { jobs: [
      { jobId: '98098', title: 'R&amp;D Engineer', location: 'M&#252;nchen', postedDate: '2026-05-07T18:25:30.000+0000' },
    ] } } };
    const { rows } = parseRefineSearch(json, { origin: 'https://careers.exampleco.com', urlPrefix: 'global/en' });
    check('phenom', rows[0].title);
    const loc = jobLocation({ location: 'M&#252;nchen' });
    if (loc === 'München') pass('phenom decodes a numeric entity in the location');
    else fail(`phenom location is ${JSON.stringify(loc)}, want "München"`);
  }

  // ── the negative side: an undecoded title bypasses the user's veto ──
  if (vetoesSales('Sales & Marketing Lead') === false && vetoesSales('Sales &amp; Marketing Lead') === true) {
    pass('an UNDECODED title bypasses a negative filter (why decoding is a filter fix)');
  } else {
    fail('negative-filter premise no longer holds — buildTitleFilter changed?');
  }

  // ── hackernews: the local map decoded &#39; but no other numeric entity ──
  {
    const hn = await load('hackernews.mjs');
    const out = hn.parseHnComment(
      '<p>Acme GmbH | Softwareentwickler &#8211; R&amp;D | M&#252;nchen | https://acme.example/jobs</p>',
      'https://news.ycombinator.com/item?id=1',
    );
    if (out && out.title.includes('–') && out.title.includes('R&D')) {
      pass('hackernews decodes numeric entities its local 7-form map missed');
    } else {
      fail(`hackernews title is ${JSON.stringify(out && out.title)}`);
    }
    if (out && out.location === 'München') pass('hackernews decodes &#252; in the location');
    else fail(`hackernews location is ${JSON.stringify(out && out.location)}, want "München"`);
  }
} catch (err) {
  fail(`title entity decode suite threw: ${err.message}`);
}
