import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanyCanonicalizer, companyRoleDedupKey } from '../scan.mjs';

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
  assert.notEqual(
    companyRoleDedupKey('C++ Consulting', 'Engineer'),
    companyRoleDedupKey('C Consulting', 'Engineer'),
  );
});

test('a legal suffix on an alias still resolves to that alias', () => {
  const canon = buildCompanyCanonicalizer({
    Acme: ['Acme Holdings'],
    Fin: [],
    'Acme Holdings Inc': [],
  });
  assert.notEqual(
    companyRoleDedupKey('Acme Holdings Inc', 'Engineer', canon),
    companyRoleDedupKey('Acme', 'Engineer', canon),
  );
  const aliased = buildCompanyCanonicalizer({ Acme: ['Acme Holdings'], Fin: [] });
  assert.equal(
    companyRoleDedupKey('Acme Holdings Inc', 'Engineer', aliased),
    companyRoleDedupKey('Acme', 'Engineer', aliased),
  );
  assert.equal(
    companyRoleDedupKey('Fin Inc', 'Engineer', aliased),
    companyRoleDedupKey('Fin', 'Engineer', aliased),
  );
});
