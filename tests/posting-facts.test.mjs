// Per-posting facts for the Today "Awaiting your decision" cards: when the
// scan first saw the posting, the board's own posting date, and the last
// conclusive liveness verdict.
//
// Run:  node --test tests/posting-facts.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';
import { postingFactsIndex, postingFactsForUrl, mergeLivenessLog, parseLivenessLog } from '../lib/posting-facts.mjs';

const row = (fields) => SCAN_HISTORY_COLUMNS.map((c) => fields[c] ?? '').join('\t');
const HEADER = SCAN_HISTORY_COLUMNS.join('\t');

test('first_seen is the earliest row for the posting, posted_at the first non-empty one', () => {
  const text = [
    HEADER,
    row({ url: 'https://boards.example.com/jobs/1', first_seen: '2026-11-10', status: 'added', posted_at: '' }),
    row({ url: 'https://boards.example.com/jobs/1?utm_source=x', first_seen: '2026-11-05', status: 'added', posted_at: '2026-11-01' }),
    row({ url: 'https://boards.example.com/jobs/2', first_seen: '2026-11-12', status: 'added' }),
  ].join('\n');
  const index = postingFactsIndex(text, '');
  const one = postingFactsForUrl(index, 'https://boards.example.com/jobs/1');
  assert.equal(one.firstSeen, '2026-11-05');
  assert.equal(one.postedAt, '2026-11-01');
  const two = postingFactsForUrl(index, 'https://boards.example.com/jobs/2');
  assert.equal(two.firstSeen, '2026-11-12');
  assert.equal(two.postedAt, '', 'no posting date from the source stays empty, never guessed');
});

test('an unknown url or a malformed date yields no facts instead of a guess', () => {
  const text = [HEADER, row({ url: 'https://a.example.com/j/1', first_seen: 'garbage', posted_at: '2026-13-45' })].join('\n');
  const index = postingFactsIndex(text, '');
  const facts = postingFactsForUrl(index, 'https://a.example.com/j/1');
  assert.equal(facts.firstSeen, '');
  assert.equal(facts.postedAt, '');
  assert.equal(postingFactsForUrl(index, 'https://nowhere.example.com/x'), null);
  assert.equal(postingFactsForUrl(index, ''), null);
});

test('a headerless history keeps its first row', () => {
  const text = row({ url: 'https://a.example.com/j/9', first_seen: '2026-11-01', status: 'added' });
  assert.equal(postingFactsForUrl(postingFactsIndex(text, ''), 'https://a.example.com/j/9').firstSeen, '2026-11-01');
});

test('liveness log: latest conclusive verdict per posting wins', () => {
  let log = '';
  log = mergeLivenessLog(log, [{ url: 'https://a.example.com/j/1', result: 'active', code: 'ok' }], '2026-11-20');
  log = mergeLivenessLog(log, [{ url: 'https://a.example.com/j/1?utm_source=z', result: 'expired', code: 'expired_banner', reason: 'closed' }], '2026-11-22');
  const parsed = parseLivenessLog(log);
  assert.equal(parsed.size, 1);
  assert.deepEqual(parsed.get('https://a.example.com/j/1'), { result: 'expired', day: '2026-11-22', at: '2026-11-22' });
});

test('liveness log: uncertain and unreadable verdicts never overwrite a conclusive one', () => {
  let log = mergeLivenessLog('', [{ url: 'https://a.example.com/j/1', result: 'active', code: 'ok' }], '2026-11-20');
  log = mergeLivenessLog(log, [
    { url: 'https://a.example.com/j/1', result: 'uncertain', code: 'blocked' },
    { url: 'https://a.example.com/j/2', result: 'expired', code: 'insufficient_content' },
  ], '2026-11-22');
  const parsed = parseLivenessLog(log);
  assert.deepEqual(parsed.get('https://a.example.com/j/1'), { result: 'active', day: '2026-11-20', at: '2026-11-20' });
  assert.equal(parsed.has('https://a.example.com/j/2'), false);
});

test('liveness log: a newer row written after an older one still wins when parsing raw text', () => {
  const log = [
    'url\tchecked_at\tresult',
    'https://a.example.com/j/1\t2026-11-23T10:00:00\texpired',
    'https://a.example.com/j/1\t2026-11-23T09:00:00\tactive',
  ].join('\n');
  assert.deepEqual(parseLivenessLog(log).get('https://a.example.com/j/1'), {
    result: 'expired', day: '2026-11-23', at: '2026-11-23T10:00:00',
  });
});

