import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  politeFetch, parseRetryAfter, slugify, decodeHtml,
  createLocalGate, writeRunLog,
} from '../scan-local-lib.mjs';
import { buildSeekUrl, parseSeekPage, extractReduxJson, loadSearches as seekSearches } from '../scan-seek.mjs';
import {
  buildSearchUrl, buildJobPostingUrl, parseSearchCards, parseJobPosting,
  loadSearches as linkedinSearches,
} from '../scan-linkedin.mjs';

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

const CARD = (id, title, company, loc, date) => `<li><div class="base-card" data-entity-urn="urn:li:jobPosting:${id}">
<a class="base-card__full-link" href="https://nz.linkedin.com/jobs/view/${title.toLowerCase().replace(/ /g, '-')}-at-x-${id}?position=1&amp;trackingId=abc"></a>
<h3 class="base-search-card__title">  ${title} </h3>
<h4 class="base-search-card__subtitle"><a href="#">${company}</a></h4>
<span class="job-search-card__location">${loc}</span>
<time class="job-search-card__listdate" datetime="${date}">2 days ago</time></div></li>`;

const LI_HTML = CARD('3900000001', 'Platform Engineer', 'Xero', 'Auckland, New Zealand', '2026-11-01')
  + CARD('3900000002', 'Site Reliability Engineer', 'Fisher &amp; Paykel', 'Wellington, New Zealand', '2026-10-30')
  + CARD('3900000001', 'Platform Engineer', 'Xero', 'Auckland, New Zealand', '2026-11-01');

const res = (status, body = '', headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

// ── scan-local-lib ───────────────────────────────────────────────────

test('politeFetch retries 429 honoring Retry-After, then succeeds', async () => {
  const waits = [];
  const replies = [res(429, '', { 'retry-after': '7' }), res(503), res(200, 'ok')];
  const body = await politeFetch('https://x.test', {
    fetchImpl: async () => replies.shift(),
    sleepImpl: async (ms) => waits.push(ms),
    backoffMs: 100,
  });
  assert.strictEqual(body, 'ok');
  assert.deepStrictEqual(waits, [7000, 200]);
});

test('politeFetch does not retry 403/404 and gives up after the retry budget', async () => {
  let calls = 0;
  await assert.rejects(
    politeFetch('https://x.test', { fetchImpl: async () => { calls++; return res(403); }, sleepImpl: async () => {} }),
    (e) => e.status === 403,
  );
  assert.strictEqual(calls, 1);
  calls = 0;
  await assert.rejects(
    politeFetch('https://x.test', { retries: 2, fetchImpl: async () => { calls++; return res(429); }, sleepImpl: async () => {} }),
    (e) => e.status === 429,
  );
  assert.strictEqual(calls, 3);
});

test('politeFetch sends an identifying User-Agent and no credentials', async () => {
  let init;
  await politeFetch('https://x.test', { fetchImpl: async (_u, i) => { init = i; return res(200, ''); } });
  assert.match(init.headers['User-Agent'], /career-ops/);
  assert.ok(!('Cookie' in init.headers) && !('Authorization' in init.headers));
});

test('parseRetryAfter reads seconds and dates', () => {
  assert.strictEqual(parseRetryAfter('5'), 5000);
  assert.strictEqual(parseRetryAfter('', 0), null);
  assert.strictEqual(parseRetryAfter(new Date(10000).toUTCString(), 4000), 6000);
});

test('slugify and decodeHtml', () => {
  assert.strictEqual(slugify('Data  Analyst / BI'), 'data-analyst-bi');
  assert.strictEqual(slugify('Māori Liaison'), 'maori-liaison');
  assert.strictEqual(decodeHtml(' A &amp; B <b>x</b> '), 'A & B x');
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

test('seek URL is the SEO path with no query string by default', () => {
  assert.strictEqual(buildSeekUrl({ keyword: 'Data Analyst', location: 'Wellington' }),
    'https://nz.seek.com/data-analyst-jobs/wellington');
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: '' }), 'https://nz.seek.com/devops-jobs');
  assert.ok(!buildSeekUrl({ keyword: 'a', location: 'b' }).includes('?'));
});

