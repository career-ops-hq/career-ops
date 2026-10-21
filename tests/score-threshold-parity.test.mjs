// AGENTS.md → Ethical Use sets the score below which the agent recommends
// against applying. The score-interpretation lists in modes/_shared.md and its
// translations once said "apply only if specific reason" for 3.5-3.9, so an
// agent got two answers for the same score. Every list that has a 3.5-3.9 band
// names the AGENTS.md threshold.
//
// Run:  node --test tests/score-threshold-parity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');
const threshold = agents.match(/Below (\d\.\d)\/5, explicitly recommend against applying/)?.[1];

const sharedCopies = ['_shared.md', ...readdirSync(join(ROOT, 'modes'))
  .map((dir) => `${dir}/_shared.md`)
  .filter((rel) => existsSync(join(ROOT, 'modes', ...rel.split('/'))))];

test('AGENTS.md states the threshold', () => {
  assert.equal(threshold, '4.0');
});

for (const rel of sharedCopies) {
  test(`modes/${rel} names the AGENTS.md threshold in its 3.5-3.9 band`, () => {
    const src = readFileSync(join(ROOT, 'modes', ...rel.split('/')), 'utf-8');
    const band = src.split('\n').find((line) => /3[.,]5 ?[-–] ?3[.,]9/.test(line));
    if (!band) return;
    // The Russian band points at the threshold paragraph right after it.
    const scope = rel === 'ru/_shared.md' ? src.slice(src.indexOf(band), src.indexOf(band) + band.length + 800) : band;
    assert.ok(scope.includes(threshold) || scope.includes(threshold.replace('.', ',')), band);
  });
}
