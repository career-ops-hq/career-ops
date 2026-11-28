// tests/ideas-mode.test.mjs — contract checks for modes/ideas.md so the
// upskill.mjs --url-text handoff, jds/ fallback, empty-gaps wording,
// no-fabrication rules, and cert links stay intact across future edits.
//
// Run:  node --test tests/ideas-mode.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODE = readFileSync(join(ROOT, 'modes', 'ideas.md'), 'utf-8').replace(/\r\n/g, '\n');

test('ideas mode delegates gap extraction to upskill.mjs --url-text', () => {
  assert.match(MODE, /node upskill\.mjs --url-text/);
  assert.match(MODE, /Never hand-roll a gap list/);
});

test('ideas mode falls back to jds/ capture via jd-capture.mjs for report numbers', () => {
  assert.match(MODE, /## Job Description\s*\(archived verbatim\)/);
  assert.match(MODE, /jds\//);
  assert.match(MODE, /jd-capture\.mjs/);
});

test('ideas mode reports no gaps found on empty list without claiming full coverage', () => {
  assert.match(MODE, /no\s+gaps were found/i);
  assert.match(MODE, /Do not report full\s+coverage/i);
});

test('ideas mode never writes to user profile files directly', () => {
  assert.match(MODE, /Nothing\s+is written to `cv\.md`, `article-digest\.md`, or `config\/profile\.yml`/);
  assert.match(MODE, /\/career-ops add/);
});

test('ideas mode scores projects with project.md matrix and includes free/paid certs with verified links', () => {
  assert.match(MODE, /modes\/project\.md/);
  assert.match(MODE, /\/career-ops project/);
  assert.match(MODE, /\/career-ops training/);
  assert.match(MODE, /free version/i);
  assert.match(MODE, /paid version/i);
  assert.match(MODE, /Verify certification names, links, and pricing/);
});
