import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// REQUIRED_TOKENS should be updated deliberately whenever a fact legitimately changes.
// The point is that a future fact change forces the PR to either update all 16 files
// or explicitly touch this token list, so drift is caught in CI.
// Note: The global install command token ("npm i -g @santifer/career-ops") was deliberately
// left out pending a separate translation rollout across the 14 remaining files.
const REQUIRED_TOKENS = [
  'A-H'
];

// RETIRED_TOKENS should be updated deliberately whenever a fact legitimately changes.
// The point is that a future fact change forces the PR to either update all 16 files
// or explicitly touch this token list, so drift is caught in CI.
const RETIRED_TOKENS = [
  'A-F', // hyphen form (U+002D) — retired, see PR #3487 review
  'A–F'  // en-dash form (U+2013) — retired, see PR #3487 review
];

// Discover all localized README files in the repo root matching README.*.md
const readmes = readdirSync(ROOT)
  .filter((f) => /^README\..+\.md$/.test(f))
  .sort();

// Guard against empty file list
test('sanity check: found localized README files', () => {
  assert.ok(readmes.length >= 16, `Expected at least 16 localized README files, found ${readmes.length}`);
});

for (const file of readmes) {
  test(`required tokens in ${file}`, () => {
    const content = readFileSync(join(ROOT, file), 'utf8');
    for (const token of REQUIRED_TOKENS) {
      assert.ok(
        content.includes(token),
        `Required token "${token}" is missing in ${file}`
      );
    }
  });

  test(`retired tokens in ${file}`, () => {
    const content = readFileSync(join(ROOT, file), 'utf8');
    for (const token of RETIRED_TOKENS) {
      assert.ok(
        !content.includes(token),
        `Retired token "${token}" was found in ${file}`
      );
    }
  });
}

// The Usage command tables list every mode the skill router accepts. Command names and
// mode-file links are not translated, so the same row pattern reads every language; only
// the section heading differs, which is why the rows are read from the whole file.
const SKILL = readFileSync(join(ROOT, '.agents', 'skills', 'career-ops', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
/** Router inputs → mode, e.g. `inbox` → `agent-inbox`, `eu-swe` → `regional/eu-swe`. */
const routes = new Map([...SKILL.matchAll(/^\| `([a-z/-]+)` \| `([^`]+)` \|$/gm)].map((m) => [m[1], m[2]]));

test('sanity check: parsed the skill router table', () => {
  assert.ok(routes.size >= 30, `only ${routes.size} router inputs parsed — the routing table format changed`);
});

for (const file of readmes) {
  test(`command tables in ${file} match the router`, () => {
    const content = readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
    /** Command-table rows as [command, mode-file link]. */
    const rows = [...content.matchAll(/^\| \[`([a-z/-]+)`\]\(([^)]+)\) \|/gm)].map((m) => [m[1], m[2]]);
    assert.ok(rows.length >= 30, `only ${rows.length} command rows parsed in ${file} — it has no command tables`);

    const listed = new Set(rows.map(([command]) => command));
    // An alias (`inbox`) is covered when the mode it routes to has a row.
    const listedModes = new Set(rows.map(([command]) => routes.get(command)));
    const missing = [...routes].filter(([input, mode]) => !listed.has(input) && !listedModes.has(mode)).map(([input]) => input);
    assert.deepEqual(missing, [], `routed mode(s) missing from ${file}: ${missing.join(', ')}`);

    const rejected = rows.map(([command]) => command).filter((command) => !routes.has(command));
    assert.deepEqual(rejected, [], `${file} lists command(s) the router does not route: ${rejected.join(', ')}`);

    const wrong = rows
      .filter(([command, link]) => link !== `modes/${routes.get(command)}.md` || !existsSync(join(ROOT, link)))
      .map(([command, link]) => `${command} → ${link}`);
    assert.deepEqual(wrong, [], `${file} links that miss the routed mode file: ${wrong.join(', ')}`);
  });

  test(`${file} no longer carries the hand-copied command block`, () => {
    const content = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!/^\/career-ops pipeline /m.test(content), `${file} still has the old "/career-ops <mode> → ..." code block`);
  });
}
