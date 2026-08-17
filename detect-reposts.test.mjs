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

import { detectReposts, parseScanHistory, companyKey, titleIdentityKey } from './detect-reposts.mjs';
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
// 4.5 companyKey + normalized-company clustering (#2093)
// ============================================================================
console.log('\n--- 4.5 companyKey / normalized-company (#2093) ---');

// companyKey unit behavior
eq('companyKey prefers the stored normCompany column', companyKey({ company: 'Ignored LLC', normCompany: 'acme' }), 'acme');
eq('companyKey falls back to normalizing the raw company', companyKey({ company: 'Acme Inc.' }), 'acme');
eq('companyKey "Acme, Inc." == "ACME Inc" (punctuation/case folded)', companyKey({ company: 'Acme, Inc.' }), companyKey({ company: 'ACME Inc' }));
eq('companyKey "Acme Inc." == "Acme" (legal-suffix stripped)', companyKey({ company: 'Acme Inc.' }), companyKey({ company: 'Acme' }));
eq('companyKey unicode-only name falls back to raw lowercase', companyKey({ company: 'Тинькофф' }), 'тинькофф');
ok('companyKey keeps two distinct unicode-only names apart (no empty over-merge)', companyKey({ company: 'Тинькофф' }) !== companyKey({ company: 'Сбербанк' }));

