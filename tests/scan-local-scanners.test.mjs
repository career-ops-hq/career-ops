import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slugify, decodeHtml,
  createLocalGate, writeRunLog,
} from '../scan-local-lib.mjs';
import { companyRoleDedupKey } from '../scan.mjs';
import { normalizeCompanyName } from '../invite-match.mjs';
import {
  buildSeekUrl, parseSeekPage, extractReduxJson,
  scanSeekSearch, loadSearches as seekSearches,
} from '../scan-seek.mjs';
import { PORTAL_TOP_LEVEL_KEYS, portalTopLevelTypos } from '../validate-portals.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ── fixtures (no network) ────────────────────────────────────────────

const SEEK_HTML = `<html><script>window.SEEK_REDUX_DATA = ${JSON.stringify({
  results: { results: { jobs: [
    { id: '81000001', title: 'Senior Data Analyst', advertiser: { description: 'Kiwi Power &amp; Light' },
      location: 'Wellington Central, Wellington', salaryLabel: '$110k - $130k', listingDate: '2026-11-02T01:00:00Z',
      teaser: 'Join our "insights" team', workTypes: ['Full time'] },
    { id: '81000002', title: 'Data Analyst', advertiser: { description: 'Harbour Council' }, location: 'Auckland' },
    { id: '81000001', title: 'Senior Data Analyst', advertiser: { description: 'Kiwi Power &amp; Light' } },
  ] }, other: 'a } brace in a string', missing: undefined },
})};</script></html>`;

test('slugify and decodeHtml', () => {
  assert.strictEqual(slugify('Data  Analyst / BI'), 'data-analyst-bi');
  assert.strictEqual(slugify('Māori Liaison'), 'maori-liaison');
  assert.strictEqual(decodeHtml(' A &amp; B <b>x</b> '), 'A & B x');
  // &amp; must resolve AFTER other entities so &amp;lt; → &lt;, not <
  assert.strictEqual(decodeHtml('&amp;lt;'), '&lt;');
  // out-of-range numeric entity is left as-is (no RangeError)
  assert.strictEqual(decodeHtml('&#99999999;'), '&#99999999;');
});

test('local gate: title, seen URL, same-role dedup within and across runs', () => {
  const gate = createLocalGate({
    gateOptions: {
      titleFilter: (t) => /engineer/i.test(t),
      locationFilter: () => true,
      blacklist: new Map(),
      seen: new Set(),
    },
    seenRoles: new Set(),
  });
  const a = { url: 'https://seek.test/job/1', company: 'Xero Ltd', title: 'Platform Engineer', location: 'Auckland' };
  assert.strictEqual(gate.check(a), null);
  // Same role on another board: different URL, same company+role.
  assert.strictEqual(gate.check({ ...a, url: 'https://linkedin.test/jobs/view/9' }), 'duplicate-role');
  assert.strictEqual(gate.check({ ...a, url: 'https://x.test/3', title: 'Chef' }), 'title');
  assert.strictEqual(gate.check(a), 'seen');
  assert.strictEqual(gate.counts.duplicateRole, 1);
  assert.strictEqual(gate.counts.admitted, 1);

  const known = createLocalGate({
    gateOptions: { titleFilter: () => true, locationFilter: () => true, blacklist: new Map(), seen: new Set() },
    seenRoles: new Set([gate.roleKey(a)]),
  });
  assert.strictEqual(known.check({ ...a, url: 'https://y.test/1' }), 'duplicate-role');
});

