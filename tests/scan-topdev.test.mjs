// Fixture-based unit tests for the pure logic in scan-topdev.mjs — argument
// parsing, region resolution, URL building and host-pinning, posting-URL
// resolution, relative-age parsing, card→Job mapping, and challenge detection.
//
// What this suite does NOT cover: the Playwright-driven parts (page.goto,
// waiting for the hydrated listing, $$eval card extraction). Exercising those
// against a mocked page would mostly test the mock; the live smoke test covers
// them instead (see the PR description for the measurement).
//
// The card fixture below is the shape read off a live hydrated TopDev card on
// 2026-11-10, reduced to the fields the extractor returns.
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  ALLOWED_HOST,
  REGION_IDS,
  parseArgs,
  regionIdFor,
  validateRegionId,
  normalizeSearchEntry,
  buildSearchUrl,
  assertTopDevUrl,
  resolvePostingUrl,
  parseRelativeAge,
  cardsToJobs,
  detectChallenge,
  TopDevChallengeError,
  TopDevRenderError,
} from '../scan-topdev.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0); // 2026-11-10T12:00:00Z
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('importing the scanner ignores the caller argv', () => {
  const moduleUrl = new URL('../scan-topdev.mjs', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(moduleUrl)})`, '--', '--keyword'],
    { encoding: 'utf8' },
  );
  assert.strictEqual(result.status, 0, describeSpawn(result));
  assert.strictEqual(result.stderr, '');
});

test('parseArgs reads CLI flags and takes no argv by default side effect', () => {
  assert.deepStrictEqual(parseArgs([]), {
    dryRun: false, debug: false, noDateFilter: false, singleKeyword: null,
  });
  assert.deepStrictEqual(parseArgs(['--dry-run', '--debug', '--all', '--keyword', 'backend']), {
    dryRun: true, debug: true, noDateFilter: true, singleKeyword: 'backend',
  });
  // --keyword=value form, which indexOf() cannot see
  assert.strictEqual(parseArgs(['--keyword=frontend']).singleKeyword, 'frontend');
});

test('regionIdFor maps the three observed cities, plus abbreviations', () => {
  assert.strictEqual(regionIdFor('Ho Chi Minh'), '79');
  assert.strictEqual(regionIdFor('  hcmc '), '79');
  assert.strictEqual(regionIdFor('Hà Nội'), '01');
  assert.strictEqual(regionIdFor('da nang'), '48');
  assert.strictEqual(REGION_IDS['hồ chí minh'], '79');
});

test('regionIdFor returns null for absent, empty or unknown locations', () => {
  assert.strictEqual(regionIdFor(undefined), null);
  assert.strictEqual(regionIdFor(null), null);
  assert.strictEqual(regionIdFor(''), null);
  assert.strictEqual(regionIdFor('   '), null);
  assert.strictEqual(regionIdFor('Hue'), null); // real city, never observed on the board
  assert.strictEqual(regionIdFor(79), null); // not a string
});

test('validateRegionId accepts 1-3 digit ids only', () => {
  assert.strictEqual(validateRegionId('79'), true);
  assert.strictEqual(validateRegionId('01'), true);
  assert.strictEqual(validateRegionId('001'), true);
  assert.strictEqual(validateRegionId('1234'), false);
  assert.strictEqual(validateRegionId('7a'), false);
  assert.strictEqual(validateRegionId(''), false);
  assert.strictEqual(validateRegionId(79), false);
});

test('normalizeSearchEntry validates and defaults', () => {
  assert.deepStrictEqual(normalizeSearchEntry({ keyword: ' backend ' }), {
    keyword: 'backend', regionId: null, maxPages: 5,
  });
  assert.deepStrictEqual(normalizeSearchEntry({ keyword: 'backend', location: 'Hanoi' }), {
    keyword: 'backend', regionId: '01', maxPages: 5,
  });
  assert.strictEqual(normalizeSearchEntry({ keyword: 'x', max_pages: 12 }).maxPages, 12);
  // clamp both ends, so a config typo cannot walk the whole board
  assert.strictEqual(normalizeSearchEntry({ keyword: 'x', max_pages: 0 }).maxPages, 1);
  assert.strictEqual(normalizeSearchEntry({ keyword: 'x', max_pages: 9999 }).maxPages, 50);
  assert.strictEqual(normalizeSearchEntry({ keyword: 'x', max_pages: 'many' }).maxPages, 5);
});

test('normalizeSearchEntry rejects a missing keyword and an unknown location', () => {
  assert.throws(() => normalizeSearchEntry({}), /topdev_searches\[0\]: `keyword` is required/);
  assert.throws(() => normalizeSearchEntry({ keyword: '   ' }), /`keyword` is required/);
  assert.throws(() => normalizeSearchEntry(null), /expected a mapping/);
  assert.throws(
    () => normalizeSearchEntry({ keyword: 'x', location: 'Hue' }, 3),
    /topdev_searches\[3\]: unknown location "Hue".*Omit `location` for a nationwide search/s,
  );
});

test('buildSearchUrl encodes the keyword and pins host + pagination', () => {
  const url = buildSearchUrl('backend', '79', 2);
  const parsed = new URL(url);
  assert.strictEqual(parsed.protocol, 'https:');
  assert.strictEqual(parsed.hostname, ALLOWED_HOST);
  assert.strictEqual(parsed.pathname, '/jobs/search');
  assert.strictEqual(parsed.searchParams.get('keyword'), 'backend');
  assert.strictEqual(parsed.searchParams.get('page'), '2');
  assert.strictEqual(parsed.searchParams.get('region_ids'), '79');
});

test('buildSearchUrl keeps accents/quotes encoded and omits region when absent', () => {
  const url = buildSearchUrl('lập trình viên & dev', null, 1);
  const parsed = new URL(url);
  assert.strictEqual(parsed.searchParams.get('keyword'), 'lập trình viên & dev');
  assert.strictEqual(parsed.searchParams.get('region_ids'), null);
  assert.ok(!url.includes('region_ids'), 'no region param for a nationwide search');
});

test('buildSearchUrl refuses a region value that is not a plain id', () => {
  assert.throws(() => buildSearchUrl('backend', '79&x=1', 1), /invalid region id/);
  assert.throws(() => buildSearchUrl('backend', '', 1), /invalid region id/);
  assert.throws(() => buildSearchUrl('backend', 'abc', 1), /invalid region id/);
});

test('assertTopDevUrl rejects off-host, non-HTTPS and malformed URLs', () => {
  assert.doesNotThrow(() => assertTopDevUrl('https://topdev.vn/jobs/search?keyword=a'));
  assert.throws(() => assertTopDevUrl('http://topdev.vn/jobs'), /must use HTTPS/);
  assert.throws(() => assertTopDevUrl('https://evil.example/jobs'), /untrusted hostname "evil.example"/);
  assert.throws(() => assertTopDevUrl('https://topdev.vn.evil.example/jobs'), /untrusted hostname/);
  assert.throws(() => assertTopDevUrl('not a url'), /invalid URL/);
});

test('resolvePostingUrl resolves relative hrefs and strips tracking params', () => {
  assert.strictEqual(
    resolvePostingUrl('/detail-jobs/back-end-developer-daoukiwoom-2139307?src=topdev_home&medium=superhotjobs'),
    'https://topdev.vn/detail-jobs/back-end-developer-daoukiwoom-2139307',
  );
  // the same posting reached from another rail must collapse to one key
  assert.strictEqual(
    resolvePostingUrl('https://topdev.vn/detail-jobs/back-end-developer-daoukiwoom-2139307?src=search#apply'),
    'https://topdev.vn/detail-jobs/back-end-developer-daoukiwoom-2139307',
  );
});

test('resolvePostingUrl drops empty, off-host, non-HTTPS and malformed hrefs', () => {
  assert.strictEqual(resolvePostingUrl(''), null);
  assert.strictEqual(resolvePostingUrl('   '), null);
  assert.strictEqual(resolvePostingUrl(null), null);
  assert.strictEqual(resolvePostingUrl(42), null);
  assert.strictEqual(resolvePostingUrl('https://careerviet.vn/detail-jobs/x-1'), null);
  assert.strictEqual(resolvePostingUrl('http://topdev.vn/detail-jobs/x-1'), null);
  assert.strictEqual(resolvePostingUrl('https://topdev.vn/detail-jobs/'), 'https://topdev.vn/detail-jobs/');
});

test('parseRelativeAge handles the Vietnamese labels the board actually renders', () => {
  assert.strictEqual(parseRelativeAge('3 ngày trước', NOW), NOW - 3 * DAY);
  assert.strictEqual(parseRelativeAge('1 giờ trước', NOW), NOW - HOUR);
  assert.strictEqual(parseRelativeAge('30 phút trước', NOW), NOW - 30 * MINUTE);
  assert.strictEqual(parseRelativeAge('2 tuần trước', NOW), NOW - 14 * DAY);
  assert.strictEqual(parseRelativeAge('1 tháng trước', NOW), NOW - 30 * DAY);
  assert.strictEqual(parseRelativeAge('Vừa xong', NOW), NOW);
});

test('parseRelativeAge handles the English labels the board also renders', () => {
  assert.strictEqual(parseRelativeAge('5 hours ago', NOW), NOW - 5 * HOUR);
  assert.strictEqual(parseRelativeAge('2 days ago', NOW), NOW - 2 * DAY);
  assert.strictEqual(parseRelativeAge('3 weeks ago', NOW), NOW - 21 * DAY);
  assert.strictEqual(parseRelativeAge('just now', NOW), NOW);
});

test('parseRelativeAge returns undefined rather than guessing', () => {
  assert.strictEqual(parseRelativeAge('', NOW), undefined);
  assert.strictEqual(parseRelativeAge('Hạn nộp: 30/11/2026', NOW), undefined);
  assert.strictEqual(parseRelativeAge('Login to view salary', NOW), undefined);
  assert.strictEqual(parseRelativeAge(null, NOW), undefined);
  assert.strictEqual(parseRelativeAge(undefined, NOW), undefined);
  assert.strictEqual(parseRelativeAge(123, NOW), undefined);
});

// The extractor's output for one real card, plus two synthetic edge cases.
const CARDS = [
  {
    title: 'Back-end Developer (trên 3 năm kinh nghiệm)',
    href: '/detail-jobs/back-end-developer-tren-3-nam-kinh-nghiem-daoukiwoom-innovation-2139307?src=topdev_home&medium=superhotjobs',
    company: 'DaouKiwoom Innovation',
    location: ' Hồ Chí Minh',
    texts: ['Hồ Chí Minh', 'Chuyên viên', '3 ngày trước'],
  },
  {
    // same posting reached from another rail — must not become a second row
    title: 'Back-end Developer (trên 3 năm kinh nghiệm)',
    href: 'https://topdev.vn/detail-jobs/back-end-developer-tren-3-nam-kinh-nghiem-daoukiwoom-innovation-2139307?src=search',
    company: 'DaouKiwoom Innovation',
    location: 'Hồ Chí Minh',
    texts: ['Hồ Chí Minh', '1 giờ trước'],
  },
  {
    title: 'Senior Full Stack Engineer',
    href: 'https://topdev.vn/detail-jobs/senior-full-stack-engineer-wecare-2138321',
    company: ' WeCare Group ',
    location: 'Hà Nội',
    texts: ['Hà Nội', '2 tuần trước'],
  },
  // dropped: no title
  { title: '   ', href: '/detail-jobs/no-title-1', company: 'X', location: '', texts: [] },
  // dropped: off-host
  { title: 'Partner job', href: 'https://careerviet.vn/detail-jobs/x-9', company: 'Y', location: '', texts: [] },
  // kept: no relative-age label → no postedAt at all
  {
    title: 'Data Engineer',
    href: '/detail-jobs/data-engineer-f88-2144836',
    company: 'F88',
    location: 'Đà Nẵng',
    texts: ['Đà Nẵng', 'Chuyên viên'],
  },
];

test('cardsToJobs dedupes by posting URL and drops unparseable cards', () => {
  const jobs = cardsToJobs(CARDS, NOW);
  assert.strictEqual(jobs.length, 3, 'two rails of one posting collapse to one job');

  const first = jobs.find((j) => j.url.includes('daoukiwoom'));
  assert.ok(first, 'the real card survived');
  assert.strictEqual(first.title, 'Back-end Developer (trên 3 năm kinh nghiệm)');
  assert.strictEqual(first.company, 'DaouKiwoom Innovation');
  assert.strictEqual(first.location, 'Hồ Chí Minh', 'leading whitespace from the cell is trimmed');
  assert.strictEqual(first.postedAt, NOW - 3 * DAY, 'the first sighting wins, not the rail duplicate');
});

test('cardsToJobs trims company and omits postedAt when no label parses', () => {
  const jobs = cardsToJobs(CARDS, NOW);
  const wecare = jobs.find((j) => j.url.includes('wecare'));
  assert.strictEqual(wecare.company, 'WeCare Group');
  assert.strictEqual(wecare.postedAt, NOW - 14 * DAY);

  const f88 = jobs.find((j) => j.url.includes('data-engineer'));
  assert.ok(f88);
  assert.ok(!('postedAt' in f88), 'no guessed date when the card shows none');
  assert.strictEqual(f88.location, 'Đà Nẵng');
});

test('cardsToJobs tolerates junk input', () => {
  assert.deepStrictEqual(cardsToJobs(null, NOW), []);
  assert.deepStrictEqual(cardsToJobs('nope', NOW), []);
  assert.deepStrictEqual(cardsToJobs([null, undefined, 42], NOW), []);
});

test('detectChallenge catches Cloudflare interstitials and human checks', () => {
  assert.strictEqual(detectChallenge('Just a moment...'), true);
  assert.strictEqual(detectChallenge('<div id="challenge-form"></div>'), true);
  assert.strictEqual(detectChallenge('<script src="/cdn-cgi/challenge-platform/x.js">'), true);
  assert.strictEqual(detectChallenge('Please complete the security check to access topdev.vn'), true);
  assert.strictEqual(detectChallenge('Verify you are human'), true);
});

test('detectChallenge is false for a normal listings page', () => {
  assert.strictEqual(detectChallenge(''), false);
  assert.strictEqual(detectChallenge(null), false);
  assert.strictEqual(
    detectChallenge('<title>Recruiting 2 backend positions in Ho Chi Minh</title><div class="text-card-foreground">'),
    false,
  );
});

test('the named errors say what to do next', () => {
  const challenge = new TopDevChallengeError('https://topdev.vn/jobs/search?keyword=a');
  assert.strictEqual(challenge.name, 'TopDevChallengeError');
  assert.match(challenge.message, /not solved, not retried/);

  const render = new TopDevRenderError('https://topdev.vn/jobs/search?keyword=a', 'TopDev');
  assert.strictEqual(render.name, 'TopDevRenderError');
  assert.match(render.message, /never rendered its listings \(page title: "TopDev"\)/);
  assert.match(render.message, /rerun with --debug/);
});
