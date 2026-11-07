// tests/readme-usage-commands.test.mjs — the README's Usage command tables
// match the modes the skill router accepts.
//
// The README listed every command in a code block copied from the router's
// menu, and the copy drifted: ats, triage, intake and retro shipped with a
// route but never reached the README. The tables are now the only full list a
// reader sees, so a route missing from them is a mode nobody finds.
//
// Run:  node --test tests/readme-usage-commands.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const README = readFileSync(join(ROOT, 'README.md'), 'utf-8').replace(/\r\n/g, '\n');
const SKILL = readFileSync(join(ROOT, '.agents', 'skills', 'career-ops', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

const usage = README.split('\n## Usage\n')[1]?.split('\n## ')[0] ?? '';
/** Router inputs → mode, e.g. `inbox` → `agent-inbox`, `eu-swe` → `regional/eu-swe`. */
const routes = new Map([...SKILL.matchAll(/^\| `([a-z/-]+)` \| `([^`]+)` \|$/gm)].map((m) => [m[1], m[2]]));
/** Command-table rows as [command, mode-file link]. */
const rows = [...usage.matchAll(/^\| \[`([a-z/-]+)`\]\(([^)]+)\) \|/gm)].map((m) => [m[1], m[2]]);
/** The everyday-commands rows, which name a command without linking it. */
const everyday = [...usage.matchAll(/^\| `([a-z/-]+)` \|/gm)].map((m) => m[1]);
/** The mode the router runs for a pasted JD or URL with no sub-command. */
const pasteMode = SKILL.match(/^\| JD text or URL \(no sub-command\) \| \*\*`([^`]+)`\*\* \|$/m)?.[1];
/** Mode-file links on the README's paste rows, which name no command. */
const pasteLinks = [...usage.matchAll(/^\| \*paste a URL or JD\* \|[^\n]*?\]\((modes\/[^)]+)\)/gm)].map((m) => m[1]);
/** Every mode-file link in Usage, including rows with no command (the paste row → auto-pipeline). */
const modeLinks = [...usage.matchAll(/\]\((modes\/[^)#]+\.md)\)/g)].map((m) => m[1]);

test('every routed mode has a row in the README command tables', () => {
  assert.ok(routes.size >= 30, `only ${routes.size} router inputs parsed — the routing table format changed`);
  assert.ok(rows.length >= 30, `only ${rows.length} README command rows parsed — the table format changed`);
  const listed = new Set(rows.map(([command]) => command));
  // An alias (`inbox`) is covered when the mode it routes to has a row.
  const listedModes = new Set(rows.map(([command]) => routes.get(command)));
  const missing = [...routes].filter(([input, mode]) => !listed.has(input) && !listedModes.has(mode)).map(([input]) => input);
  assert.deepEqual(missing, [], `routed mode(s) missing from README.md Usage: ${missing.join(', ')}`);
});

test('every README command is one the router accepts', () => {
  assert.ok(everyday.length >= 3, `only ${everyday.length} everyday command rows parsed — the table format changed`);
  const rejected = [...rows.map(([command]) => command), ...everyday].filter((command) => !routes.has(command));
  assert.deepEqual(rejected, [], `README.md Usage lists command(s) the router does not route: ${rejected.join(', ')}`);
});

test('every README command links to the mode file the router runs', () => {
  const wrong = rows.filter(([command, link]) => link !== `modes/${routes.get(command)}.md` || !existsSync(join(ROOT, link)))
    .map(([command, link]) => `${command} → ${link}`);
  assert.deepEqual(wrong, [], `README.md Usage links that miss the routed mode file: ${wrong.join(', ')}`);
});

test('the paste row links to the mode the router runs for a pasted JD or URL', () => {
  assert.ok(pasteMode, 'router row for JD text or URL not parsed — the routing table format changed');
  assert.ok(pasteLinks.length >= 1, 'no linked paste row parsed in README.md Usage — the table format changed');
  const wrong = pasteLinks.filter((link) => link !== `modes/${pasteMode}.md`);
  assert.deepEqual(wrong, [], `README.md paste row links to ${wrong.join(', ')}, not modes/${pasteMode}.md`);
});

test('every mode file linked from README Usage exists', () => {
  assert.ok(modeLinks.length > rows.length, `only ${modeLinks.length} mode links parsed — the link format changed`);
  const ghosts = [...new Set(modeLinks)].filter((link) => !existsSync(join(ROOT, link)));
  assert.deepEqual(ghosts, [], `README.md Usage links to missing mode file(s): ${ghosts.join(', ')}`);
});
