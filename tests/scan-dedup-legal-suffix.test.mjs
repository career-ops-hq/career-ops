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

test('an explicit alias wins over a stem inferred from another alias', () => {
  const canon = buildCompanyCanonicalizer({ Alpha: ['Acme Inc'], Beta: ['Acme'] });
  assert.equal(canon('Acme'), 'beta');
  assert.equal(canon('Acme Inc'), 'alpha');
  assert.equal(canon('Acme Inc.'), 'alpha');
  assert.equal(canon('Acme, Inc.'), 'alpha');
  assert.equal(
    companyRoleDedupKey('Acme Inc.', 'Engineer', canon),
    companyRoleDedupKey('Acme Inc', 'Engineer', canon),
  );
  assert.notEqual(
    companyRoleDedupKey('Acme', 'Engineer', canon),
    companyRoleDedupKey('Acme Inc.', 'Engineer', canon),
  );
  assert.notEqual(canon('Acme'), canon('Alpha'));
});

test('punctuated spellings of one collision stay unresolved', () => {
  const canon = buildCompanyCanonicalizer({ Alpha: ['Acme Inc.'], Beta: ['Acme Inc'] });
  assert.equal(canon('Acme Inc.'), 'acme inc');
  assert.equal(canon('Acme Inc'), 'acme inc');
  assert.equal(canon('Acme, Inc.'), 'acme inc');
  assert.notEqual(canon('Acme Inc.'), 'alpha');
  assert.notEqual(canon('Acme Inc'), 'beta');
  const named = buildCompanyCanonicalizer({
    'Acme Inc.': [],
    Alpha: ['Acme Inc'],
    Beta: ['Acme Inc'],
  });
  assert.equal(named('Acme Inc.'), 'acme inc.');
  assert.equal(named('Acme Inc'), 'acme inc');
});

test('an ambiguous alias stays itself when its stem is a canonical name', () => {
  const canon = buildCompanyCanonicalizer({ Acme: [], Beta: ['Acme Inc'], Gamma: ['Acme Inc'] });
  assert.equal(canon('Acme Inc'), 'acme inc');
  assert.equal(canon('Acme, Inc.'), 'acme inc');
  assert.equal(canon('Acme'), 'acme');
  assert.notEqual(canon('Acme Inc'), canon('Acme'));
});
