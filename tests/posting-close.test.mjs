import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDateForUrl, closeDatesByUrl, closesAtIso, refreshOfferForSeenUrl, selectCloseDateRefreshes } from '../lib/posting-close.mjs';
import { alignCloseRefreshOffers, closeRefreshUrlForSeenOffer, collectSeenUrls, seenJobKey } from '../scan.mjs';
import { computeListingFingerprint } from '../listing-fingerprint.mjs';
import { SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('a calendar day stays that day', () => {
  assert.equal(closesAtIso('2026-11-11'), '2026-11-11');
  assert.equal(closesAtIso('  2026-11-11  '), '2026-11-11');
  assert.equal(closesAtIso('2024-02-29'), '2024-02-29');
});

test('an impossible calendar day is absent', () => {
  assert.equal(closesAtIso('2026-02-31'), '');
  assert.equal(closesAtIso('2026-02-29'), '');
  assert.equal(closesAtIso('2026-13-01'), '');
  assert.equal(closesAtIso('2026-00-10'), '');
  assert.equal(closesAtIso('2026-11-00'), '');
});

test('a datetime without a zone keeps its date prefix', () => {
  assert.equal(closesAtIso('2026-11-11T23:59:59'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-11T00:30:00'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-11T23:59'), '2026-11-11');
});

test('a naive close instant stays on its date in a zone that would shift it', () => {
  const script = `
    import { closesAtIso } from './lib/posting-close.mjs';
    const late = closesAtIso('2026-11-11T23:59:59');
    const early = closesAtIso('2026-11-11T00:30:00');
    process.stdout.write(late + ' ' + early);
  `;
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Honolulu', 'UTC']) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, '2026-11-11 2026-11-11');
  }
});

