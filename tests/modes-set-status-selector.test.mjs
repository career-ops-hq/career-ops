// A bare number given to set-status.mjs is a tracker row id. Mode files hand
// the agent a report id, and the two counters diverge as soon as one row has
// no report, so `set-status.mjs <report#> Applied` exits 3 and the agent has
// to retry. Every mode names the selector instead.
//
// outcome.mjs reads a bare number the same way, with no report-link guard, so
// a report id there records the outcome on another application. AGENTS.md and
// docs/SCRIPTS.md document both commands, so they are held to the same rule.
//
// Run:  node --test tests/modes-set-status-selector.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const CALL = /node (?:set-status|outcome)\.mjs ([^\s`]+)/g;

function bareReportPlaceholders(src) {
  return [...src.matchAll(CALL)].map((m) => m[1]).filter((arg) => arg.startsWith('<report#'));
}

test('mode files never pass a report id as a bare set-status selector', () => {
  const offenders = listTree(join(ROOT, 'modes'), { match: /\.md$/ })
    .filter((path) => bareReportPlaceholders(readFileSync(path, 'utf-8')).length > 0)
    .map((path) => relative(ROOT, path));
  assert.deepEqual(offenders, []);
});

test('AGENTS.md and docs/SCRIPTS.md never document a report id as the bare selector', () => {
  const offenders = ['AGENTS.md', join('docs', 'SCRIPTS.md')]
    .filter((path) => bareReportPlaceholders(readFileSync(join(ROOT, path), 'utf-8')).length > 0);
  assert.deepEqual(offenders, []);
});

test('the scan sees the apply-mode calls it guards', () => {
  const src = readFileSync(join(ROOT, 'modes', 'apply.md'), 'utf-8');
  assert.deepEqual([...src.matchAll(CALL)].map((m) => m[1]), ['--report', '--report']);
});

test('a bare report placeholder is reported', () => {
  assert.deepEqual(bareReportPlaceholders('`node set-status.mjs <report#> Applied`'), ['<report#>']);
  assert.deepEqual(bareReportPlaceholders('`node set-status.mjs --report <report#> Applied`'), []);
  assert.deepEqual(bareReportPlaceholders('`node set-status.mjs <report#\\|company> <State>`'), ['<report#\\|company>']);
  assert.deepEqual(bareReportPlaceholders('`node outcome.mjs <report#|company> hired`'), ['<report#|company>']);
  assert.deepEqual(bareReportPlaceholders('`node outcome.mjs <tracker#|company> hired`'), []);
});
