import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlacklist, findBlacklistEntry } from '../scan.mjs';
import { filterBlacklistedOffers } from '../scan-ats-full.mjs';

const table = rows => '| Company | Since | Scope | Reason |\n|---|---|---|---|\n' + rows.join('\n');

test('distinct dotted and hyphenated domains both filter postings in either row order', () => {
  const rows = [
    '| a.b.example | 2026-01-01 | domain | dotted |',
    '| a-b.example | 2026-01-01 | domain | hyphenated |',
  ];
  for (const ordered of [rows, [...rows].reverse()]) {
    const blacklist = parseBlacklist(table(ordered));
    assert.equal(blacklist.size, 2);
    const offers = [
      { company: 'ExampleCo', url: 'https://jobs.a.b.example/1' },
      { company: 'ExampleCo', url: 'https://a-b.example/2' },
      { company: 'ExampleCo', url: 'https://nota-b.example/3' },
    ];
    assert.equal(findBlacklistEntry(blacklist, 'ExampleCo', offers[0].url)?.reason, 'dotted');
    assert.equal(findBlacklistEntry(blacklist, 'ExampleCo', offers[1].url)?.reason, 'hyphenated');
    assert.equal(findBlacklistEntry(blacklist, 'ExampleCo', offers[2].url), null);
    assert.deepEqual(filterBlacklistedOffers(offers, blacklist).offers, [offers[2]]);
  }
});

test('company and domain scopes coexist, with canonical domain duplicates keeping the first row', () => {
  const blacklist = parseBlacklist(table([
    '| A.B.Example. | 2026-01-01 | DOMAIN | first domain |',
    '| a.b.example | 2026-01-02 | domain | duplicate domain |',
    '| abexample | 2026-01-03 | company | company rule |',
    '| . | 2026-01-04 | domain | empty suffix |',
  ]));
  assert.equal(blacklist.size, 2);
  assert.equal(findBlacklistEntry(blacklist, 'Other', 'https://jobs.a.b.example./1')?.reason, 'first domain');
  assert.equal(findBlacklistEntry(blacklist, 'AB-Example', 'invalid')?.reason, 'company rule');
  assert.equal(findBlacklistEntry(blacklist, 'Other', 'invalid'), null);
  assert.equal(findBlacklistEntry(blacklist, 'Other', undefined), null);
});
