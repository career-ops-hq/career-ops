import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkNodeModules } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCTOR = join(ROOT, 'doctor.mjs');
const PLAYWRIGHT_STUB = join(ROOT, 'tests', 'fixtures', 'playwright-stub.mjs');

function checkout({ withSetup }) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-setup-'));
  copyFileSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  assert.equal(linkNodeModules(dir), null);
  mkdirSync(join(dir, 'modes'));
  mkdirSync(join(dir, 'config'));
  if (withSetup) {
    writeFileSync(join(dir, 'cv.md'), '# Jordan Rivera\n\n## Experience\n\n### Data Analyst, Globex\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Rivera"\n');
    writeFileSync(join(dir, 'modes', '_profile.md'), '# Targeting\n\nSenior data analyst roles.\n');
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - "Data Analyst"\n');
  }
  return dir;
}

function runDoctor(dir) {
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(PLAYWRIGHT_STUB).href, DOCTOR, '--target', dir], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000, env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('a fresh checkout is told setup is not finished, not that tools are ready', () => {
  const dir = checkout({ withSetup: false });
  try {
    const { status, out } = runDoctor(dir);
    assert.equal(status, 0, out);
    assert.match(out, /Setup is not finished \(4 files missing: cv\.md, config\/profile\.yml, modes\/_profile\.md, portals\.yml\)/);
    assert.match(out, /\d+ warning/);
    assert.doesNotMatch(out, /Your tools are ready/);
    assert.doesNotMatch(out, /ready to go/);
    assert.doesNotMatch(out, /Personalization files customized/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a checkout with every setup file still reads as ready', () => {
  const dir = checkout({ withSetup: true });
  try {
    const { status, out } = runDoctor(dir);
    assert.equal(status, 0, out);
    assert.match(out, /You're ready to go! Open your AI CLI in this folder \(claude, codex, gemini, opencode, qwen, agy or grok\)/);
    assert.doesNotMatch(out, /setup is not finished/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fresh checkout with a skill-entrypoint stub does not claim tools are ready', () => {
  const dir = checkout({ withSetup: false });
  try {
    mkdirSync(join(dir, '.claude', 'skills', 'career-ops'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'career-ops', 'SKILL.md'), '../../../.agents/skills/career-ops/SKILL.md\n');
    const { status, out } = runDoctor(dir);
    assert.equal(status, 0, out);
    assert.match(out, /Setup is not finished \(4 files missing:/);
    assert.match(out, /\d+ warning/);
    assert.doesNotMatch(out, /Your tools are ready/);
    assert.doesNotMatch(out, /ready to go/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing check still reports the missing setup files', () => {
  const dir = checkout({ withSetup: false });
  try {
    writeFileSync(join(dir, 'data'), '');
    const { status, out } = runDoctor(dir);
    assert.equal(status, 1, out);
    assert.match(out, /✗ data\/pipeline\.md could not be created/);
    assert.match(out, /Result: 1 issue found\./);
    assert.match(out, /Setup is not finished \(4 files missing: cv\.md, config\/profile\.yml, modes\/_profile\.md, portals\.yml\)\./);
    assert.match(out, /Open your AI CLI in this folder \(claude, codex, gemini, opencode, qwen, agy or grok\) and it walks you through setup by chatting\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