test('mergeLivenessLog selects the URL from a conclusive row, not a newer uncertain one', () => {
  const log = [
    'url\tchecked_at\tresult',
    'https://a.example.com/j/1\t2026-11-20\tactive',
    'https://a.example.com/j/1?utm_source=uncertain\t2026-11-22\tuncertain',
  ].join('\n');
  const lines = mergeLivenessLog(log, [], '2026-11-23').split('\n')
    .filter((line) => line && !line.startsWith('url\t'));
  assert.equal(lines.length, 1);
  assert.ok(
    lines[0].startsWith('https://a.example.com/j/1\t') && !lines[0].includes('utm_source'),
    `URL must come from the conclusive row: ${lines[0]}`,
  );
});

test('facts carry the liveness verdict joined by posting url', () => {
  const log = mergeLivenessLog('', [{ url: 'https://a.example.com/j/1', result: 'active', code: 'ok' }], '2026-11-20');
  const index = postingFactsIndex('', log);
  assert.deepEqual(postingFactsForUrl(index, 'https://a.example.com/j/1').check, { result: 'active', day: '2026-11-20' });
});

test('liveness log: a late commit of an older observation keeps the newer verdict', () => {
  const url = 'https://a.example.com/j/1';
  // Sweep B saw it closed at 10:00 and committed first.
  let log = mergeLivenessLog('', [{ url, result: 'expired', code: 'expired_banner', checkedAt: '2026-11-23T10:00:00' }], '2026-11-23');
  // Sweep A saw it open at 09:00 and committed later.
  log = mergeLivenessLog(log, [{ url, result: 'active', code: 'ok', checkedAt: '2026-11-23T09:00:00' }], '2026-11-23');
  const kept = parseLivenessLog(log).get(url);
  assert.equal(kept.result, 'expired');
  assert.equal(kept.day, '2026-11-23');
  // A later observation still replaces it.
  log = mergeLivenessLog(log, [{ url, result: 'active', code: 'ok', checkedAt: '2026-11-23T11:00:00' }], '2026-11-23');
  assert.equal(parseLivenessLog(log).get(url).result, 'active');
});

test('liveness log: offset stamps order by real time across a DST change or a move west', () => {
  const url = 'https://a.example.com/j/1';
  // Open at 01:30 CDT; closed 40 minutes later at 01:10 CST, after the clocks fell back.
  let log = mergeLivenessLog('', [{ url, result: 'active', code: 'ok', checkedAt: '2026-11-01T01:30:00-05:00' }], '2026-11-01');
  log = mergeLivenessLog(log, [{ url, result: 'expired', code: 'expired_banner', checkedAt: '2026-11-01T01:10:00-06:00' }], '2026-11-01');
  assert.equal(parseLivenessLog(log).get(url).result, 'expired');
  assert.match(log, /\t2026-11-01T01:10:00-06:00\texpired\n/);
  // The earlier open check committing late does not replace the closed one.
  log = mergeLivenessLog(log, [{ url, result: 'active', code: 'ok', checkedAt: '2026-11-01T01:30:00-05:00' }], '2026-11-01');
  assert.equal(parseLivenessLog(log).get(url).result, 'expired');
  // Open at 14:00 UTC; closed at 10:00 five hours west, one hour later in real time.
  log = mergeLivenessLog('', [{ url, result: 'active', code: 'ok', checkedAt: '2026-11-23T14:00:00+00:00' }], '2026-11-23');
  log = mergeLivenessLog(log, [{ url, result: 'expired', code: 'expired_banner', checkedAt: '2026-11-23T10:00:00-05:00' }], '2026-11-23');
  assert.deepEqual(postingFactsForUrl(postingFactsIndex('', log), url).check, { result: 'expired', day: '2026-11-23' });
});

test('liveness log: an older observation from an earlier day does not replace a newer day', () => {
  const url = 'https://a.example.com/j/1';
  let log = mergeLivenessLog('', [{ url, result: 'expired', code: 'expired_banner' }], '2026-11-23');
  log = mergeLivenessLog(log, [{ url, result: 'active', code: 'ok', checkedAt: '2026-11-22T23:59:00' }], '2026-11-23');
  assert.deepEqual(postingFactsForUrl(postingFactsIndex('', log), url).check, { result: 'expired', day: '2026-11-23' });
});
