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
import { buildSeekUrl, parseSeekPage, extractReduxJson, loadSearches as seekSearches } from '../scan-seek.mjs';

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

test('seek URL resolves known NZ locations and canonical in- paths, rejects unknown plain locations, and never has a query string', () => {
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

test('seek searches config: minimal { keyword, location? } schema', () => {
  assert.deepStrictEqual(
    seekSearches({ seek_searches: [{ keyword: ' qa ', location: 'Auckland' }, 'sre', { location: 'x' }, null] }),
    [{ keyword: 'qa', location: 'Auckland' }, { keyword: 'sre', location: '' }],
  );
  assert.deepStrictEqual(seekSearches({}), []);
});

// ── CLI ──────────────────────────────────────────────────────────────

test('scan-seek.mjs: --help exits 0 without scanning; unknown flag (incl. removed --daterange) and missing operand exit 1', () => {
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'scan-seek.mjs'), ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
  const help = run('--help');
  assert.strictEqual(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  assert.ok(!help.stdout.includes('daterange'));
  assert.strictEqual(run('--dryrun').status, 1);
  assert.strictEqual(run('--delay-ms').status, 1);
  assert.strictEqual(run('--daterange', '7').status, 1);
});

