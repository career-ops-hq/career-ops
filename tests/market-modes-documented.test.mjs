// tests/market-modes-documented.test.mjs — every market mode set that ships is
// listed in AGENTS.md's market table.
//
// The table is not a nicety. AGENTS.md is loaded into every agent session, and
// its own rule for choosing a set reads:
//
//     "you detect a JD written in that language -> suggest switching"
//
// driven by that table. A set the table does not name is a set the agent cannot
// route to, whatever is on disk. Eighteen complete sets shipped and six were
// listed, so twelve full localizations — es, pt, it, nl, pl, da, ru, ua, zh,
// zh-TW, ko, id — were invisible to the system that would have used them.
//
// A set is "shipped" when it has _shared.md, which is what makes it a market
// set rather than a subdirectory like modes/interview/ or modes/pdf/.
//
// Run:  node --test tests/market-modes-documented.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');

/** Market mode sets on disk: a modes/ subdirectory carrying _shared.md. */
function shippedSets() {
  return readdirSync(join(ROOT, 'modes'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'modes', e.name, '_shared.md')))
    .map((e) => e.name)
    .sort();
}

/** Dirs the market table names, e.g. `modes/de/`. */
function documentedSets() {
  return [...new Set([...AGENTS.matchAll(/\|\s*`modes\/([a-zA-Z-]+)\/`\s*\|/g)].map((m) => m[1]))].sort();
}

test('every shipped market mode set is in the market table', () => {
  const missing = shippedSets().filter((d) => !documentedSets().includes(d));
  assert.deepEqual(
    missing,
    [],
    `${missing.length} market mode set(s) ship and are undocumented: ${missing.join(', ')}. `
    + 'AGENTS.md is what routes JD-language detection to a set, so an unlisted set is unreachable.',
  );
});

test('and the table names no set that does not ship', () => {
  // The other direction: a row for a deleted set sends the agent at a directory
  // that is not there, which costs a tool call every session it tries.
  const ghosts = documentedSets().filter((d) => !shippedSets().includes(d));
  assert.deepEqual(ghosts, [], `the market table names non-existent set(s): ${ghosts.join(', ')}`);
});

test('every evaluation and apply mode the table names exists on disk', () => {
  // The mode NAMES are what a user types and what the agent looks for. A row
  // with the right directory and a wrong filename is still a dead route.
  const rows = [...AGENTS.matchAll(/\|\s*`modes\/([a-zA-Z-]+)\/`\s*\|\s*`([a-z-]+)`\s*\/\s*`([a-z-]+)`\s*\|/g)];
  assert.ok(rows.length >= 18, `only ${rows.length} market rows parsed — the table format changed`);
  const missing = [];
  for (const [, dir, evalMode, applyMode] of rows) {
    for (const mode of [evalMode, applyMode]) {
      const path = join('modes', dir, `${mode}.md`);
      if (!existsSync(join(ROOT, path))) missing.push(path);
    }
  }
  assert.deepEqual(missing, [], `the market table names mode file(s) that do not exist:\n${missing.join('\n')}`);
});