test('a locationless seen role still blocks a located local offer, and another city does not', () => {
  const open = {
    titleFilter: () => true,
    locationFilter: () => true,
    blacklist: new Map(),
    seen: new Set(),
  };
  const config = { location_filter: { workplace_policy: { onsite_locations: ['Harbor Bay'] } } };
  const bare = companyRoleDedupKey('Lumenfield', 'Automation Analyst', normalizeCompanyName);
  const blocked = createLocalGate({
    config,
    gateOptions: open,
    seenRoles: new Set([bare]),
  });
  assert.strictEqual(
    blocked.check({ url: 'https://boards.example/jobs/1', company: 'Lumenfield', title: 'Automation Analyst', location: 'Harbor Bay' }),
    'duplicate-role',
  );

  const pebble = companyRoleDedupKey('Lumenfield', 'Automation Analyst', normalizeCompanyName, 'Pebbleford, TX');
  const otherCity = createLocalGate({
    config,
    gateOptions: { ...open, seen: new Set() },
    seenRoles: new Set([pebble]),
  });
  assert.strictEqual(
    otherCity.check({ url: 'https://boards.example/jobs/2', company: 'Lumenfield', title: 'Automation Analyst', location: 'Harbor Bay' }),
    null,
  );
});

test('a located role blocks a later offer with no city, and a different city still comes through', () => {
  const open = {
    titleFilter: () => true,
    locationFilter: () => true,
    blacklist: new Map(),
    seen: new Set(),
  };
  const config = { location_filter: { workplace_policy: { onsite_locations: ['Harbor Bay'] } } };
  const harbor = { url: 'https://boards.example/jobs/1', company: 'Lumenfield', title: 'Automation Analyst', location: 'Harbor Bay' };
  const noCity = { url: 'https://boards.example/jobs/2', company: 'Lumenfield', title: 'Automation Analyst' };
  const pebble = { url: 'https://boards.example/jobs/3', company: 'Lumenfield', title: 'Automation Analyst', location: 'Pebbleford, TX' };

  const locatedFirst = createLocalGate({ config, gateOptions: open, seenRoles: new Set() });
  assert.strictEqual(locatedFirst.check(harbor), null);
  assert.strictEqual(locatedFirst.check(noCity), 'duplicate-role');
  assert.strictEqual(locatedFirst.check(pebble), null);

  const bareFirst = createLocalGate({
    config,
    gateOptions: { ...open, seen: new Set() },
    seenRoles: new Set(),
  });
  assert.strictEqual(bareFirst.check(noCity), null);
  assert.strictEqual(bareFirst.check({ ...harbor, url: 'https://boards.example/jobs/4' }), 'duplicate-role');
});

test('writeRunLog appends a scan-runs.tsv row stats.mjs can read by header name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-scan-'));
  try {
    const file = join(dir, 'data', 'scan-runs.tsv');
    await writeRunLog({
      found: 12, newAdded: 3, queries: 2, errors: 1,
      counts: { title: 4, location: 1, seen: 2, duplicateRole: 1, blacklisted: 1 },
    }, file);
    const [header, row] = readFileSync(file, 'utf-8').trim().split('\n');
    const cols = header.split('\t');
    const cells = row.split('\t');
    const get = (name) => cells[cols.indexOf(name)];
    assert.strictEqual(cells.length, cols.length);
    assert.strictEqual(get('status'), 'completed');
    assert.strictEqual(get('found'), '12');
    assert.strictEqual(get('new_added'), '3');
    assert.strictEqual(get('dupes'), '3');
    assert.strictEqual(get('filtered_title'), '4');
    assert.strictEqual(get('filtered_blacklist'), '1');
    assert.strictEqual(get('errors'), '1');
    assert.ok(!Number.isNaN(Date.parse(get('timestamp'))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── scan-seek ────────────────────────────────────────────────────────

test('seek URL resolves known NZ locations and canonical in- paths, rejects unknown plain locations, and omits query string on page 1 without daterange', () => {
  assert.strictEqual(buildSeekUrl({ keyword: 'Data Analyst', location: 'Wellington' }),
    'https://nz.seek.com/data-analyst-jobs/in-All-Wellington');
  assert.strictEqual(buildSeekUrl({ keyword: 'Data Analyst', location: 'Masterton' }),
    'https://nz.seek.com/data-analyst-jobs/in-Masterton-Wellington');
  assert.strictEqual(buildSeekUrl({ keyword: 'Data Analyst', location: 'in-All-Auckland' }),
    'https://nz.seek.com/data-analyst-jobs/in-All-Auckland');
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: '' }), 'https://nz.seek.com/devops-jobs');
  assert.ok(!buildSeekUrl({ keyword: 'a', location: 'Wellington' }).includes('?'));
  assert.throws(() => buildSeekUrl({ keyword: '!!!', location: '' }));
  assert.throws(() => buildSeekUrl({ keyword: 'devops', location: 'UnknownTown' }), /Unknown SEEK NZ location/);
});

