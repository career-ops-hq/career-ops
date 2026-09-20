// tests/providers/ashby-compensation-tiers.test.mjs — the posting-api returns
// compensation as tiers[].components[], not as min/max on the compensation
// object (#4316).
//
// The shape here is copied from a live `posting-api/job-board` payload, so the
// test fails against a parser that only reads the flat form. Every existing
// fixture in ashby.test.mjs uses the flat form, which is why the flat read went
// unnoticed.
//
// Run:  node --test tests/providers/ashby-compensation-tiers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCompensation } from '../../providers/ashby.mjs';

/** One component of a real payload's compensationTiers[0].components[]. */
const salary = (over = {}) => ({
  id: 'feaef96f-559f-4df8-a38c-3eee072a8d74',
  summary: '$128K - $180K • Offers Equity',
  compensationType: 'Salary',
  interval: '1 YEAR',
  currencyCode: 'USD',
  minValue: 128000,
  maxValue: 180000,
  ...over,
});

const equity = (over = {}) => ({
  id: 'a1',
  summary: 'Offers Equity',
  compensationType: 'EquityPercentage',
  interval: 'NONE',
  currencyCode: null,
  minValue: null,
  maxValue: null,
  ...over,
});

const jobWith = (components, tierOver = {}) => ({
  compensation: {
    compensationTierSummary: '$128K – $180K • Offers Equity',
    scrapeableCompensationSalarySummary: '$128K - $180K',
    compensationTiers: [{ id: 't1', tierSummary: '$128K – $180K', components, ...tierOver }],
  },
});

test('reads the salary range from compensationTiers[].components[]', () => {
  const result = parseCompensation(jobWith([salary(), equity()]));
  assert.equal(result.min, 128000);
  assert.equal(result.max, 180000);
  assert.equal(result.currency, 'USD');
});

test('does not mistake an equity component for the salary range', () => {
  // EquityPercentage carries no min/max, so it must never become the source.
  const result = parseCompensation(jobWith([equity(), salary()]));
  assert.equal(result.min, 128000);
  assert.equal(result.max, 180000);
});

test('an equity-only tier has no salary to report', () => {
  assert.equal(parseCompensation(jobWith([equity()])), null);
});

test('picks the widest band when a tier carries several salary components', () => {
  const narrow = salary({ minValue: 140000, maxValue: 150000, currencyCode: 'USD' });
  const wide = salary({ minValue: 128000, maxValue: 180000, currencyCode: 'USD' });
  const result = parseCompensation(jobWith([narrow, wide]));
  assert.equal(result.min, 128000);
  assert.equal(result.max, 180000);
});

test('annualizes a non-year interval from a component', () => {
  const hourly = salary({ interval: '1 HOUR', minValue: 50, maxValue: 70 });
  const result = parseCompensation(jobWith([hourly]));
  assert.equal(result.min, 50 * 2080);
  assert.equal(result.max, 70 * 2080);
});

test('tiers spread across several entries are all considered', () => {
  const job = {
    compensation: {
      compensationTiers: [
        { id: 't1', components: [equity()] },
        { id: 't2', components: [salary()] },
      ],
    },
  };
  const result = parseCompensation(job);
  assert.equal(result.min, 128000);
  assert.equal(result.max, 180000);
});

test('the flat shape still parses, so existing callers are unaffected', () => {
  const flat = parseCompensation({
    compensation: { interval: '1 YEAR', minValue: 90000, maxValue: 110000, currency: 'EUR' },
  });
  assert.equal(flat.min, 90000);
  assert.equal(flat.max, 110000);
  assert.equal(flat.currency, 'EUR');
});

test('a malformed tier degrades to null rather than throwing', () => {
  assert.equal(parseCompensation({ compensation: { compensationTiers: 'nope' } }), null);
  assert.equal(parseCompensation({ compensation: { compensationTiers: [null] } }), null);
  assert.equal(
    parseCompensation(jobWith([salary({ minValue: 'abc', maxValue: null })])),
    null,
  );
});

test('an unknown interval on a component is rejected', () => {
  assert.equal(parseCompensation(jobWith([salary({ interval: '7 MOON' })])), null);
});

test('a nested component with no interval is rejected, not assumed yearly', () => {
  // A component states its own interval. Defaulting it to 1 YEAR would annualize
  // a monthly figure and present it as a salary with nothing signalling it.
  assert.equal(parseCompensation(jobWith([salary({ interval: undefined })])), null);
  assert.equal(parseCompensation(jobWith([salary({ interval: '' })])), null);
});

test('only a Salary component is read, so an equity number is never the range', () => {
  // A bonus component can carry real numbers. Reading the widest one regardless
  // of type would report a one-off as the role's annual band.
  const bonus = {
    id: 'b1',
    summary: '10% bonus',
    compensationType: 'Bonus',
    interval: '1 YEAR',
    currencyCode: 'USD',
    minValue: 500000,
    maxValue: 900000,
  };
  const result = parseCompensation(jobWith([salary(), bonus]));
  assert.equal(result.min, 128000);
  assert.equal(result.max, 180000);

  // And a tier with no Salary component at all has nothing to report.
  assert.equal(parseCompensation(jobWith([bonus, equity()])), null);
});

test('the flat shape keeps its 1 YEAR default', () => {
  // The fallback is a flat-shape convenience and must survive the nested rule.
  const flat = parseCompensation({ compensation: { minValue: 80000, maxValue: 100000, currency: 'EUR' } });
  assert.equal(flat.min, 80000);
  assert.equal(flat.max, 100000);
});