test('seek daterange is the only query string and is opt-in', () => {
  assert.strictEqual(buildSeekUrl({ keyword: 'devops', location: '' }, 7), 'https://nz.seek.com/devops-jobs?daterange=7');
  assert.throws(() => buildSeekUrl({ keyword: '!!!', location: '' }));
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

test('seek page parsing tolerates pages without data', () => {
  assert.deepStrictEqual(parseSeekPage('<html>blocked</html>'), []);
  assert.strictEqual(extractReduxJson('window.SEEK_REDUX_DATA = {"a": '), null);
  assert.deepStrictEqual(parseSeekPage('window.SEEK_REDUX_DATA = {not json};'), []);
});

test('seek searches config: minimal { keyword, location? } schema', () => {
  assert.deepStrictEqual(
    seekSearches({ seek_searches: [{ keyword: ' qa ', location: 'Auckland' }, 'sre', { location: 'x' }, null] }),
    [{ keyword: 'qa', location: 'Auckland' }, { keyword: 'sre', location: '' }],
  );
  assert.deepStrictEqual(seekSearches({}), []);
});

// ── scan-linkedin ────────────────────────────────────────────────────

test('linkedin search URL targets the guest endpoint with paging and window', () => {
  const url = new URL(buildSearchUrl({ keywords: 'platform engineer', location: 'Auckland, New Zealand' }, { page: 2, sinceDays: 7 }));
  assert.strictEqual(url.pathname, '/jobs-guest/jobs/api/seeMoreJobPostings/search');
  assert.strictEqual(url.searchParams.get('keywords'), 'platform engineer');
  assert.strictEqual(url.searchParams.get('start'), '50');
  assert.strictEqual(url.searchParams.get('f_TPR'), 'r604800');
  assert.ok(!new URL(buildSearchUrl({ keywords: 'x', location: '' })).searchParams.has('f_TPR'));
});

test('linkedin jobPosting URL rejects non-numeric ids', () => {
  assert.match(buildJobPostingUrl('3900000001'), /\/jobPosting\/3900000001$/);
  assert.throws(() => buildJobPostingUrl('../../me'));
});

test('linkedin cards parse to offers with clean URLs and dedup by id', () => {
  const offers = parseSearchCards(LI_HTML);
  assert.strictEqual(offers.length, 2);
  assert.deepStrictEqual(offers[0], {
    id: '3900000001',
    url: 'https://www.linkedin.com/jobs/view/platform-engineer-at-x-3900000001',
    title: 'Platform Engineer',
    company: 'Xero',
    location: 'Auckland, New Zealand',
    postedAt: '2026-11-01',
    source: 'linkedin',
  });
  assert.strictEqual(offers[1].company, 'Fisher & Paykel');
  assert.deepStrictEqual(parseSearchCards('<html>nothing</html>'), []);
});

test('linkedin JD parsing returns text, or empty for unknown markup', () => {
  const jd = parseJobPosting('<div class="show-more-less-html__markup"><p>Build things.</p><ul><li>Go</li><li>K8s</li></ul></div>');
  assert.match(jd, /Build things\./);
  assert.match(jd, /- Go/);
  assert.strictEqual(parseJobPosting('<html></html>'), '');
});

test('linkedin searches config: minimal { keywords, location? } schema', () => {
  assert.deepStrictEqual(
    linkedinSearches({ linkedin_searches: [{ keywords: 'sre', location: 'NZ' }, 'devops', {}] }),
    [{ keywords: 'sre', location: 'NZ' }, { keywords: 'devops', location: '' }],
  );
});

// ── CLI ──────────────────────────────────────────────────────────────

for (const script of ['scan-seek.mjs', 'scan-linkedin.mjs']) {
  test(`${script}: --help exits 0 without scanning; unknown flag and missing operand exit 1`, () => {
    const run = (...args) => spawnSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
    const help = run('--help');
    assert.strictEqual(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage:/);
    assert.strictEqual(run('--dryrun').status, 1);
    assert.strictEqual(run('--delay-ms').status, 1);
  });
}