test('seek URL appends daterange and page query parameters when requested', () => {
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: '' }, 7),
    'https://nz.seek.com/devops-jobs?daterange=7');
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: '' }, null, 1),
    'https://nz.seek.com/devops-jobs');
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: '' }, null, 2),
    'https://nz.seek.com/devops-jobs?page=2');
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: 'Wellington' }, 7, 3),
    'https://nz.seek.com/devops-jobs/in-All-Wellington?daterange=7&page=3');
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: '', daterange: 14 }, { page: 2 }),
    'https://nz.seek.com/devops-jobs?daterange=14&page=2');
  assert.throws(() => buildSeekUrl({ keyword: 'devops', location: '' }, 0), /Invalid daterange/);
  assert.throws(() => buildSeekUrl({ keyword: 'devops', location: '' }, null, 0), /Invalid page/);
});

test('seek pagination walks pages with daterange and stops on an empty or repeated page or at maxPages', async () => {
  const pageHtml = (ids) => `<html><script>window.SEEK_REDUX_DATA = ${JSON.stringify({
    results: { results: { jobs: ids.map((id) => ({ id, title: `Role ${id}`, advertiser: { description: 'Acme' }, location: 'Auckland' })) } },
  })};</script></html>`;

  const requested = [];
  const waits = [];
  const pages = {
    'https://nz.seek.com/devops-jobs?daterange=7': pageHtml(['101', '102']),
    'https://nz.seek.com/devops-jobs?daterange=7&page=2': pageHtml(['102', '103']),
    'https://nz.seek.com/devops-jobs?daterange=7&page=3': pageHtml([]),
  };
  const offers = await scanSeekSearch(
    { keyword: 'devops', location: '' },
    {
      daterange: 7,
      maxPages: 5,
      delayMs: 50,
      sleepImpl: async (ms) => waits.push(ms),
      fetchText: async (url) => { requested.push(url); return pages[url] ?? pageHtml([]); },
    },
  );
  assert.deepStrictEqual(offers.map((o) => o.id), ['101', '102', '103']);
  assert.deepStrictEqual(requested, [
    'https://nz.seek.com/devops-jobs?daterange=7',
    'https://nz.seek.com/devops-jobs?daterange=7&page=2',
    'https://nz.seek.com/devops-jobs?daterange=7&page=3',
  ]);
  assert.deepStrictEqual(waits, [50, 50]);

  const repeatedCalls = [];
  const repeatedOffers = await scanSeekSearch(
    { keyword: 'devops', location: '' },
    {
      maxPages: 5,
      fetchText: async (url) => {
        repeatedCalls.push(url);
        return pageHtml(['101', '102']);
      },
    },
  );
  assert.strictEqual(repeatedCalls.length, 2);
  assert.deepStrictEqual(repeatedOffers.map((o) => o.id), ['101', '102']);

  // Respects max_pages on the search entry when CLI maxPages is not set.
  const cappedCalls = [];
  const cappedOffers = await scanSeekSearch(
    { keyword: 'devops', location: '', max_pages: 2 },
    {
      fetchText: async (url) => {
        cappedCalls.push(url);
        return pageHtml([String(cappedCalls.length)]);
      },
    },
  );
  assert.strictEqual(cappedCalls.length, 2);
  assert.deepStrictEqual(cappedOffers.map((o) => o.id), ['1', '2']);

  // Retains earlier-page offers and marks the search incomplete when a later
  // page fails, while still rejecting when page 1 fails.
  const partialCalls = [];
  const partialOffers = await scanSeekSearch(
    { keyword: 'devops', location: '' },
    {
      maxPages: 4,
      fetchText: async (url) => {
        partialCalls.push(url);
        if (partialCalls.length === 1) return pageHtml(['201', '202']);
        throw new Error('HTTP 503');
      },
    },
  );
  assert.strictEqual(partialCalls.length, 2);
  assert.deepStrictEqual(partialOffers.map((o) => o.id), ['201', '202']);
  assert.strictEqual(partialOffers.incomplete, true);
  assert.strictEqual(partialOffers.error?.seekUrl, 'https://nz.seek.com/devops-jobs?page=2');

  await assert.rejects(
    scanSeekSearch(
      { keyword: 'devops', location: '' },
      { fetchText: async () => { throw new Error('HTTP 503'); } },
    ),
    (err) => err.message === 'HTTP 503' && err.seekUrl === 'https://nz.seek.com/devops-jobs',
  );
});