test('Z and a numeric offset use the UTC calendar day', () => {
  assert.equal(closesAtIso('2026-11-11T23:59:59Z'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-11T23:59:59.000Z'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-11T23:59:59.9995Z'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-11T23:59:59+00:00'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-12T00:30:00+02:00'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-12T00:30+02:00'), '2026-11-11');
  assert.equal(closesAtIso('2026-11-11T23:00:00-05:00'), '2026-11-12');
  assert.equal(closesAtIso('2026-01-01T00:30:00+02:00'), '2025-12-31');
  assert.equal(closesAtIso('2026-12-31T22:00:00-05:00'), '2027-01-01');
});

test('a datetime that is not a real instant is absent', () => {
  assert.equal(closesAtIso('2026-02-31T00:00:00Z'), '');
  assert.equal(closesAtIso('2026-11-11T24:00:00Z'), '');
  assert.equal(closesAtIso('2026-11-11T23:60:00Z'), '');
  assert.equal(closesAtIso('2026-11-11T23:59:60Z'), '');
  assert.equal(closesAtIso('2026-11-11T23:59:59+15:00'), '');
  assert.equal(closesAtIso('2026-11-11 23:59:59'), '');
  assert.equal(closesAtIso('2026-11-11T23:59:59z'), '');
});

test('empty, whitespace, and non-strings are absent', () => {
  for (const value of ['', '   ', null, undefined, 20261111, true, false, [], new Date('2026-11-11T00:00:00Z')]) {
    assert.equal(closesAtIso(value), '');
  }
});

test('the first present valid field wins, in field order', () => {
  assert.equal(closesAtIso({ validThrough: '2026-12-01' }), '2026-12-01');
  assert.equal(closesAtIso({ applicationDeadline: '2026-03-04' }), '2026-03-04');
  assert.equal(closesAtIso({ application_deadline: '2026-11-11T23:59:59' }), '2026-11-11');
  assert.equal(closesAtIso({ endDate: '2026-07-04' }), '2026-07-04');
  assert.equal(closesAtIso({ end_date: '2026-08-05' }), '2026-08-05');
  assert.equal(closesAtIso({ closeDate: '2026-09-06' }), '2026-09-06');
  assert.equal(closesAtIso({ close_date: '2026-10-07' }), '2026-10-07');
  assert.equal(closesAtIso({
    validThrough: '2026-01-15',
    close_date: '2026-02-15',
  }), '2026-01-15');
  assert.equal(closesAtIso({
    validThrough: 'nope',
    applicationDeadline: '2026-03-01',
    application_deadline: '2026-04-01',
  }), '2026-03-01');
  assert.equal(closesAtIso({
    validThrough: '',
    applicationDeadline: '2026-05-02',
  }), '2026-05-02');
  assert.equal(closesAtIso({
    validThrough: 1,
    applicationDeadline: '2026-06-03',
  }), '2026-06-03');
  assert.equal(closesAtIso({
    validThrough: '2026-02-31',
    endDate: '2026-07-04',
  }), '2026-07-04');
  assert.equal(closesAtIso({
    validThrough: 'not-a-day',
    applicationDeadline: '',
  }), '');
});

test('a field that is not a close-date name is ignored', () => {
  assert.equal(closesAtIso({ closesAt: '2026-01-01', endDate: '2026-02-02' }), '2026-02-02');
  const inherited = Object.create({ validThrough: '2026-01-01' });
  inherited.applicationDeadline = '2026-08-08';
  assert.equal(closesAtIso(inherited), '2026-08-08');
});

test('closes_at is the last scan-history column', () => {
  assert.equal(SCAN_HISTORY_COLUMNS.at(-1), 'closes_at');
  assert.equal(SCAN_HISTORY_COLUMNS.at(-2), 'listing_key');
});

function historyRow(cells) {
  const byName = Object.fromEntries(SCAN_HISTORY_COLUMNS.map((name) => [name, '']));
  Object.assign(byName, cells);
  return SCAN_HISTORY_COLUMNS.map((name) => byName[name]).join('\t');
}

test('scan history indexes a close day by the posting URL key', () => {
  const header = SCAN_HISTORY_COLUMNS.join('\t');
  const text = [
    header,
    historyRow({
      url: 'https://jobs.example/acme-exact',
      company: 'Acme',
      closes_at: '2026-10-03',
    }),
    historyRow({
      url: 'https://jobs.example/acme-exact',
      company: 'Acme',
      closes_at: '',
    }),
    historyRow({
      url: 'https://jobs.example/northwind?utm_source=board',
      company: 'Northwind Traders',
      closes_at: '2026-09-15',
    }),
    historyRow({
      url: 'https://jobs.example/one?gh_jid=111',
      company: 'Acme',
      closes_at: '2026-03-03',
    }),
    historyRow({
      url: 'https://jobs.example/one?gh_jid=222',
      company: 'Acme',
      closes_at: '2026-04-04',
    }),
    historyRow({
      url: 'https://jobs.example/blank',
      company: 'Acme',
      closes_at: 'not-a-day',
    }),
    historyRow({
      url: '',
      company: 'Acme',
      closes_at: '2026-01-01',
    }),
  ].join('\n');
  const index = closeDatesByUrl(text);
  assert.equal(index.get('https://jobs.example/acme-exact'), '2026-10-03');
  assert.equal(index.get('https://jobs.example/northwind'), '2026-09-15');
  assert.equal(index.has('https://jobs.example/northwind?utm_source=board'), false);
  assert.equal(index.has('https://jobs.example/blank'), false);
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme-exact'), '2026-10-03');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme-exact?utm_source=email'), '2026-10-03');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme-exact?src=email'), '');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/northwind'), '2026-09-15');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/one?gh_jid=111'), '2026-03-03');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/one?gh_jid=222'), '2026-04-04');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/one'), '');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/other'), '');
  assert.equal(closeDateForUrl(index, ''), '');
});

test('a later scan replaces the day for the same posting, including a tracking variant', () => {
  const text = [
    historyRow({ url: 'https://jobs.example/acme?utm_source=board', closes_at: '2026-01-01' }),
    historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-04-04' }),
  ].join('\n');
  const index = closeDatesByUrl(text);
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme?utm_source=board'), '2026-04-04');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme'), '2026-04-04');
});

test('a later scan-history day replaces an earlier one for the same URL', () => {
  const text = [
    historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-01-01' }),
    historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-04-04' }),
  ].join('\n');
  assert.equal(closeDatesByUrl(text).get('https://jobs.example/acme'), '2026-04-04');
});

