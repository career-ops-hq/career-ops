// Doctor must see plugins in the code checkout, and config in the data root.
//
// Under a split install (CAREER_OPS_ROOT points at the user's files, the
// checkout holds plugins/), doctor used to look for plugins inside the data
// root and print "Plugins: none installed". `node plugins.mjs list` on the
// same install listed them, including one switched on with keys missing.
//
// Run: node --test tests/doctor-plugin-split-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = join(import.meta.dirname, '..');
const DOCTOR = join(ROOT, 'doctor.mjs');

function dataRootWith(yaml) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-plugins-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'plugins.yml'), yaml);
  return dir;
}

function doctorEnv(dataRoot) {
  const env = { NO_COLOR: '1' };
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CAREER_OPS_')) continue;
    if (key === 'NOTION_ACCESS_TOKEN' || key === 'NOTION_PARENT_PAGE_ID') continue;
    env[key] = value;
  }
  env.CAREER_OPS_ROOT = dataRoot;
  return env;
}

function runDoctor(dataRoot, args) {
  const r = spawnSync(process.execPath, [DOCTOR, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    env: doctorEnv(dataRoot),
  });
  assert.equal(r.error, undefined, describeSpawn(r, args.join(' ')));
  return r;
}

test('a switched-on plugin in a data-only root is reported from the checkout', () => {
  const dir = dataRootWith('plugins:\n  notion:\n    enabled: true\n');
  try {
    const human = runDoctor(dir, []);
    const text = `${human.stdout}\n${human.stderr}`;
    assert.match(text, /notion \(missing NOTION_ACCESS_TOKEN, NOTION_PARENT_PAGE_ID\)/);
    assert.match(text, /notion: add NOTION_ACCESS_TOKEN, NOTION_PARENT_PAGE_ID to \.env/);
    assert.doesNotMatch(text, /Plugins: none installed/);

    const json = runDoctor(dir, ['--json']);
    assert.equal(json.status, 0, describeSpawn(json, 'json'));
    const state = JSON.parse(json.stdout);
    const notion = (state.plugins || []).find((p) => p.id === 'notion');
    assert.ok(notion, `plugins did not include notion: ${JSON.stringify(state.plugins)}`);
    assert.equal(notion.enabled, false);
    assert.ok(notion.missingEnv.includes('NOTION_ACCESS_TOKEN'));
    assert.equal(state.pluginConfigError, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('--target still diagnoses the directory it was given', () => {
  const dir = dataRootWith('plugins:\n  notion:\n    enabled: true\n');
  try {
    const human = runDoctor(dir, ['--target', dir]);
    const text = `${human.stdout}\n${human.stderr}`;
    assert.match(text, /Plugins: none installed/);
    assert.doesNotMatch(text, /notion: add NOTION_ACCESS_TOKEN/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a plugin that is off does not get a missing-key warning', () => {
  const dir = dataRootWith('plugins:\n  notion:\n    enabled: false\n');
  try {
    const human = runDoctor(dir, []);
    const text = `${human.stdout}\n${human.stderr}`;
    assert.match(text, /notion \(off\)/);
    assert.doesNotMatch(text, /notion: add NOTION_ACCESS_TOKEN/);

    const json = runDoctor(dir, ['--json']);
    assert.equal(json.status, 0, describeSpawn(json, 'json off'));
    const state = JSON.parse(json.stdout);
    const notion = (state.plugins || []).find((p) => p.id === 'notion');
    assert.ok(notion, 'plugins did not include notion');
    assert.equal(notion.enabled, false);
    assert.equal(state.pluginConfigError, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('keys in the data root .env count when --cli picks the CLI', () => {
  const dir = dataRootWith('plugins:\n  notion:\n    enabled: true\n');
  writeFileSync(join(dir, '.env'), 'NOTION_ACCESS_TOKEN=fixture-token\nNOTION_PARENT_PAGE_ID=fixture-page\n');
  try {
    const human = runDoctor(dir, ['--cli', 'claude']);
    const text = `${human.stdout}\n${human.stderr}`;
    assert.doesNotMatch(text, /missing NOTION_ACCESS_TOKEN/);
    assert.doesNotMatch(text, /notion: add NOTION_ACCESS_TOKEN/);

    const json = runDoctor(dir, ['--json', '--cli', 'claude']);
    assert.equal(json.status, 0, describeSpawn(json, 'json cli'));
    const notion = (JSON.parse(json.stdout).plugins || []).find((p) => p.id === 'notion');
    assert.ok(notion, 'plugins did not include notion');
    assert.deepEqual(notion.missingEnv, []);
    assert.equal(notion.enabled, true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
