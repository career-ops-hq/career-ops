// @ts-check
// tests/plugins/plugins-data-root.test.mjs — verify separation of plugin code root
// (codeRoot) and data root (dataRoot / CAREER_OPS_ROOT) for Issue #7177.
//
// In Claude Code plugin installs and custom CAREER_OPS_ROOT layouts:
// - Bundled plugins live in <codeRoot>/plugins/.
// - User-layer plugins live in <dataRoot>/plugins.local/.
// - Lock file lives in <dataRoot>/plugins.lock.
// - Plugins in plugins.local can NEVER claim 'bundled' source trust.
// - Standard checkouts (dataRoot === codeRoot) preserve 100% identical behavior.
//
// Run: node --test tests/plugins/plugins-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT } from '../helpers.mjs';
import { describeSpawn } from '../helpers/describe-spawn.mjs';
import {
  pluginRoots,
  resolveSuccessorIds,
  discoverPlugins,
  pluginSource,
  lockGate,
  loadPlugins,
  mergeProviderPlugins,
  warnConfigLeftInCodeRoot,
} from '../../plugins/_engine.mjs';
import { classifySource } from '../../plugins/_registry.mjs';
import {
  lockPath,
  readLock,
  writeLockEntry,
  removeLockEntry,
  hashPluginTree,
} from '../../plugins/_lock.mjs';
import { scaffoldNew } from '../../plugin-install.mjs';

const PLUGINS_CLI = join(ROOT, 'plugins.mjs');

function makeSandbox(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return dir;
}

function writePlugin(parentDir, id, { hooks = ['ingest'], isProvider = false, version = '1.0.0' } = {}) {
  const dir = join(parentDir, id);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    apiVersion: 1,
    name: id,
    version,
    description: `Test fixture for ${id}`,
    hooks,
    requiredEnv: [],
    allowedHosts: ['api.example.com'],
    humanInTheLoop: true,
    entry: 'index.mjs',
    dir,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const code = isProvider
    ? `export default { provider: { id: "${id}", detect: () => null, async fetch() { return [{ title: "Job from ${id}" }]; } } };\n`
    : `export default { ingest: async () => [{ title: "Item from ${id}" }] };\n`;
  writeFileSync(join(dir, 'index.mjs'), code);
  return { dir, manifest };
}

test('pluginRoots returns [codeRoot/plugins, dataRoot/plugins.local]', () => {
  const codeRoot = '/mock/code';
  const dataRoot = '/mock/data';

  // Split checkout
  const roots = pluginRoots(codeRoot, dataRoot);
  assert.deepEqual(roots, [
    join(codeRoot, 'plugins'),
    join(dataRoot, 'plugins.local'),
  ]);

  // Single-root checkout (default parameter)
  const single = pluginRoots(codeRoot);
  assert.deepEqual(single, [
    join(codeRoot, 'plugins'),
    join(codeRoot, 'plugins.local'),
  ]);
});

