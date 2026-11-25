import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount,
  compensationCurrency,
  parseAnnualCompensation,
} from '../providers/_salary-text.mjs';
import { parseHomerunSalary } from '../providers/homerun.mjs';
import { parseZohoSalary } from '../providers/zoho-recruit.mjs';

test('compensationCurrency ignores non-ISO uppercase 3-letter labels and maps RMB to CNY', () => {
  assert.equal(compensationCurrency('OTE: €60,000 - €70,000 per year'), 'EUR');
  assert.equal(compensationCurrency('OTE: $150,000 - $180,000 USD'), 'USD');
  assert.equal(compensationCurrency('€60,000 - €70,000 EUR (EST)'), 'EUR');
  assert.equal(compensationCurrency('$70,000 - $90,000 (FTE)'), undefined);
  assert.equal(compensationCurrency('DOE $120,000 - $140,000'), undefined);
  assert.equal(compensationCurrency('600k RMB'), 'CNY');
  assert.equal(compensationCurrency('CNY 600k RMB'), 'CNY');
  assert.equal(compensationCurrency('USD 100k - EUR 90k'), '');
});

test('parseAnnualCompensation does not strip non-ISO qualifiers before parsing', () => {
  assert.equal(parseAnnualCompensation('100k TAX'), null);
  assert.equal(parseAnnualCompensation('100k NET'), null);
  assert.equal(parseAnnualCompensation('MAX 120,000'), null);
  assert.equal(parseAnnualCompensation('100k NOT annual'), null);
  assert.deepEqual(parseAnnualCompensation('65.000 EUR-75.000 EUR'), { min: 65000, max: 75000, mid: 70000 });
  assert.deepEqual(parseAnnualCompensation('600k RMB - 800k RMB'), { min: 600000, max: 800000, mid: 700000 });
  assert.deepEqual(parseAnnualCompensation('OTE: $150,000 - $180,000 USD'), { min: 150000, max: 180000, mid: 165000 });
});

test('parseAmount does not strip non-ISO 3-letter words ahead of a bound', () => {
  assert.equal(parseAmount('NET 80,000'), null);
  assert.equal(parseAmount('MAX 120,000'), null);
  assert.equal(parseAmount('TAX 20,000'), null);
  assert.equal(parseAmount('80,000 - MAX 120,000'), null);
  assert.deepEqual(parseAmount('NOK 2 000 000-2 600 000'), { min: 2000000, max: 2600000, mid: 2300000 });
  assert.deepEqual(parseAmount('RMB 600k'), { min: 600000, max: 600000, mid: 600000 });
  assert.deepEqual(parseAmount('kr 1.100.000 – 1.400.000'), { min: 1100000, max: 1400000, mid: 1250000 });
});

test('parseAmount Chinese path does not strip non-ISO 3-letter qualifiers', () => {
  assert.equal(parseAmount('NET 60-80 万'), null);
  assert.equal(parseAmount('TAX 50 万'), null);
  assert.equal(parseAmount('MAX 50 万'), null);
  assert.equal(parseAmount('25-40K·15薪 OTE'), null);
  assert.deepEqual(parseAmount('CNY 600,000-800,000 年薪'), { min: 600000, max: 800000, mid: 700000 });
  assert.deepEqual(parseAmount('年薪 60 至 80 万 RMB'), { min: 600000, max: 800000, mid: 700000 });
});

test('Homerun and Zoho salary parsers keep real currencies and fallbacks next to non-ISO labels', () => {
  assert.deepEqual(
    parseHomerunSalary('OTE: €60000 to €70000 per year'),
    { min: 60000, max: 70000, currency: 'EUR' },
  );
  assert.deepEqual(
    parseZohoSalary('OTE: $150,000 - $180,000 USD', 'CAD'),
    { min: 150000, max: 180000, currency: 'USD' },
  );
  assert.deepEqual(
    parseZohoSalary('$70,000 - $90,000 (FTE)', 'CAD'),
    { min: 70000, max: 90000, currency: 'CAD' },
  );
  assert.equal(parseZohoSalary('100k NET', 'USD'), null);
});
