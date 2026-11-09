import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, parseExplorePatch, filtersToParams, paramsToFilters } from '../../src/lib/explore.ts';

test('Explore preserves saved website selections and supports website-only searches across URL round trips', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const filters = parseExplorePatch({ ats: [], websiteIds: [id, id], positive: ['AI'] });
  assert.deepEqual(filters.ats, []);
  assert.deepEqual(filters.websiteIds, [id]);
  const query = filtersToParams(filters);
  const decoded = paramsToFilters(new URLSearchParams(query));
  assert.deepEqual(decoded.ats, []);
  assert.deepEqual(decoded.websiteIds, [id]);
  assert.deepEqual(decoded.positive, ['AI']);
  assert.deepEqual(DEFAULT_FILTERS.websiteIds, []);
});
