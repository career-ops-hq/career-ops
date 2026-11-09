import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = readFileSync(join(ROOT, '.github/workflows/no-user-data.yml'), 'utf8');
const triage = readFileSync(join(ROOT, '.github/scripts/triage.bundle.mjs'), 'utf8');

test('no-user-data guard runs for merge queue entries', () => {
  assert.match(workflow, /^\s+merge_group\s*:/m);
});

test('no-user-data guard uses merge queue base and head SHAs', () => {
  assert.match(workflow, /context\.payload\.merge_group\.base_sha/);
  assert.match(workflow, /context\.payload\.merge_group\.head_sha/);
});

test('triage does not classify the no-user-data guard as informative', () => {
  assert.doesNotMatch(triage, /"informativeChecks":\[[^\]]*"guard"/);
});
