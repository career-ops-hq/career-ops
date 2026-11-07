// tests/verify-cv-facts-currencies.test.mjs — amounts in currencies other than
// USD/EUR/GBP, local magnitude abbreviations, and the decimal comma.
//
// The metric patterns read money only as $/€/£ or USD/EUR/GBP. An amount in any
// other currency the project ships market modes for ("PLN 99m", "CHF 2m",
// "99 mln zł") was not a claim at all, so an invented figure passed the gate.
// A decimal comma split one number into two: "12,5%" was read as "5%", which
// both let an invented "12,5%" through against a source holding any "5%" and
// flagged a true one against a source that wrote "12.5%".
//
// Run:  node --test tests/verify-cv-facts-currencies.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditClaims, metricClaims } from '../verify-cv-facts.mjs';

const SOURCE = 'Closed an acquisition at an independent valuation of PLN 30m. Revenue of PLN 7.4m. '
  + 'Gross margin 12.5%. Raised CHF 2m. Managed a $300K budget.';

const claims = (text) => [...metricClaims(text)].sort();
const invented = (text, source = SOURCE) => auditClaims(text, source).invented.sort();

test('an amount in a non-USD/EUR/GBP currency is a claim', () => {
  assert.deepEqual(claims('Valuation PLN 99m'), ['pln99m']);
  assert.deepEqual(claims('Raised SEK 2m'), ['sek2m']);
  assert.deepEqual(claims('Budget of 500 CZK'), ['czk500']);
});

test('an invented amount in such a currency is blocked', () => {
  assert.deepEqual(invented('Closed an acquisition at PLN 99m'), ['pln99m']);
  assert.deepEqual(invented('Raised SEK 2m'), ['sek2m']);
});

test('a true amount passes however it is spelled', () => {
  assert.deepEqual(invented('Valuation PLN 30m'), []);
  assert.deepEqual(invented('wycena 30 mln zł'), []);
  assert.deepEqual(invented('przychody 7,4 mln zł'), []);
  assert.deepEqual(invented('2 Mio. CHF eingeworben'), []);
});

test('two currencies never compare equal', () => {
  assert.deepEqual(invented('Raised EUR 2m'), ['€2m']);
  assert.deepEqual(invented('Raised PLN 2m'), ['pln2m']);
});

test('a decimal comma is one number', () => {
  assert.deepEqual(claims('marża 12,5%'), ['12.5%']);
  assert.deepEqual(invented('marża 12,5%'), []);
  assert.deepEqual(invented('marża 5%'), ['5%']);
  assert.deepEqual(invented('przychody 7,9 mln zł'), ['pln7.9m']);
});

test('a comma before three digits is still a thousands separator', () => {
  assert.deepEqual(claims('Managed a $300,000 budget'), ['$300000']);
});

test('the first letter of the next word is not a magnitude suffix', () => {
  // Before: "$40 bonus" -> "$40b" and "$300,000 budget" -> "$300000b" (billion).
  assert.deepEqual(claims('$40 bonus'), ['$40']);
  assert.deepEqual(claims('$5 billion'), ['$5b']);
  assert.deepEqual(claims('$300K budget'), ['$300k']);
  assert.deepEqual(claims('€2m Umsatz'), ['€2m']);
});

test('ambiguous "kr" is deliberately not read as any one currency', () => {
  assert.deepEqual(claims('Budget 500 kr'), []);
});

test('the existing USD/EUR/GBP behaviour is unchanged', () => {
  assert.deepEqual(invented('Managed a $300K budget'), []);
  assert.deepEqual(invented('Managed a $900K budget'), ['$900k']);
  assert.deepEqual(claims('USD 3M'), ['$3m']);
});
