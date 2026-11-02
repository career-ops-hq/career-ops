// tests/providers/notion.test.mjs — direct provider-contract tests.
//
// A public Notion page on `<workspace>.notion.site` is read through the two
// same-origin endpoints the published page calls itself, `loadPageChunk` and
// (for a database) `queryCollection` — see the header comment in
// providers/notion.mjs for both shapes.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — notion');

const ORIGIN = 'https://acme.notion.site';
const PAGE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PAGE_HEX = PAGE.replace(/-/g, '');
const SPACE = '5a5a5a5a-0000-4000-8000-000000000000';
const COLL = 'c0c0c0c0-0000-4000-8000-000000000000';
const VIEW1 = 'e1e1e1e1-0000-4000-8000-000000000000';
const VIEW2 = 'e2e2e2e2-0000-4000-8000-000000000000';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.UTC(2026, 8, 1);

/** A recordMap entry in the newer wrapping, `{ spaceId, value: { role, value } }`. */
const rec = (value) => ({ spaceId: SPACE, value: { role: 'reader', value } });
/** The same in the older wrapping, `{ role, value }`. */
const recOld = (value) => ({ role: 'reader', value });
const page = (bid, title, extra = {}) => ({ id: bid, type: 'page', alive: true, created_time: T0, properties: { title: [[title]] }, ...extra });

// A plain page: two child pages, a text block, a column layout holding a third
// posting, and an inline mention of a fourth page that lives elsewhere.
function pageChunk() {
  return {
    recordMap: {
      block: {
        [PAGE]: rec({ id: PAGE, type: 'page', space_id: SPACE, properties: { title: [['Careers']] },
          content: [id(1), id(9), id(2), id(3), id(5), id(99)] }),
        [id(1)]: rec(page(id(1), 'Smart Contract Engineer')),
        [id(2)]: recOld(page(id(2), 'Backend Engineer')),
        [id(9)]: rec({ id: id(9), type: 'text', properties: { title: [['Open roles']] } }),
        [id(3)]: rec({ id: id(3), type: 'column_list', content: [id(4)] }),
        [id(4)]: rec({ id: id(4), type: 'column', content: [id(6)] }),
        [id(6)]: rec(page(id(6), 'Protocol Engineer')),
        [id(5)]: rec({ id: id(5), type: 'text', properties: { title: [['‣', [['p', id(7), SPACE]]]] } }),
        [id(7)]: rec(page(id(7), 'Rust Engineer', { parent_id: 'elsewhere' })),
        // id(99) referenced but not loaded: counted as missing.
      },
    },
  };
}

function dbChunk(rootType = 'collection_view_page') {
  return {
    recordMap: {
      block: {
        [PAGE]: rec({ id: PAGE, type: rootType, space_id: SPACE, collection_id: COLL, view_ids: [VIEW1, VIEW2] }),
      },
      collection_view: {
        [VIEW1]: rec({ id: VIEW1, type: 'table', query2: { filter: { operator: 'and', filters: [{ property: 'st', filter: { operator: 'enum_is', value: { type: 'exact', value: 'Open' } } }] } } }),
        [VIEW2]: rec({ id: VIEW2, type: 'board' }),
      },
    },
  };
}

