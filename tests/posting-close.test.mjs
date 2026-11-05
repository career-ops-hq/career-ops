import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDateForUrl, closeDatesByUrl, closesAtIso, stripQuery } from '../lib/posting-close.mjs';
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

test('scan history indexes a close day by exact URL and by URL without the query', () => {
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
      url: 'https://jobs.example/northwind?src=board',
      company: 'Northwind Traders',
      closes_at: '2026-09-15',
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
  assert.equal(index.get('https://jobs.example/northwind?src=board'), '2026-09-15');
  assert.equal(index.get('https://jobs.example/northwind'), '2026-09-15');
  assert.equal(index.has('https://jobs.example/blank'), false);
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme-exact'), '2026-10-03');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/acme-exact?src=email'), '2026-10-03');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/northwind'), '2026-09-15');
  assert.equal(closeDateForUrl(index, 'https://jobs.example/other'), '');
  assert.equal(closeDateForUrl(index, ''), '');
});

test('a later scan-history day replaces an earlier one for the same URL', () => {
  const text = [
    historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-01-01' }),
    historyRow({ url: 'https://jobs.example/acme', closes_at: '2026-04-04' }),
  ].join('\n');
  assert.equal(closeDatesByUrl(text).get('https://jobs.example/acme'), '2026-04-04');
});

test('stripQuery removes the query and keeps the hash', () => {
  assert.equal(stripQuery('https://jobs.example/acme?src=board'), 'https://jobs.example/acme');
  assert.equal(stripQuery('https://jobs.example/acme#apply'), 'https://jobs.example/acme#apply');
  assert.equal(stripQuery('https://jobs.example/acme'), 'https://jobs.example/acme');
  assert.equal(stripQuery(''), '');
});