// (a) stored normalized column clusters "Acme Inc." + "Acme"
eq('stored normCompany clusters "Acme Inc." + "Acme"', detectReposts([
  row({ url: 'https://a.com/1', company: 'Acme Inc.', normCompany: 'acme', title: 'Backend Engineer Platform' }),
  row({ url: 'https://a.com/2', company: 'Acme', normCompany: 'acme', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// (b) backward compat: rows without the column cluster via raw-normalize fallback
eq('fallback clusters "Acme Inc." + "Acme" with no stored column', detectReposts([
  row({ url: 'https://a.com/1', company: 'Acme Inc.', title: 'Backend Engineer Platform' }),
  row({ url: 'https://a.com/2', company: 'Acme', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

eq('fallback clusters "Acme, Inc." + "ACME Inc" (punctuation/case)', detectReposts([
  row({ url: 'https://a.com/1', company: 'Acme, Inc.', title: 'Backend Engineer Platform' }),
  row({ url: 'https://a.com/2', company: 'ACME Inc', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 1);

// Distinct companies must NOT merge under normalization
eq('distinct companies not merged by normalization', detectReposts([
  row({ url: 'https://a.com/1', company: 'Acme Inc.', title: 'Backend Engineer Platform' }),
  row({ url: 'https://b.com/2', company: 'Beta Corp', date: d('2026-02-01'), dateStr: '2026-02-01' }),
]).length, 0);

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

// Window = 0 admits same-day clusters only, which the default 1-day span floor
// then rejects — the two bounds have no overlap, so --window 0 can no longer
// return anything. Asserted so the degenerate combination is a documented
// outcome rather than a surprise.
eq('window=0 with the default span floor -> nothing can be flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-01'), dateStr: '2026-01-01' }),
], 0).length, 0);

// The same rows with the floor lowered: this keeps coverage of the window=0
// path itself, and proves the assertion above is the FLOOR talking rather than
// the window silently dropping same-day rows for some other reason.
eq('window=0, same day, different URL, span floor 0 -> flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-01'), dateStr: '2026-01-01' }),
], 0, 0).length, 1);

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

// Same date, different URLs — two openings listed side by side in one sweep,
// not one opening re-listed. `first_seen` is a SCANNER observation date, so a
// zero-day span means both URLs were already live when the scanner arrived and
// carries no evidence about re-listing at all. This was the defect behind three
// companies reading as `reposts-detected` on 2026-08-11.
eq('same date, different URLs -> NOT flagged (concurrent, not reposted)', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-01'), dateStr: '2026-01-01' }),
], 90).length, 0);

// One day apart is the smallest real signal and must survive, so the rule above
// reads as "a zero span is not evidence" rather than "close sightings are
// suspicious".
eq('one day apart, different URLs -> flagged', detectReposts([
  row({ url: 'https://x.com/1', date: d('2026-01-01'), dateStr: '2026-01-01' }),
  row({ url: 'https://x.com/2', date: d('2026-01-02'), dateStr: '2026-01-02' }),
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

  // #2093 — normalized-company column: writer stores it (trailing col 12),
  // parser prefers it as the clustering key so "Acme Inc." and "Acme" cluster.
  const normTsv = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company',
    'https://a.com/1\t2026-01-01\tgreenhouse\tBackend Engineer Platform\tAcme Inc.\tadded\tRemote\t\t\t\t\tacme',
    'https://a.com/2\t2026-02-01\tgreenhouse\tBackend Engineer Platform\tAcme\tadded\tRemote\t\t\t\t\tacme',
  ].join('\n');
  const normParsed = parseScanHistory(normTsv);
  eq('#2093: normalized_company (col 12) parsed into normCompany', normParsed[0]?.normCompany, 'acme');
  eq('#2093: "Acme Inc." + "Acme" cluster via stored normalized column', detectReposts(normParsed, 90).length, 1);

  // Backward compat: legacy 7-column rows lack the column. Clustering falls back
  // to normalizing the raw company on the fly, so old and new rows still key the
  // same and cluster together — nothing depends on the writer having run.
  const legacyTsv = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://a.com/1\t2026-01-01\tgreenhouse\tBackend Engineer Platform\tAcme Inc.\tadded\tRemote',
    'https://a.com/2\t2026-02-01\tgreenhouse\tBackend Engineer Platform\tAcme\tadded\tRemote',
  ].join('\n');
  const legacyParsed = parseScanHistory(legacyTsv);
  eq('#2093 backward-compat: legacy rows carry empty normCompany', legacyParsed[0]?.normCompany, '');
  eq('#2093 backward-compat: legacy "Acme Inc." + "Acme" still cluster (raw fallback)', detectReposts(legacyParsed, 90).length, 1);

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
// 10.6 Grouping equivalence with the pre-#2383 algorithm
// ============================================================================
console.log('\n--- 10.6 grouping equivalence (#2383) ---');

// A second, independently written implementation of the whole detector. The
// clusters coming out of detect-reposts.mjs must be byte-identical to what this
// one produces, including their order and the order of appearances inside them.
//
// Its history: it began as the pre-#2383 file copied verbatim, guarding a pure
// speed change (a nested title loop became a bucket Map plus an inverted token
// index). It is no longer a frozen copy of anything — the phantom-repost fix
// changed what the detector COMPUTES, so this reference was updated in the same
// commit, exactly as the note here has always required. What it still buys is a
// second opinion on the parts most easily broken by accident: grouping order,
// same-date input order, URL dedup, and the two date bounds. It is deliberately
// written in the straightforward nested-loop style rather than mirroring the
// real file's structure, so a shared bug has to be reasoned into both.
//
// If detect-reposts.mjs ever changes what it computes (window rules, span
// rules, cluster shape, dedup policy, title identity) rather than how fast it
// computes it, this copy must be updated in the same commit. A silent
// divergence failing here is the intended behaviour, not a nuisance.
function legacyBuildRepostCluster(clusterRows, windowDays, minSpan) {
  const byUrl = new Map();
  for (const r of clusterRows) {
    if (!byUrl.has(r.url) || r.date < byUrl.get(r.url).date) byUrl.set(r.url, r);
  }
  const deduped = [...byUrl.values()];
  if (deduped.length < 2) return null;
  const sorted = [...deduped].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = daysBetween(first.date, last.date);
  if (span > windowDays) return null;
  if (span < minSpan) return null;
  return {
    company: clusterRows[0].company,
    role: last.title,
    repostCount: sorted.length,
    firstSeen: first.dateStr,
    lastSeen: last.dateStr,
    daysSpan: span,
    appearances: sorted.map(r => ({ url: r.url, date: r.dateStr, title: r.title })),
  };
}

function legacyDetectRepostsInGroup(rows, windowDays, minSpan) {
  // Grouping by title identity, written as the naive quadratic scan: every row
  // is compared against every other with a freshly recomputed key. The real
  // file does this with a single-pass Map; agreeing here is the point.
  const titleGroups = [];
  const used = new Set();
  for (const r of rows) {
    if (used.has(r)) continue;
    const group = [r];
    used.add(r);
    for (const other of rows) {
      if (used.has(other)) continue;
      if (titleIdentityKey(r.title) === titleIdentityKey(other.title)) {
        group.push(other);
        used.add(other);
      }
    }
    titleGroups.push(group);
  }

  const results = [];
  for (const group of titleGroups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    let cluster = [];
    for (const r of sorted) {
      if (cluster.length === 0) { cluster = [r]; continue; }
      const span = daysBetween(cluster[0].date, r.date);
      if (span <= windowDays) {
        cluster.push(r);
      } else {
        if (cluster.length >= 2) {
          const built = legacyBuildRepostCluster(cluster, windowDays, minSpan);
          if (built) results.push(built);
        }
        cluster = cluster.filter(cr => daysBetween(cr.date, r.date) <= windowDays);
        cluster.push(r);
      }
    }
    if (cluster.length >= 2) {
      const built = legacyBuildRepostCluster(cluster, windowDays, minSpan);
      if (built) results.push(built);
    }
  }
  return results;
}

function legacyDetectReposts(rows, windowDays = 90, minSpan = 1) {
  if (!Array.isArray(rows)) return [];
  const valid = rows
    .filter(r =>
      r && typeof r === 'object' && r.status === 'added' &&
      typeof r.url === 'string' && r.url.trim() &&
      r.date instanceof Date && !Number.isNaN(r.date.getTime()) &&
      typeof r.company === 'string' && r.company.trim() &&
      typeof r.title === 'string' && r.title.trim()
    )
    .map(r => ({ ...r, url: r.url.trim(), company: r.company.trim(), title: r.title.trim() }));
  if (valid.length < 2) return [];

  const byCompany = new Map();
  for (const r of valid) {
    const key = companyKey(r);
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(r);
  }

  const clusters = [];
  for (const [, groupRows] of byCompany) {
    if (groupRows.length < 2) continue;
    clusters.push(...legacyDetectRepostsInGroup(groupRows, windowDays, minSpan));
  }
  return clusters.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

// Compares full cluster output, not just cluster counts: eq() stringifies, so
// this catches a changed cluster order, a changed appearance order inside a
// cluster, or a different `role`/`company` representative being picked.
function sameAsLegacy(label, rows, windowDays = 90, minSpan = 1) {
  eq(label, detectReposts(rows, windowDays, minSpan), legacyDetectReposts(rows, windowDays, minSpan));
}

// Compact row builder for the corpora below.
function eqRow(url, dateStr, title, company = 'Acme', status = 'added') {
  return { url, date: d(dateStr), dateStr, title, company, status, portal: 'greenhouse', location: '' };
}

function dayStr(offset) {
  // Walks forward from 2026-01-01 without needing a calendar in the caller.
  const base = Date.UTC(2026, 0, 1) + offset * 86400000;
  return new Date(base).toISOString().slice(0, 10);
}

// (a) Many DISTINCT titles at one company — the shape from the issue. Nothing
// collapses, so this is the corpus where the old loop paid for every pair.
const distinctCorpus = Array.from({ length: 120 }, (_, i) =>
  eqRow(`https://x.com/d${i}`, dayStr(i % 200), `Backend Engineer, Squad ${'Zephyr'}${i}`)
);
sameAsLegacy('equivalence: 120 distinct titles, one company', distinctCorpus);

// (b) Many EXACT duplicates — the case bucketing collapses in one pass. Dates
// are spread so the sliding window produces several overlapping clusters.
const exactCorpus = Array.from({ length: 60 }, (_, i) =>
  eqRow(`https://x.com/e${i}`, dayStr(i * 7), 'Senior Backend Engineer, Payments')
);
sameAsLegacy('equivalence: 60 exact duplicates spread over a year', exactCorpus);

// (c) Fuzzy-but-not-exact variants. These are the pairs that must still reach
// roleFuzzyMatch through the token index rather than being filtered out.
sameAsLegacy('equivalence: fuzzy word-order variants', [
  eqRow('https://x.com/f1', dayStr(0), 'Senior Backend Engineer Payments'),
  eqRow('https://x.com/f2', dayStr(20), 'Backend Engineer Payments Senior'),
  eqRow('https://x.com/f3', dayStr(40), 'Senior Backend Engineer Payments Processing'),
  eqRow('https://x.com/f4', dayStr(60), 'Backend Engineer Payments Processing Senior'),
  eqRow('https://x.com/f5', dayStr(80), 'Engineering Manager Platform Infrastructure'),
]);

// (d) Near-misses that must NOT match: shared baseline vocabulary only, a
// sub-baseline seniority on one side, and a specialization suffix. If the token
// index ever let one of these through, the clusters would differ here.
sameAsLegacy('equivalence: near-miss titles stay separate', [
  eqRow('https://x.com/n1', dayStr(0), 'Software Engineer'),
  eqRow('https://x.com/n2', dayStr(10), 'Software Developer'),
  eqRow('https://x.com/n3', dayStr(20), 'Associate Product Manager, Marketplace'),
  eqRow('https://x.com/n4', dayStr(30), 'Product Manager, Marketplace'),
  eqRow('https://x.com/n5', dayStr(40), 'Senior Analytics Engineer'),
  eqRow('https://x.com/n6', dayStr(50), 'Senior Analytics Engineer, People Analytics'),
]);

// (e) Case variants inside one title bucket. The new code compares the FIRST
// row's raw title on behalf of the whole bucket, so this proves that choosing a
// different-cased representative cannot change a verdict or the emitted `role`.
sameAsLegacy('equivalence: mixed-case duplicates of one title', [
  eqRow('https://x.com/c1', dayStr(0), 'Senior Backend Engineer, Payments'),
  eqRow('https://x.com/c2', dayStr(10), 'SENIOR BACKEND ENGINEER, PAYMENTS'),
  eqRow('https://x.com/c3', dayStr(20), 'senior backend engineer, payments'),
  eqRow('https://x.com/c4', dayStr(30), 'Senior Backend Engineer Payments'),
]);

// (f) Same-date rows. The date sort in detectRepostsInGroup uses a comparator
// that returns 1 rather than 0 for equal dates, so its result depends on the
// order rows arrive in. This corpus fails loudly if grouping stops preserving
// original array order.
sameAsLegacy('equivalence: same-date rows keep input order', [
  eqRow('https://x.com/s1', dayStr(0), 'Data Engineer, Ingestion'),
  eqRow('https://x.com/s2', dayStr(0), 'Data Engineer, Ingestion'),
  eqRow('https://x.com/s3', dayStr(0), 'data engineer, ingestion'),
  eqRow('https://x.com/s4', dayStr(0), 'Data Engineer Ingestion'),
  eqRow('https://x.com/s5', dayStr(0), 'Data Engineer, Ingestion'),
]);

// (g) Singletons: companies with one row, and titles that group alone. These
// take the early-exit paths in the new grouping and must still be no-ops.
sameAsLegacy('equivalence: singleton companies and singleton titles', [
  eqRow('https://a.com/1', dayStr(0), 'Backend Engineer, Checkout', 'Alpha'),
  eqRow('https://b.com/1', dayStr(5), 'Frontend Engineer, Checkout', 'Beta'),
  eqRow('https://c.com/1', dayStr(10), 'Security Engineer, Identity', 'Gamma'),
  eqRow('https://c.com/2', dayStr(15), 'Security Engineer, Identity', 'Gamma'),
  eqRow('https://d.com/1', dayStr(20), 'Compiler Engineer, Toolchain', 'Delta'),
]);

// (h) Mixed corpus: several companies, duplicate URLs, non-added statuses,
// out-of-order dates, shared vocabulary. Generated from a seeded LCG so a
// failure is reproducible rather than a one-off.
let seed = 20260731;
const rand = (n) => {
  // Math.imul, not `*`: the product overflows 2^53, so plain multiplication
  // rounds the low bits away and the generator degenerates. Measured over 3000
  // draws mod 6 it returned {0:909, 1:1, 2:1022, 3:12, 4:1056} and never once
  // returned 5, so the corpus never picked the last entry of a six-item list
  // (the "Machine Learning" domain was unreachable).
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  // Take the HIGH bits: an LCG's low bits have a very short period (these cycle
  // 0,1,2,3 under `% 4`). Each row draws eight times and the company is the
  // seventh draw, so it landed on the same phase every row and all 300 rows got
  // a single company, despite the comment above promising several.
  return (seed >>> 16) % n;
};
const levels = ['', 'Senior ', 'Staff ', 'Principal ', 'Associate '];
const domains = ['Backend', 'Frontend', 'Platform', 'Security', 'Analytics', 'Machine Learning'];
const kinds = ['Engineer', 'Developer', 'Manager'];
const teams = ['Checkout', 'Marketplace', 'Billing', 'Ingestion', 'Trust'];
const statuses = ['added', 'added', 'added', 'added', 'skipped_expired'];
const mixedCorpus = Array.from({ length: 300 }, (_, i) => {
  const title = `${levels[rand(levels.length)]}${domains[rand(domains.length)]} ${kinds[rand(kinds.length)]}, ${teams[rand(teams.length)]}`;
  // Deliberate URL reuse (i % 7) so the URL-dedup path inside clusters runs.
  return eqRow(
    `https://mix.com/${i % 7 === 0 ? i - (i % 7) : i}`,
    dayStr(rand(240)),
    rand(9) === 0 ? title.toUpperCase() : title,
    `Company${rand(4)}`,
    statuses[rand(statuses.length)]
  );
});
sameAsLegacy('equivalence: 300-row mixed corpus (seeded)', mixedCorpus);
sameAsLegacy('equivalence: same mixed corpus at window=30', mixedCorpus, 30);
// window=0 needs the span floor lowered to 0 as well, or both sides return an
// empty list and the comparison confirms nothing.
sameAsLegacy('equivalence: same mixed corpus at window=0, span floor 0', mixedCorpus, 0, 0);
// The span floor itself, compared against the reference on the full corpus.
sameAsLegacy('equivalence: same mixed corpus at span floor 0', mixedCorpus, 90, 0);
sameAsLegacy('equivalence: same mixed corpus at span floor 30', mixedCorpus, 90, 30);

// The mixed corpus is only meaningful if it actually produces clusters — an
// all-empty comparison would pass no matter what the grouping did.
ok('equivalence corpus is non-trivial (mixed corpus yields clusters)', detectReposts(mixedCorpus, 90).length > 0);
ok('equivalence corpus is non-trivial (exact-duplicate corpus yields clusters)', detectReposts(exactCorpus, 90).length > 0);

// ============================================================================
// 11. Performance
// ============================================================================
console.log('\n--- 11. performance ---');

// #2383 regression guard. 4000 rows at ONE company with distinct titles is the
// reachable worst case: scan-history.tsv is append-only with one row per
// scanned posting, so a large employer accumulates thousands of distinct
// titles and nothing collapses. The pre-#2383 nested loop took ~45s on this
// machine for this shape; the bucketed version takes a fraction of a second.
// The budget is deliberately loose (a whole order of magnitude of headroom
// over the observed runtime) so it is not a wall-clock flake on a loaded CI
// box, while still failing hard if the quadratic loop ever comes back.
const bigDistinct = [];
for (let i = 0; i < 4000; i++) {
  // One unique discriminating token per title and otherwise only baseline
  // vocabulary, so no two of these fuzzy-match (the overlap would be
  // [backend, engineer], both baseline) and the expected cluster count is
  // exactly the number of planted reposts below.
  bigDistinct.push(eqRow(`https://big.com/u${i}`, dayStr(i % 200), `Backend Engineer, Zephyr${i}`, 'BigCo'));
}
// 25 planted exact reposts (distinct URL, same title, 10 days apart) so the
// guard cannot pass by silently returning nothing.
for (let i = 0; i < 25; i++) {
  bigDistinct.push(eqRow(`https://big.com/r${i}`, dayStr((i % 200) + 10), `Backend Engineer, Zephyr${i}`, 'BigCo'));
}
const bigStart = Date.now();
const bigClusters = detectReposts(bigDistinct, 90);
const bigElapsed = Date.now() - bigStart;
eq('4025 rows at one company: exactly the 25 planted reposts found', bigClusters.length, 25);
ok(`4025 rows at one company completes under 10s (#2383 quadratic guard, took ${bigElapsed}ms)`, bigElapsed < 10000);

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

// Test --min-span flag.
//
// This asserts on the VALUE reaching metadata, not merely on a zero exit,
// because the failure this guards against exits non-zero for a reason that has
// nothing to do with the flag's logic: validateFlags reads KNOWN_FLAGS, which
// lives in a different block from every line that consumes --min-span. Adding
// the flag everywhere else and forgetting that list produces "unrecognized
// flag(s): --min-span" from code that is otherwise complete and correct — and
// two branches can each append to that list and merge without git ever
// reporting a conflict, so nothing outside a running CLI catches it.
const minSpanOut = execFileSync('node', [scriptPath, '--min-span', '3'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const minSpanJson = JSON.parse(minSpanOut);
eq('--min-span sets minSpanDays in metadata', minSpanJson.metadata.minSpanDays, 3);

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

// Test --help flag
const helpOut = execFileSync('node', [scriptPath, '--help'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
ok('--help prints usage', helpOut.includes('Usage:'));
ok('--help documents --summary', helpOut.includes('--summary'));
ok('--help documents --window', helpOut.includes('--window'));
ok('--help documents --min-span', helpOut.includes('--min-span'));
ok('--help documents --self-test', helpOut.includes('--self-test'));
ok('--help documents --help', helpOut.includes('--help'));

// --min-span in both accepted forms, since it reads through flagValue. The
// `=` form is the one a hand-rolled indexOf() lookup drops silently.
const spanEqOut = execFileSync('node', [scriptPath, '--min-span=30'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
eq('--min-span=30 is honoured (not silently dropped)', JSON.parse(spanEqOut).metadata.minSpanDays, 30);

const spanSpaceOut = execFileSync('node', [scriptPath, '--min-span', '30'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
eq('--min-span 30 is honoured', JSON.parse(spanSpaceOut).metadata.minSpanDays, 30);

const badSpanOut = execFileSync('node', [scriptPath, '--min-span', 'abc'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
eq('--min-span abc falls back to 1', JSON.parse(badSpanOut).metadata.minSpanDays, 1);

// Anything that is not a plain non-negative integer falls back rather than
// being half-read. The negative case is the dangerous one: it silently DISABLES
// the guard --min-span exists to set, so concurrent openings would be reported
// as reposts again with nothing to indicate the value was rejected. "7abc" is
// the same class — parseInt() reads it as 7 and runs with a number nobody typed.
const flagFallbackCases = [
  ['--min-span', '-5', 'minSpanDays', 1, 'negative --min-span falls back (never disables the floor)'],
  ['--min-span', '7abc', 'minSpanDays', 1, 'partially numeric --min-span falls back (not read as 7)'],
  ['--min-span', '1.5', 'minSpanDays', 1, 'non-integer --min-span falls back'],
  ['--window', '-1', 'windowDays', 90, 'negative --window falls back (never rejects every cluster)'],
  ['--window', '60abc', 'windowDays', 90, 'partially numeric --window falls back'],
];
for (const [flag, value, field, expected, label] of flagFallbackCases) {
  const out = execFileSync('node', [scriptPath, flag, value], {
    encoding: 'utf-8', timeout: 10000,
    cwd: dirname(scriptPath),
  });
  eq(label, JSON.parse(out).metadata[field], expected);
}

// `--min-span=` supplies an EMPTY value, which must fall back too. Number('')
// is 0, so a validator written with Number()/Number.isInteger() would read this
// as a deliberate zero and quietly disable the floor.
const emptySpanOut = execFileSync('node', [scriptPath, '--min-span='], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
eq('--min-span= (empty value) falls back to 1, not 0', JSON.parse(emptySpanOut).metadata.minSpanDays, 1);

// 0 remains a legitimate explicit value on both flags — the fallback rules must
// not swallow it, or the floor could never be switched off on purpose.
const zeroSpanOut = execFileSync('node', [scriptPath, '--min-span', '0'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
eq('--min-span 0 is honoured as an explicit zero', JSON.parse(zeroSpanOut).metadata.minSpanDays, 0);

// All-digits is not enough on its own. A long digit run converts to Infinity,
// which is this file's original defect in a new place: an infinite floor
// rejects every cluster, an infinite window is unbounded, and JSON.stringify
// writes Infinity as `null` — so metadata would report a value that is not the
// one in effect. An UNSAFE integer is the quiet version: 9007199254740993
// silently becomes ...992, a number nobody typed.
const overflowCases = [
  ['--min-span', '9'.repeat(400), 'minSpanDays', 1, 'overflow --min-span falls back (never becomes an infinite floor)'],
  ['--window', '9'.repeat(400), 'windowDays', 90, 'overflow --window falls back (never becomes an unbounded window)'],
  ['--min-span', '9007199254740993', 'minSpanDays', 1, 'unsafe-integer --min-span falls back rather than losing precision'],
];
for (const [flag, value, field, expected, label] of overflowCases) {
  const out = execFileSync('node', [scriptPath, flag, value], {
    encoding: 'utf-8', timeout: 10000,
    cwd: dirname(scriptPath),
  });
  const meta = JSON.parse(out).metadata;
  eq(label, meta[field], expected);
}

// The metadata block must always round-trip a real number, since it is what a
// consumer reads to learn which rules produced the clusters. `null` there means
// an Infinity got through.
const metaSanity = JSON.parse(execFileSync('node', [scriptPath, '--min-span', '9'.repeat(400)], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
})).metadata;
ok('metadata.minSpanDays is always a finite number, never null', Number.isFinite(metaSanity.minSpanDays));
ok('metadata.windowDays is always a finite number, never null', Number.isFinite(metaSanity.windowDays));

// Test -h flag
const hOut = execFileSync('node', [scriptPath, '-h'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
ok('-h prints usage', hOut.includes('Usage:'));

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