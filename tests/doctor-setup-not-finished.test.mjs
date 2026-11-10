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
    assert.equal(status, 1, out);
    assert.match(out, /Setup is not finished \(4 files missing: cv\.md, config\/profile\.yml, modes\/_profile\.md, portals\.yml\)/);
    assert.match(out, /onboard-write\.mjs/);
    assert.match(out, /Result: 2 issues found/);
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
    assert.match(out, /You're ready to go! Open your AI CLI in this folder \(claude, codex, opencode, qwen, agy or grok\)/);
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
    assert.equal(status, 1, out);
    assert.match(out, /Setup is not finished \(4 files missing:/);
    assert.match(out, /onboard-write\.mjs/);
    assert.match(out, /Result: 2 issues found/);
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
    assert.match(out, /✗ cv\.md not found/);
    assert.match(out, /✗ config\/profile\.yml not found/);
    assert.match(out, /Result: 3 issues found\./);
    assert.match(out, /onboard-write\.mjs/);
    assert.match(out, /Setup is not finished \(4 files missing: cv\.md, config\/profile\.yml, modes\/_profile\.md, portals\.yml\)\./);
    assert.match(out, /Open your AI CLI in the checkout \(claude, codex, opencode, qwen, agy or grok\) and it walks you through setup by chatting\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing cv.md exits non-zero and points at creating cv.md, not onboard-write', () => {
  const dir = checkout({ withSetup: true });
  try {
    rmSync(join(dir, 'cv.md'));
    const { status, out } = runDoctor(dir);
    assert.equal(status, 1, out);
    assert.match(out, /✗ cv\.md not found/);
    assert.match(out, /Create cv\.md in the project root/);
    assert.match(out, /Add your CV as cv\.md in .*examples\/cv-example\.md shows the format/);
    assert.doesNotMatch(out, /onboard-write\.mjs/);
    assert.doesNotMatch(out, /config\/profile\.yml not found/);
    assert.doesNotMatch(out, /ready to go/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing profile exits non-zero and names onboard-write', () => {
  const dir = checkout({ withSetup: true });
  try {
    rmSync(join(dir, 'config', 'profile.yml'));
    const { status, out } = runDoctor(dir);
    assert.equal(status, 1, out);
    assert.match(out, /✗ config\/profile\.yml not found/);
    assert.match(out, /onboard-write\.mjs/);
    assert.doesNotMatch(out, /cv\.md not found/);
    assert.doesNotMatch(out, /ready to go/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor --json still exits 0 when cv and profile are missing', () => {
  const dir = checkout({ withSetup: false });
  try {
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(PLAYWRIGHT_STUB).href, DOCTOR, '--json', '--target', dir], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const state = JSON.parse(r.stdout);
    assert.equal(state.onboardingNeeded, true);
    assert.ok(state.missing.includes('cv.md'));
    assert.ok(state.missing.includes('config/profile.yml'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('a missing shell-selected profile exits non-zero', () => {
  const dir = checkout({ withSetup: true });
  try {
    rmSync(join(dir, 'config', 'profile.yml'));
    const named = join(dir, 'config', 'named-profile.yml');
    const env = { ...process.env, NO_COLOR: '1', CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: named };
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(PLAYWRIGHT_STUB).href, DOCTOR], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60_000, env,
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /✗ config\/profile\.yml not found \(CAREER_OPS_PROFILE names /);
    assert.doesNotMatch(out, /⚠ config\/profile\.yml not found \(CAREER_OPS_PROFILE names /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing default profile overridden by .env exits non-zero', () => {
  const dir = checkout({ withSetup: true });
  try {
    rmSync(join(dir, 'config', 'profile.yml'));
    writeFileSync(join(dir, '.env'), 'CAREER_OPS_PROFILE=config/from-env.yml\n');
    const env = { ...process.env, NO_COLOR: '1', CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' };
    delete env.CAREER_OPS_PROFILE;
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(PLAYWRIGHT_STUB).href, DOCTOR], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60_000, env,
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /✗ config\/profile\.yml not found \(\.env sets CAREER_OPS_PROFILE=config\/from-env\.yml/);
    assert.doesNotMatch(out, /⚠ config\/profile\.yml not found \(\.env sets CAREER_OPS_PROFILE=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the onboard command quotes the script path and a data root that contains a space', () => {
  const parent = mkdtempSync(join(tmpdir(), 'doctor-quote-'));
  const dir = join(parent, 'career ops $HOME');
  mkdirSync(dir);
  copyFileSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  assert.equal(linkNodeModules(dir), null);
  mkdirSync(join(dir, 'modes'));
  mkdirSync(join(dir, 'config'));
  try {
    const { status, out } = runDoctor(dir);
    assert.equal(status, 1, out);
    const script = join(dir, 'onboard-write.mjs');
    const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
    const expected = `node ${quote(script)} --answers <answers.json> --target ${quote(dir)}`;
    assert.ok(out.includes(expected), out);
    if (process.platform !== 'win32') {
      const safe = expected.replace('<answers.json>', 'answers.json');
      const parsed = spawnSync('sh', ['-c', `set -- ${safe}\nprintf '%s\\0' "$1" "$2" "$3" "$4" "$5" "$6"`], { encoding: 'utf8' });
      assert.equal(parsed.status, 0, parsed.stderr);
      assert.deepEqual(parsed.stdout.split('\0').slice(0, 6), ['node', script, '--answers', 'answers.json', '--target', dir]);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
