/**
 * detect-reposts.test.mjs — Systematic test suite for detect-reposts.mjs
 *
 * Tests every exported and internal function across:
 * - Input validation (malformed, missing, boundary values)
 * - Date handling (calendar validity, format, edge dates)
 * - TSV parsing (column count, whitespace, special chars)
 * - Row filtering (status, empty fields, type coercion)
 * - Company grouping (case sensitivity, unicode, whitespace)
 * - Title matching (exact, fuzzy, variations, empty, unicode)
 * - Window logic (boundary days, transitive chains, sliding window)
 * - URL deduplication (same URL, multiple sightings, dedup + repost)
 * - Cluster output shape (all fields present, correct types)
 * - CLI behavior (args, flags, missing file)
 * - Integration (full TSV round-trip, multi-company, mixed statuses)
 *
 * Run: node detect-reposts.test.mjs
 */

import { detectReposts, parseScanHistory } from './detect-reposts.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}

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

// Helper: create a row object with sensible defaults
function row(overrides) {
  return {
    url: 'https://example.com/jobs/1',
    date: new Date('2026-01-01T00:00:00Z'),
    dateStr: '2026-01-01',
    title: 'Backend Engineer Platform',
    company: 'Acme',
    status: 'added',
    portal: 'greenhouse',
    location: 'Remote',
    ...overrides,
  };
}

// Helper: create a date from ISO string
function d(iso) {
  return new Date(iso + 'T00:00:00Z');
}

// ============================================================================
// 1. parseDate (replicated for testing — internal function not exported)
// ============================================================================
console.log('\n--- 1. parseDate ---');

function parseDate(dateStr) {
  const iso = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return date;
}

// Valid dates
ok('valid date 2026-01-01', parseDate('2026-01-01') !== null);
ok('valid date 2026-12-31', parseDate('2026-12-31') !== null);
ok('valid date 2024-02-29 (leap year)', parseDate('2024-02-29') !== null);
ok('valid date 2026-06-15', parseDate('2026-06-15') !== null);
ok('returns Date object for valid input', parseDate('2026-01-01') instanceof Date);

// Calendar-invalid dates (the CodeRabbit bug)
eq('2024-02-31 rejected (rolls to March)', parseDate('2024-02-31'), null);
eq('2024-13-01 rejected (month 13)', parseDate('2024-13-01'), null);
eq('2024-00-01 rejected (month 0)', parseDate('2024-00-01'), null);
eq('2024-01-00 rejected (day 0)', parseDate('2024-01-00'), null);
eq('2024-01-32 rejected (day 32)', parseDate('2024-01-32'), null);
eq('2023-02-29 rejected (not leap year)', parseDate('2023-02-29'), null);
eq('2024-02-30 rejected (Feb 30 never exists)', parseDate('2024-02-30'), null);

// Format validation
eq('null rejected', parseDate(null), null);
eq('undefined rejected', parseDate(undefined), null);
eq('empty string rejected', parseDate(''), null);
eq('whitespace-only rejected', parseDate('   '), null);
eq('wrong format (slashes) rejected', parseDate('2026/01/01'), null);
eq('wrong format (dots) rejected', parseDate('2026.01.01'), null);
eq('wrong format (no dashes) rejected', parseDate('20260101'), null);
eq('partial date rejected', parseDate('2026-01'), null);
eq('extra characters rejected', parseDate('2026-01-01T00:00:00Z'), null);
eq('negative year rejected', parseDate('-001-01-01'), null);
eq('5-digit year rejected', parseDate('10000-01-01'), null);
eq('2-digit year rejected', parseDate('26-01-01'), null);
eq('single digit month rejected', parseDate('2026-1-01'), null);
eq('single digit day rejected', parseDate('2026-01-1'), null);

// Whitespace handling
ok('whitespace trimmed (valid)', parseDate('  2026-01-01  ') !== null);
ok('tab trimmed (valid)', parseDate('\t2026-01-01\t') !== null);

// Type coercion
ok('number coerced to string (20260101 -> not valid format)', parseDate(20260101) === null);
ok('object coerced to string', parseDate({}) === null);

// Round-trip: parsed date toISOString should match input
const rt = parseDate('2026-06-15');
eq('round-trip toISOString matches input', rt.toISOString().slice(0, 10), '2026-06-15');

// ============================================================================
// 2. daysBetween
// ============================================================================
console.log('\n--- 2. daysBetween ---');