test('seek page parsing reads SEEK_REDUX_DATA, dedups ids, decodes text', () => {
  const offers = parseSeekPage(SEEK_HTML);
  assert.strictEqual(offers.length, 2);
  assert.deepStrictEqual(offers[0], {
    id: '81000001',
    url: 'https://nz.seek.com/job/81000001',
    title: 'Senior Data Analyst',
    company: 'Kiwi Power & Light',
    location: 'Wellington Central, Wellington',
    salary: '$110k - $130k',
    teaser: 'Join our "insights" team',
    workTypes: ['Full time'],
    postedAt: '2026-11-02',
    source: 'seek-nz',
  });
  assert.strictEqual(offers[1].postedAt, '');
});

test('seek page parsing throws descriptively for blocked/malformed pages', () => {
  assert.throws(
    () => parseSeekPage('<html>blocked</html>'),
    /SEEK_REDUX_DATA/,
  );
  assert.strictEqual(extractReduxJson('window.SEEK_REDUX_DATA = {"a": '), null);
  assert.throws(
    () => parseSeekPage('window.SEEK_REDUX_DATA = {not json};'),
    /SEEK_REDUX_DATA/,
  );
});

test('seek searches config: minimal { keyword, location? } schema plus optional daterange and max_pages', () => {
  assert.deepStrictEqual(
    seekSearches({
      seek_searches: [
        { keyword: ' qa ', location: 'Auckland' },
        { keyword: 'data', location: 'Wellington', daterange: 7, max_pages: 3 },
        'sre',
        { location: 'x' },
        null,
      ],
    }),
    [
      { keyword: 'qa', location: 'Auckland' },
      { keyword: 'data', location: 'Wellington', daterange: 7, max_pages: 3 },
      { keyword: 'sre', location: '' },
    ],
  );
  assert.deepStrictEqual(seekSearches({}), []);
});

test('seek_searches is a registered portals.yml key, so a typo is reported', () => {
  // Same class of bug as `tracked_companys` and the TopDev key: a valid list
  // plus a `seek_searche` miss beside it used to validate clean, and the
  // scanner would read the real list and silently ignore the extra search.
  assert.ok(PORTAL_TOP_LEVEL_KEYS.includes('seek_searches'));
  assert.deepStrictEqual(
    portalTopLevelTypos({ seek_searches: [{ keyword: 'devops' }], seek_searche: [{ keyword: 'qa' }] }),
    [{ key: 'seek_searche', suggestion: 'seek_searches' }],
  );
});

// ── CLI ──────────────────────────────────────────────────────────────

test('scan-seek.mjs: --help exits 0 without scanning; unknown flag, missing operand and invalid --daterange/--pages exit 1', () => {
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'scan-seek.mjs'), ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
  const help = run('--help');
  assert.strictEqual(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  assert.match(help.stdout, /--daterange/);
  assert.match(help.stdout, /--pages/);
  assert.strictEqual(run('--dryrun').status, 1);
  assert.strictEqual(run('--delay-ms').status, 1);
  assert.strictEqual(run('--daterange').status, 1);
  assert.strictEqual(run('--pages').status, 1);
  assert.strictEqual(run('--daterange', '0').status, 1);
  assert.strictEqual(run('--pages', '0').status, 1);
});

