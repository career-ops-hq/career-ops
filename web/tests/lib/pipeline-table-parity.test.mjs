import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the web pipeline row parser stays identical to the core parser', () => {
  const core = readFileSync(new URL('../../../lib/pipeline-table.mjs', import.meta.url), 'utf8');
  const mirror = readFileSync(new URL('../../src/lib/pipeline-table.mjs', import.meta.url), 'utf8');
  const implementation = source => source.slice(source.indexOf('export function splitLines'));
  assert.equal(implementation(mirror), implementation(core));
});
