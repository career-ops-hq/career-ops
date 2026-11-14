/**
 * tests/debrief-localized-step10.test.mjs — every localized debrief mode tells
 * the agent to record a debrief with `debrief-sync.mjs --app <tracker#>` (#6539).
 *
 * `debrief-sync.mjs` refuses a call without `--app` (BAD_PLAN: appNum must be a
 * positive integer), so a localized Step 10 that shows the bare command sends
 * the agent into a dead end. This suite pins the Step 10 command in the English
 * file and in every `modes/<lang>/interview/debrief.md` that exists. Languages
 * are discovered from disk, so a new localization is checked automatically.
 *
 * Run: node --test tests/debrief-localized-step10.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const MODES = join(ROOT, 'modes');

// Localized mode sets are the subdirectories of modes/ that carry a debrief.md.
const localized = readdirSync(MODES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((lang) => existsSync(join(MODES, lang, 'interview', 'debrief.md')))
  .sort();

test('localized debrief modes are discovered', () => {
  assert.ok(localized.length >= 8, `expected at least 8 localized debrief modes, found ${localized.length}`);
});

test('English debrief mode records a debrief with --app', () => {
  const text = readFileSync(join(MODES, 'interview', 'debrief.md'), 'utf8');
  assert.match(text, /debrief-sync\.mjs --app/);
});

// Older translations predate the debrief-sync step entirely and are out of scope for #6539.
// Listed explicitly so a localized file that drops its Step 10 fails instead of being skipped.
const PREDATES_STEP10 = new Set(['fr', 'id', 'ja']);

for (const lang of localized) {
  const text = readFileSync(join(MODES, lang, 'interview', 'debrief.md'), 'utf8');
  const skip = PREDATES_STEP10.has(lang) ? 'no debrief-sync.mjs Step 10 (predates #6539)' : false;
  test(`${lang}: Step 10 runs debrief-sync.mjs with --app`, { skip }, () => {
    const lines = text.split('\n').filter((line) => line.includes('debrief-sync.mjs'));
    assert.ok(lines.length > 0, `${lang}/interview/debrief.md does not mention debrief-sync.mjs`);
    for (const line of lines) {
      assert.match(line, /debrief-sync\.mjs --app\b/, `${lang}/interview/debrief.md runs debrief-sync.mjs without --app: ${line.trim()}`);
    }
  });
}
