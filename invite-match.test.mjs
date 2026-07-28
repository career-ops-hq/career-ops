/**
 * invite-match.test.mjs — regression tests for invite-match.mjs's ambiguous-
 * match ranking, which is the part most likely to silently regress: a wrong
 * top candidate is worse than no candidate at all.
 *
 * Run: node invite-match.test.mjs
 */

import { matchInvite, normalizeCompanyName } from './invite-match.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

const rows = [
  { num: 201, company: 'Northwind Traders', role: 'Ops Coordinator', status: 'Applied', date: '2026-05-01', notes: '' },
  { num: 202, company: 'Northwind Traders', role: 'HR Assistant', status: 'Interview', date: '2026-05-15', notes: '' },
  { num: 203, company: 'Northwind Traders', role: 'Analyst', status: 'Rejected', date: '2026-04-10', notes: 'Rejected 2026-04-20' },
];

// Three tracker rows for the same company at three different statuses — the
// Interview row must outrank both Applied and Rejected, since an in-progress
// interview is the most likely thing a new invite email is about.
const result = matchInvite({ company: 'Northwind Traders', date: null, reqId: null }, rows);
eq('all three same-company candidates are returned, not just the top one', result.length, 3);
eq('Interview-status row ranks first among same-name candidates', result[0].appNumber, 202);
eq('Rejected-status row ranks last among same-name candidates', result[result.length - 1].appNumber, 203);

// A company name that only partially overlaps (e.g. recruiter drops a
// division name) must still resolve, but must not outrank an exact match
// when both are present in the tracker.
const mixedRows = [
  ...rows,
  { num: 204, company: 'Northwind', role: 'Coordinator', status: 'Applied', date: '2026-06-01', notes: '' },
];
const partial = matchInvite({ company: 'Northwind', date: null, reqId: null }, mixedRows);
eq('exact "Northwind" match outranks the longer "Northwind Traders" partial matches', partial[0].appNumber, 204);

// normalizeCompanyName must be idempotent — normalizing an already-normalized
// string must return it unchanged, otherwise repeated normalization could
// drift the matching key across call sites.
const once = normalizeCompanyName('Acme Technologies Inc.');
eq('normalizeCompanyName is idempotent', normalizeCompanyName(once), once);

// A req ID that appears verbatim in a row's notes must outrank a same-name
// row without it, even though both have identical name similarity — this is
// the strongest disambiguation signal the matcher has, so it must actually
// move the ranking, not just add a negligible tiebreaker.
const reqIdRows = [
  { num: 301, company: 'Fabrikam', role: 'Engineer', status: 'Applied', date: '2026-05-01', notes: '' },
  { num: 302, company: 'Fabrikam', role: 'Engineer II', status: 'Applied', date: '2026-05-02', notes: 'req R-4821 mentioned' },
];
const reqIdResult = matchInvite({ company: 'Fabrikam', date: null, reqId: 'R-4821' }, reqIdRows);
eq('row with matching reqId in notes outranks identical-name row without it', reqIdResult[0].appNumber, 302);

// The req-ID boost must be case-insensitive: the invite and the tracker
// notes may case the same ID differently ("r-4821" vs "R-4821"), and a
// casing mismatch silently dropping the strongest signal is exactly the
// kind of regression this suite exists to catch.
const reqIdCaseResult = matchInvite({ company: 'Fabrikam', date: null, reqId: 'r-4821' }, reqIdRows);
eq('reqId boost still applies when invite cases the ID differently than the notes', reqIdCaseResult[0].appNumber, 302);

// Two distinct companies that each end in a *different pair* of chained
// generic descriptor words must not erode down to the same root — this is
// the actual over-stripping bug raised on PR #1497: chaining generic-word
// removal (not just legal-suffix removal) let "X Solutions Group" and
// "X Technologies Holdings" both collapse all the way to "x". Limiting
// generic-descriptor stripping to a single, non-chained pass stops at the
// first strip instead of eating through both words.
eq(
  'chained generic descriptors ("Solutions Group" vs "Technologies Holdings") do not erode to the same key',
  normalizeCompanyName('Northwind Solutions Group') === normalizeCompanyName('Northwind Technologies Holdings'),
  false
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
