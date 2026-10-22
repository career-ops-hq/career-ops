// tests/claude-plugin-install.test.mjs — career-ops installed as a Claude Code
// plugin runs from a copy under ~/.claude/plugins/cache/ that Claude Code
// replaces on every update. Before this, the data root fell back to that copy,
// so a plugin install wrote cv.md, the tracker and every report into a folder
// the next update deleted, and the copy had no node_modules at all.
//
// Covered here: plugin-copy detection, the ~/career-ops-data default, the
// SessionStart hook's dependency install and data-root creation, and the
// updater's managed-by-plugin status.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPluginInstallCopy } from '../path-resolver.mjs';
import { ensureDataRoot, ensureDependencies, sessionStart } from '../scripts/claude-plugin-session-start.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-plugin-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fake install copy holding only the given repo files.
function pluginCopy(base, files) {
  const copy = join(base, 'plugins', 'cache', 'career-ops', 'career-ops', '1.0.0');
  for (const file of files) {
    mkdirSync(dirname(join(copy, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(copy, file));
  }
  return copy;
}

function childEnv(base, extra = {}) {
  const env = { ...process.env, HOME: join(base, 'home'), USERPROFILE: join(base, 'home'), CLAUDE_CODE_PLUGIN_CACHE_DIR: join(base, 'plugins') };
  delete env.CAREER_OPS_ROOT;
  delete env.CAREER_OPS_DATA_DIR;
  return { ...env, ...extra };
}

function dataRootFrom(dir, env) {
  const result = spawnSync(process.execPath, ['-e', "import('./path-resolver.mjs').then((m) => console.log(m.getCareerOpsRoot()))"], { cwd: dir, env, encoding: 'utf-8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('isPluginInstallCopy matches only the copies Claude Code owns', (t) => {
  const base = sandbox(t);
  const plugins = join(base, 'plugins');
  const env = { CLAUDE_CODE_PLUGIN_CACHE_DIR: plugins };
  assert.equal(isPluginInstallCopy(join(plugins, 'cache', 'mk', 'career-ops', '1.0.0'), env), true);
  assert.equal(isPluginInstallCopy(join(plugins, 'marketplaces', 'mk'), env), true);
  assert.equal(isPluginInstallCopy(join(plugins, 'synced', 'career-ops'), env), true);
  // The persistent data folder and the plugins root itself are not copies.
  assert.equal(isPluginInstallCopy(join(plugins, 'data', 'career-ops-career-ops'), env), false);
  assert.equal(isPluginInstallCopy(join(plugins, 'cache'), env), false);
  assert.equal(isPluginInstallCopy(join(base, 'career-ops'), env), false);
  // CLAUDE_CONFIG_DIR moves the default plugins root with it.
  assert.equal(isPluginInstallCopy(join(base, 'cfg', 'plugins', 'cache', 'x'), { CLAUDE_CONFIG_DIR: join(base, 'cfg') }), true);
  // This checkout is loaded in place, never a copy.
  assert.equal(isPluginInstallCopy(ROOT, env), false);
});

test('a plugin copy defaults its data root to ~/career-ops-data', (t) => {
  const base = sandbox(t);
  const copy = pluginCopy(base, ['path-resolver.mjs']);
  assert.equal(dataRootFrom(copy, childEnv(base)), join(base, 'home', 'career-ops-data'));
});

test('CAREER_OPS_ROOT still wins over the plugin default', (t) => {
  const base = sandbox(t);
  const copy = pluginCopy(base, ['path-resolver.mjs']);
  const chosen = join(base, 'job-search');
  assert.equal(dataRootFrom(copy, childEnv(base, { CAREER_OPS_ROOT: chosen })), chosen);
});

test('a checkout outside the plugins root keeps its own data root', (t) => {
  const base = sandbox(t);
  const checkout = join(base, 'career-ops');
  mkdirSync(checkout, { recursive: true });
  copyFileSync(join(ROOT, 'path-resolver.mjs'), join(checkout, 'path-resolver.mjs'));
  assert.equal(dataRootFrom(checkout, childEnv(base)), checkout);
});

function fakePlugin(base, dependencies = { 'js-yaml': '^5.3.0' }) {
  const pluginRoot = join(base, 'plugins', 'cache', 'mk', 'career-ops', '1.0.0');
  mkdirSync(pluginRoot, { recursive: true });
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ name: 'career-ops', scripts: { postinstall: 'exit 1' }, dependencies }));
  return { pluginRoot, dataDir: join(base, 'plugins', 'data', 'career-ops-mk') };
}

