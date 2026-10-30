import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSoftgardenDate } from '../providers/softgarden.mjs';
import { parseCsbDate } from '../providers/successfactors.mjs';

test('softgarden rejects a day past the end of the month', () => {
  assert.equal(parseSoftgardenDate('02/31/2026'), undefined);
  assert.equal(parseSoftgardenDate('31.04.2026'), undefined);
  assert.equal(parseSoftgardenDate('29.02.2028'), Date.UTC(2028, 1, 29));
});

test('successfactors csb rejects a day past the end of the month', () => {
  assert.equal(parseCsbDate('31.02.2026'), undefined);
  assert.equal(parseCsbDate('2026-06-31'), undefined);
  assert.equal(parseCsbDate('30.06.2026'), Date.UTC(2026, 5, 30));
});
