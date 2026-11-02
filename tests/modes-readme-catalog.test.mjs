// tests/modes-readme-catalog.test.mjs — modes/README.md's catalog matches the
// mode files on disk and the names the skill router accepts.
//
// The catalog is the map a contributor reads to find a mode. It had drifted
// three ways: mode files that shipped with a route but no row (triage, ats,
// discover, ...), market sets missing from the language-dir row (nl, sg,
// zh-TW), and rows naming `job` / `jobs` for oferta / ofertas, which the
// router does not route: `/career-ops job` falls through to the command menu.
//
// Run:  node --test tests/modes-readme-catalog.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODES = join(ROOT, 'modes');
const README = readFileSync(join(MODES, 'README.md'), 'utf-8').replace(/\r\n/g, '\n');
const SKILL = readFileSync(join(ROOT, '.agents', 'skills', 'career-ops', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

const catalog = README.split('## Mode catalog')[1]?.split('\n## ')[0] ?? '';
/** Catalog rows as [file, mode cell]. */
const rows = [...catalog.matchAll(/^\| `([a-z-]+\.md)` \| ([^|]+) \|/gm)].map((m) => [m[1], m[2].trim()]);
/** Inputs the router's Mode Routing table accepts, e.g. `pdf`, `inbox`. */
const routed = new Set([...SKILL.matchAll(/^\| `([a-z/-]+)` \| `[^`]+` \|$/gm)].map((m) => m[1]));

test('every top-level mode file has a catalog row', () => {
  assert.ok(rows.length >= 20, `only ${rows.length} catalog rows parsed — the table format changed`);
  const files = readdirSync(MODES).filter((f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md');
  const listed = new Set(rows.map(([file]) => file));
  const missing = files.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `mode file(s) missing from the modes/README.md catalog: ${missing.join(', ')}`);
});

test('every catalog row names a file that exists', () => {
  const ghosts = rows.map(([file]) => file).filter((f) => !existsSync(join(MODES, f)));
  assert.deepEqual(ghosts, [], `the catalog lists non-existent mode file(s): ${ghosts.join(', ')}`);
});

test('every backticked mode name in the catalog is one the router accepts', () => {
  assert.ok(routed.size >= 20, `only ${routed.size} router inputs parsed — the routing table format changed`);
  const rejected = rows.flatMap(([, cell]) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]))
    .filter((name) => !routed.has(name));
  assert.deepEqual(rejected, [], `the catalog names mode(s) the router does not route: ${rejected.join(', ')}`);
});

test('every shipped market mode set is in the language-dir row', () => {
  const shipped = readdirSync(MODES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(MODES, e.name, '_shared.md')))
    .map((e) => e.name);
  const row = README.match(/^\| `((?:[a-zA-Z-]+\/ )*[a-zA-Z-]+\/)` \| Language/m)?.[1] ?? '';
  const listed = row.split(' ').map((d) => d.replace(/\/$/, ''));
  const missing = shipped.filter((d) => !listed.includes(d));
  const ghosts = listed.filter((d) => !shipped.includes(d));
  assert.deepEqual(missing, [], `market mode set(s) missing from modes/README.md: ${missing.join(', ')}`);
  assert.deepEqual(ghosts, [], `modes/README.md lists non-existent market set(s): ${ghosts.join(', ')}`);
});
