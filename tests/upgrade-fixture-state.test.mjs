// tests/upgrade-fixture-state.test.mjs — every state fixtureStateFor() can
// return exists under test-fixtures/upgrade/, and a tag from before the
// v1.18.0 user-data boundary is refused instead of seeding the wrong state.
//
// #6707 removed state-v1.16: no upgrade leg seeded it, and its files did not
// match what a v1.16 install holds. This pins the selector to what is on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureStateFor } from '../upgrade-tests.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'upgrade');

test('a tag at or past v1.18.0 seeds state-v1.18, which exists', () => {
  for (const tag of ['career-ops-v1.18.0', 'career-ops-v1.39.0', 'career-ops-v2.0.0']) {
    assert.equal(fixtureStateFor(tag), 'state-v1.18', tag);
  }
  assert.ok(existsSync(join(FIXTURES, 'state-v1.18', 'expected.json')));
});

test('a tag before v1.18.0 has no fixture state and throws', () => {
  // v0.18.0 shares the minor number but sits before the boundary.
  for (const tag of ['career-ops-v1.16.0', 'career-ops-v1.17.9', 'career-ops-v0.18.0']) {
    assert.throws(() => fixtureStateFor(tag), new RegExp(`no upgrade fixture state for ${tag.replaceAll('.', '\\.')}`), tag);
  }
  assert.equal(existsSync(join(FIXTURES, 'state-v1.16')), false);
});
