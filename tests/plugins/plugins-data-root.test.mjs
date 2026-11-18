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
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, linkNodeModules } from '../helpers.mjs';
import { describeSpawn, exitedNonZero } from '../helpers/describe-spawn.mjs';
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
  migrateLegacyLock,
} from '../../plugins/_lock.mjs';
import { scaffoldNew } from '../../plugin-install.mjs';

function makeSandbox(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return dir;
}

// The CLI test runs plugins.mjs from a DISPOSABLE checkout, the way
// plugins-run-failure-exit.test.mjs does: started from the real checkout it
// would read the developer's own plugins.local/ and legacy plugins.lock
// through the code-root fallback, and its "nothing written to the code root"
// assertions would fail on a machine that already has them.
function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  const spec = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    if (!existsSync(file)) continue;
    seen.add(file);
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(spec)) {
      const s = m[1];
      if (!s.startsWith('.')) continue;
      queue.push(join(dirname(file), s));
    }
  }
  return [...seen];
}

function disposableCheckout() {
  const checkout = mkdtempSync(join(tmpdir(), 'plugins-data-root-checkout-'));
  for (const file of importClosure(join(ROOT, 'plugins.mjs'))) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('..')) continue;
    const dest = join(checkout, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
  }
  // Runtime reads, not imports: the scaffold template for `new`, and the
  // tracker alias data plugins.mjs loads.
  cpSync(join(ROOT, 'plugins', '_template'), join(checkout, 'plugins', '_template'), { recursive: true });
  cpSync(join(ROOT, 'tracker-aliases.json'), join(checkout, 'tracker-aliases.json'));
  const linkReason = linkNodeModules(checkout, ROOT);
  if (linkReason) throw new Error(`linkNodeModules could not give the fixture a dependency tree: ${linkReason}`);
  return checkout;
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

