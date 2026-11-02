import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const workflow = readFileSync(new URL('../.github/workflows/no-user-data.yml', import.meta.url), 'utf8');
const triage = readFileSync(new URL('../.github/scripts/triage.bundle.mjs', import.meta.url), 'utf8');
const informative = JSON.parse(triage.match(/"informativeChecks":(\[[^\]]*\])/)[1]);

test('no-user-data guard runs for merge queue entries', () => {
  assert.ok(/^\s*merge_group\s*:/m.test(workflow), 'no-user-data workflow does not trigger on merge_group');
});

test('triage treats a failed no-user-data guard as blocking', () => {
  assert.ok(!informative.includes('guard'), 'triage treats guard failures as informative');
});