function recordingInstall(calls, ok = true) {
  return (cwd) => {
    calls.push(cwd);
    if (ok) mkdirSync(join(cwd, 'node_modules', 'js-yaml'), { recursive: true });
    return ok ? { ok: true, code: 0 } : { ok: false, code: 1 };
  };
}

test('the hook installs dependencies into the data folder and links them into the copy', (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];

  assert.deepEqual(ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'installed' });
  assert.deepEqual(calls, [dataDir]);
  const link = join(pluginRoot, 'node_modules');
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(resolve(pluginRoot, readlinkSync(link)), join(dataDir, 'node_modules'));
  // Only the dependencies reach the install: no lifecycle script from the plugin's manifest.
  const installed = JSON.parse(readFileSync(join(dataDir, 'package.json'), 'utf-8'));
  assert.deepEqual(installed.dependencies, { 'js-yaml': '^5.3.0' });
  assert.equal(installed.scripts, undefined);

  // Unchanged package.json: no reinstall.
  assert.deepEqual(ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'ready' });
  assert.equal(calls.length, 1);
});

test('an updated copy reuses the installed packages and relinks them', (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];
  ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) });

  const next = join(dirname(pluginRoot), '1.1.0');
  mkdirSync(next);
  copyFileSync(join(pluginRoot, 'package.json'), join(next, 'package.json'));
  assert.deepEqual(ensureDependencies({ pluginRoot: next, dataDir, install: recordingInstall(calls) }), { status: 'ready' });
  assert.equal(calls.length, 1);
  assert.equal(existsSync(join(next, 'node_modules', 'js-yaml')), true);
});

test('changed dependencies trigger a reinstall', (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];
  ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) });
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ dependencies: { 'js-yaml': '^5.4.0' } }));
  assert.deepEqual(ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'installed' });
  assert.equal(calls.length, 2);
});

test('a failed install is reported and retried next session', (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];
  const result = ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls, false) });
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /code 1/);
  assert.equal(existsSync(join(pluginRoot, 'node_modules')), false);
  assert.deepEqual(ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'installed' });
  assert.equal(calls.length, 2);
});

test('node_modules that Claude Code installed itself are left alone', (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  mkdirSync(join(pluginRoot, 'node_modules'));
  const calls = [];
  assert.deepEqual(ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'provided' });
  assert.equal(calls.length, 0);
});

test('the hook creates the data root, never one inside a plugin copy', (t) => {
  const base = sandbox(t);
  const root = join(base, 'home', 'career-ops-data');
  assert.deepEqual(ensureDataRoot(root), { status: 'ok', root });
  assert.equal(existsSync(root), true);

  const saved = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
  process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = join(base, 'plugins');
  t.after(() => {
    if (saved === undefined) delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
    else process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = saved;
  });
  const inside = join(base, 'plugins', 'cache', 'mk', 'career-ops', '1.0.0', 'data');
  assert.equal(ensureDataRoot(inside).status, 'inside-plugin-copy');
  assert.equal(existsSync(inside), false);
});

test('the hook does nothing for a checkout loaded in place', (t) => {
  const base = sandbox(t);
  assert.deepEqual(sessionStart({ CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: join(base, 'data') }), []);
  assert.equal(existsSync(join(base, 'data')), false);
});

test('hooks/hooks.json runs the session-start script on SessionStart', () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf-8'));
  const commands = hooks.hooks.SessionStart.flatMap((entry) => entry.hooks.map((h) => h.command));
  assert.deepEqual(commands, ['node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-plugin-session-start.mjs"']);
  assert.equal(existsSync(join(ROOT, 'scripts', 'claude-plugin-session-start.mjs')), true);
});

test('update-system reports managed-by-plugin inside a plugin copy and refuses apply', (t) => {
  const base = sandbox(t);
  const copy = pluginCopy(base, ['update-system.mjs', 'path-resolver.mjs', 'VERSION']);
  const env = childEnv(base);

  const check = spawnSync(process.execPath, [join(copy, 'update-system.mjs'), 'check'], { cwd: copy, env, encoding: 'utf-8' });
  assert.equal(check.status, 0, check.stderr);
  const status = JSON.parse(check.stdout.trim());
  assert.equal(status.status, 'managed-by-plugin');

  const apply = spawnSync(process.execPath, [join(copy, 'update-system.mjs'), 'apply', '--confirm'], { cwd: copy, env, encoding: 'utf-8' });
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /Claude Code plugin/);
});
