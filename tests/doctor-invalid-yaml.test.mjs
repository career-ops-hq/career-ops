// Real CLI coverage: broken setup YAML must be visible without exposing its contents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNestedCheckout } from '../lib/mjs-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const YAML_PATHS = ['config/profile.yml', 'portals.yml'];
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_YAML_VALUE';
const INVALID = `scan:\n  extractor: cli\nprivate: [${PRIVATE_MARKER}\n`;
const INVALID_LABEL = (path) => `${path}: invalid YAML (line 4, column 1)`;
const yamlWarnings = (state) => state.warnings.filter((warning) => YAML_PATHS.some((path) => warning.startsWith(`${path}:`)));

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-doctor-yaml-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
  for (const dir of ['config', 'modes', 'data', 'output', 'reports', 'node_modules']) {
    mkdirSync(join(root, dir));
  }
  const files = {
    'cv.md': '# Example Candidate\n',
    'config/profile.yml': 'scan:\n  extractor: cli\n',
    'portals.yml': 'tracked_companies: []\njob_boards: []\n',
    'modes/_profile.md': '# Backend targeting\n',
    'modes/_custom.md': '# House rules\n',
    'modes/_brief.md': '# Backend brief\n',
    'voice-dna.md': '# Plain language\n',
    'data/pipeline.md': '# Existing pipeline\n',
    'browser-extract.mjs': '// Presence check only.\n',
    ...overrides,
  };
  for (const [path, text] of Object.entries(files)) {
    if (text !== null) writeFileSync(join(root, path), text);
  }
  return root;
}

function contents(root) {
  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (isNestedCheckout(path)) {
        entries.push([entry.name, null]);
        continue;
      }
      entries.push([entry.name, contents(path)]);
    } else {
      entries.push([entry.name, readFileSync(path, 'utf8')]);
    }
  }
  return entries;
}

function runDoctor(root, { json = true, target = root, cwd = root, env = {}, extra = [] } = {}) {
  const before = contents(root);
  const beforeCwd = cwd === root ? null : contents(cwd);
  const result = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--cli', 'codex',
    ...(json ? ['--json'] : []), ...(target ? ['--target', target] : []), ...extra], {
    cwd, encoding: 'utf8', timeout: 60_000,
    env: {
      ...process.env, HOME: root, USERPROFILE: root, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', ...env,
      // Keep YAML checks independent of installed browsers, including Windows' LOCALAPPDATA cache.
      PLAYWRIGHT_BROWSERS_PATH: join(root, 'playwright-browsers'),
    },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.stderr, '');
  assert.ok(!result.stdout.includes(PRIVATE_MARKER), 'doctor exposed YAML contents');
  assert.deepEqual(contents(root), before, 'diagnostics changed the user files');
  if (beforeCwd) assert.deepEqual(contents(cwd), beforeCwd, 'diagnostics changed the working directory');
  if (json) {
    assert.equal(result.status, 0, result.stdout);
    return JSON.parse(result.stdout);
  }
  return result;
}

function expectErrors(root, labels, options = {}) {
  const state = runDoctor(root, options);
  assert.deepEqual(state.missing, []);
  assert.equal(state.onboardingNeeded, false);
  assert.deepEqual(state.autoCopied, []);
  assert.deepEqual(yamlWarnings(state), labels);
  const human = runDoctor(root, { ...options, json: false });
  assert.equal(human.status, 1);
  for (const label of labels) {
    assert.ok(human.stdout.includes(`✗ ${label}`), human.stdout);
    assert.ok(!human.stdout.includes(`${label.split(':')[0]} found`), human.stdout);
  }
  assert.ok(!human.stdout.includes('All checks passed'), human.stdout);
  if (labels.some((label) => label.startsWith('config/profile.yml:'))) {
    assert.ok(!human.stdout.includes('Scan extractor:'), human.stdout);
  }
  return human;
}

for (const paths of [['config/profile.yml'], ['portals.yml'], YAML_PATHS]) {
  test(`invalid YAML is reported in JSON and human output: ${paths.join(', ')}`, (t) => {
    const root = fixture(t, Object.fromEntries(paths.map((path) => [path, INVALID])));
    expectErrors(root, paths.map(INVALID_LABEL));
  });
}