function dbRows(blockIds = [id(11), id(12), id(13)]) {
  return {
    result: { type: 'reducer', reducerResults: { collection_group_results: { type: 'results', blockIds } } },
    recordMap: {
      collection: {
        [COLL]: rec({ id: COLL, schema: { title: { name: 'Name', type: 'title' }, 'Op_}': { name: 'Location', type: 'multi_select' } } }),
      },
      block: {
        [id(11)]: rec(page(id(11), 'Solidity Engineer', { parent_table: 'collection', properties: { title: [['Solidity Engineer']], 'Op_}': [['Remote,Europe']] } })),
        [id(12)]: rec(page(id(12), '', { parent_table: 'collection' })), // no title → dropped
        [id(13)]: rec(page(id(13), 'Designer', { parent_table: 'collection', alive: false })), // deleted → dropped
      },
    },
  };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/notion.mjs')).href);
  const notion = mod.default;
  const { resolvePage, unwrapRecord, parsePageChunk, parseCollectionRows } = mod;

  if (notion.id === 'notion') pass('notion.id is "notion"');
  else fail(`notion.id is ${JSON.stringify(notion.id)}`);

  // detect(): any *.notion.site URL that carries a page id.
  const API = `${ORIGIN}/api/v3/loadPageChunk`;
  const positives = [
    `${ORIGIN}/Careers-${PAGE_HEX}`,
    `${ORIGIN}/${PAGE_HEX}?v=${VIEW1.replace(/-/g, '')}`,
    `${ORIGIN}/p/${PAGE_HEX}`,
    `${ORIGIN}/${PAGE}`,
    `${ORIGIN}/acme/Careers-${PAGE_HEX.toUpperCase()}?pvs=25`,
  ];
  const posOk = positives.every((u) => notion.detect({ name: 'Acme', careers_url: u })?.url === API);
  if (posOk) pass('notion.detect() resolves slug, bare-id, /p/ and dashed-uuid notion.site URLs → loadPageChunk');
  else fail(`notion.detect() missed one of ${JSON.stringify(positives)}`);

  const junk = [
    { name: 'X', careers_url: `https://acme.notion.site/job-board` },                    // no page id
    { name: 'X', careers_url: `http://acme.notion.site/${PAGE_HEX}` },                   // non-https
    { name: 'X', careers_url: `https://example.com/${PAGE_HEX}` },                       // other host
    { name: 'X', careers_url: `https://acme.notion.site.evil.example/${PAGE_HEX}` },     // suffix spoof
    { name: 'X', careers_url: `https://evilnotion.site/${PAGE_HEX}` },                   // missing dot
    { name: 'X', careers_url: `https://evil.example/acme.notion.site/${PAGE_HEX}` },     // path spoof
    { name: 'X', careers_url: 'not a url' },
    { name: 'X', careers_url: null },
    { name: 'X', careers_url: 7 },
    { name: 'X' },
  ];
  let junkOk = true;
  for (const e of junk) {
    try {
      if (notion.detect(e) !== null) { junkOk = false; fail(`notion.detect() should be null for ${JSON.stringify(e.careers_url)}`); }
    } catch (err) {
      junkOk = false;
      fail(`notion.detect() threw for ${JSON.stringify(e.careers_url)}: ${err.message}`);
    }
  }
  if (junkOk) pass('notion.detect() returns null (no throw) for id-less paths, other hosts, spoofs, non-https, junk and missing careers_url');

  const r = resolvePage({ careers_url: `https://acme.notion.site:8443/Careers-${PAGE_HEX}?v=${VIEW2.replace(/-/g, '')}` });
  if (r?.origin === ORIGIN && r.pageId === PAGE && r.viewId === VIEW2) pass('resolvePage rebuilds the origin (drops the port) and reads the page id and ?v= view');
  else fail(`resolvePage returned ${JSON.stringify(r)}`);

  if (unwrapRecord(rec({ id: 'a' }))?.id === 'a' && unwrapRecord(recOld({ id: 'b' }))?.id === 'b' && unwrapRecord(null) === null) {
    pass('unwrapRecord reads both record wrappings');
  } else {
    fail('unwrapRecord should read { spaceId, value: { role, value } } and { role, value }');
  }

  // Plain page: child pages, columns and inline mentions, in reading order.
  const parsed = parsePageChunk(pageChunk(), { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' });
  const titles = parsed.jobs.map((j) => j.title).join(' | ');
  if (titles === 'Smart Contract Engineer | Backend Engineer | Protocol Engineer | Rust Engineer' && parsed.missing === 1 && parsed.collection === null) {
    pass('parsePageChunk reads child pages, column layouts and inline page mentions in order, counting unloaded blocks');
  } else {
    fail(`parsePageChunk: ${titles}, missing ${parsed.missing}`);
  }
  const j0 = parsed.jobs[0];
  if (j0.url === `${ORIGIN}/${id(1).replace(/-/g, '')}` && j0.company === 'Acme' && j0.location === '' && j0.postedAt === T0) {
    pass('a posting links to <origin>/<bare page id> and carries created_time as postedAt');
  } else {
    fail(`parsePageChunk job shape: ${JSON.stringify(j0)}`);
  }

  // fetch() on a plain page: one request, POST, redirect:'error'; warns about unloaded blocks.
  const calls = [];
  const { result: pageJobs, errors: pageErrors } = await captureConsoleErrors(() => notion.fetch(
    { name: 'Acme', careers_url: `${ORIGIN}/Careers-${PAGE_HEX}` },
    { fetchJson: async (url, o) => { calls.push({ url, o }); return pageChunk(); } },
  ));
  const body0 = JSON.parse(calls[0]?.o?.body ?? '{}');
  if (calls.length === 1 && calls[0].url === API && calls[0].o.method === 'POST' && calls[0].o.redirect === 'error'
      && body0.pageId === PAGE && pageJobs.length === 4) {
    pass('notion.fetch() reads a plain page with one POST to loadPageChunk, redirect:"error"');
  } else {
    fail(`notion.fetch() plain page: ${JSON.stringify(calls)}`);
  }
  if (pageErrors.some((e) => /1 child block/.test(e))) pass('notion.fetch() warns when referenced blocks were not loaded');
  else fail(`notion.fetch() should warn about unloaded blocks: ${JSON.stringify(pageErrors)}`);

  // fetch() on a database: loadPageChunk then queryCollection, with the chosen view's filter.
  for (const rootType of ['collection_view_page', 'collection_view']) {
    const dbCalls = [];
    const rows = await notion.fetch(
      { name: 'Acme', careers_url: `${ORIGIN}/${PAGE_HEX}` },
      { fetchJson: async (url, o) => { dbCalls.push({ url, o }); return dbCalls.length === 1 ? dbChunk(rootType) : dbRows(); } },
    );
    const q = JSON.parse(dbCalls[1]?.o?.body ?? '{}');
    if (dbCalls.length === 2 && dbCalls.every((c) => c.o.redirect === 'error' && c.o.method === 'POST')
        && dbCalls[1].url === `${ORIGIN}/api/v3/queryCollection?src=initial_load`
        && q.source?.id === COLL && q.source?.spaceId === SPACE && q.collectionView?.id === VIEW1
        && q.loader?.filter?.filters?.[0]?.property === 'st'
        && rows.length === 1 && rows[0].title === 'Solidity Engineer' && rows[0].location === 'Remote · Europe') {
      pass(`notion.fetch() queries a ${rootType} with the view's own filter (redirect:"error"), drops untitled and deleted rows`);
    } else {
      fail(`notion.fetch() ${rootType}: ${JSON.stringify({ q, rows })}`);
    }
  }

  // ?v= picks that view (VIEW2 has no filter, so none is sent).
  const vCalls = [];
  await notion.fetch(
    { name: 'Acme', careers_url: `${ORIGIN}/${PAGE_HEX}?v=${VIEW2.replace(/-/g, '')}` },
    { fetchJson: async (url, o) => { vCalls.push(JSON.parse(o.body)); return vCalls.length === 1 ? dbChunk() : dbRows(); } },
  );
  if (vCalls[1]?.collectionView?.id === VIEW2 && !('filter' in vCalls[1].loader)) pass('notion.fetch() honors the ?v= view in careers_url');
  else fail(`notion.fetch() ?v=: ${JSON.stringify(vCalls[1])}`);

  // An inline database on a page (the page block carries a collection_view child).
  const inline = pageChunk();
  inline.recordMap.block[PAGE].value.value.content = [id(9), id(20)];
  inline.recordMap.block[id(20)] = rec({ id: id(20), type: 'collection_view', space_id: SPACE, collection_id: COLL, view_ids: [VIEW1] });
  inline.recordMap.collection_view = dbChunk().recordMap.collection_view;
  const inlineParsed = parsePageChunk(inline, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' });
  if (inlineParsed.collection?.collectionId === COLL && inlineParsed.collection.viewId === VIEW1) pass('parsePageChunk finds an inline database on the page');
  else fail(`parsePageChunk inline database: ${JSON.stringify(inlineParsed)}`);

  // A "link to page" block resolves to its target page.
  const linked = pageChunk();
  linked.recordMap.block[PAGE].value.value.content = [id(30)];
  linked.recordMap.block[id(30)] = rec({ id: id(30), type: 'alias', format: { alias_pointer: { id: id(7), spaceId: SPACE } } });
  const linkedParsed = parsePageChunk(linked, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' });
  if (linkedParsed.jobs.map((j) => j.title).join(' | ') === 'Rust Engineer') pass('parsePageChunk follows a "link to page" (alias) block to its target');
  else fail(`parsePageChunk alias block: ${JSON.stringify(linkedParsed.jobs)}`);

  // Empty vs broken.
  const emptyPage = pageChunk();
  emptyPage.recordMap.block[PAGE].value.value.content = [id(9)];
  const emptyRows = parseCollectionRows(dbRows([]), { collectionId: COLL, origin: ORIGIN, companyName: 'Acme' });
  if (parsePageChunk(emptyPage, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' }).jobs.length === 0
      && emptyRows.jobs.length === 0 && emptyRows.rawCount === 0) {
    pass('a page with no postings and a database with no rows both return []');
  } else {
    fail('empty page / empty database should return []');
  }

  const broken = [
    ['loadPageChunk null', () => parsePageChunk(null, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' })],
    ['loadPageChunk {}', () => parsePageChunk({}, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' })],
    ['page id absent', () => parsePageChunk({ recordMap: { block: {} } }, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' })],
    ['root is a text block', () => parsePageChunk({ recordMap: { block: { [PAGE]: rec({ id: PAGE, type: 'text' }) } } }, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' })],
    ['database without view_ids', () => parsePageChunk({ recordMap: { block: { [PAGE]: rec({ id: PAGE, type: 'collection_view_page', space_id: SPACE, collection_id: COLL }) } } }, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' })],
    ['database view record absent', () => { const c = dbChunk(); delete c.recordMap.collection_view; return parsePageChunk(c, { pageId: PAGE, viewId: null, origin: ORIGIN, companyName: 'Acme' }); }],
    ['queryCollection {}', () => parseCollectionRows({}, { collectionId: COLL, origin: ORIGIN, companyName: 'Acme' })],
    ['queryCollection blockIds null', () => parseCollectionRows({ result: { reducerResults: { collection_group_results: { blockIds: null } } } }, { collectionId: COLL, origin: ORIGIN, companyName: 'Acme' })],
  ];
  const notThrown = [];
  for (const [label, run] of broken) {
    try { run(); notThrown.push(label); } catch (e) { if (!/^notion: /.test(e.message)) notThrown.push(`${label} (${e.message})`); }
  }
  if (notThrown.length === 0) pass('a missing envelope, an absent page or view record and an unknown root type throw a descriptive notion: error');
  else fail(`should throw: ${notThrown.join('; ')}`);

  // Allowlist guard: a careers_url that is not a notion.site page throws before any request.
  let badCalled = false;
  let badThrew = false;
  try {
    await notion.fetch({ name: 'Acme', careers_url: `https://acme.notion.site.evil.example/${PAGE_HEX}` },
      { fetchJson: async () => { badCalled = true; return pageChunk(); } });
  } catch {
    badThrew = true;
  }
  if (badThrew && !badCalled) pass('notion.fetch() throws without calling fetchJson for a non-notion.site careers_url');
  else fail(`notion.fetch() bad entry: threw=${badThrew}, fetchJson called=${badCalled}`);

  // Probe: a rejection while ctx.maxPages is set propagates unwrapped.
  class FakeProbeBudget extends Error {}
  let probeErr = null;
  try {
    await notion.fetch({ name: 'Acme', careers_url: `${ORIGIN}/${PAGE_HEX}` },
      { maxPages: 1, fetchJson: async () => { throw new FakeProbeBudget('budget'); } });
  } catch (e) {
    probeErr = e;
  }
  if (probeErr instanceof FakeProbeBudget) pass('notion.fetch() propagates a ctx.fetchJson rejection unwrapped under a probe');
  else fail(`notion.fetch() probe rejection: ${probeErr}`);

  // A row id that is not a uuid (e.g. a lone surrogate) drops that posting only.
  const odd = dbRows([id(11), 'bad\uD800']);
  odd.recordMap.block['bad\uD800'] = rec(page('bad\uD800', 'Odd', { parent_table: 'collection' }));
  const oddJobs = parseCollectionRows(odd, { collectionId: COLL, origin: ORIGIN, companyName: 'Acme' }).jobs;
  if (oddJobs.length === 1 && oddJobs[0].title === 'Solidity Engineer') pass('a malformed row id drops that posting, not the board');
  else fail(`malformed id: ${JSON.stringify(oddJobs)}`);
} catch (e) {
  fail(`notion provider tests crashed: ${e.stack || e.message}`);
}
