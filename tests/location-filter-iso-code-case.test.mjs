// #6605: a two-letter uppercase allow entry is an ISO country code, not the word "in".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

test('strict allow IN does not match the word "in" in a worldwide label', () => {
  const accepts = buildLocationFilter({ allow: ['IN'], strict: true });
  assert.equal(accepts('Anywhere in the World', '', 'Software Engineer'), false);
  assert.equal(accepts('Remote in Europe', '', 'Software Engineer'), false);
});

test('allow IN still matches India as a standalone code', () => {
  const accepts = buildLocationFilter({ allow: ['IN'], strict: true });
  assert.equal(accepts('Bengaluru, Karnataka, IN', '', 'Software Engineer'), true);
  assert.equal(accepts('IN', '', 'Software Engineer'), true);
});

test('block IN does not reject the word "in" either', () => {
  const accepts = buildLocationFilter({ block: ['IN'] });
  assert.equal(accepts('Anywhere in the World', '', 'Software Engineer'), true);
  assert.equal(accepts('Pune, IN', '', 'Software Engineer'), false);
});

test('lowercase and mixed-case entries keep the case-insensitive match', () => {
  for (const entry of ['in', 'In']) {
    const accepts = buildLocationFilter({ allow: [entry], strict: true });
    assert.equal(accepts('Pune, IN', '', 'Software Engineer'), true);
  }
});
