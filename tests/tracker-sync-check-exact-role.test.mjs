// tests/tracker-sync-check-exact-role.test.mjs: an interview row whose company
// and role match one tracker row exactly is matched to that row, even when the
// same employer has other rows with near-miss titles that roleFuzzyMatch also
// accepts. Rows from different employers stay ambiguous.
//
// Run:  node --test tests/tracker-sync-check-exact-role.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchInterviewRow } from '../tracker-sync-check.mjs';

const entries = [
  { num: 107, company: 'Saltmarsh Energy', role: 'Revenue Analytics Manager', status: 'Interview', lineNum: 5 },
  { num: 228, company: 'Saltmarsh Energy', role: 'Revenue Analytics Manager, Clinical', status: 'Applied', lineNum: 6 },
  { num: 238, company: 'Saltmarsh Energy', role: 'Revenue Analytics Manager, Platform', status: 'Discarded', lineNum: 7 },
];

const match = (row, list) => {
  const r = matchInterviewRow({ Notes: '', ...row }, list);
  return { num: r.entry?.num ?? null, method: r.method };
};

test('one exact company and role match wins over near-miss titles at the same employer', () => {
  assert.deepEqual(match({ Company: 'Saltmarsh Energy', Role: 'Revenue Analytics Manager' }, entries), { num: 107, method: 'fuzzy' });
});

test('the exact match is case and spacing insensitive', () => {
  assert.deepEqual(match({ Company: 'saltmarsh energy', Role: '  revenue analytics  manager ' }, entries), { num: 107, method: 'fuzzy' });
});

test('two exact matches at the same employer stay ambiguous', () => {
  const repost = [...entries, { num: 294, company: 'Saltmarsh Energy', role: 'Revenue Analytics Manager', status: 'SKIP', lineNum: 8 }];
  assert.deepEqual(match({ Company: 'Saltmarsh Energy', Role: 'Revenue Analytics Manager' }, repost), { num: null, method: 'unmatched' });
});

test('a near-miss title with no exact row stays ambiguous', () => {
  assert.deepEqual(match({ Company: 'Saltmarsh Energy', Role: 'Manager, Revenue Analytics' }, entries), { num: null, method: 'unmatched' });
});

test('candidates from different employers stay ambiguous', () => {
  const mixed = [
    { num: 301, company: 'Acme Partners', role: 'Program Manager', status: 'Applied', lineNum: 1 },
    { num: 302, company: 'Acme Partners Group Studio', role: 'Program Manager', status: 'Applied', lineNum: 2 },
  ];
  assert.deepEqual(match({ Company: 'Acme Partners', Role: 'Program Manager' }, mixed), { num: null, method: 'unmatched' });
});