test('lockGate keeps the plugin unloaded and the lock untouched when the data-root lock is torn', () => {
  const codeRoot = makeSandbox('co-test-code-torn-');
  const dataRoot = makeSandbox('co-test-data-torn-');
  try {
    const { manifest } = writePlugin(join(dataRoot, 'plugins.local'), 'torn-gated');
    const torn = '{not-json';
    writeFileSync(join(dataRoot, 'plugins.lock'), torn);
    assert.equal(lockGate(manifest, codeRoot, dataRoot).load, false);
    assert.equal(readFileSync(join(dataRoot, 'plugins.lock'), 'utf8'), torn);
    assert.throws(() => writeLockEntry(dataRoot, 'x', {}, codeRoot), /not valid JSON/);
    assert.throws(() => removeLockEntry(dataRoot, 'x', codeRoot), /not valid JSON/);
    assert.equal(readFileSync(join(dataRoot, 'plugins.lock'), 'utf8'), torn);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('lockGate keeps the plugin unloaded through legacy-lock migration when the legacy lock is torn', () => {
  const codeRoot = makeSandbox('co-test-code-torn-legacy-');
  const dataRoot = makeSandbox('co-test-data-torn-legacy-');
  try {
    const { manifest } = writePlugin(join(dataRoot, 'plugins.local'), 'torn-legacy');
    const torn = '{"plugins": ';
    writeFileSync(join(codeRoot, 'plugins.lock'), torn);
    assert.equal(lockGate(manifest, codeRoot, dataRoot).load, false);
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false, 'a torn legacy lock must not be migrated or replaced by a fresh pin');
    assert.equal(readFileSync(join(codeRoot, 'plugins.lock'), 'utf8'), torn);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('migrateLegacyLock refuses a legacy lock whose plugins map is an array', () => {
  const codeRoot = makeSandbox('co-test-code-arr-');
  const dataRoot = makeSandbox('co-test-data-arr-');
  try {
    const arr = JSON.stringify({ lockfileVersion: 1, plugins: [] });
    writeFileSync(join(codeRoot, 'plugins.lock'), arr);
    assert.equal(migrateLegacyLock(dataRoot, codeRoot), false);
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false, 'an invalid plugins map must not be published');
    assert.equal(readFileSync(join(codeRoot, 'plugins.lock'), 'utf8'), arr);
    writeFileSync(join(codeRoot, 'plugins.lock'), '[]');
    assert.equal(migrateLegacyLock(dataRoot, codeRoot), false);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('the legacy lock is not used when the data-root lock cannot be checked', { skip: process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0) }, () => {
  const codeRoot = makeSandbox('co-test-code-eacces-');
  const parent = makeSandbox('co-test-data-eacces-');
  const dataRoot = join(parent, 'data');
  try {
    mkdirSync(dataRoot);
    writeFileSync(join(codeRoot, 'plugins.lock'), JSON.stringify({ lockfileVersion: 1, plugins: { legacy: { version: '1.0.0' } } }));
    chmodSync(dataRoot, 0o000);
    assert.deepEqual(readLock(dataRoot, codeRoot).plugins, {}, 'readLock must not fall back to the legacy lock');
    assert.throws(() => writeLockEntry(dataRoot, 'x', {}, codeRoot), /could not be checked/);
  } finally {
    chmodSync(dataRoot, 0o755);
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test('lockGate migrates a valid legacy lock and still loads', () => {
  const codeRoot = makeSandbox('co-test-code-ok-legacy-');
  const dataRoot = makeSandbox('co-test-data-ok-legacy-');
  try {
    const { manifest } = writePlugin(join(dataRoot, 'plugins.local'), 'ok-legacy');
    writeFileSync(join(codeRoot, 'plugins.lock'), JSON.stringify({ lockfileVersion: 1, plugins: { other: { version: '1.0.0' } } }));
    assert.equal(lockGate(manifest, codeRoot, dataRoot).load, true);
    const lock = JSON.parse(readFileSync(join(dataRoot, 'plugins.lock'), 'utf8'));
    assert.ok(lock.plugins.other, 'the other legacy pin survives');
    assert.ok(lock.plugins['ok-legacy']);
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
  // A disposable checkout: the real one's plugins.local/ and legacy
  // plugins.lock would leak into both the run and the assertions.
  const checkout = disposableCheckout();
  const cli = join(checkout, 'plugins.mjs');

  try {
    mkdirSync(join(dataRoot, 'config'), { recursive: true });
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    writeFileSync(join(dataRoot, 'data', 'applications.md'), '# Applications\n');
    writeFileSync(join(dataRoot, 'data', 'pipeline.md'), '# Pipeline\n');

    const runCli = (args) => {
      const r = spawnSync(process.execPath, [cli, ...args], {
        cwd: checkout,
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
    assert.equal(existsSync(join(checkout, 'plugins.local', 'cli-plug')), false);

    // 2. `enable --confirm` records consent in dataRoot/plugins.lock and enables in dataRoot/config/plugins.yml
    const rEnable = runCli(['enable', 'cli-plug', '--confirm']);
    assert.equal(rEnable.status, 0, describeSpawn(rEnable, 'enable cli-plug --confirm'));
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), true);
    assert.equal(existsSync(join(checkout, 'plugins.lock')), false);

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
    rmSync(checkout, { recursive: true, force: true, maxRetries: 10 });
  }
});

// Fails the plugins.lock save inside the CLI process (FAIL_LOCK_SAVE), the
// way add-entry-concurrent.test.mjs pauses its child: a read-only folder would
// do the same on POSIX, but Windows ignores chmod. It also stands in for git
// (FAKE_CLONE_SRC), since safeClone refuses local remotes by design and a
// test must not need the network.
function writeCliPreload(dir) {
  const preload = join(dir, 'preload.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const rename = fs.renameSync;
fs.renameSync = function(from, to) {
  if (process.env.FAIL_LOCK_SAVE && String(to).endsWith('plugins.lock')) {
    throw Object.assign(new Error('EACCES: permission denied (injected)'), { code: 'EACCES' });
  }
  return rename.call(this, from, to);
};
// Same idea for the folder delete in remove: chmod cannot make a Windows
// folder undeletable, so FAIL_FOLDER_DELETE fails rmSync on plugins.local.
const rm = fs.rmSync;
fs.rmSync = function(target, ...rest) {
  if (process.env.FAIL_FOLDER_DELETE && String(target).includes('plugins.local')) {
    throw Object.assign(new Error('EACCES: permission denied (injected)'), { code: 'EACCES' });
  }
  return rm.call(this, target, ...rest);
};
const execFile = cp.execFileSync;
cp.execFileSync = function(file, args = [], ...rest) {
  if (file !== 'git' || !process.env.FAKE_CLONE_SRC) return execFile.call(this, file, args, ...rest);
  const at = args.indexOf('-C');
  if (at !== -1 && args[at + 2] === 'checkout') fs.cpSync(process.env.FAKE_CLONE_SRC, args[at + 1], { recursive: true });
  return Buffer.alloc(0);
};
syncBuiltinESMExports();
`);
  return preload;
}

function cliFixture(prefix) {
  const dataRoot = makeSandbox(`co-test-${prefix}-data-`);
  const tools = makeSandbox(`co-test-${prefix}-tools-`);
  const checkout = disposableCheckout();
  mkdirSync(join(dataRoot, 'config'), { recursive: true });
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), '# Applications\n');
  writeFileSync(join(dataRoot, 'data', 'pipeline.md'), '# Pipeline\n');
  const preload = writeCliPreload(tools);
  const run = (args, env = {}) => {
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(checkout, 'plugins.mjs'), ...args], {
      cwd: checkout,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot, NO_COLOR: '1', ...env },
    });
    assert.equal(r.error, undefined, describeSpawn(r, args.join(' ')));
    return r;
  };
  const cleanup = () => {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(tools, { recursive: true, force: true });
    rmSync(checkout, { recursive: true, force: true, maxRetries: 10 });
  };
  return { dataRoot, tools, run, cleanup };
}

test('remove keeps the folder and its pin when the lock save fails, so a second remove finishes', () => {
  const { dataRoot, run, cleanup } = cliFixture('remove-retry');
  try {
    const { dir } = writePlugin(join(dataRoot, 'plugins.local'), 'retry-plug');
    const tree = hashPluginTree(dir);
    writeLockEntry(dataRoot, 'retry-plug', {
      source: 'local', version: '1.0.0', integrity: tree.integrity, files: tree.files,
      consent: { allowedHosts: ['api.example.com'], requiredEnv: [], acceptedAt: '2026-01-01T00:00:00.000Z' },
    });

    const failed = run(['remove', 'retry-plug'], { FAIL_LOCK_SAVE: '1' });
    assert.ok(exitedNonZero(failed), describeSpawn(failed, 'remove with a failing lock save'));
    assert.match(failed.stderr, /EACCES/);
    assert.equal(existsSync(join(dir, 'manifest.json')), true, 'the folder must survive, or a second remove cannot find the plugin');
    assert.ok(readLock(dataRoot).plugins['retry-plug'], 'the pin must survive a failed save');

    const retried = run(['remove', 'retry-plug']);
    assert.equal(retried.status, 0, describeSpawn(retried, 'remove retry'));
    assert.equal(existsSync(dir), false);
    assert.equal(readLock(dataRoot).plugins['retry-plug'], undefined);
  } finally {
    cleanup();
  }
});

test('remove puts the pin back when the folder cannot be deleted, so a retry can finish', () => {
  const { dataRoot, run, cleanup } = cliFixture('remove-restore');
  try {
    const { dir } = writePlugin(join(dataRoot, 'plugins.local'), 'stuck-plug');
    const tree = hashPluginTree(dir);
    writeLockEntry(dataRoot, 'stuck-plug', {
      source: 'local', version: '1.0.0', integrity: tree.integrity, files: tree.files,
      consent: { allowedHosts: ['api.example.com'], requiredEnv: [], acceptedAt: '2026-01-01T00:00:00.000Z' },
    });

    const failed = run(['remove', 'stuck-plug'], { FAIL_FOLDER_DELETE: '1' });
    assert.ok(exitedNonZero(failed), describeSpawn(failed, 'remove with a failing folder delete'));
    assert.match(failed.stderr, /EACCES/);
    assert.match(failed.stderr, /pin was put back/);
    assert.equal(existsSync(join(dir, 'manifest.json')), true, 'the folder must survive');
    const restored = readLock(dataRoot).plugins['stuck-plug'];
    assert.equal(restored?.integrity, tree.integrity, 'the pin must be put back, or the leftover files load unpinned');
    assert.equal(restored?.version, '1.0.0');

    const retried = run(['remove', 'stuck-plug']);
    assert.equal(retried.status, 0, describeSpawn(retried, 'remove retry'));
    assert.equal(existsSync(dir), false);
    assert.equal(readLock(dataRoot).plugins['stuck-plug'], undefined);
  } finally {
    cleanup();
  }
});

test('remove retries a partial delete that took manifest.json before failing', () => {
  const { dataRoot, run, cleanup } = cliFixture('remove-partial');
  try {
    const { dir } = writePlugin(join(dataRoot, 'plugins.local'), 'partial-plug');
    const tree = hashPluginTree(dir);
    writeLockEntry(dataRoot, 'partial-plug', {
      source: 'local', version: '1.0.0', integrity: tree.integrity, files: tree.files,
      consent: { allowedHosts: ['api.example.com'], requiredEnv: [], acceptedAt: '2026-01-01T00:00:00.000Z' },
    });

    // Node's recursive delete removes children one by one, so a failure can
    // land after manifest.json is already gone. Stand that state up directly:
    // the leftover folder has no manifest to resolve on the retry.
    rmSync(join(dir, 'manifest.json'));
    const failed = run(['remove', 'partial-plug'], { FAIL_FOLDER_DELETE: '1' });
    assert.ok(exitedNonZero(failed), describeSpawn(failed, 'remove with a failing folder delete'));
    assert.match(failed.stderr, /pin was put back/);
    assert.equal(existsSync(dir), true, 'the leftover folder must survive');
    assert.equal(existsSync(join(dir, 'manifest.json')), false, 'the manifest is gone, as in a partial delete');
    assert.ok(readLock(dataRoot).plugins['partial-plug'], 'the pin must be put back');

    const retried = run(['remove', 'partial-plug']);
    assert.equal(retried.status, 0, describeSpawn(retried, 'remove retry without a manifest'));
    assert.equal(existsSync(dir), false, 'the retry must finish the cleanup');
    assert.equal(readLock(dataRoot).plugins['partial-plug'], undefined);
  } finally {
    cleanup();
  }
});

test('remove disables the plugin when the folder cannot be deleted and no pin exists to restore', () => {
  const { dataRoot, run, cleanup } = cliFixture('remove-disable');
  try {
    const { dir } = writePlugin(join(dataRoot, 'plugins.local'), 'unpinned-plug');
    const enabled = run(['enable', 'unpinned-plug', '--confirm']);
    assert.equal(enabled.status, 0, describeSpawn(enabled, 'enable'));
    // Enabled but unpinned: the state a torn or legacy lock can leave behind.
    removeLockEntry(dataRoot, 'unpinned-plug');

    const failed = run(['remove', 'unpinned-plug'], { FAIL_FOLDER_DELETE: '1' });
    assert.ok(exitedNonZero(failed), describeSpawn(failed, 'remove with a failing folder delete and no pin'));
    assert.match(failed.stderr, /was disabled/);
    assert.equal(existsSync(join(dir, 'manifest.json')), true, 'the folder must survive');
    const config = readFileSync(join(dataRoot, 'config', 'plugins.yml'), 'utf8');
    assert.match(config, /enabled: false/, 'an unpinned plugin whose files survived must not stay enabled');

    const retried = run(['remove', 'unpinned-plug']);
    assert.equal(retried.status, 0, describeSpawn(retried, 'remove retry'));
    assert.equal(existsSync(dir), false);
  } finally {
    cleanup();
  }
});

test('add takes the fresh clone back out when its pin cannot be written, so add can run again', () => {
  const { dataRoot, tools, run, cleanup } = cliFixture('add-pin');
  try {
    const { dir: src } = writePlugin(join(tools, 'src'), 'pinfail');
    writeFileSync(join(src, 'README.md'), '# pinfail\n');
    writeFileSync(join(src, 'LICENSE'), 'MIT\n');
    const sha = 'a'.repeat(40);
    const args = ['add', 'someone/career-ops-plugin-pinfail', '--sha', sha];
    const installed = join(dataRoot, 'plugins.local', 'pinfail');

    const failed = run(args, { FAKE_CLONE_SRC: src, FAIL_LOCK_SAVE: '1' });
    assert.ok(exitedNonZero(failed), describeSpawn(failed, 'add with a failing pin write'));
    assert.match(failed.stderr, /pinfail was not installed/);
    assert.equal(existsSync(installed), false, 'a clone with no pin must not stay installed');
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false);

    const retried = run(args, { FAKE_CLONE_SRC: src });
    assert.equal(retried.status, 0, describeSpawn(retried, 'add retry'));
    assert.equal(existsSync(join(installed, 'manifest.json')), true);
    assert.equal(readLock(dataRoot).plugins.pinfail.sha, sha);
  } finally {
    cleanup();
  }
});

test('a checkout root named plugins.local keeps its bundled plugins bundled', () => {
  // plugins.local/ must match at or below a plugin root, never as an ancestor
  // of the checkout itself (#7177 review): a root named plugins.local would
  // otherwise reclassify every bundled plugin as local, and lockGate would
  // fail same-version bundled changes instead of repinning them.
  const parent = makeSandbox('co-test-pl-root-');
  try {
    const root = join(parent, 'plugins.local', 'career-ops');
    const { manifest } = writePlugin(join(root, 'plugins'), 'bundled-inside-pl-root');

    assert.equal(pluginSource(manifest, root), 'bundled');
    assert.equal(classifySource(manifest, root, null), 'bundled');

    // A plugin in the actual local root stays local, and a plugins.local
    // directory INSIDE the bundled tree still cannot claim bundled trust.
    const { manifest: localMan } = writePlugin(join(root, 'plugins.local'), 'real-local');
    assert.equal(pluginSource(localMan, root), 'local');
    const tricky = { ...manifest, dir: join(root, 'plugins', 'plugins.local', 'tricky') };
    assert.equal(pluginSource(tricky, root), 'local');
    assert.equal(classifySource(tricky, root, null), 'unverified');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('lockGate migrates a legacy code-root lock into the data root before relying on it', () => {
  const codeRoot = makeSandbox('co-test-code-migrate-');
  const dataRoot = makeSandbox('co-test-data-migrate-');

  try {
    // Legacy layout: the only lock lives in the code root, holding a pin and
    // recorded consent for a plugin the data root does not know yet.
    writeLockEntry(codeRoot, 'legacy-plugin', {
      source: 'local',
      version: '1.0.0',
      integrity: 'sha256-legacy',
      files: { 'index.mjs': 'sha256-legacy-file' },
      consent: { allowedHosts: ['api.example.com'], requiredEnv: [], acceptedAt: '2026-01-01T00:00:00.000Z' },
    });
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false);

    // Fully pinned control: the gated plugin is pinned in the legacy lock with
    // its real integrity, so the gate is a match and no re-pin writes a
    // data-root lock — only the migration can create it.
    const { manifest } = writePlugin(join(dataRoot, 'plugins.local'), 'gated-plugin');
    const tree = hashPluginTree(manifest.dir);
    writeLockEntry(codeRoot, 'gated-plugin', {
      source: 'local',
      version: manifest.version || '0.0.0',
      integrity: tree.integrity,
      files: tree.files,
      consent: { allowedHosts: ['api.example.com'], requiredEnv: [], acceptedAt: '2026-01-01T00:00:00.000Z' },
    });
    const legacyBefore = readFileSync(join(codeRoot, 'plugins.lock'), 'utf8');
    const gateResult = lockGate(manifest, codeRoot, dataRoot);
    assert.equal(gateResult.load, true);

    // The legacy lock was persisted into the data root with every entry kept:
    // the legacy pin/consent survives replacing the code checkout.
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), true);
    const migrated = readLock(dataRoot);
    assert.ok(migrated.plugins['legacy-plugin'], 'legacy entry should be migrated');
    assert.equal(migrated.plugins['legacy-plugin'].integrity, 'sha256-legacy');
    assert.deepEqual(migrated.plugins['legacy-plugin'].consent.allowedHosts, ['api.example.com']);
    assert.equal(migrated.plugins['gated-plugin'].integrity, tree.integrity, 'the pinned control entry migrates verbatim');

    // The code-root lock is left as it was, and a second gate does not rewrite.
    assert.equal(readFileSync(join(codeRoot, 'plugins.lock'), 'utf8'), legacyBefore);
    const before = readFileSync(join(dataRoot, 'plugins.lock'), 'utf8');
    lockGate(manifest, codeRoot, dataRoot);
    assert.equal(readFileSync(join(dataRoot, 'plugins.lock'), 'utf8'), before);

    // migrateLegacyLock refuses to shadow an unparseable legacy lock.
    const codeRoot2 = makeSandbox('co-test-code-migrate-corrupt-');
    const dataRoot2 = makeSandbox('co-test-data-migrate-corrupt-');
    try {
      writeFileSync(join(codeRoot2, 'plugins.lock'), 'not json\n');
      assert.equal(migrateLegacyLock(dataRoot2, codeRoot2), false);
      assert.equal(existsSync(join(dataRoot2, 'plugins.lock')), false);
    } finally {
      rmSync(codeRoot2, { recursive: true, force: true });
      rmSync(dataRoot2, { recursive: true, force: true });
    }
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('migrateLegacyLock leaves an existing data-root lock untouched', () => {
  const codeRoot = makeSandbox('co-test-code-exists-');
  const dataRoot = makeSandbox('co-test-data-exists-');

  try {
    writeLockEntry(codeRoot, 'legacy-plugin', {
      source: 'local', version: '1.0.0', integrity: 'sha256-legacy', files: {},
    });
    writeLockEntry(dataRoot, 'newer-plugin', {
      source: 'local', version: '2.0.0', integrity: 'sha256-newer', files: {},
    });
    const newerBefore = readFileSync(join(dataRoot, 'plugins.lock'), 'utf8');

    assert.equal(migrateLegacyLock(dataRoot, codeRoot), false);
    assert.equal(readFileSync(join(dataRoot, 'plugins.lock'), 'utf8'), newerBefore);
    assert.deepEqual(Object.keys(readLock(dataRoot).plugins), ['newer-plugin']);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('migrateLegacyLock loses a race with a concurrent data-root lock create (no-replace publish, never overwrites newer consent)', () => {
  const codeRoot = makeSandbox('co-test-code-race-');
  const dataRoot = makeSandbox('co-test-data-race-');

  try {
    writeLockEntry(codeRoot, 'legacy-plugin', {
      source: 'local', version: '1.0.0', integrity: 'sha256-legacy', files: {},
    });
    const target = join(dataRoot, 'plugins.lock');
    // Interleave a concurrent create between migrateLegacyLock's existsSync
    // probe and its publish: the racing writer lands the final path while the
    // migration's complete temp is being written. The no-replace link must
    // refuse (EEXIST), defer to the winner, and clean up only its own temp.
    const racingIo = {
      writeFile: (file, data, options) => {
        writeFileSync(target, JSON.stringify({ lockfileVersion: 1, plugins: { 'newer-plugin': { source: 'local', version: '2.0.0', integrity: 'sha256-newer', files: {} } } }, null, 2) + '\n', 'utf8');
        writeFileSync(file, data, options);
      },
    };
    const migrated = migrateLegacyLock(dataRoot, codeRoot, racingIo);

    assert.equal(migrated, false, 'migration must defer to the concurrently created lock');
    const served = readLock(dataRoot);
    assert.deepEqual(Object.keys(served.plugins), ['newer-plugin'], 'the newer lock wins the race');
    assert.equal(served.plugins['newer-plugin'].integrity, 'sha256-newer');
    assert.equal(readdirSync(dataRoot).filter((f) => f.startsWith('.migrate-')).length, 0, 'no migration temp dir left behind');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('lockGate still checks a readable legacy lock when the migration write fails (injected denial + legacy drift)', () => {
  const codeRoot = makeSandbox('co-test-code-denied-');
  const dataRoot = makeSandbox('co-test-data-denied-');

  try {
    // Pin the plugin in the legacy lock with a stale integrity: same version,
    // changed files — drift the gate must keep catching.
    const { manifest } = writePlugin(join(dataRoot, 'plugins.local'), 'drifted-plugin');
    writeLockEntry(codeRoot, 'drifted-plugin', {
      source: 'local',
      version: manifest.version || '0.0.0',
      integrity: 'sha256-stale',
      files: { 'index.mjs': 'sha256-stale-file' },
      consent: { allowedHosts: ['api.example.com'], requiredEnv: [], acceptedAt: '2026-01-01T00:00:00.000Z' },
    });
    // Deterministic write denial, portable to every platform: the migration
    // write throws EACCES through the injected seam.
    const deniedWrite = () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };

    const gateResult = lockGate(manifest, codeRoot, dataRoot, { writeFile: deniedWrite });
    assert.equal(gateResult.load, false, 'legacy drift must still block the load when the migration write fails');
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('migrateLegacyLock leaves no partial final when the write fails midway (injected ENOSPC) and heals on retry', () => {
  const codeRoot = makeSandbox('co-test-code-partial-');
  const dataRoot = makeSandbox('co-test-data-partial-');

  try {
    writeLockEntry(codeRoot, 'legacy-plugin', {
      source: 'local', version: '1.0.0', integrity: 'sha256-legacy', files: {},
    });
    const target = join(dataRoot, 'plugins.lock');
    // A write that lands 17 bytes of the requested file and then fails: the
    // old wx-to-final shape left that partial file as the data-root lock.
    const partialWrite = (file, data) => { writeFileSync(file, data.slice(0, 17)); throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };

    assert.equal(migrateLegacyLock(dataRoot, codeRoot, { writeFile: partialWrite }), false, 'failed write must not report a migration');
    assert.equal(existsSync(target), false, 'no partial final lock may remain');
    assert.equal(readdirSync(dataRoot).filter((f) => f.startsWith('.migrate-')).length, 0, 'owned temp dir removed');
    // The readable legacy lock keeps serving its pins (no empty-lock masking).
    assert.equal(readLock(dataRoot, codeRoot).plugins['legacy-plugin'].integrity, 'sha256-legacy', 'legacy fallback still serves the old pins');
    // Nothing partial masks a later attempt: a clean retry migrates.
    assert.equal(migrateLegacyLock(dataRoot, codeRoot), true, 'retry after a failed write still migrates');
    assert.equal(readLock(dataRoot).plugins['legacy-plugin'].integrity, 'sha256-legacy');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('migrateLegacyLock keeps the final absent when the platform cannot hard-link (injected EPERM)', () => {
  const codeRoot = makeSandbox('co-test-code-nolink-');
  const dataRoot = makeSandbox('co-test-data-nolink-');

  try {
    writeLockEntry(codeRoot, 'legacy-plugin', {
      source: 'local', version: '1.0.0', integrity: 'sha256-legacy', files: {},
    });
    const noLink = { link: () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); } };

    assert.equal(migrateLegacyLock(dataRoot, codeRoot, noLink), false, 'unsupported atomic publish must not report a migration');
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false, 'final stays absent so legacy checks keep running');
    assert.equal(readdirSync(dataRoot).filter((f) => f.startsWith('.migrate-')).length, 0, 'owned temp dir removed');
    assert.equal(readLock(dataRoot, codeRoot).plugins['legacy-plugin'].integrity, 'sha256-legacy', 'legacy fallback still serves the old pins');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('lockGate still fails drift when the migration publish fails after a partial temp write', () => {
  const codeRoot = makeSandbox('co-test-code-partgate-');
  const dataRoot = makeSandbox('co-test-data-partgate-');

  try {
    const { manifest } = writePlugin(join(dataRoot, 'plugins.local'), 'drifted-plugin');
    writeLockEntry(codeRoot, 'drifted-plugin', {
      source: 'local',
      version: manifest.version || '0.0.0',
      integrity: 'sha256-stale',
      files: { 'index.mjs': 'sha256-stale-file' },
      consent: { allowedHosts: ['api.example.com'], requiredEnv: [], acceptedAt: '2026-01-01T00:00:00.000Z' },
    });
    const partialWrite = (file, data) => { writeFileSync(file, data.slice(0, 17)); throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };

    const gateResult = lockGate(manifest, codeRoot, dataRoot, { writeFile: partialWrite });
    assert.equal(gateResult.load, false, 'a partial migration must not mask legacy drift');
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false, 'no partial final lock may remain');
    assert.equal(readdirSync(dataRoot).filter((f) => f.startsWith('.migrate-')).length, 0, 'owned temp dir removed');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('migrateLegacyLock never removes a foreign orphan migration dir (ownership is structural)', () => {
  const codeRoot = makeSandbox('co-test-code-orphan-');
  const dataRoot = makeSandbox('co-test-data-orphan-');

  try {
    writeLockEntry(codeRoot, 'legacy-plugin', {
      source: 'local', version: '1.0.0', integrity: 'sha256-legacy', files: {},
    });
    // A foreign migration directory (another migrator's orphan) with a
    // sentinel inside: our cleanup must never touch it, whatever fails.
    const foreignDir = join(dataRoot, '.migrate-plugins.lock-foreign');
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(join(foreignDir, 'plugins.lock'), 'SENTINEL-OTHER-WRITER\n');
    const partialWrite = (file, data) => { writeFileSync(file, data.slice(0, 17)); throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };

    assert.equal(migrateLegacyLock(dataRoot, codeRoot, { writeFile: partialWrite }), false, 'failed write must not report a migration');
    assert.equal(readFileSync(join(foreignDir, 'plugins.lock'), 'utf8'), 'SENTINEL-OTHER-WRITER\n', 'foreign orphan dir is preserved');
    // Only our own dir was removed: exactly the foreign orphan remains.
    assert.deepEqual(readdirSync(dataRoot).filter((f) => f.startsWith('.migrate-')), ['.migrate-plugins.lock-foreign'], 'only the foreign orphan remains');
    assert.equal(existsSync(join(dataRoot, 'plugins.lock')), false, 'no final lock created');
    assert.equal(readLock(dataRoot, codeRoot).plugins['legacy-plugin'].integrity, 'sha256-legacy', 'legacy fallback still serves the old pins');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