function daysBetween(d1, d2) {
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

eq('same day = 0', daysBetween(d('2026-01-01'), d('2026-01-01')), 0);
eq('1 day apart', daysBetween(d('2026-01-01'), d('2026-01-02')), 1);
eq('30 days apart', daysBetween(d('2026-01-01'), d('2026-01-31')), 30);
eq('365 days apart', daysBetween(d('2026-01-01'), d('2027-01-01')), 365);
eq('negative (reverse order)', daysBetween(d('2026-01-02'), d('2026-01-01')), -1);
eq('crosses month boundary', daysBetween(d('2026-01-31'), d('2026-02-01')), 1);
eq('crosses year boundary', daysBetween(d('2026-12-31'), d('2027-01-01')), 1);
eq('leap year Feb 29 exists', daysBetween(d('2024-02-28'), d('2024-02-29')), 1);
eq('non-leap year Feb 28 to Mar 1', daysBetween(d('2023-02-28'), d('2023-03-01')), 1);

// DST handling: both dates use UTC (T00:00:00Z), so no DST drift
eq('DST spring forward (Mar 9-10 2026)', daysBetween(d('2026-03-08'), d('2026-03-09')), 1);
eq('DST fall back (Nov 1-2 2026)', daysBetween(d('2026-11-01'), d('2026-11-02')), 1);

// ============================================================================
// 3. detectReposts — input validation
// ============================================================================
console.log('\n--- 3. detectReposts input validation ---');

eq('null input -> empty', detectReposts(null), []);
eq('undefined input -> empty', detectReposts(undefined), []);
eq('empty array -> empty', detectReposts([]), []);
eq('single row -> empty', detectReposts([row()]), []);
eq('two rows same company different role -> empty (no match)', detectReposts([
  row({ url: 'https://x.com/1', title: 'Backend Engineer Platform' }),
  row({ url: 'https://x.com/2', title: 'Product Marketing Manager Senior' }),
]), []);

// Status filtering
eq('skipped_expired rows ignored', detectReposts([
  row({ url: 'https://x.com/1', status: 'skipped_expired' }),
  row({ url: 'https://x.com/2', status: 'skipped_expired', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]), []);
eq('skipped_invalid_url rows ignored', detectReposts([
  row({ url: 'https://x.com/1', status: 'skipped_invalid_url' }),
  row({ url: 'https://x.com/2', status: 'skipped_invalid_url', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]), []);
eq('skipped_blocked_host rows ignored', detectReposts([
  row({ url: 'https://x.com/1', status: 'skipped_blocked_host' }),
  row({ url: 'https://x.com/2', status: 'skipped_blocked_host', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]), []);
eq('mixed status: only added rows used', detectReposts([
  row({ url: 'https://x.com/1', status: 'added' }),
  row({ url: 'https://x.com/2', status: 'skipped_expired', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

// Empty field filtering (CodeRabbit fix 2)
eq('empty url -> filtered', detectReposts([
  row({ url: '' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);
eq('null url -> filtered', detectReposts([
  row({ url: null }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);
eq('whitespace-only url -> filtered', detectReposts([
  row({ url: '   ' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);
eq('empty company -> filtered (no cross-company false positive)', detectReposts([
  row({ url: 'https://a.com/1', company: '' }),
  row({ url: 'https://b.com/2', company: '', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);
eq('whitespace-only company -> filtered', detectReposts([
  row({ url: 'https://a.com/1', company: '  ' }),
  row({ url: 'https://b.com/2', company: '  ', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);
eq('empty title -> filtered', detectReposts([
  row({ url: 'https://a.com/1', title: '' }),
  row({ url: 'https://a.com/2', title: '', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);
eq('whitespace-only title -> filtered', detectReposts([
  row({ url: 'https://a.com/1', title: '  ' }),
  row({ url: 'https://a.com/2', title: '  ', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);
eq('null date -> filtered', detectReposts([
  row({ url: 'https://a.com/1', date: null }),
  row({ url: 'https://a.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

// CodeRabbit: type coercion and edge cases
eq('null row in array -> no crash', detectReposts([
  null,
  row({ url: 'https://a.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('undefined row in array -> no crash', detectReposts([
  undefined,
  row({ url: 'https://a.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('non-string company (number 123) -> filtered, no crash', detectReposts([
  row({ url: 'https://a.com/1', company: 123 }),
  row({ url: 'https://a.com/2', company: 123, date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('non-string title (number) -> filtered, no crash', detectReposts([
  row({ url: 'https://a.com/1', title: 123 }),
  row({ url: 'https://a.com/2', title: 123, date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('string date (not Date object) -> filtered, no crash', detectReposts([
  row({ url: 'https://a.com/1', date: '2026-01-01' }),
  row({ url: 'https://a.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('invalid Date object -> filtered, no crash', detectReposts([
  row({ url: 'https://a.com/1', date: new Date('invalid') }),
  row({ url: 'https://a.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('null row object -> filtered', detectReposts([
  row({ url: 'https://a.com/1' }),
  null,
  row({ url: 'https://a.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// ============================================================================
// 4. detectReposts — company grouping
// ============================================================================
console.log('\n--- 4. company grouping ---');

eq('case insensitive: ACME == acme == Acme', detectReposts([
  row({ url: 'https://a.com/1', company: 'ACME', title: 'Backend Engineer Platform' }),
  row({ url: 'https://a.com/2', company: 'acme', date: d('2026-02-01'), dateStr: '2026-02-01' }),
  row({ url: 'https://a.com/3', company: 'Acme', date: d('2026-03-01'), dateStr: '2026-03-01' }),
]).length, 1);

eq('different companies not grouped', detectReposts([
  row({ url: 'https://a.com/1', company: 'Acme', title: 'Backend Engineer Platform' }),
  row({ url: 'https://b.com/2', company: 'Beta', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('unicode company names grouped correctly', detectReposts([
  row({ url: 'https://t.com/1', company: 'Тинькофф', title: 'Backend Engineer Platform' }),
  row({ url: 'https://t.com/2', company: 'Тинькофф', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('company with trailing whitespace trimmed', detectReposts([
  row({ url: 'https://a.com/1', company: 'Acme ', title: 'Backend Engineer Platform' }),
  row({ url: 'https://a.com/2', company: ' Acme', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// ============================================================================
// 5. detectReposts — title matching
// ============================================================================
console.log('\n--- 5. title matching ---');

eq('identical titles match', detectReposts([
  row({ url: 'https://x.com/1', title: 'Senior Backend Engineer Payments' }),
  row({ url: 'https://x.com/2', title: 'Senior Backend Engineer Payments', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('fuzzy match: word order variation', detectReposts([
  row({ url: 'https://x.com/1', title: 'Senior Backend Engineer Payments' }),
  row({ url: 'https://x.com/2', title: 'Backend Engineer Payments Senior', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('fuzzy match: minor wording change', detectReposts([
  row({ url: 'https://x.com/1', title: 'Senior Backend Engineer Payments Processing' }),
  row({ url: 'https://x.com/2', title: 'Backend Engineer Payments Processing Senior', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('distinct roles NOT matched', detectReposts([
  row({ url: 'https://x.com/1', title: 'Senior Backend Engineer Payments' }),
  row({ url: 'https://x.com/2', title: 'Engineering Manager Platform Infrastructure', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

eq('short identical titles match (fast path)', detectReposts([
  row({ url: 'https://x.com/1', title: 'Senior ML Engineer' }),
  row({ url: 'https://x.com/2', title: 'Senior ML Engineer', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('titles differing only in case match', detectReposts([
  row({ url: 'https://x.com/1', title: 'Senior Backend Engineer' }),
  row({ url: 'https://x.com/2', title: 'senior BACKEND engineer', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('special chars in titles (C++ / Rust)', detectReposts([
  row({ url: 'https://x.com/1', title: 'C++ / Rust Systems Engineer' }),
  row({ url: 'https://x.com/2', title: 'C++ / Rust Systems Engineer', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('unicode titles (Cyrillic)', detectReposts([
  row({ url: 'https://x.com/1', title: 'Инженер-программист Backend', company: 'Тинькофф' }),
  row({ url: 'https://x.com/2', title: 'Инженер-программист Backend', company: 'Тинькофф', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// ============================================================================
// 6. detectReposts — window logic (boundary conditions)
// ============================================================================
console.log('\n--- 6. window logic ---');

// Exact boundary: 90 days should be included
eq('exactly 90 days -> flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-04-01'), dateStr: '2026-04-01' }),
], 90).length, 1);

// 91 days should be excluded
eq('91 days -> NOT flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-04-02'), dateStr: '2026-04-02' }),
], 90).length, 0);

// Window = 0: same-day only
eq('window=0, same day, different URL -> flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-01'), dateStr: '2026-01-01' }),
], 0).length, 1);

eq('window=0, 1 day apart -> NOT flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-02'), dateStr: '2026-01-02' }),
], 0).length, 0);

// Window = 1: 1 day apart
eq('window=1, 1 day apart -> flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-02'), dateStr: '2026-01-02' }),
], 1).length, 1);

// Negative window (invalid) — should not crash
ok('negative window does not crash', detectReposts([
  row({ url: 'https://x.com/1' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
], -1).length === 0);

// Very large window
eq('window=36500 (100 years) -> flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2027-01-01'), dateStr: '2027-01-01' }),
], 36500).length, 1);

// Transitive chain (CodeRabbit fix 3): A-B within window, B-C within window, A-C exceeds
const transResult = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-03-01'), dateStr: '2026-03-01' }),
  row({ url: 'https://x.com/3', date: d('2026-05-01'), dateStr: '2026-05-01' }),
], 90);
ok('transitive chain: at least 2 clusters found (both pairs detected)', transResult.length >= 2);
if (transResult.length >= 2) {
  // Clusters sorted by lastSeen descending: Mar 1-May 1 (61d) first, Jan 1-Mar 1 (59d) second
  eq('transitive chain: first cluster span = 61d (Mar 1 - May 1)', transResult[0].daysSpan, 61);
  eq('transitive chain: second cluster span = 59d (Jan 1 - Mar 1)', transResult[1].daysSpan, 59);
}

// 3 reposts all within window
const threeResult = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
  row({ url: 'https://x.com/3', date: d('2026-03-01'), dateStr: '2026-03-01' }),
], 90);
eq('3 reposts within window -> 1 cluster, 3 appearances', threeResult.length, 1);
eq('3 reposts: repostCount = 3', threeResult[0]?.repostCount, 3);
eq('3 reposts: daysSpan = 59', threeResult[0]?.daysSpan, 59);
eq('3 reposts: firstSeen = 2026-01-01', threeResult[0]?.firstSeen, '2026-01-01');
eq('3 reposts: lastSeen = 2026-03-01', threeResult[0]?.lastSeen, '2026-03-01');

// 4 reposts spanning exactly 90 days
const fourResult = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-31'), dateStr: '2026-01-31' }),
  row({ url: 'https://x.com/3', date: d('2026-03-01'), dateStr: '2026-03-01' }),
  row({ url: 'https://x.com/4', date: d('2026-04-01'), dateStr: '2026-04-01' }),
], 90);
eq('4 reposts within 90d -> 1 cluster', fourResult.length, 1);
eq('4 reposts: repostCount = 4', fourResult[0]?.repostCount, 4);
eq('4 reposts: daysSpan = 90', fourResult[0]?.daysSpan, 90);

// 4 reposts where last one is 91 days from first (should split)
const splitResult = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
  row({ url: 'https://x.com/3', date: d('2026-03-01'), dateStr: '2026-03-01' }),
  row({ url: 'https://x.com/4', date: d('2026-04-02'), dateStr: '2026-04-02' }),
], 90);
ok('4 reposts split: at least 1 cluster (first 3 within window)', splitResult.length >= 1);
if (splitResult.length >= 1) {
  eq('split: first cluster has 3 reposts', splitResult[0].repostCount, 3);
}

// Sliding window: overlapping repost pairs (CodeRabbit's exact scenario)
// Jan 1 + Mar 15 = 73d (within 90), Mar 15 + Jun 10 = 87d (within 90),
// but Jan 1 + Jun 10 = 160d (exceeds 90). Both pairs must be detected.
const slidingResult = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-03-15'), dateStr: '2026-03-15' }),
  row({ url: 'https://x.com/3', date: d('2026-06-10'), dateStr: '2026-06-10' }),
], 90);
eq('sliding window: 2 clusters (both overlapping pairs detected)', slidingResult.length, 2);
if (slidingResult.length === 2) {
  // Sorted by lastSeen descending: Jun 10 cluster first, Mar 15 cluster second
  eq('sliding window: cluster 1 is Mar 15-Jun 10 (87d)', slidingResult[0].daysSpan, 87);
  eq('sliding window: cluster 2 is Jan 1-Mar 15 (73d)', slidingResult[1].daysSpan, 73);
}

// Dates not in chronological order in input
const unsortedResult = detectReposts([
  row({ url: 'https://x.com/2', date: d('2026-03-01'), dateStr: '2026-03-01' }),
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/3', date: d('2026-02-01'), dateStr: '2026-02-01' }),
], 90);
eq('unsorted input dates -> still works (sorted internally)', unsortedResult.length, 1);
eq('unsorted: firstSeen = 2026-01-01', unsortedResult[0]?.firstSeen, '2026-01-01');
eq('unsorted: lastSeen = 2026-03-01', unsortedResult[0]?.lastSeen, '2026-03-01');

// Same date, different URLs
eq('same date, different URLs -> flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-01'), dateStr: '2026-01-01' }),
], 90).length, 1);

// ============================================================================
// 7. URL deduplication
// ============================================================================
console.log('\n--- 7. URL deduplication ---');

// Same URL seen twice = dedup hit, not a repost
eq('same URL twice -> no cluster', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/1', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

// Same URL + different URL = 2 appearances (same URL deduped, different URL counts)
const mixedResult = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/1', date: d('2026-02-01'), dateStr: '2026-02-01' }),
  row({ url: 'https://x.com/2', date: d('2026-03-01'), dateStr: '2026-03-01' }),
], 90);
eq('same URL seen twice + 1 different URL -> 1 cluster', mixedResult.length, 1);
eq('deduped to 2 appearances (not 3)', mixedResult[0]?.repostCount, 2);

// Same URL with trailing slash vs without — treated as different URLs
// (this is correct: URL normalization is scan.mjs's job, not ours)
eq('URL with/without trailing slash treated as different', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/1/', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// URL with different fragments
eq('URL with different fragments treated as different', detectReposts([
  row({ url: 'https://x.com/1#section', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/1#other', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// URL with query params
eq('URL with different query params treated as different', detectReposts([
  row({ url: 'https://x.com/1?ref=linkedin', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/1?ref=google', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// ============================================================================
// 8. Cluster output shape
// ============================================================================
console.log('\n--- 8. cluster output shape ---');

const shapeResult = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', title: 'Backend Engineer Platform', company: 'Acme' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01', title: 'Backend Engineer Platform', company: 'Acme' }),
], 90);

ok('returns array', Array.isArray(shapeResult));
ok('cluster is object', shapeResult.length === 1 && typeof shapeResult[0] === 'object');
const c = shapeResult[0];
ok('has company field', 'company' in c);
ok('has role field', 'role' in c);
ok('has repostCount field', 'repostCount' in c);
ok('has firstSeen field', 'firstSeen' in c);
ok('has lastSeen field', 'lastSeen' in c);
ok('has daysSpan field', 'daysSpan' in c);
ok('has appearances field', 'appearances' in c);
ok('company is string', typeof c.company === 'string');
ok('role is string', typeof c.role === 'string');
ok('repostCount is number', typeof c.repostCount === 'number');
ok('firstSeen is string (ISO date)', typeof c.firstSeen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.firstSeen));
ok('lastSeen is string (ISO date)', typeof c.lastSeen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.lastSeen));
ok('daysSpan is number', typeof c.daysSpan === 'number');
ok('appearances is array', Array.isArray(c.appearances));
ok('appearance has url', 'url' in c.appearances[0]);
ok('appearance has date', 'date' in c.appearances[0]);
ok('appearance has title', 'title' in c.appearances[0]);
ok('appearance url is string', typeof c.appearances[0].url === 'string');
ok('appearance date is string (ISO date)', typeof c.appearances[0].date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.appearances[0].date));
ok('appearance title is string', typeof c.appearances[0].title === 'string');

// Role uses most recent title (last by first_seen)
// Using identical titles to test that the most recent title wording is used
const shapeResult2 = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', title: 'Backend Engineer Platform' }),
  row({ url: 'https://x.com/2', date: d('2026-02-15'), dateStr: '2026-02-15', title: 'backend engineer PLATFORM' }),
], 90);
ok('case-insensitive title match produces cluster', shapeResult2.length === 1);
if (shapeResult2.length === 1) {
  eq('role uses most recent title', shapeResult2[0].role, 'backend engineer PLATFORM');
}

// Company uses the company from the rows (not lowercased)
eq('company preserves original case in output', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', company: 'ACME Corp' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01', company: 'acme corp' }),
], 90)[0].company, 'ACME Corp');

// Appearances sorted by date ascending
const appResult = detectReposts([
  row({ url: 'https://x.com/3', date: d('2026-03-01'), dateStr: '2026-03-01' }),
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
], 90)[0];
eq('appearances sorted ascending by date', appResult.appearances.map(a => a.date), ['2026-01-01', '2026-02-01', '2026-03-01']);

// Clusters sorted by lastSeen descending (most recent first)
const sortResult = detectReposts([
  row({ url: 'https://a.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', title: 'Backend Engineer Platform', company: 'Alpha' }),
  row({ url: 'https://a.com/2', date: d('2026-02-01'), dateStr: '2026-02-01', title: 'Backend Engineer Platform', company: 'Alpha' }),
  row({ url: 'https://b.com/1', date: d('2026-03-01'), dateStr: '2026-03-01', title: 'Backend Engineer Platform', company: 'Beta' }),
  row({ url: 'https://b.com/2', date: d('2026-04-01'), dateStr: '2026-04-01', title: 'Backend Engineer Platform', company: 'Beta' }),
], 90);
eq('multiple companies: Beta cluster first (more recent lastSeen)', sortResult[0].company, 'Beta');
eq('multiple companies: Alpha cluster second', sortResult[1].company, 'Alpha');

// ============================================================================
// 9. TSV parsing (integration with parseScanHistory)
// ============================================================================
console.log('\n--- 9. TSV parsing ---');

// The parseScanHistory function is internal, but we can test it through loadScanHistory
// by creating temp files. We test the full pipeline: TSV -> parseScanHistory -> detectReposts.

function makeTsv(rows) {
  const header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
  const lines = rows.map(r =>
    [r.url, r.dateStr, r.portal || 'greenhouse', r.title, r.company, r.status || 'added', r.location || ''].join('\t')
  );
  return [header, ...lines].join('\n');
}

// We can't call parseScanHistory directly (not exported), but we can test the CLI
// output by running the script against a temp TSV. For now, test via detectReposts
// with row objects that match what parseScanHistory would produce.

// Simulate TSV parsing: minimal valid TSV
const tsvContent = makeTsv([
  { url: 'https://a.com/1', dateStr: '2026-01-01', title: 'Backend Engineer Platform', company: 'Acme', status: 'added' },
  { url: 'https://a.com/2', dateStr: '2026-02-01', title: 'Backend Engineer Platform', company: 'Acme', status: 'added' },
  { url: 'https://a.com/3', dateStr: '2026-03-01', title: 'Product Manager Senior', company: 'Acme', status: 'added' },
]);

// Write to temp file and test via the script
const tmpDir = mkdtempSync(join(tmpdir(), 'detect-reposts-test-'));
const tmpTsv = join(tmpDir, 'scan-history.tsv');
writeFileSync(tmpTsv, tsvContent);

try {
  // Parse using the production parser
  const parsedRows = parseScanHistory(tsvContent);

  const tsvResult = detectReposts(parsedRows, 90);
  eq('TSV round-trip: 1 cluster found', tsvResult.length, 1);
  eq('TSV round-trip: cluster is Backend Engineer Platform', tsvResult[0]?.role, 'Backend Engineer Platform');
  eq('TSV round-trip: 2 reposts', tsvResult[0]?.repostCount, 2);
  eq('TSV round-trip: Product Manager NOT in cluster', tsvResult[0]?.appearances.length, 2);

  // TSV with empty lines between rows
  const tsvWithBlanks = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    '',
    'https://a.com/1\t2026-01-01\tgreenhouse\tBackend Engineer Platform\tAcme\tadded\tRemote',
    '',
    'https://a.com/2\t2026-02-01\tgreenhouse\tBackend Engineer Platform\tAcme\tadded\tRemote',
    '',
  ].join('\n');
  const blankParsed = parseScanHistory(tsvWithBlanks);
  eq('TSV with blank lines: parsed correctly', blankParsed.length, 2);
  eq('TSV with blank lines: 1 cluster', detectReposts(blankParsed, 90).length, 1);

  // TSV with fewer than 5 columns (malformed)
  const tsvShort = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://a.com/1\t2026-01-01\tgreenhouse',
    'https://a.com/2\t2026-02-01\tgreenhouse\tBackend Engineer Platform\tAcme\tadded\tRemote',
  ].join('\n');
  const shortParsed = parseScanHistory(tsvShort);
  eq('TSV with short row: only valid row parsed', shortParsed.length, 1);
  eq('TSV with short row: no clusters (need 2)', detectReposts(shortParsed, 90).length, 0);

  // TSV with calendar-invalid date
  const tsvBadDate = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://a.com/1\t2026-02-31\tgreenhouse\tBackend Engineer Platform\tAcme\tadded\tRemote',
    'https://a.com/2\t2026-02-01\tgreenhouse\tBackend Engineer Platform\tAcme\tadded\tRemote',
  ].join('\n');
  const badDateParsed = parseScanHistory(tsvBadDate);
  eq('TSV with calendar-invalid date: only valid row parsed', badDateParsed.length, 1);
  eq('TSV with calendar-invalid date: no clusters', detectReposts(badDateParsed, 90).length, 0);

  // TSV with empty company field
  const tsvEmptyCompany = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://a.com/1\t2026-01-01\tgreenhouse\tBackend Engineer Platform\t\tadded\tRemote',
    'https://b.com/2\t2026-02-01\tgreenhouse\tBackend Engineer Platform\t\tadded\tRemote',
  ].join('\n');
  const emptyCoParsed = parseScanHistory(tsvEmptyCompany);
  // parseScanHistory produces rows with empty company, but detectReposts filters them out
  eq('TSV with empty company: rows parsed (2)', emptyCoParsed.length, 2);
  eq('TSV with empty company: no clusters (filtered by detectReposts)', detectReposts(emptyCoParsed, 90).length, 0);

  // Headerless 5-column TSV parsing test (Older scan-history and seed file backward compat)
  const headerlessTsv = [
    'https://a.com/1\t2026-01-01\tgreenhouse\tBackend Engineer Platform\tAcme',
    'https://a.com/2\t2026-02-01\tgreenhouse\tBackend Engineer Platform\tAcme',
  ].join('\n');
  const headerlessParsed = parseScanHistory(headerlessTsv);
  eq('Headerless 5-column TSV: both rows parsed successfully', headerlessParsed.length, 2);
  eq('Headerless 5-column TSV: default status applied is added', headerlessParsed[0]?.status, 'added');
  eq('Headerless 5-column TSV: 1 cluster found', detectReposts(headerlessParsed, 90).length, 1);

} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ============================================================================
// 10. Multi-company integration test
// ============================================================================
console.log('\n--- 10. multi-company integration ---');

const multiResult = detectReposts([
  // Acme: 2 reposts of Backend Engineer (within window)
  row({ url: 'https://acme.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', title: 'Backend Engineer Platform', company: 'Acme' }),
  row({ url: 'https://acme.com/2', date: d('2026-02-01'), dateStr: '2026-02-01', title: 'Backend Engineer Platform', company: 'Acme' }),
  // Acme: distinct role (not a repost)
  row({ url: 'https://acme.com/3', date: d('2026-01-15'), dateStr: '2026-01-15', title: 'Product Marketing Manager Senior', company: 'Acme' }),
  // Beta: 2 reposts of SRE (within window)
  row({ url: 'https://beta.com/1', date: d('2026-03-01'), dateStr: '2026-03-01', title: 'Senior Site Reliability Engineer', company: 'Beta' }),
  row({ url: 'https://beta.com/2', date: d('2026-04-01'), dateStr: '2026-04-01', title: 'Senior Site Reliability Engineer', company: 'Beta' }),
  // Gamma: only 1 posting (no repost)
  row({ url: 'https://gamma.com/1', date: d('2026-02-01'), dateStr: '2026-02-01', title: 'Backend Engineer Platform', company: 'Gamma' }),
  // Delta: same URL twice (dedup, not repost)
  row({ url: 'https://delta.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', title: 'Backend Engineer Platform', company: 'Delta' }),
  row({ url: 'https://delta.com/1', date: d('2026-02-01'), dateStr: '2026-02-01', title: 'Backend Engineer Platform', company: 'Delta' }),
  // Epsilon: expired rows (should be ignored)
  row({ url: 'https://epsilon.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', title: 'Backend Engineer Platform', company: 'Epsilon', status: 'skipped_expired' }),
  row({ url: 'https://epsilon.com/2', date: d('2026-02-01'), dateStr: '2026-02-01', title: 'Backend Engineer Platform', company: 'Epsilon', status: 'skipped_expired' }),
], 90);

eq('multi-company: 2 clusters total (Acme + Beta)', multiResult.length, 2);
eq('multi-company: Beta first (more recent lastSeen)', multiResult[0].company, 'Beta');
eq('multi-company: Acme second', multiResult[1].company, 'Acme');
eq('multi-company: Acme cluster has 2 reposts', multiResult[1].repostCount, 2);
eq('multi-company: Beta cluster has 2 reposts', multiResult[0].repostCount, 2);
ok('multi-company: Gamma not in any cluster', !multiResult.some(c => c.company === 'Gamma'));
ok('multi-company: Delta not in any cluster (same URL = dedup)', !multiResult.some(c => c.company === 'Delta'));
ok('multi-company: Epsilon not in any cluster (expired)', !multiResult.some(c => c.company === 'Epsilon'));

// ============================================================================
// 10.5 Sliding window: overlapping repost pairs
// ============================================================================
console.log('\n--- 10.5 sliding window ---');

// CodeRabbit scenario: Jan 1, Mar 15, Jun 10, 90-day window
// Jan1-Mar15 = 73d (within), Mar15-Jun10 = 87d (within), Jan1-Jun10 = 160d (exceeds)
const sw1 = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-03-15'), dateStr: '2026-03-15' }),
  row({ url: 'https://x.com/3', date: d('2026-06-10'), dateStr: '2026-06-10' }),
], 90);
eq('SW: 2 clusters (both overlapping pairs)', sw1.length, 2);
eq('SW: cluster 1 = Mar15-Jun10 (87d)', sw1[0]?.daysSpan, 87);
eq('SW: cluster 2 = Jan1-Mar15 (73d)', sw1[1]?.daysSpan, 73);
ok('SW: x.com/2 in both clusters (shared row)', sw1[0].appearances.some(a => a.url === 'https://x.com/2') && sw1[1].appearances.some(a => a.url === 'https://x.com/2'));

// All within window — 1 cluster, no over-splitting
eq('SW: 3 within window = 1 cluster', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01' }),
  row({ url: 'https://x.com/3', date: d('2026-03-01'), dateStr: '2026-03-01' }),
], 90).length, 1);

// 4-row chain: A-B, B-C, C-D within window, A-C exceeds
const sw4 = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-03-01'), dateStr: '2026-03-01' }),
  row({ url: 'https://x.com/3', date: d('2026-05-01'), dateStr: '2026-05-01' }),
  row({ url: 'https://x.com/4', date: d('2026-07-01'), dateStr: '2026-07-01' }),
], 90);
eq('SW: 4-row chain = 3 overlapping clusters', sw4.length, 3);
if (sw4.length === 3) {
  eq('SW: chain cluster 1 = C-D (61d)', sw4[0].daysSpan, 61);
  eq('SW: chain cluster 2 = B-C (61d)', sw4[1].daysSpan, 61);
  eq('SW: chain cluster 3 = A-B (59d)', sw4[2].daysSpan, 59);
}

// Exact 90-day boundary between consecutive
const sw6 = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-04-01'), dateStr: '2026-04-01' }),
  row({ url: 'https://x.com/3', date: d('2026-06-30'), dateStr: '2026-06-30' }),
], 90);
eq('SW: exact 90d boundary = 2 clusters', sw6.length, 2);
eq('SW: boundary cluster 1 = 90d', sw6[0]?.daysSpan, 90);
eq('SW: boundary cluster 2 = 90d', sw6[1]?.daysSpan, 90);

// 91 days exceeds — only the valid pair detected
const sw7 = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-04-02'), dateStr: '2026-04-02' }),
  row({ url: 'https://x.com/3', date: d('2026-07-01'), dateStr: '2026-07-01' }),
], 90);
eq('SW: 91d excluded, only B-C cluster', sw7.length, 1);
eq('SW: 91d cluster = B-C (90d)', sw7[0]?.daysSpan, 90);

// 6 rows, 45d apart — sliding produces 4 clusters of 3
const sw8 = detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-02-15'), dateStr: '2026-02-15' }),
  row({ url: 'https://x.com/3', date: d('2026-04-01'), dateStr: '2026-04-01' }),
  row({ url: 'https://x.com/4', date: d('2026-05-16'), dateStr: '2026-05-16' }),
  row({ url: 'https://x.com/5', date: d('2026-06-30'), dateStr: '2026-06-30' }),
  row({ url: 'https://x.com/6', date: d('2026-08-14'), dateStr: '2026-08-14' }),
], 90);
eq('SW: 6 rows 45d apart = 4 clusters', sw8.length, 4);
if (sw8.length === 4) {
  for (let i = 0; i < 4; i++) {
    eq(`SW: 6-row cluster ${i+1} has 3 reposts`, sw8[i].repostCount, 3);
    eq(`SW: 6-row cluster ${i+1} span = 90d`, sw8[i].daysSpan, 90);
  }
}

// Regression: URL dedup with sliding window
eq('SW: URL dedup works with sliding', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/1', date: d('2026-02-01'), dateStr: '2026-02-01' }),
  row({ url: 'https://x.com/2', date: d('2026-03-01'), dateStr: '2026-03-01' }),
  row({ url: 'https://x.com/3', date: d('2026-06-01'), dateStr: '2026-06-01' }),
], 90).length, 1);

// Regression: distinct roles not grouped
eq('SW: distinct roles not grouped', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01', title: 'Backend Engineer Platform' }),
  row({ url: 'https://x.com/2', date: d('2026-02-01'), dateStr: '2026-02-01', title: 'Engineering Manager Platform Infrastructure' }),
  row({ url: 'https://x.com/3', date: d('2026-03-01'), dateStr: '2026-03-01', title: 'Backend Engineer Platform' }),
], 90).length, 1);

// ============================================================================
// 11. Performance
// ============================================================================
console.log('\n--- 11. performance ---');

// Smoke tests only — no wall-clock thresholds (flaky on CI)
const perfRows = Array.from({ length: 100 }, (_, i) => row({
  url: `https://x.com/${i}`,
  date: new Date(2026, 0, 1 + (i % 30)),
  dateStr: `2026-01-${String(1 + (i % 30)).padStart(2, '0')}`,
  title: i % 2 === 0 ? 'Backend Engineer Platform' : 'Frontend Engineer React',
  company: 'PerfCo',
}));
detectReposts(perfRows, 90);
ok('100 rows completes without throwing', true);

// 500 rows across 50 companies
const perfRows2 = Array.from({ length: 500 }, (_, i) => row({
  url: `https://co${i % 50}.com/${i}`,
  date: new Date(2026, 0, 1 + (i % 30)),
  dateStr: `2026-01-${String(1 + (i % 30)).padStart(2, '0')}`,
  title: i % 3 === 0 ? 'Backend Engineer Platform' : i % 3 === 1 ? 'Frontend Engineer React' : 'Product Manager Senior',
  company: `Company${i % 50}`,
}));
detectReposts(perfRows2, 90);
ok('500 rows across 50 companies completes without throwing', true);

// ============================================================================
// 12. CLI behavior
// ============================================================================
console.log('\n--- 12. CLI behavior ---');

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'detect-reposts.mjs');

// Test --self-test exit code
try {
  execFileSync('node', [scriptPath, '--self-test'], { encoding: 'utf-8', timeout: 10000 });
  ok('--self-test exits 0', true);
} catch (e) {
  ok('--self-test exits 0', false);
  console.log(`    exit code: ${e.status}, stderr: ${e.stderr?.slice(0, 200)}`);
}

// Test --window flag
const windowOut = execFileSync('node', [scriptPath, '--window', '30'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const windowJson = JSON.parse(windowOut);
ok('--window produces valid JSON output', typeof windowJson === 'object' && 'metadata' in windowJson);
eq('--window sets windowDays in metadata', windowJson.metadata.windowDays, 30);

// Test --summary flag
const summaryOut = execFileSync('node', [scriptPath, '--summary'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
ok('--summary produces human-readable output', summaryOut.includes('Repost Detector'));

// Test no args (default JSON output)
const defaultOut = execFileSync('node', [scriptPath], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const defaultJson = JSON.parse(defaultOut);
ok('default produces valid JSON', typeof defaultJson === 'object');
ok('default has metadata', 'metadata' in defaultJson);
ok('default has clusters array', 'clusters' in defaultJson && Array.isArray(defaultJson.clusters));
eq('default windowDays = 90', defaultJson.metadata.windowDays, 90);

// Test --window with non-numeric value (falls back to default)
const badWindowOut = execFileSync('node', [scriptPath, '--window', 'abc'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const badWindowJson = JSON.parse(badWindowOut);
eq('--window abc falls back to 90', badWindowJson.metadata.windowDays, 90);

// Test --window with no value (falls back to default)
const noWindowOut = execFileSync('node', [scriptPath, '--window'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const noWindowJson = JSON.parse(noWindowOut);
eq('--window without value falls back to 90', noWindowJson.metadata.windowDays, 90);

// ============================================================================
// RESULTS
// ============================================================================
console.log(`\n${'='.repeat(78)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n  Failed tests:`);
  for (const f of failures) console.log(`    - ${f}`);
}
console.log(`${'='.repeat(78)}`);

process.exit(failed > 0 ? 1 : 0);