import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = readFileSync(join(ROOT, '.github/workflows/no-user-data.yml'), 'utf8');
const triage = readFileSync(join(ROOT, '.github/scripts/triage.bundle.mjs'), 'utf8');

test('no-user-data guard runs for merge queue entries', () => {
  assert.ok(/^\s+merge_group\s*:/m.test(workflow), 'workflow has no merge_group trigger');
});

test('no-user-data guard uses merge queue base and head SHAs', () => {
  assert.ok(/context\.payload\.merge_group\.base_sha/.test(workflow), 'base SHA is not used');
  assert.ok(/context\.payload\.merge_group\.head_sha/.test(workflow), 'head SHA is not used');
});

test('triage does not classify the no-user-data guard as informative', () => {
  assert.ok(!/"informativeChecks":\[[^\]]*"guard"/.test(triage), 'guard is marked informative');
});