test('a seen posting with a new close day is selected, and an unchanged day is not', () => {
  const history = [
    historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-01-01' }),
    historyRow({ url: 'https://jobs.example/other', closes_at: '2026-05-05' }),
  ].join('\n');
  const selected = selectCloseDateRefreshes([
    { url: 'https://jobs.example/acme?utm_source=board', closesAt: '2026-06-06' },
    { url: 'https://jobs.example/other', closesAt: '2026-05-05' },
    { url: 'https://jobs.example/blank', closesAt: '' },
    { url: 'https://jobs.example/bad', closesAt: '2026-02-31', validThrough: '2026-07-07' },
    { url: 'https://jobs.example/acme', closesAt: '2026-08-08' },
  ], history);
  assert.deepEqual(selected.map((offer) => offer.url), [
    'https://jobs.example/acme',
    'https://jobs.example/bad',
  ]);
  assert.equal(closesAtIso(selected[0].closesAt), '2026-08-08');
  assert.equal(closesAtIso(selected[1].closesAt) || closesAtIso(selected[1]), '2026-07-07');
});

test('an offer with no close day does not clear a stored day', () => {
  const history = historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-01-01' });
  assert.deepEqual(selectCloseDateRefreshes([
    { url: 'https://jobs.example/acme', closesAt: '' },
    { url: 'https://jobs.example/acme', closesAt: 'nope' },
  ], history), []);
});

test('a path-case change refreshes the stored posting and leaves a different path alone', () => {
  const history = [
    historyRow({ url: 'https://jobs.example/Acme', closes_at: '2026-01-01', status: 'added', first_seen: '2026-10-01' }),
    historyRow({ url: 'https://jobs.example/Other', closes_at: '2026-02-02', status: 'added', first_seen: '2026-10-01' }),
  ].join('\n');
  const same = refreshOfferForSeenUrl(
    { url: 'https://jobs.example/Acme', closesAt: '2026-03-03' },
    'https://jobs.example/Acme',
  );
  assert.equal(same.url, 'https://jobs.example/Acme');
  const aligned = alignCloseRefreshOffers([
    { url: 'https://jobs.example/acme', closesAt: '2026-06-06' },
    { url: 'https://jobs.example/other-role', closesAt: '2026-07-07' },
  ], history);
  assert.equal(aligned[0].url, 'https://jobs.example/Acme');
  assert.equal(aligned[1].url, 'https://jobs.example/other-role');
  const selected = selectCloseDateRefreshes(aligned, history);
  const next = [
    history,
    historyRow({ url: selected[0].url, closes_at: '2026-06-06' }),
  ].join('\n');
  const index = closeDatesByUrl(next);
  assert.equal(closeDateForUrl(index, 'https://jobs.example/Acme'), '2026-06-06');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/Other'), '2026-02-02');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/other-role'), '');
});

test('two seen language versions keep their own close days', () => {
  const history = [
    historyRow({ url: 'https://jobs.example/Acme?lang=en', closes_at: '2026-01-01', status: 'added', first_seen: '2026-10-01' }),
    historyRow({ url: 'https://jobs.example/Acme?lang=fr', closes_at: '2026-02-02', status: 'added', first_seen: '2026-10-01' }),
  ].join('\n');
  const aligned = alignCloseRefreshOffers([
    { url: 'https://jobs.example/acme?lang=fr', closesAt: '2026-06-06', language: 'fr' },
    { url: 'https://jobs.example/acme?lang=en', closesAt: '2026-07-07', language: 'en' },
    { url: 'https://jobs.example/acme?lang=de', closesAt: '2026-08-08', language: 'de' },
  ], history);
  assert.equal(aligned[0].url, 'https://jobs.example/Acme?lang=fr');
  assert.equal(aligned[1].url, 'https://jobs.example/Acme?lang=en');
  assert.equal(aligned[2].url, 'https://jobs.example/acme?lang=de');
  const selected = selectCloseDateRefreshes(aligned, history);
  const next = [
    history,
    ...selected.map((offer) => historyRow({ url: offer.url, closes_at: closesAtIso(offer.closesAt) })),
  ].join('\n');
  const index = closeDatesByUrl(next);
  assert.equal(closeDateForUrl(index, 'https://jobs.example/Acme?lang=en'), '2026-07-07');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/Acme?lang=fr'), '2026-06-06');
});

