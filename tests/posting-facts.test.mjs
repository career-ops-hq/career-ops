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
  assert.deepEqual(parsed.get('https://a.example.com/j/1'), { result: 'expired', day: '2026-11-22' });
});

test('liveness log: uncertain and unreadable verdicts never overwrite a conclusive one', () => {
  let log = mergeLivenessLog('', [{ url: 'https://a.example.com/j/1', result: 'active', code: 'ok' }], '2026-11-20');
  log = mergeLivenessLog(log, [
    { url: 'https://a.example.com/j/1', result: 'uncertain', code: 'blocked' },
    { url: 'https://a.example.com/j/2', result: 'expired', code: 'insufficient_content' },
  ], '2026-11-22');
  const parsed = parseLivenessLog(log);
  assert.deepEqual(parsed.get('https://a.example.com/j/1'), { result: 'active', day: '2026-11-20' });
  assert.equal(parsed.has('https://a.example.com/j/2'), false);
});

test('facts carry the liveness verdict joined by posting url', () => {
  const log = mergeLivenessLog('', [{ url: 'https://a.example.com/j/1', result: 'active', code: 'ok' }], '2026-11-20');
  const index = postingFactsIndex('', log);
  assert.deepEqual(postingFactsForUrl(index, 'https://a.example.com/j/1').check, { result: 'active', day: '2026-11-20' });
});
