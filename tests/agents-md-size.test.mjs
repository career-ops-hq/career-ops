// AGENTS.md stays under Claude Code's 40,000-character project-context limit (#6693).
//
// CLAUDE.md is `@AGENTS.md`, so every session loads AGENTS.md whole before it
// reads its first mode file. Claude Code warns at startup once the file passes
// 40,000 characters, and the file had grown to 104,000 with no test to stop it.
// Reference that one workflow needs (the script table, the onboarding steps,
// the tracker TSV format, the market sets, the community asks, headless
// workers) now lives in `modes/_*.md` files that AGENTS.md points to.
//
// The moved sections keep their headings in AGENTS.md as pointers, because
// translated mode files and script comments cite them by name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_PATHS } from '../lib/update-manifest.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const LIMIT = 40_000;
const agents = read('AGENTS.md');

// heading kept in AGENTS.md → the file its content moved to
const MOVED = [
  ['### Main Files', 'modes/_files.md'],
  ['### First Run — Onboarding', 'modes/_onboarding.md'],
  ['### TSV Format for Tracker Additions', 'modes/_tracker-tsv.md'],
  ['### Output Language vs Market Modes', 'modes/_markets.md'],
  ['## Community asks', 'modes/_community-asks.md'],
  ['### Celebrating a hire (the Hired Wall)', 'modes/_community-asks.md'],
  ['## Headless / Batch Mode', 'modes/_headless.md'],
];

/** The text from `heading` to the next heading of any level. */
function section(heading) {
  const start = agents.indexOf(`${heading}`);
  assert.ok(start >= 0, `AGENTS.md has no "${heading}" heading`);
  const next = agents.slice(start + heading.length).search(/\n#{1,4} /);
  return next < 0 ? agents.slice(start) : agents.slice(start, start + heading.length + next);
}

test(`AGENTS.md is at most ${LIMIT.toLocaleString('en-US')} characters`, () => {
  assert.ok(agents.length <= LIMIT,
    `AGENTS.md is ${agents.length} characters, over the ${LIMIT} that Claude Code loads without a warning. `
    + 'Move reference that only one workflow needs into a modes/_*.md file and leave a one-line pointer (see "Where rules live").');
});

test('each moved section keeps its heading and points at the file that holds it', () => {
  for (const [heading, file] of MOVED) {
    assert.ok(section(heading).includes(`\`${file}\``), `AGENTS.md "${heading}" does not point at ${file}`);
  }
});

test('every modes/_*.md file AGENTS.md points to exists and ships with updates', () => {
  const pointed = [...new Set([...agents.matchAll(/`(modes\/_[a-z-]+\.md)`/g)].map((m) => m[1]))]
    // User-layer files: created per install, never shipped.
    .filter((f) => !['modes/_profile.md', 'modes/_custom.md', 'modes/_brief.md'].includes(f));
  for (const [, file] of MOVED) assert.ok(pointed.includes(file), `AGENTS.md never names ${file}`);
  for (const file of pointed) {
    assert.ok(existsSync(join(ROOT, file)), `AGENTS.md points at ${file}, which does not exist`);
    assert.ok(SYSTEM_PATHS.includes(file), `${file} is missing from SYSTEM_PATHS in lib/update-manifest.mjs, so updates would not ship it`);
  }
});

test('the router sends a first run to the onboarding steps', () => {
  const router = read('.agents/skills/career-ops/SKILL.md');
  assert.match(router, /onboardingNeeded[^\n]*`modes\/_onboarding\.md`/);
});