test('a tracker URL with no history pin receives the path-case refresh', () => {
  const history = historyRow({ url: 'https://jobs.example/Other', closes_at: '2026-02-02', status: 'added', first_seen: '2026-10-01' });
  const applications = '| 1 | 2026-10-01 | Acme | Analyst | 4/5 | Evaluated | | | https://jobs.example/Acme | |';
  const aligned = alignCloseRefreshOffers([
    { url: 'https://jobs.example/acme', closesAt: '2026-06-06' },
    { url: 'https://jobs.example/other-role', closesAt: '2026-07-07' },
  ], history, {}, { applicationsText: applications });
  assert.equal(aligned[0].url, 'https://jobs.example/Acme');
  assert.equal(aligned[1].url, 'https://jobs.example/other-role');
  const selected = selectCloseDateRefreshes(aligned, history);
  const next = [
    history,
    historyRow({ url: selected[0].url, closes_at: '2026-06-06' }),
  ].join('\n');
  const index = closeDatesByUrl(next);
  assert.equal(closeDateForUrl(index, 'https://jobs.example/Acme'), '2026-06-06');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/other-role'), '');
});

test('a notes link ahead of the URL column does not replace the posting URL', () => {
  const applications = [
    '| # | Notes | Date | Company | Role | Score | Status | PDF | Report | URL |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 1 | see https://jobs.example/acme | 2026-10-01 | Acme | Analyst | 4/5 | Evaluated | | | https://jobs.example/Acme |',
  ].join('\n');
  const aligned = alignCloseRefreshOffers([
    { url: 'https://jobs.example/acme', closesAt: '2026-06-06' },
  ], '', {}, { applicationsText: applications });
  assert.equal(aligned[0].url, 'https://jobs.example/Acme');
});

test('two stored path-case URLs keep their own close days', () => {
  const history = [
    historyRow({ url: 'https://jobs.example/Acme', closes_at: '2026-01-01', status: 'added', first_seen: '2026-10-01' }),
    historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-02-02', status: 'added', first_seen: '2026-10-01' }),
  ].join('\n');
  const aligned = alignCloseRefreshOffers([
    { url: 'https://jobs.example/Acme', closesAt: '2026-06-06' },
    { url: 'https://jobs.example/acme', closesAt: '2026-07-07' },
    { url: 'https://jobs.example/ACME', closesAt: '2026-08-08' },
  ], history);
  assert.equal(aligned[0].url, 'https://jobs.example/Acme');
  assert.equal(aligned[1].url, 'https://jobs.example/acme');
  assert.equal(aligned[2].url, 'https://jobs.example/ACME');
  const selected = selectCloseDateRefreshes(aligned, history);
  const next = [
    history,
    ...selected.map((offer) => historyRow({ url: offer.url, closes_at: closesAtIso(offer.closesAt) })),
  ].join('\n');
  const index = closeDatesByUrl(next);
  assert.equal(closeDateForUrl(index, 'https://jobs.example/Acme'), '2026-06-06');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme'), '2026-07-07');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/ACME'), '2026-08-08');
});

test('an exact tracker path case wins over a different history case', () => {
  const history = historyRow({
    url: 'https://jobs.example/Acme',
    closes_at: '2026-01-01',
    status: 'added',
    first_seen: '2026-10-01',
  });
  const applications = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | URL | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 1 | 2026-10-01 | Acme | Analyst | 4/5 | Evaluated | | | https://jobs.example/Acme | |',
    '| 2 | 2026-10-01 | Acme | Other | 4/5 | Evaluated | | | https://jobs.example/acme | |',
  ].join('\n');
  const aligned = alignCloseRefreshOffers([
    { url: 'https://jobs.example/acme', closesAt: '2026-07-07' },
    { url: 'https://jobs.example/Acme', closesAt: '2026-06-06' },
  ], history, {}, { applicationsText: applications });
  assert.equal(aligned[0].url, 'https://jobs.example/acme');
  assert.equal(aligned[1].url, 'https://jobs.example/Acme');
});

test('a listing identity keeps the offer path case for the tracker match', () => {
  const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
  const key = computeListingFingerprint({ strong: identity }).listing_key;
  const history = historyRow({
    url: 'https://jobs.example/Acme',
    status: 'added',
    first_seen: '2026-10-01',
    listing_key: key,
  });
  const applications = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | URL | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 1 | 2026-10-01 | Acme | Analyst | 4/5 | Evaluated | | | https://jobs.example/Acme | |',
    '| 2 | 2026-10-01 | Acme | Other | 4/5 | Evaluated | | | https://jobs.example/acme | |',
  ].join('\n');
  const job = { url: 'https://jobs.example/acme', listingIdentity: identity, closesAt: '2026-07-07' };
  const { listingRefreshUrls } = collectSeenUrls({ scanHistoryText: history });
  const refreshUrl = closeRefreshUrlForSeenOffer(job, new Set(), listingRefreshUrls);
  const aligned = alignCloseRefreshOffers(
    [{ ...job, url: refreshUrl }],
    history,
    {},
    { applicationsText: applications },
  );
  assert.equal(aligned[0].url, 'https://jobs.example/acme');
});

