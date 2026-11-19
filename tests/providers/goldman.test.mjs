// tests/providers/goldman.test.mjs — goldman provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — goldman');

const SITE = 'https://higher.gs.com/results';
const ENDPOINT = 'https://api-higher.gs.com/gateway/api/v1/graphql';

const item = (id, title, locations = [{ primary: true, city: 'New York', state: 'New York', country: 'United States' }]) => ({
  roleId: `${id}_GS`,
  jobTitle: title,
  locations,
  externalSource: { sourceId: id },
});

/** A board of `total` roles, served 100 per page. */
function boardCtx(total, calls, extra = {}) {
  return {
    transport: 'http',
    sleep: async () => {},
    fetchText: async () => { throw new Error('fetchText must not be called'); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const vars = JSON.parse(opts.body).variables.searchQueryInput;
      const start = vars.page.pageNumber * vars.page.pageSize;
      const n = Math.max(0, Math.min(vars.page.pageSize, total - start));
      const items = Array.from({ length: n }, (_, i) => item(String(100000 + start + i), `Role ${start + i}`));
      return { data: { roleSearch: { totalCount: total, items } } };
    },
    ...extra,
  };
}

async function quiet(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { return { result: await fn(), lines }; } finally { console.error = orig; }
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/goldman.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'goldman') pass('goldman.id is "goldman"');
  else fail(`goldman.id is ${JSON.stringify(provider.id)}`);

  // ── detect() ──
  const hit = provider.detect({ name: 'Acme', careers_url: SITE });
  if (hit?.url === ENDPOINT) pass('goldman.detect() claims the higher.gs.com careers URL');
  else fail(`goldman.detect() = ${JSON.stringify(hit)}`);
  if (provider.detect({ name: 'Acme', provider: 'goldman' })?.url === ENDPOINT) pass('goldman.detect() honors an explicit provider: goldman');
  else fail('goldman.detect() ignored provider: goldman');
  const rejects = [
    'https://evil.example.com/higher.gs.com/results',
    'https://higher.gs.com.evil.example.com/results',
    'http://higher.gs.com/results',
    'not a url',
  ].map((u) => provider.detect({ name: 'Acme', careers_url: u }));
  const junk = [null, 7, undefined].map((v) => provider.detect({ name: 'Acme', careers_url: v }));
  if ([...rejects, ...junk].every((r) => r === null)) pass('goldman.detect() rejects hijacks, http, malformed and non-string URLs without throwing');
  else fail(`goldman.detect() rejects: ${JSON.stringify([...rejects, ...junk])}`);

  // ── fetch(): normalization, redirect, request shape ──
  const calls = [];
  const rows = await provider.fetch({ name: 'Acme', careers_url: SITE }, {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      return { data: { roleSearch: { totalCount: 4, items: [
        item('187325', '  Strategy Associate  ', [
          { primary: false, city: 'London', country: 'United Kingdom' },
          { primary: true, city: 'New York', state: 'New York', country: 'United States' },
        ]),
        item('187326', ''),
        { roleId: 'x', jobTitle: 'No id', externalSource: {} },
        null,
      ] } } };
    },
  });
  if (rows.length === 1 && rows[0].title === 'Strategy Associate'
      && rows[0].url === 'https://higher.gs.com/roles/187325'
      && rows[0].location === 'New York, New York, United States; London, United Kingdom'
      && rows[0].externalId === '187325' && !('postedAt' in rows[0])) {
    pass('goldman.fetch() normalizes a role (title trimmed, primary location first, role URL) and skips rows without a title or id');
  } else {
    fail(`goldman.fetch() rows = ${JSON.stringify(rows)}`);
  }
  const req = calls[0];
  const sent = req ? JSON.parse(req.opts.body) : null;
  if (calls.length === 1 && req.url === ENDPOINT && req.opts.redirect === 'error' && req.opts.method === 'POST'
      && sent.operationName === 'GetRoles'
      && JSON.stringify(sent.variables.searchQueryInput.experiences) === JSON.stringify(['PROFESSIONAL', 'EARLY_CAREER', 'CAMPUS'])
      && !('origin' in (req.opts.headers || {})) && !('referer' in (req.opts.headers || {}))) {
    pass('goldman.fetch() POSTs GetRoles with redirect:"error", all public experiences, and no borrowed origin/referer');
  } else {
    fail(`goldman.fetch() request = ${JSON.stringify(req)}`);
  }

  // listingIdentity: the exact triple, and the same posting at a second URL is already seen.
  const { isOfferSeen, markOfferSeen, listingIdentityToken } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const id = rows[0]?.listingIdentity;
  if (id?.ats_provider === 'goldman' && id?.board_slug === 'higher.gs.com' && id?.posting_id === '187325' && Object.keys(id).length === 3) {
    pass('goldman.fetch() returns the goldman/higher.gs.com/<sourceId> listingIdentity');
  } else {
    fail(`goldman listingIdentity = ${JSON.stringify(id)}`);
  }
  const seen = new Set();
  markOfferSeen(rows[0], seen);
  const sameElsewhere = { ...rows[0], url: 'https://higher.gs.com/roles/187325?utm=share&ref=search' };
  const sameElsewhere2 = { ...rows[0], url: 'https://www.goldmansachs.com/careers/roles/187325' };
  if (isOfferSeen(sameElsewhere2, seen) && isOfferSeen(sameElsewhere, seen)) pass('the same Goldman role at another URL is already seen');
  else fail('the same Goldman role at another URL was not recognised');
  const other = { ...rows[0], url: 'https://higher.gs.com/roles/187399', listingIdentity: { ats_provider: 'goldman', board_slug: 'higher.gs.com', posting_id: '187399' } };
  if (listingIdentityToken(other) !== listingIdentityToken(rows[0]) && !isOfferSeen(other, seen)) pass('a different sourceId is a different listing');
  else fail('a different sourceId collided');

  // experiences config
  const narrowCalls = [];
  await provider.fetch({ name: 'Acme', careers_url: SITE, goldman: { experiences: ['professional', 'EARLY_CAREER'] } }, boardCtx(5, narrowCalls));
  const narrow = JSON.parse(narrowCalls[0].opts.body).variables.searchQueryInput.experiences;
  if (JSON.stringify(narrow) === JSON.stringify(['PROFESSIONAL', 'EARLY_CAREER'])) pass('goldman.experiences narrows the request (case-insensitive)');
  else fail(`goldman.experiences sent ${JSON.stringify(narrow)}`);
  let badThrew = 0;
  for (const bad of [['INTERNAL_MOBILITY'], ['PROFESIONAL'], [], 'CAMPUS']) {
    const before = narrowCalls.length;
    try {
      await provider.fetch({ name: 'Acme', careers_url: SITE, goldman: { experiences: bad } }, boardCtx(5, narrowCalls));
    } catch (e) {
      if (/goldman/.test(e.message) && narrowCalls.length === before) badThrew++;
    }
  }
  if (badThrew === 4) pass('goldman.experiences rejects internal-only, misspelled, empty and non-list values before any request');
  else fail(`goldman.experiences bad values: ${badThrew}/4 threw before fetching`);

  // ── empty vs broken ──
  const empty = await provider.fetch({ name: 'Acme', careers_url: SITE }, {
    sleep: async () => {}, fetchJson: async () => ({ data: { roleSearch: { totalCount: 0, items: [] } } }),
  });
  if (Array.isArray(empty) && empty.length === 0 && !empty.truncated) pass('goldman.fetch() returns [] for a present-and-empty roleSearch.items');
  else fail(`empty board = ${JSON.stringify(empty)}`);
  let brokenThrew = 0;
  for (const body of [null, 'x', {}, { data: {} }, { data: { roleSearch: { items: null } } }, { errors: [{ message: 'Validation error' }] }]) {
    try {
      await provider.fetch({ name: 'Acme', careers_url: SITE }, { sleep: async () => {}, fetchJson: async () => body });
    } catch (e) {
      if (/goldman/.test(e.message)) brokenThrew++;
    }
  }
  if (brokenThrew === 6) pass('goldman.fetch() throws a named error for a non-object, a missing envelope, a null list and a GraphQL error');
  else fail(`goldman broken shapes: ${brokenThrew}/6 threw`);

  // ── pagination ──
  const fullCalls = [];
  const full = await quiet(() => provider.fetch({ name: 'Acme', careers_url: SITE }, boardCtx(936, fullCalls)));
  if (full.result.length === 936 && fullCalls.length === 10 && !full.result.truncated && full.lines.length === 0
      && fullCalls.every((c) => c.opts.redirect === 'error')) {
    pass('goldman.fetch() reads a 936-role board to its short last page, untruncated, redirect:"error" on every page');
  } else {
    fail(`full board: ${full.result.length} roles in ${fullCalls.length} calls, lines ${JSON.stringify(full.lines)}`);
  }
  const exactCalls = [];
  const exact = await quiet(() => provider.fetch({ name: 'Acme', careers_url: SITE }, boardCtx(300, exactCalls)));
  if (exact.result.length === 300 && exactCalls.length === 4 && !exact.result.truncated) pass('goldman.fetch() ends an exact-multiple board on its empty page');
  else fail(`exact board: ${exact.result.length} in ${exactCalls.length} calls`);
  const capCalls = [];
  const capped = await quiet(() => provider.fetch({ name: 'Acme', careers_url: SITE }, boardCtx(50000, capCalls)));
  if (capCalls.length === 20 && capped.result.length === 2000 && capped.result.truncated?.reason === 'page-cap'
      && capped.result.truncated?.total === 50000 && capped.lines.length === 1 && capped.lines[0].includes('raise max_pages')) {
    pass('goldman.fetch() stops at DEFAULT_MAX_PAGES even when totalCount reports more, and marks the board page-cap');
  } else {
    fail(`cap: ${capCalls.length} calls, ${capped.result.length} roles, ${JSON.stringify(capped.result.truncated)}, ${JSON.stringify(capped.lines)}`);
  }
  const optCalls = [];
  await quiet(() => provider.fetch({ name: 'Acme', careers_url: SITE, max_pages: 5000 }, boardCtx(50000, optCalls)));
  if (optCalls.length === 100) pass('goldman max_pages is clamped to the hard ceiling');
  else fail(`max_pages ceiling: ${optCalls.length} calls`);
  // totalCount understating the board never ends the walk early.
  const underCalls = [];
  const underCtx = boardCtx(450, underCalls);
  const realFetch = underCtx.fetchJson;
  underCtx.fetchJson = async (url, opts) => { const r = await realFetch(url, opts); r.data.roleSearch.totalCount = 200; return r; };
  const under = await quiet(() => provider.fetch({ name: 'Acme', careers_url: SITE }, underCtx));
  if (under.result.length === 450 && !under.result.truncated) pass('goldman.fetch() never treats totalCount as the end of the board');
  else fail(`understated total: ${under.result.length} roles`);
  // A server that ignores pageNumber ends the walk instead of looping.
  const loopCalls = [];
  const loop = await quiet(() => provider.fetch({ name: 'Acme', careers_url: SITE }, {
    sleep: async () => {},
    fetchJson: async (url, opts) => { loopCalls.push(opts); return { data: { roleSearch: { totalCount: 5000, items: Array.from({ length: 100 }, (_, i) => item(String(i), `R${i}`)) } } }; },
  }));
  if (loopCalls.length === 2 && loop.result.length === 100) pass('goldman.fetch() stops when a page brings nothing new');
  else fail(`ignored pageNumber: ${loopCalls.length} calls, ${loop.result.length} roles`);

  // ── probe ──
  const probeCalls = [];
  const probe = await quiet(() => provider.fetch({ name: 'Acme', careers_url: SITE }, boardCtx(936, probeCalls, { maxPages: 1 })));
  if (probeCalls.length === 1 && probe.result.length === 100 && !probe.result.truncated && probe.lines.length === 0) {
    pass('goldman.fetch() reads exactly one page under ctx.maxPages: 1, silently');
  } else {
    fail(`probe: ${probeCalls.length} calls, ${JSON.stringify(probe.lines)}`);
  }
  class ProbeStop extends Error {}
  let stop = null;
  try {
    await provider.fetch({ name: 'Acme', careers_url: SITE }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw new ProbeStop('budget'); } });
  } catch (e) { stop = e; }
  if (stop instanceof ProbeStop) pass('goldman.fetch() propagates a ctx.fetchJson rejection unwrapped during a probe');
  else fail(`probe rejection = ${stop}`);

  // ── transient failure mid-walk: retried, then loud ──
  let attempts = 0;
  const flaky = boardCtx(936, []);
  const okFetch = flaky.fetchJson;
  flaky.fetchJson = async (url, opts) => {
    const page = JSON.parse(opts.body).variables.searchQueryInput.page.pageNumber;
    if (page === 2) { attempts++; throw Object.assign(new Error('HTTP 503'), { status: 503 }); }
    return okFetch(url, opts);
  };
  let flakyErr = null;
  const flakyRun = await quiet(async () => {
    try { return await provider.fetch({ name: 'Acme', careers_url: SITE }, flaky); } catch (e) { flakyErr = e; return null; }
  });
  if (flakyErr && attempts > 1 && !flakyRun.lines.some((l) => l.includes('raise max_pages'))) {
    pass('goldman.fetch() retries a 503 mid-walk, then fails loud without the "raise max_pages" warning');
  } else {
    fail(`mid-walk 503: err=${flakyErr}, attempts=${attempts}, lines=${JSON.stringify(flakyRun.lines)}`);
  }

  // safeEncodeURIComponent: a lone-surrogate id is dropped, the clean row kept.
  const enc = await provider.fetch({ name: 'Acme', careers_url: SITE }, {
    sleep: async () => {},
    fetchJson: async () => ({ data: { roleSearch: { totalCount: 2, items: [item('\uD800bad', 'Bad'), item('a b/1', 'Spaced')] } } }),
  });
  if (enc.length === 1 && enc[0].url === 'https://higher.gs.com/roles/a%20b%2F1') pass('goldman role URLs go through safeEncodeURIComponent (bad id dropped, clean id escaped)');
  else fail(`encoding: ${JSON.stringify(enc)}`);

  // A full page whose rows are all malformed is a distinct page, not a repeat:
  // the walk goes on and reads the valid page after it.
  const badCalls = [];
  const badPage = Array.from({ length: 100 }, (_, i) => ({ roleId: `b${i}`, jobTitle: '', externalSource: { sourceId: String(500000 + i) } }));
  const afterBad = await provider.fetch({ name: 'Acme', careers_url: SITE }, {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      badCalls.push(opts);
      const page = JSON.parse(opts.body).variables.searchQueryInput.page.pageNumber;
      if (page === 0) return { data: { roleSearch: { totalCount: 105, items: badPage } } };
      if (page === 1) return { data: { roleSearch: { totalCount: 105, items: [item('600001', 'After the bad page')] } } };
      return { data: { roleSearch: { totalCount: 105, items: [] } } };
    },
  });
  if (badCalls.length === 2 && afterBad.length === 1 && afterBad[0].title === 'After the bad page') {
    pass('goldman.fetch() pages past a full page of malformed rows and reads the next page');
  } else {
    fail(`malformed page: ${badCalls.length} calls, rows ${JSON.stringify(afterBad.map((r) => r.title))}`);
  }

  // The same malformed page served for every pageNumber is a repeat and ends the walk.
  const repeatCalls = [];
  await provider.fetch({ name: 'Acme', careers_url: SITE }, {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url, opts) => { repeatCalls.push(opts); return { data: { roleSearch: { totalCount: 900, items: badPage } } }; },
  });
  if (repeatCalls.length === 2) pass('goldman.fetch() ends the walk when the same raw page comes back');
  else fail(`repeated malformed page: ${repeatCalls.length} calls`);

  // Ids that cannot form a role URL, padded ids, and separate locations.
  const odd = await provider.fetch({ name: 'Acme', careers_url: SITE }, {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async () => ({ data: { roleSearch: { totalCount: 5, items: [
      item('..', 'Dot dot'),
      item('.', 'Dot'),
      item(' 187400 ', 'Padded'),
      item('187401', 'Two places', [
        { primary: true, city: 'New York', state: 'New York', country: 'United States' },
        { primary: false, city: 'London', country: 'United Kingdom' },
        { primary: false, city: 'London', country: 'United Kingdom' },
      ]),
      item('187402', 'No place', []),
    ] } } }),
  });
  const byTitle = Object.fromEntries(odd.map((r) => [r.title, r]));
  if (!byTitle['Dot dot'] && !byTitle.Dot) pass('goldman.fetch() skips ids "." and ".." that cannot form a role URL');
  else fail(`dot ids kept: ${JSON.stringify(odd.map((r) => r.url))}`);
  const padded = byTitle.Padded;
  if (padded && !('listingIdentity' in padded) && padded.externalId === ' 187400 ') {
    pass('goldman.fetch() keeps a padded-id row for URL dedup but omits its listingIdentity');
  } else {
    fail(`padded id row = ${JSON.stringify(padded)}`);
  }
  const two = byTitle['Two places'];
  if (two && JSON.stringify(two.locations) === JSON.stringify(['New York, New York, United States', 'London, United Kingdom'])
      && two.location === 'New York, New York, United States; London, United Kingdom'
      && byTitle['No place'] && !('locations' in byTitle['No place'])) {
    pass('goldman.fetch() returns separate, deduplicated locations and omits the key when there are none');
  } else {
    fail(`locations = ${JSON.stringify(two)} / ${JSON.stringify(byTitle['No place'])}`);
  }
} catch (e) {
  fail(`goldman provider tests crashed: ${e.stack || e.message}`);
}
