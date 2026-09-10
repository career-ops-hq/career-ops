import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

test('location_filter.strict fails closed on empty locations without changing the default', () => {
  const lenient = buildLocationFilter({ allow: ['puerto rico', 'san juan'] });
  const strict = buildLocationFilter({ allow: ['puerto rico', 'san juan'], strict: true });
  const icimsUrl = 'https://careers-peraton.icims.com/jobs/168257/data-architect/job';

  assert.equal(lenient('', icimsUrl), true, 'default: empty-location iCIMS posting still passes');
  assert.equal(strict('', icimsUrl), false, 'strict: empty-location iCIMS posting is rejected');
  assert.equal(strict('', undefined), false);
  assert.equal(strict(null, null), false);
  assert.equal(strict('San Juan, PR', undefined), true, 'strict preserves matching locations');
  assert.equal(strict('Boston, MA', undefined), false, 'strict still rejects real out-of-region locations');
});

test('strict:true with no restricting tier is inert; block-only strict fails closed', () => {
  const strictNoTiers = buildLocationFilter({ strict: true });
  const strictBlockOnly = buildLocationFilter({ block: ['india'], strict: true });

  assert.equal(strictNoTiers('', undefined), true);
  assert.equal(strictNoTiers('Anywhere', undefined), true);
  assert.equal(strictBlockOnly('', undefined), false, 'block-only strict cannot confirm an empty location is safe');
  assert.equal(strictBlockOnly('Berlin, Germany', undefined), true);
});