test('one accepted listing identity refreshes its recorded URL', () => {
  const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
  const recorded = 'https://boards.greenhouse.io/acme/jobs/4012345';
  const key = computeListingFingerprint({ strong: identity }).listing_key;
  const history = historyRow({
    url: recorded,
    status: 'added',
    first_seen: '2026-10-01',
    listing_key: key,
    closes_at: '2026-01-01',
  });
  const job = { url: 'https://jobs.example.test/same-identity', listingIdentity: identity };
  const { listingRefreshUrls } = collectSeenUrls({ scanHistoryText: history });
  assert.equal(closeRefreshUrlForSeenOffer(job, new Set(), listingRefreshUrls), recorded);
  const other = historyRow({
    url: 'https://jobs.example.test/other-copy',
    status: 'added',
    first_seen: '2026-10-01',
    listing_key: key,
  });
  const ambiguous = collectSeenUrls({ scanHistoryText: `${history}\n${other}` });
  assert.equal(closeRefreshUrlForSeenOffer(job, new Set(), ambiguous.listingRefreshUrls), '');
});

test('a listing refresh follows the offer language, and a seen URL stands alone', () => {
  const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
  const key = computeListingFingerprint({ strong: identity }).listing_key;
  const en = 'https://jobs.example/acme-en';
  const fr = 'https://jobs.example/acme-fr';
  const history = [
    historyRow({ url: en, status: 'added', first_seen: '2026-10-01', listing_key: key, language: 'en' }),
    historyRow({ url: fr, status: 'added', first_seen: '2026-10-01', listing_key: key, language: 'fr' }),
  ].join('\n');
  const { listingRefreshUrls } = collectSeenUrls({ scanHistoryText: history });
  const parsed = { url: 'https://jobs.example.test/parsed', listingIdentity: identity, language: 'fr' };
  assert.equal(closeRefreshUrlForSeenOffer(parsed, new Set(), listingRefreshUrls), fr);
  assert.equal(closeRefreshUrlForSeenOffer({ ...parsed, language: 'en' }, new Set(), listingRefreshUrls), en);
  const plain = { url: 'https://jobs.example/acme' };
  assert.equal(closeRefreshUrlForSeenOffer(plain, new Set([seenJobKey(plain.url)]), new Map()), plain.url);
});

test('a different language does not refresh the seen URL of the same listing', () => {
  const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
  const key = computeListingFingerprint({ strong: identity }).listing_key;
  const url = 'https://jobs.example/acme';
  const history = historyRow({
    url,
    status: 'added',
    first_seen: '2026-10-01',
    listing_key: key,
    language: 'en',
    closes_at: '2026-01-01',
  });
  const { listingRefreshUrls } = collectSeenUrls({ scanHistoryText: history });
  const seen = new Set([seenJobKey(url)]);
  const job = { url, listingIdentity: identity, language: 'fr' };
  assert.equal(closeRefreshUrlForSeenOffer(job, seen, listingRefreshUrls), '');
  assert.equal(closeRefreshUrlForSeenOffer({ ...job, language: 'en' }, seen, listingRefreshUrls), url);
});

test('an expired history row still blocks a different language on its URL', () => {
  const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
  const key = computeListingFingerprint({ strong: identity }).listing_key;
  const url = 'https://jobs.example/acme';
  const history = historyRow({
    url,
    status: 'added',
    first_seen: '2026-01-01',
    listing_key: key,
    language: 'en',
  });
  const policy = { recheckAfterDays: 30, today: '2026-11-05' };
  const released = collectSeenUrls({ scanHistoryText: history }, policy);
  assert.equal(released.seen.has(seenJobKey(url)), false);
  const job = { url, listingIdentity: identity, language: 'fr' };
  const tracked = new Set([seenJobKey(url)]);
  assert.equal(closeRefreshUrlForSeenOffer(job, tracked, released.listingRefreshUrls), '');
  assert.equal(closeRefreshUrlForSeenOffer({ ...job, language: 'en' }, tracked, released.listingRefreshUrls), url);
  const other = { url: 'https://jobs.example/other', language: 'fr' };
  assert.equal(closeRefreshUrlForSeenOffer(other, new Set([seenJobKey(other.url)]), released.listingRefreshUrls), other.url);
});

