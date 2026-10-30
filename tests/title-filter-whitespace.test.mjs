import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTitleFilter, buildDomainFilter } from '../title-keywords.mjs';
import { matchedTitleKeywords } from '../scan.mjs';

const titleFilter = { positive: ['product manager'], negative: ['sales engineer'] };
const filter = buildTitleFilter(titleFilter);

test('a no-break or doubled space in a title still matches a multi-word positive', () => {
  for (const title of ['Product\u00a0Manager', 'Product  Manager', 'Product\tManager', 'Senior Product\u2009Manager']) {
    assert.equal(filter(title), true, JSON.stringify(title));
  }
});

test('a no-break space cannot slip a title past a multi-word negative', () => {
  assert.equal(filter('Sales\u00a0Engineer / Product Manager'), false);
  assert.equal(filter('Product Manager, Sales  Engineer'), false);
});

test('content override scoping and the domain filter read the same title', () => {
  assert.deepEqual(matchedTitleKeywords('Product\u00a0Manager', titleFilter), ['product manager']);
  assert.equal(buildDomainFilter(['product manager'])('Product\u00a0Manager'), true);
});

test('keywords written with doubled spaces still match', () => {
  assert.equal(buildTitleFilter({ positive: ['product  manager'] })('Product Manager'), true);
});
