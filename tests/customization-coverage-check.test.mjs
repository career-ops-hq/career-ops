// docs/CUSTOMIZATION.md told readers to run `node coverage-check.mjs` with
// no arguments. The script exits 1 until it has a URL, --company, and --title.
// docs/SCRIPTS.md already shows that form.
//
// Run: node --test tests/customization-coverage-check.test.mjs

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const doc = readFileSync(join(ROOT, 'docs/CUSTOMIZATION.md'), 'utf8');

test('the customization guide shows the arguments coverage-check requires', () => {
  const line = doc.split('\n').find((row) => row.includes('coverage-check.mjs'));
  assert.ok(line, 'CUSTOMIZATION.md mentions coverage-check.mjs');
  assert.match(line, /node coverage-check\.mjs <url>/);
  assert.match(line, /--company/);
  assert.match(line, /--title/);
});
