import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyRoleDedupKey } from '../scan.mjs';

test('a trailing legal suffix does not split one employer', () => {
  const bare = companyRoleDedupKey('Acme', 'Engineer');
  assert.equal(companyRoleDedupKey('Acme, Inc.', 'Engineer'), bare);
  assert.equal(companyRoleDedupKey('Acme Inc', 'Engineer'), bare);
  assert.equal(companyRoleDedupKey('Acme  Inc.', 'Engineer'), bare);
  assert.equal(
    companyRoleDedupKey('Acme Technologies, Inc.', 'Engineer'),
    companyRoleDedupKey('Acme Technologies', 'Engineer'),
  );
});

test('different business names stay different employers', () => {
  assert.notEqual(
    companyRoleDedupKey('Acme Solutions', 'Engineer'),
    companyRoleDedupKey('Acme Technologies', 'Engineer'),
  );
});