for (const source of ['scan:\n  extractor: cli\n', '', '# Empty configuration is valid YAML.\n']) {
  test(`valid YAML remains accepted: ${source || '(empty)'}`, (t) => {
    const root = fixture(t, Object.fromEntries(YAML_PATHS.map((path) => [path, source])));
    const state = runDoctor(root);
    assert.deepEqual(state.missing, []);
    assert.equal(state.onboardingNeeded, false);
    assert.deepEqual(yamlWarnings(state), []);
    const human = runDoctor(root, { json: false });
    for (const path of YAML_PATHS) assert.ok(human.stdout.includes(`✓ ${path} found`), human.stdout);
    assert.ok(human.stdout.includes(`✓ Scan extractor: ${source.startsWith('scan:') ? 'cli' : 'mcp'}`), human.stdout);
    // These cases check YAML; unrelated prerequisites may still fail.
    assert.ok(!human.stdout.includes('invalid YAML'), human.stdout);
  });
}

test('missing YAML keeps onboarding and warning semantics', (t) => {
  const root = fixture(t, Object.fromEntries(YAML_PATHS.map((path) => [path, null])));
  const state = runDoctor(root);
  assert.deepEqual(state.missing, YAML_PATHS);
  assert.equal(state.onboardingNeeded, true);
  assert.deepEqual(yamlWarnings(state), []);
  const human = runDoctor(root, { json: false });
  for (const path of YAML_PATHS) {
    assert.ok(human.stdout.includes(`⚠ ${path} not found (user setup required)`), human.stdout);
  }
  assert.ok(!human.stdout.includes('invalid YAML'), human.stdout);
});

for (const path of YAML_PATHS) {
  test(`a YAML path that cannot be read as a file is diagnosed: ${path}`, (t) => {
    const root = fixture(t, { [path]: null });
    mkdirSync(join(root, path));
    expectErrors(root, [`${path}: YAML file could not be read`]);
  });
}

for (const value of [`*${PRIVATE_MARKER}`, `!${PRIVATE_MARKER} value`]) {
  test(`parser diagnostics never expose ${value[0] === '*' ? 'alias' : 'tag'} names`, (t) => {
    const root = fixture(t, { 'config/profile.yml': `private: ${value}\n` });
    const state = runDoctor(root);
    assert.equal(state.onboardingNeeded, false);
    assert.deepEqual(state.missing, []);
    const warnings = yamlWarnings(state);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^config\/profile\.yml: invalid YAML \(line 1, column \d+\)$/);
    const human = runDoctor(root, { json: false });
    assert.equal(human.status, 1);
    assert.ok(human.stdout.includes(`✗ ${warnings[0]}`), human.stdout);
  });
}

test('--strict does not pass malformed portals to the live probe or expose its exception', (t) => {
  const root = fixture(t, { 'portals.yml': INVALID });
  const human = expectErrors(root, [INVALID_LABEL('portals.yml')], { extra: ['--strict'] });
  assert.ok(!human.stdout.includes('Portal entry check skipped:'), human.stdout);
  assert.ok(!human.stdout.includes('All portals.yml entries resolve'), human.stdout);
});

test('multiple YAML documents are not accepted as a single configuration', (t) => {
  const root = fixture(t, Object.fromEntries(YAML_PATHS.map((path) => [path, 'scan: {}\n---\nscan: {}\n'])));
  expectErrors(root, YAML_PATHS.map((path) => `${path}: invalid YAML (expected a single document)`));
});

for (const variable of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) {
  test(`YAML diagnostics use the configured Data Root: ${variable}`, (t) => {
    const root = fixture(t, { 'config/profile.yml': INVALID });
    const decoy = fixture(t);
    expectErrors(root, [INVALID_LABEL('config/profile.yml')], { target: null, cwd: decoy, env: { [variable]: root } });
  });
}

test('--target takes precedence over the configured Data Root', (t) => {
  const root = fixture(t, { 'portals.yml': INVALID });
  const other = fixture(t);
  const before = contents(other);
  expectErrors(root, [INVALID_LABEL('portals.yml')], { env: { CAREER_OPS_ROOT: other, CAREER_OPS_DATA_DIR: other } });
  assert.deepEqual(contents(other), before);
});
