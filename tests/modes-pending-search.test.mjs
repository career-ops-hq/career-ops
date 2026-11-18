// data/pipeline.md and data/scan-history.tsv only grow. A mode that tells the
// agent to read either one whole costs 100k+ tokens on a busy search, so the
// pipeline mode and every translated copy name the same bounded search, and
// the scan mode never reads its dedup sources whole.
//
// Run:  node --test tests/modes-pending-search.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODES = join(ROOT, 'modes');
const RESOLVED_PENDING_SEARCH = "grep -n -m 20 '^- \\[ \\] ' -- \"{INBOX}\"";

const pipelineModes = [
  'pipeline.md',
  ...readdirSync(MODES)
    .map((dir) => join(dir, 'pipeline.md'))
    .filter((rel) => existsSync(join(MODES, rel)) && rel !== 'pipeline.md'),
];

test('the pipeline mode and its translations exist', () => {
  assert.ok(pipelineModes.length >= 19, `found ${pipelineModes.length}`);
});

/**
 * Verifies that a pipeline mode searches the resolved inbox as one shell argument.
 * @param {string} rel Pipeline mode path relative to modes/.
 * @param {object} [_testContext] Node.js test context.
 * @returns {void}
 */
function pipelineModeUsesResolvedInbox(rel, _testContext) {
  const source = readFileSync(join(MODES, rel), 'utf-8');
  assert.ok(source.includes(RESOLVED_PENDING_SEARCH), `${rel} does not search the resolved inbox`);
}

for (const rel of pipelineModes) {
  test(
    `modes/${rel} searches the resolved inbox with the bounded command`,
    pipelineModeUsesResolvedInbox.bind(null, rel),
  );
}

test('the pipeline mode stops once only items it left in Pending come back', () => {
  assert.match(readFileSync(join(MODES, 'pipeline.md'), 'utf-8'), /repeat until the search prints only items you left in Pending this run/);
});

test('the scan mode does not read its dedup sources whole', () => {
  const src = readFileSync(join(MODES, 'scan.md'), 'utf-8');
  assert.doesNotMatch(src, /\*\*Read (History|Dedup Sources)\*\*/);
});