test('discoverPlugins finds bundled plugins in codeRoot and local plugins in dataRoot', () => {
  const codeRoot = makeSandbox('co-test-code-');
  const dataRoot = makeSandbox('co-test-data-');

  try {
    const bundledDir = join(codeRoot, 'plugins');
    const localDir = join(dataRoot, 'plugins.local');
    writePlugin(bundledDir, 'demo-bundled');
    writePlugin(localDir, 'demo-local');

    const roots = pluginRoots(codeRoot, dataRoot);
    const discovered = discoverPlugins(roots);
    const ids = discovered.map(m => m.id).sort();

    assert.deepEqual(ids, ['demo-bundled', 'demo-local']);
    assert.equal(discovered.find(m => m.id === 'demo-bundled')?.dir, join(bundledDir, 'demo-bundled'));
    assert.equal(discovered.find(m => m.id === 'demo-local')?.dir, join(localDir, 'demo-local'));
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('a plugin loaded from dataRoot/plugins.local can NEVER claim bundled trust', () => {
  const codeRoot = makeSandbox('co-test-code-trust-');
  const dataRoot = makeSandbox('co-test-data-trust-');

  try {
    const bundledDir = join(codeRoot, 'plugins');
    const localDir = join(dataRoot, 'plugins.local');
    const { manifest: bundledMan } = writePlugin(bundledDir, 'my-bundled');
    const { manifest: localMan } = writePlugin(localDir, 'my-local');

    // pluginSource
    assert.equal(pluginSource(bundledMan, codeRoot), 'bundled');
    assert.equal(pluginSource(localMan, codeRoot), 'local');

    // classifySource
    assert.equal(classifySource(bundledMan, codeRoot, null), 'bundled');
    assert.equal(classifySource(localMan, codeRoot, null), 'unverified');

    // Even if localMan.dir is inside a path with "plugins", having plugins.local prevents bundled classification
    const trickyManifest = {
      ...localMan,
      dir: join(codeRoot, 'plugins', 'plugins.local', 'tricky'),
    };
    assert.equal(pluginSource(trickyManifest, codeRoot), 'local');
    assert.equal(classifySource(trickyManifest, codeRoot, null), 'unverified');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('lockPath points to plugins.lock in dataRoot', () => {
  const dataRoot = '/custom/data/path';
  assert.equal(lockPath(dataRoot), join(dataRoot, 'plugins.lock'));
});

test('readLock falls back to codeRoot if dataRoot lock is absent, but writeLockEntry always targets dataRoot', () => {
  const codeRoot = makeSandbox('co-test-code-lock-');
  const dataRoot = makeSandbox('co-test-data-lock-');

  try {
    // 1. Seed codeRoot with a legacy lock file
    writeLockEntry(codeRoot, 'legacy-plugin', {
      source: 'local',
      version: '1.0.0',
      integrity: 'sha256-legacy',
      files: {},
    });
    assert.equal(existsSync(join(codeRoot, 'plugins.lock')), true);
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false);

    // 2. readLock(dataRoot, codeRoot) should fall back to reading codeRoot
    const initial = readLock(dataRoot, codeRoot);
    assert.ok(initial.plugins['legacy-plugin'], 'fallback lock read failed');
    assert.equal(initial.plugins['legacy-plugin'].version, '1.0.0');

    // 3. writeLockEntry to dataRoot should write to dataRoot and preserve legacy entry
    writeLockEntry(dataRoot, 'new-plugin', {
      source: 'local',
      version: '2.0.0',
      integrity: 'sha256-new',
      files: {},
    }, codeRoot);

    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), true);
    const dataLock = readLock(dataRoot, codeRoot);
    assert.ok(dataLock.plugins['legacy-plugin'], 'legacy entry should be carried over');
    assert.ok(dataLock.plugins['new-plugin'], 'new entry should exist');
    assert.equal(dataLock.plugins['new-plugin'].version, '2.0.0');

    // codeRoot lock remains untouched with only the legacy plugin
    const codeLock = readLock(codeRoot);
    assert.equal(codeLock.plugins['new-plugin'], undefined);

    // 4. removeLockEntry targets dataRoot
    removeLockEntry(dataRoot, 'legacy-plugin', codeRoot);
    const updatedDataLock = readLock(dataRoot, codeRoot);
    assert.equal(updatedDataLock.plugins['legacy-plugin'], undefined);
    assert.ok(updatedDataLock.plugins['new-plugin']);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('lockGate pins to dataRoot/plugins.lock', () => {
  const codeRoot = makeSandbox('co-test-code-gate-');
  const dataRoot = makeSandbox('co-test-data-gate-');

  try {
    const localDir = join(dataRoot, 'plugins.local');
    const { manifest } = writePlugin(localDir, 'gated-plugin');

    const gateResult = lockGate(manifest, codeRoot, dataRoot);
    assert.equal(gateResult.load, true);

    // Verify lock was created in dataRoot
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), true);
    assert.equal(existsSync(join(codeRoot, 'plugins.lock')), false);

    const lock = readLock(dataRoot);
    assert.ok(lock.plugins['gated-plugin']);
    assert.equal(lock.plugins['gated-plugin'].source, 'local');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('loadPlugins loads plugins from dataRoot/plugins.local and passes dataRoot in ctx', async () => {
  const codeRoot = makeSandbox('co-test-code-load-');
  const dataRoot = makeSandbox('co-test-data-load-');

  try {
    const localDir = join(dataRoot, 'plugins.local');
    writePlugin(localDir, 'user-ingest', { hooks: ['ingest'] });

    mkdirSync(join(dataRoot, 'config'), { recursive: true });
    writeFileSync(join(dataRoot, 'config', 'plugins.yml'), 'plugins:\n  user-ingest:\n    enabled: true\n');

    const loaded = await loadPlugins('ingest', { root: codeRoot, dataRoot });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'user-ingest');
    assert.equal(loaded[0].ctx.dataRoot, dataRoot);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('mergeProviderPlugins discovers provider plugin in dataRoot/plugins.local and verifies lockGate with dataRoot', async () => {
  const codeRoot = makeSandbox('co-test-code-provider-');
  const dataRoot = makeSandbox('co-test-data-provider-');

  try {
    const localDir = join(dataRoot, 'plugins.local');
    writePlugin(localDir, 'custom-board', { hooks: ['provider'], isProvider: true });

    mkdirSync(join(dataRoot, 'config'), { recursive: true });
    writeFileSync(join(dataRoot, 'config', 'plugins.yml'), 'plugins:\n  custom-board:\n    enabled: true\n');

    const providers = new Map();
    await mergeProviderPlugins(providers, { root: codeRoot, dataRoot });

    assert.ok(providers.has('custom-board'));
    const provider = providers.get('custom-board');
    assert.equal(provider.id, 'custom-board');
    const jobs = await provider.fetch({});
    assert.deepEqual(jobs, [{ title: 'Job from custom-board' }]);

    // lock was pinned in dataRoot
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), true);
    assert.equal(existsSync(join(codeRoot, 'plugins.lock')), false);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('scaffoldNew scaffolds to dataRoot/plugins.local from codeRoot/plugins/_template', () => {
  const codeRoot = makeSandbox('co-test-code-scaffold-');
  const dataRoot = makeSandbox('co-test-data-scaffold-');

  try {
    // Template in codeRoot
    const tplDir = join(codeRoot, 'plugins', '_template');
    mkdirSync(tplDir, { recursive: true });
    writeFileSync(join(tplDir, 'manifest.json'), JSON.stringify({ id: '{{NAME}}', apiVersion: 1, description: 'desc', hooks: ['ingest'], humanInTheLoop: true, requiredEnv: [], allowedHosts: [] }));
    writeFileSync(join(tplDir, 'index.mjs'), 'export default {};\n');

    const dest = scaffoldNew(dataRoot, 'scaffolded-plug', codeRoot);
    assert.equal(dest, join(dataRoot, 'plugins.local', 'scaffolded-plug'));
    assert.equal(existsSync(join(dataRoot, 'plugins.local', 'scaffolded-plug', 'manifest.json')), true);
    assert.equal(existsSync(join(codeRoot, 'plugins.local', 'scaffolded-plug')), false);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('warnConfigLeftInCodeRoot warns if plugins.local in codeRoot still has plugins in split layout', () => {
  const codeRoot = makeSandbox('co-test-code-warn-');
  const dataRoot = makeSandbox('co-test-data-warn-');

  try {
    // Put legacy plugin in codeRoot/plugins.local
    writePlugin(join(codeRoot, 'plugins.local'), 'legacy-left');

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      warnConfigLeftInCodeRoot(codeRoot, dataRoot);
    } finally {
      console.warn = origWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /⚠️  plugins\.local is in the code folder, not the data folder, so plugins do not read it/);
    assert.ok(warnings[0].includes(join(codeRoot, 'plugins.local')));
    assert.ok(warnings[0].includes(join(dataRoot, 'plugins.local')));
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('warnConfigLeftInCodeRoot does not warn if codeRoot === dataRoot', () => {
  const root = makeSandbox('co-test-single-root-warn-');

  try {
    writePlugin(join(root, 'plugins.local'), 'local-plug');

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      warnConfigLeftInCodeRoot(root, root);
    } finally {
      console.warn = origWarn;
    }

    assert.equal(warnings.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI commands (new, enable, trust, remove) in plugins.mjs respect CAREER_OPS_ROOT', () => {
  const dataRoot = makeSandbox('co-test-cli-data-');

  try {
    mkdirSync(join(dataRoot, 'config'), { recursive: true });
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    writeFileSync(join(dataRoot, 'data', 'applications.md'), '# Applications\n');
    writeFileSync(join(dataRoot, 'data', 'pipeline.md'), '# Pipeline\n');

    const runCli = (args) => {
      const r = spawnSync(process.execPath, [PLUGINS_CLI, ...args], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30_000,
        env: { ...process.env, CAREER_OPS_ROOT: dataRoot, NO_COLOR: '1' },
      });
      assert.equal(r.error, undefined, describeSpawn(r, args.join(' ')));
      return r;
    };

    // 1. `new` scaffolds into dataRoot/plugins.local
    const rNew = runCli(['new', 'cli-plug']);
    assert.equal(rNew.status, 0, describeSpawn(rNew, 'new cli-plug'));
    assert.equal(existsSync(join(dataRoot, 'plugins.local', 'cli-plug', 'manifest.json')), true);
    assert.equal(existsSync(join(ROOT, 'plugins.local', 'cli-plug')), false);

    // 2. `enable --confirm` records consent in dataRoot/plugins.lock and enables in dataRoot/config/plugins.yml
    const rEnable = runCli(['enable', 'cli-plug', '--confirm']);
    assert.equal(rEnable.status, 0, describeSpawn(rEnable, 'enable cli-plug --confirm'));
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), true);
    assert.equal(existsSync(join(ROOT, 'plugins.lock', 'cli-plug')), false);

    const lock = readLock(dataRoot);
    assert.ok(lock.plugins['cli-plug']);
    assert.equal(lock.plugins['cli-plug'].source, 'local');

    // 3. Mutate file to cause drift, then `trust` re-pins in dataRoot
    writeFileSync(join(dataRoot, 'plugins.local', 'cli-plug', 'index.mjs'), 'export default { async ingest() { return []; } }; // edited\n');
    const rTrust = runCli(['trust', 'cli-plug']);
    assert.equal(rTrust.status, 0, describeSpawn(rTrust, 'trust cli-plug'));
    const lockAfterTrust = readLock(dataRoot);
    const newTree = hashPluginTree(join(dataRoot, 'plugins.local', 'cli-plug'));
    assert.equal(lockAfterTrust.plugins['cli-plug'].integrity, newTree.integrity);

    // 4. `remove` removes from dataRoot/plugins.local and dataRoot/plugins.lock
    const rRemove = runCli(['remove', 'cli-plug']);
    assert.equal(rRemove.status, 0, describeSpawn(rRemove, 'remove cli-plug'));
    assert.equal(existsSync(join(dataRoot, 'plugins.local', 'cli-plug')), false);
    const lockAfterRemove = readLock(dataRoot);
    assert.equal(lockAfterRemove.plugins['cli-plug'], undefined);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
