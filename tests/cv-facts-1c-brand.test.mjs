import test from 'node:test';
import assert from 'node:assert/strict';
import { metricClaims } from '../verify-cv-facts.mjs';
test('ERP brand 1C does not become a fabricated workflow count after rephrasing', () => {
  assert.deepEqual([...metricClaims('Used 1C warehouse and order workflows')], []);
  assert.deepEqual([...metricClaims('Used 1C warehouse/order workflows')], []);
  assert.deepEqual([...metricClaims('Worked with 1C accounting systems')], []);
});
test('ordinary counts, units and nearby real metrics still reach the fact gate', () => {
  assert.deepEqual([...metricClaims('Built 10 workflows')], ['10 workflows']);
  assert.deepEqual([...metricClaims('Built 1 of the workflows')], ['1 workflows']);
  assert.deepEqual([...metricClaims('Shipped 50kg servers')], ['50 servers']);
  assert.deepEqual([...metricClaims('Used 1C to automate 12 workflows')], ['12 workflows']);
});
