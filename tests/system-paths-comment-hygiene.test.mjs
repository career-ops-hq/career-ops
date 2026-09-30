/**
 * SYSTEM_PATHS comment hygiene
 * (tests/system-paths-comment-hygiene.test.mjs)
 *
 * updater-migration-tests.mjs extracts the path arrays out of update-system.mjs
 * with a regex over QUOTED SPANS:
 *
 *     const\s+SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\];
 *     ... /['"]([^'"]+)['"]/g
 *
 * That regex does not know about comments, so any apostrophe or double quote in
 * a comment INSIDE an array body is read as the opening delimiter of a path
 * entry. A two-line comment containing one `user's` produced phantom entries
 * such as `s data/.\n  'jev-post-linter.mjs` — 174 bogus SYSTEM_PATHS rows, each
 * reported as "missing from tree", and the updater suite went red for a reason
 * that had nothing to do with the updater.
 *
 * The rule is therefore: inside a path array body, comments carry no quote
 * characters. Quoting a path in prose there is the trap, so this test fails on
 * it rather than leaving it to be rediscovered by a confusing failure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARRAYS = ['SYSTEM_PATHS', 'BOOTSTRAP_PATHS', 'USER_PATHS'];

const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');

/** Replicates the updater suite's own extraction, including its blind spot. */
function extractArray(name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${name} must be a parseable array literal`);
  return Array.from(m[1].matchAll(/['"]([^'"]+)['"]/g), (e) => e[1]);
}

test('no comment inside a path array contains a quote character', () => {
  for (const name of ARRAYS) {
    const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
    if (!m) continue;
    m[1].split('\n').forEach((line, i) => {
      if (!/^\s*\/\//.test(line)) return;
      assert.doesNotMatch(
        line,
        /['"]/,
        `${name} line ${i + 1} has a quote in a comment; the updater's regex will read it as a path entry: ${line.trim()}`,
      );
    });
  }
});

test('the extraction yields no entry that is not a real path', () => {
  const knownMissing = new Set(['lib/context-budget.test.mjs']);
  const phantom = [];
  for (const name of ['SYSTEM_PATHS', 'BOOTSTRAP_PATHS']) {
    for (const entry of extractArray(name)) {
      if (entry.endsWith('/') || knownMissing.has(entry)) continue;
      if (!existsInRepo(entry)) phantom.push(`${name}: ${JSON.stringify(entry)}`);
    }
  }
  assert.deepEqual(phantom, [], `phantom entries (usually an apostrophe in a comment):\n${phantom.join('\n')}`);
});

function existsInRepo(rel) {
  try {
    readFileSync(join(ROOT, rel));
    return true;
  } catch {
    try {
      return readFileSync(join(ROOT, rel, '.gitkeep')) !== undefined;
    } catch {
      return false;
    }
  }
}

test('no path is registered twice in SYSTEM_PATHS or BOOTSTRAP_PATHS', () => {
  for (const name of ['SYSTEM_PATHS', 'BOOTSTRAP_PATHS']) {
    const entries = extractArray(name);
    const seen = new Map();
    const dupes = [];
    for (const entry of entries) {
      if (seen.has(entry)) dupes.push(entry);
      seen.set(entry, true);
    }
    assert.deepEqual(
      [...new Set(dupes)],
      [],
      `${name} registers the same path more than once: ${[...new Set(dupes)].join(', ')}`,
    );
  }
});

test('the two new system scripts are registered exactly once', () => {
  const system = extractArray('SYSTEM_PATHS');
  assert.ok(system.includes('jev-post-linter.mjs'), 'Gate 3 wrapper must ship with the system');
  assert.ok(system.includes('scripts/jev-calibrate.mjs'), 'the calibration script must ship with the system');
  assert.ok(system.includes('scripts/jev_gatekeeper.py'), 'the gatekeeper itself must remain registered');
  assert.ok(system.includes('.editorconfig'), '.editorconfig must stay registered exactly once');
});
