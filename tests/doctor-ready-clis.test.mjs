// doctor.mjs told a finished setup to open gemini. GEMINI.md is a no-op, and
// the README quick start does not name gemini. docs/SCRIPTS.md also omitted
// modes/_profile.md from the files doctor requires.
//
// Run: node --test tests/doctor-ready-clis.test.mjs

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const doctor = readFileSync(join(ROOT, 'doctor.mjs'), 'utf8');
const scripts = readFileSync(join(ROOT, 'docs/SCRIPTS.md'), 'utf8');

const README_CLIS = ['claude', 'codex', 'opencode', 'qwen', 'agy', 'grok'];

test('doctor names the CLIs the README quick start tells you to open', () => {
  const names = doctor.match(/const CLI_NAMES = '([^']+)'/)?.[1];
  assert.ok(names, 'CLI_NAMES is a single-quoted string');
  assert.doesNotMatch(names, /\bgemini\b/);
  for (const cli of README_CLIS) {
    assert.match(names, new RegExp(`\\b${cli}\\b`));
  }
});

test('SCRIPTS.md lists every file doctor treats as a setup prerequisite', () => {
  const start = scripts.indexOf('## doctor\n');
  assert.ok(start >= 0, 'docs/SCRIPTS.md has a doctor section');
  const section = scripts.slice(start, scripts.indexOf('\n## ', start + 1));
  for (const file of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml']) {
    assert.ok(section.includes(file), `doctor section names ${file}`);
  }
});
