#!/usr/bin/env node
// @ts-check
/**
 * Comprehensive test suite for salary filter and Ashby compensation parsing.
 * Run: node test-salary-filter.mjs
 *
 * Tests cover:
 *   - buildSalaryFilter: range overlap, currency matching, edge cases, validation
 *   - parseCompensation (Ashby): interval normalization, malformed data, ordering
 */

import { parseCompensation } from './providers/ashby.mjs';
import { buildSalaryFilter } from './scan.mjs';

// ── Test runner ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ══════════════════════════════════════════════════════════════════════
// PART 1: parseCompensation (Ashby provider)
// ══════════════════════════════════════════════════════════════════════

section('parseCompensation — basic cases');

assert(
  parseCompensation(null) === null,
  'null job → null'
);

assert(
  parseCompensation({}) === null,
  'empty job (no compensation) → null'
);

assert(
  parseCompensation({ compensation: null }) === null,
  'compensation: null → null'
);

assert(
  parseCompensation({ compensation: {} }) === null,
  'compensation: {} (no minValue/maxValue) → null'
);

section('parseCompensation — yearly interval');

{
  const result = parseCompensation({
    compensation: { minValue: 100000, maxValue: 150000, currency: 'usd', interval: '1 YEAR' }
  });
  assert(result != null, 'yearly salary returns non-null');
  assert(result.min === 100000, 'yearly min = 100000');
  assert(result.max === 150000, 'yearly max = 150000');
  assert(result.currency === 'USD', 'currency uppercased to USD');
}

section('parseCompensation — hourly interval (annualization)');

{
  const result = parseCompensation({
    compensation: { minValue: 50, maxValue: 75, currency: 'USD', interval: '1 HOUR' }
  });
  assert(result != null, 'hourly salary returns non-null');
  assert(result.min === 50 * 2080, `hourly min annualized: ${result?.min} = ${50 * 2080}`);
  assert(result.max === 75 * 2080, `hourly max annualized: ${result?.max} = ${75 * 2080}`);
}

section('parseCompensation — monthly interval');

{
  const result = parseCompensation({
    compensation: { minValue: 8000, maxValue: 12000, currency: 'EUR', interval: '1 MONTH' }
  });
  assert(result != null, 'monthly salary returns non-null');
  assert(result.min === 8000 * 12, `monthly min annualized: ${result?.min} = ${8000 * 12}`);
  assert(result.max === 12000 * 12, `monthly max annualized: ${result?.max} = ${12000 * 12}`);
}

section('parseCompensation — weekly interval');

{
  const result = parseCompensation({
    compensation: { minValue: 2000, maxValue: 3000, currency: 'GBP', interval: '1 WEEK' }
  });
  assert(result != null, 'weekly salary returns non-null');
  assert(result.min === 2000 * 52, `weekly min annualized: ${result?.min}`);
  assert(result.max === 3000 * 52, `weekly max annualized: ${result?.max}`);
}

section('parseCompensation — bi-weekly interval');

{
  const result = parseCompensation({
    compensation: { minValue: 4000, maxValue: 5000, currency: 'USD', interval: '2 WEEK' }
  });
  assert(result != null, 'bi-weekly salary returns non-null');
  assert(result.min === 4000 * 26, `bi-weekly min annualized: ${result?.min}`);
  assert(result.max === 5000 * 26, `bi-weekly max annualized: ${result?.max}`);
}

section('parseCompensation — partial range (min only, max only)');

{
  const minOnly = parseCompensation({
    compensation: { minValue: 80000, maxValue: null, currency: 'USD', interval: '1 YEAR' }
  });
  assert(minOnly != null, 'min-only returns non-null');
  assert(minOnly.min === 80000, 'min-only: min = 80000');
  assert(minOnly.max === 80000, 'min-only: max falls back to min = 80000');
}