test('an aged row without a listing key blocks a different language', () => {
  const url = 'https://jobs.example/acme';
  const history = historyRow({
    url,
    status: 'added',
    first_seen: '2026-01-01',
    language: 'en',
  });
  const released = collectSeenUrls({ scanHistoryText: history }, { recheckAfterDays: 30, today: '2026-11-05' });
  assert.equal(released.seen.has(seenJobKey(url)), false);
  const tracked = new Set([seenJobKey(url)]);
  const french = { url, language: 'fr' };
  assert.equal(closeRefreshUrlForSeenOffer(french, tracked, released.listingRefreshUrls, released.urlRefreshLanguages), '');
  assert.equal(closeRefreshUrlForSeenOffer({ url, language: 'en' }, tracked, released.listingRefreshUrls, released.urlRefreshLanguages), url);
  const other = { url: 'https://jobs.example/other', language: 'fr' };
  assert.equal(closeRefreshUrlForSeenOffer(other, new Set([seenJobKey(other.url)]), new Map(), released.urlRefreshLanguages), other.url);
});

test('an exact current alias refreshes when an older alias has expired', () => {
  const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
  const key = computeListingFingerprint({ strong: identity }).listing_key;
  const oldUrl = 'https://jobs.example/acme-old';
  const current = 'https://jobs.example/acme';
  const history = [
    historyRow({
      url: oldUrl,
      status: 'added',
      first_seen: '2026-01-01',
      listing_key: key,
      language: 'en',
      closes_at: '2026-02-01',
    }),
    historyRow({
      url: current,
      status: 'added',
      first_seen: '2026-11-01',
      listing_key: key,
      language: 'en',
      closes_at: '2026-03-01',
    }),
  ].join('\n');
  const released = collectSeenUrls({ scanHistoryText: history }, { recheckAfterDays: 30, today: '2026-11-05' });
  const job = { url: current, listingIdentity: identity, language: 'en' };
  assert.equal(closeRefreshUrlForSeenOffer(job, released.seen, released.listingRefreshUrls, released.urlRefreshLanguages), current);
  const third = { url: 'https://jobs.example/acme-third', listingIdentity: identity, language: 'en' };
  assert.equal(closeRefreshUrlForSeenOffer(third, released.seen, released.listingRefreshUrls, released.urlRefreshLanguages), '');
});

test('an expired path-case sibling still receives the close day', () => {
  const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
  const key = computeListingFingerprint({ strong: identity }).listing_key;
  const stored = 'https://jobs.example/Acme';
  const current = 'https://jobs.example/acme';
  const history = [
    historyRow({
      url: stored,
      status: 'added',
      first_seen: '2026-01-01',
      listing_key: key,
      language: 'en',
      closes_at: '2026-02-01',
    }),
    historyRow({
      url: 'https://jobs.example/other',
      status: 'added',
      first_seen: '2026-11-01',
      listing_key: key,
      language: 'en',
    }),
  ].join('\n');
  const policy = { recheckAfterDays: 30, today: '2026-11-05' };
  const tracker = (url) => [
    '| # | Date | Company | Role | Score | Status | PDF | Report | URL | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| 1 | 2026-10-01 | Acme | Analyst | 4/5 | Evaluated | | | ${url} | |`,
  ].join('\n');
  const released = collectSeenUrls({ scanHistoryText: history }, policy);
  const job = { url: current, listingIdentity: identity, language: 'en', closesAt: '2026-07-07' };
  const refreshUrl = closeRefreshUrlForSeenOffer(job, released.seen, released.listingRefreshUrls, released.urlRefreshLanguages);
  const onStored = alignCloseRefreshOffers(
    [{ ...job, url: refreshUrl }],
    history,
    policy,
    { applicationsText: tracker(stored) },
  );
  assert.equal(onStored[0].url, stored);
  const onExact = alignCloseRefreshOffers(
    [{ ...job, url: refreshUrl }],
    history,
    policy,
    { applicationsText: tracker(current) },
  );
  assert.equal(onExact[0].url, current);
});


