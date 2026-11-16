// tests/plugins-config-invalid.test.mjs
// `node plugins.mjs list` and `run` must not treat a broken config/plugins.yml
// as "every plugin is off". Scan keeps the fail-open reader.
//
// Run: node --test tests/plugins-config-invalid.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'plugins.mjs');

// A tab in the indent. js-yaml 4 and 5 both reject it. A bare `: value`
// parses on js-yaml 5, so it is not a portable broken fixture.
const BROKEN = 'plugins:\n  notion:\n\tenabled: true\n';

function dataRoot(body) {
  const root = mkdtempSync(join(tmpdir(), 'plugins-cfg-'));
  mkdirSync(join(root, 'config'));
  if (body != null) writeFileSync(join(root, 'config', 'plugins.yml'), body);
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: root, NO_COLOR: '1' },
  });
}

test('list exits 1 on broken plugins.yml and does not call the plugins disabled', () => {
  const root = dataRoot(BROKEN);
  try {
    const result = run(root, ['list']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /config\/plugins\.yml/);
    assert.match(result.stderr, /node plugins\.mjs list/);
    assert.doesNotMatch(result.stdout, /disabled/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run exits 1 on the same broken file before it starts a plugin', () => {
  const root = dataRoot(BROKEN);
  try {
    const result = run(root, ['run', 'notion']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /config\/plugins\.yml/);
    assert.match(result.stderr, /not the same as every plugin being off/);
    assert.doesNotMatch(result.stderr, /Specify one|missing env|unreadable, ignoring/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('list still prints plugins when the file is valid', () => {
  const root = dataRoot('plugins:\n  notion:\n    enabled: false\n');
  try {
    const result = run(root, ['list']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Discovered plugins/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('list still works when plugins.yml is absent', () => {
  const root = dataRoot(null);
  try {
    const result = run(root, ['list']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Discovered plugins/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('list exits 1 when config/ cannot be searched, instead of calling every plugin off', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = dataRoot('plugins:\n  notion:\n    enabled: true\n');
  chmodSync(join(root, 'config'), 0o600);
  try {
    const result = run(root, ['list']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /config\/plugins\.yml could not be read/);
    assert.doesNotMatch(result.stdout, /disabled/);
  } finally {
    chmodSync(join(root, 'config'), 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

test('scan still fail-opens a broken plugins file', async () => {
  const root = dataRoot(BROKEN);
  try {
    const { loadPluginConfig } = await import(pathToFileURL(join(ROOT, 'plugins', '_engine.mjs')).href);
    const cfg = await loadPluginConfig(root);
    assert.deepEqual(cfg, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