{
  const maxOnly = parseCompensation({
    compensation: { minValue: null, maxValue: 200000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(maxOnly != null, 'max-only returns non-null');
  assert(maxOnly.min === 200000, 'max-only: min falls back to max = 200000');
  assert(maxOnly.max === 200000, 'max-only: max = 200000');
}

section('parseCompensation — unknown interval');

{
  const result = parseCompensation({
    compensation: { minValue: 5000, maxValue: 10000, currency: 'USD', interval: 'QUARTERLY' }
  });
  assert(result === null, 'unknown interval → null');
}

section('parseCompensation — default interval (missing)');

{
  const result = parseCompensation({
    compensation: { minValue: 120000, maxValue: 180000, currency: 'USD' }
  });
  assert(result != null, 'missing interval defaults to 1 YEAR');
  assert(result.min === 120000, 'default interval: min = 120000');
  assert(result.max === 180000, 'default interval: max = 180000');
}

section('parseCompensation — malformed data (CodeRabbit hardening)');

{
  const nanResult = parseCompensation({
    compensation: { minValue: 'not-a-number', maxValue: 100000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(nanResult != null, 'NaN minValue treated as null, maxValue used');
  assert(nanResult.min === 100000, 'NaN min: falls back to max = 100000');
  assert(nanResult.max === 100000, 'NaN min: max = 100000');
}

{
  const infResult = parseCompensation({
    compensation: { minValue: Infinity, maxValue: 100000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(infResult != null, 'Infinity minValue treated as null, maxValue used');
  assert(infResult.min === 100000, 'Infinity min: falls back to max = 100000');
}

{
  const negInfResult = parseCompensation({
    compensation: { minValue: -Infinity, maxValue: 100000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(negInfResult != null, '-Infinity minValue treated as null, maxValue used');
  assert(negInfResult.min === 100000, '-Infinity min: falls back to max = 100000');
}

{
  const negativeResult = parseCompensation({
    compensation: { minValue: -50000, maxValue: 100000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(negativeResult != null, 'Negative minValue treated as null, maxValue used');
  assert(negativeResult.min === 100000, 'Negative min: falls back to max = 100000');
}

{
  const numericCurrency = parseCompensation({
    compensation: { minValue: 100000, maxValue: 150000, currency: 12345, interval: '1 YEAR' }
  });
  assert(numericCurrency != null, 'numeric currency does not crash');
  assert(numericCurrency.currency === '', 'numeric currency treated as empty string');
}

{
  const boolCurrency = parseCompensation({
    compensation: { minValue: 100000, maxValue: 150000, currency: true, interval: '1 YEAR' }
  });
  assert(boolCurrency != null, 'boolean currency does not crash');
  assert(boolCurrency.currency === '', 'boolean currency treated as empty string');
}

{
  const stringMin = parseCompensation({
    compensation: { minValue: '100000', maxValue: 150000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(stringMin != null, 'string minValue coerced to number');
  assert(stringMin.min === 100000, 'string "100000" coerced to 100000');
}

section('parseCompensation — blank string values (normalizeNum)');

{
  const blankMin = parseCompensation({
    compensation: { minValue: '', maxValue: 150000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(blankMin != null, 'blank minValue treated as null, maxValue used');
  assert(blankMin.min === 150000, 'blank min: falls back to max = 150000');
}

{
  const blankBoth = parseCompensation({
    compensation: { minValue: '', maxValue: '', currency: 'USD', interval: '1 YEAR' }
  });
  assert(blankBoth === null, 'both blank → null');
}

{
  const spacesOnly = parseCompensation({
    compensation: { minValue: '   ', maxValue: 100000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(spacesOnly != null, 'whitespace-only minValue treated as null');
  assert(spacesOnly.min === 100000, 'whitespace min: falls back to max');
}

section('parseCompensation — trimmed currency');

{
  const spacedCurrency = parseCompensation({
    compensation: { minValue: 100000, maxValue: 150000, currency: '  usd  ', interval: '1 YEAR' }
  });
  assert(spacedCurrency != null, 'whitespace-padded currency does not crash');
  assert(spacedCurrency.currency === 'USD', 'whitespace-padded currency trimmed to USD');
}

section('parseCompensation — min/max ordering (reversed values)');

{
  const reversed = parseCompensation({
    compensation: { minValue: 200000, maxValue: 100000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(reversed != null, 'reversed min/max returns non-null');
  assert(reversed.min === 100000, 'reversed: min corrected to 100000');
  assert(reversed.max === 200000, 'reversed: max corrected to 200000');
}

section('parseCompensation — zero values');

{
  const zeroMin = parseCompensation({
    compensation: { minValue: 0, maxValue: 150000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(zeroMin != null, 'zero minValue preserved (not treated as null)');
  assert(zeroMin.min === 0, 'zero min = 0');
  assert(zeroMin.max === 150000, 'zero min: max = 150000');
}

{
  const bothZero = parseCompensation({
    compensation: { minValue: 0, maxValue: 0, currency: 'USD', interval: '1 YEAR' }
  });
  assert(bothZero != null, 'both zero returns non-null');
  assert(bothZero.min === 0, 'both zero: min = 0');
  assert(bothZero.max === 0, 'both zero: max = 0');
}

// ══════════════════════════════════════════════════════════════════════
// PART 2: buildSalaryFilter (scan.mjs)
// ══════════════════════════════════════════════════════════════════════

section('buildSalaryFilter — disabled / no-op cases');

{
  const filter = buildSalaryFilter(null);
  assert(filter({ min: 50000, max: 80000, currency: 'USD' }) === true, 'null config → pass all');
}

{
  const filter = buildSalaryFilter(undefined);
  assert(filter({ min: 50000, max: 80000, currency: 'USD' }) === true, 'undefined config → pass all');
}

{
  const filter = buildSalaryFilter({ min: 0, max: 0 });
  assert(filter({ min: 50000, max: 80000, currency: 'USD' }) === true, 'min=0, max=0 → pass all');
}

{
  const filter = buildSalaryFilter({});
  assert(filter({ min: 50000, max: 80000, currency: 'USD' }) === true, 'empty object → pass all');
}

section('buildSalaryFilter — basic range filtering');

{
  const filter = buildSalaryFilter({ min: 100000, max: 200000, currency: 'USD' });

  assert(filter({ min: 120000, max: 180000, currency: 'USD' }) === true,
    'job fully inside range → pass');

  assert(filter({ min: 50000, max: 80000, currency: 'USD' }) === false,
    'job entirely below range → reject');

  assert(filter({ min: 250000, max: 300000, currency: 'USD' }) === false,
    'job entirely above range → reject');

  assert(filter({ min: 90000, max: 150000, currency: 'USD' }) === true,
    'job overlaps lower bound → pass');

  assert(filter({ min: 180000, max: 250000, currency: 'USD' }) === true,
    'job overlaps upper bound → pass');

  assert(filter({ min: 50000, max: 300000, currency: 'USD' }) === true,
    'job completely encompasses filter range → pass');
}

section('buildSalaryFilter — exact boundary matches');

{
  const filter = buildSalaryFilter({ min: 100000, max: 200000, currency: 'USD' });

  assert(filter({ min: 100000, max: 200000, currency: 'USD' }) === true,
    'job exactly matches filter range → pass');

  assert(filter({ min: 100000, max: 100000, currency: 'USD' }) === true,
    'job at exact minimum → pass');

  assert(filter({ min: 200000, max: 200000, currency: 'USD' }) === true,
    'job at exact maximum → pass');

  assert(filter({ min: 99999, max: 99999, currency: 'USD' }) === false,
    'job 1 below minimum → reject');

  assert(filter({ min: 200001, max: 200001, currency: 'USD' }) === false,
    'job 1 above maximum → reject');
}

section('buildSalaryFilter — min-only filter (no upper limit)');

{
  const filter = buildSalaryFilter({ min: 100000, max: 0, currency: 'USD' });

  assert(filter({ min: 150000, max: 200000, currency: 'USD' }) === true,
    'min-only: job above minimum → pass');

  assert(filter({ min: 50000, max: 80000, currency: 'USD' }) === false,
    'min-only: job entirely below minimum → reject');

  assert(filter({ min: 500000, max: 1000000, currency: 'USD' }) === true,
    'min-only: very high salary → pass (no upper limit)');
}

section('buildSalaryFilter — max-only filter');

{
  const filter = buildSalaryFilter({ min: 0, max: 200000, currency: 'USD' });

  assert(filter({ min: 50000, max: 100000, currency: 'USD' }) === true,
    'max-only: job below maximum → pass');

  assert(filter({ min: 250000, max: 300000, currency: 'USD' }) === false,
    'max-only: job entirely above maximum → reject');
}

section('buildSalaryFilter — currency handling');

{
  const filter = buildSalaryFilter({ min: 100000, max: 200000, currency: 'USD' });

  assert(filter({ min: 120000, max: 180000, currency: 'EUR' }) === false,
    'currency mismatch (USD vs EUR) → reject');

  assert(filter({ min: 120000, max: 180000, currency: 'usd' }) === true,
    'currency case-insensitive (usd vs USD) → pass');

  assert(filter({ min: 120000, max: 180000, currency: '' }) === true,
    'job has empty currency → pass (conservative)');

  assert(filter({ min: 120000, max: 180000 }) === true,
    'job has no currency field → pass (conservative)');
}

{
  const noCurrencyFilter = buildSalaryFilter({ min: 100000, max: 200000 });

  assert(noCurrencyFilter({ min: 120000, max: 180000, currency: 'EUR' }) === true,
    'filter has no currency → pass regardless of job currency');
}

{
  // Whitespace-padded currency in filter config
  const spacedFilter = buildSalaryFilter({ min: 100000, max: 200000, currency: '  USD  ' });

  assert(spacedFilter({ min: 120000, max: 180000, currency: 'USD' }) === true,
    'filter currency with whitespace trimmed → matches USD');

  assert(spacedFilter({ min: 120000, max: 180000, currency: 'EUR' }) === false,
    'filter currency with whitespace: still rejects EUR mismatch');
}

{
  // Whitespace-padded currency in job data
  const filter = buildSalaryFilter({ min: 100000, max: 200000, currency: 'USD' });

  assert(filter({ min: 120000, max: 180000, currency: ' USD ' }) === true,
    'job currency with whitespace trimmed → matches USD');

  assert(filter({ min: 120000, max: 180000, currency: ' EUR ' }) === false,
    'job currency with whitespace: still rejects EUR mismatch');
}

section('buildSalaryFilter — missing salary data (conservative)');

{
  const filter = buildSalaryFilter({ min: 100000, max: 200000, currency: 'USD' });

  assert(filter(null) === true,
    'null salary → pass (conservative)');

  assert(filter(undefined) === true,
    'undefined salary → pass (conservative)');

  assert(filter({}) === true,
    'empty salary object (no min/max) → pass (conservative)');

  assert(filter({ min: null, max: null, currency: 'USD' }) === true,
    'salary with null min and max → pass (conservative)');
}

section('buildSalaryFilter — partial job salary data');

{
  const filter = buildSalaryFilter({ min: 100000, max: 200000, currency: 'USD' });

  assert(filter({ min: 150000, max: null, currency: 'USD' }) === true,
    'job has only min (in range) → pass');

  assert(filter({ min: null, max: 150000, currency: 'USD' }) === true,
    'job has only max (in range) → pass');

  assert(filter({ min: 50000, max: null, currency: 'USD' }) === false,
    'job has only min (below range, treated as single point) → reject');

  assert(filter({ min: null, max: 50000, currency: 'USD' }) === false,
    'job has only max (below min) → reject');

  assert(filter({ min: 300000, max: null, currency: 'USD' }) === false,
    'job has only min (above max) → reject');
}

section('buildSalaryFilter — validation (CodeRabbit hardening)');

{
  // Capture console.error output
  const originalError = console.error;
  let warnings = [];
  console.error = (msg) => warnings.push(msg);

  const nanFilter = buildSalaryFilter({ min: 'abc', max: 100000 });
  assert(nanFilter({ min: 50000, max: 80000, currency: 'USD' }) === true,
    'NaN min → filter disabled (no-op)');
  assert(warnings.length > 0, 'NaN min → warning logged');

  warnings = [];
  const negFilter = buildSalaryFilter({ min: -50000, max: 100000 });
  assert(negFilter({ min: 50000, max: 80000, currency: 'USD' }) === true,
    'negative min → filter disabled (no-op)');
  assert(warnings.length > 0, 'negative min → warning logged');

  warnings = [];
  const invertedFilter = buildSalaryFilter({ min: 200000, max: 100000 });
  assert(invertedFilter({ min: 150000, max: 180000, currency: 'USD' }) === true,
    'min > max → filter disabled (no-op)');
  assert(warnings.length > 0, 'min > max → warning logged');

  warnings = [];
  const negMaxFilter = buildSalaryFilter({ min: 0, max: -100000 });
  assert(negMaxFilter({ min: 50000, max: 80000, currency: 'USD' }) === true,
    'negative max → filter disabled (no-op)');
  assert(warnings.length > 0, 'negative max → warning logged');

  // "100k" style string
  warnings = [];
  const stringFilter = buildSalaryFilter({ min: '100k', max: 200000 });
  assert(stringFilter({ min: 50000, max: 80000, currency: 'USD' }) === true,
    '"100k" string min → filter disabled (no-op)');

  // Restore console.error
  console.error = originalError;
}

section('buildSalaryFilter — valid string numbers (coercion)');

{
  const filter = buildSalaryFilter({ min: '100000', max: '200000', currency: 'USD' });

  assert(filter({ min: 120000, max: 180000, currency: 'USD' }) === true,
    'string "100000"/"200000" coerced to valid numbers → works correctly');

  assert(filter({ min: 50000, max: 80000, currency: 'USD' }) === false,
    'string coercion: job below range → still rejects');
}

section('buildSalaryFilter — zero salary jobs');

{
  const filter = buildSalaryFilter({ min: 100000, max: 200000, currency: 'USD' });

  assert(filter({ min: 0, max: 0, currency: 'USD' }) === false,
    'zero salary job (volunteer/intern) → reject (below min)');

  assert(filter({ min: 0, max: 150000, currency: 'USD' }) === true,
    'zero min with valid max in range → pass');
}

// ══════════════════════════════════════════════════════════════════════
// PART 3: End-to-end (parseCompensation → buildSalaryFilter)
// ══════════════════════════════════════════════════════════════════════

section('End-to-end — Ashby job through salary filter');

{
  const filter = buildSalaryFilter({ min: 100000, max: 250000, currency: 'USD' });

  // Hourly $60/hr → $124,800/yr → should pass
  const hourlyJob = parseCompensation({
    compensation: { minValue: 50, maxValue: 60, currency: 'USD', interval: '1 HOUR' }
  });
  assert(hourlyJob != null, 'e2e: hourly job parsed');
  assert(filter(hourlyJob) === true, `e2e: $50-60/hr (${hourlyJob?.min}-${hourlyJob?.max}/yr) → pass`);

  // Monthly €3000/mo → €36,000/yr → should fail (below min, wrong currency)
  const monthlyJob = parseCompensation({
    compensation: { minValue: 3000, maxValue: 4000, currency: 'EUR', interval: '1 MONTH' }
  });
  assert(monthlyJob != null, 'e2e: monthly EUR job parsed');
  assert(filter(monthlyJob) === false, `e2e: €3000-4000/mo → currency mismatch → reject`);

  // Yearly $180k → should pass
  const yearlyJob = parseCompensation({
    compensation: { minValue: 180000, maxValue: 220000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(yearlyJob != null, 'e2e: yearly job parsed');
  assert(filter(yearlyJob) === true, `e2e: $180k-220k/yr → pass`);

  // Yearly $30k → should fail (entirely below range)
  const lowJob = parseCompensation({
    compensation: { minValue: 20000, maxValue: 30000, currency: 'USD', interval: '1 YEAR' }
  });
  assert(lowJob != null, 'e2e: low yearly job parsed');
  assert(filter(lowJob) === false, `e2e: $20k-30k/yr → reject`);

  // No compensation → null → filter passes conservatively
  const noComp = parseCompensation({});
  assert(noComp === null, 'e2e: no comp → null');
  assert(filter(noComp) === true, 'e2e: null salary → pass (conservative)');

  // Malformed → null → filter passes conservatively
  const malformed = parseCompensation({
    compensation: { minValue: 'garbage', maxValue: null, currency: 'USD' }
  });
  assert(malformed === null, 'e2e: malformed comp → null');
  assert(filter(malformed) === true, 'e2e: malformed → null → pass (conservative)');
}

// ══════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${passed} tests passed!`);
}
