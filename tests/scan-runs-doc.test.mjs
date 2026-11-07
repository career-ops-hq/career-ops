// tests/scan-runs-doc.test.mjs — the data/scan-runs.tsv section of
// docs/SCRIPTS.md lists every column scan.mjs writes, in header order.
//
// The section once listed 15 columns while SCAN_RUNS_HEADER had 19, and
// filtered_posting_age, inserted at position 8, was missing from it, so anyone
// reading a row by the documented positions was off by one from there on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { SCAN_RUNS_HEADER } from '../scan.mjs';

function documentedColumns() {
  const doc = readFileSync(join(ROOT, 'docs', 'SCRIPTS.md'), 'utf8');
  const start = doc.indexOf('## data/scan-runs.tsv');
  assert.notEqual(start, -1, 'docs/SCRIPTS.md has no "## data/scan-runs.tsv" section');
  const rest = doc.slice(start + 1);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\* `([a-z_]+)`/gm)].map((m) => m[1]);
}

test('docs/SCRIPTS.md lists every scan-runs.tsv column in header order', () => {
  const header = SCAN_RUNS_HEADER.trim().split('\t');
  assert.deepEqual(documentedColumns(), header);
});
