import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
