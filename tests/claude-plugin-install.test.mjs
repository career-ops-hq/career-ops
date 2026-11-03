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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isPluginInstallCopy } from '../path-resolver.mjs';
import { linkNodeModules } from './helpers.mjs';
import { ensureDataRoot, ensureDependencies, runNpmInstall, sessionStart } from '../scripts/claude-plugin-session-start.mjs';

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

function rootErrorFrom(dir, env) {
  const result = spawnSync(process.execPath, ['-e', "import('./path-resolver.mjs').then((m) => { try { console.log(m.getCareerOpsRoot()); } catch (err) { console.log(JSON.stringify({ name: err.name, code: err.code, source: err.source, root: err.root })); process.exitCode = 3; } })"], { cwd: dir, env, encoding: 'utf-8' });
  assert.equal(result.status, 3, `expected a refusal, got: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

test('an explicit data root inside a plugin copy is refused, never used', (t) => {
  const base = sandbox(t);
  const copy = pluginCopy(base, ['path-resolver.mjs']);
  const inside = join(copy, 'userdata');

  for (const name of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) {
    const err = rootErrorFrom(copy, childEnv(base, { [name]: inside }));
    assert.deepEqual(err, { name: 'UnsafeDataRootError', code: 'CAREER_OPS_UNSAFE_DATA_ROOT', source: name, root: inside });
  }
  // A relative value resolves against the copy, so it lands inside it too.
  assert.equal(rootErrorFrom(copy, childEnv(base, { CAREER_OPS_ROOT: 'userdata' })).root, inside);

  writeFileSync(join(copy, '.career-ops-data'), 'userdata\n');
  assert.equal(rootErrorFrom(copy, childEnv(base)).source, 'The .career-ops-data marker');
});

test('a checkout refuses a data root inside a plugin copy too', (t) => {
  const base = sandbox(t);
  const checkout = join(base, 'career-ops');
  mkdirSync(checkout, { recursive: true });
  copyFileSync(join(ROOT, 'path-resolver.mjs'), join(checkout, 'path-resolver.mjs'));
  const inside = join(base, 'plugins', 'cache', 'mk', 'career-ops', '1.0.0', 'userdata');
  assert.equal(rootErrorFrom(checkout, childEnv(base, { CAREER_OPS_ROOT: inside })).code, 'CAREER_OPS_UNSAFE_DATA_ROOT');
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

test('the hook installs dependencies into the data folder and links them into the copy', async (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];

  assert.deepEqual(await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'installed' });
  assert.deepEqual(calls, [dataDir]);
  const link = join(pluginRoot, 'node_modules');
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(resolve(pluginRoot, readlinkSync(link)), join(dataDir, 'node_modules'));
  // Only the dependencies reach the install: no lifecycle script from the plugin's manifest.
  const installed = JSON.parse(readFileSync(join(dataDir, 'package.json'), 'utf-8'));
  assert.deepEqual(installed.dependencies, { 'js-yaml': '^5.3.0' });
  assert.equal(installed.scripts, undefined);

  // Unchanged package.json: no reinstall.
  assert.deepEqual(await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'ready' });
  assert.equal(calls.length, 1);
});

test('an updated copy reuses the installed packages and relinks them', async (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];
  await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) });

  const next = join(dirname(pluginRoot), '1.1.0');
  mkdirSync(next);
  copyFileSync(join(pluginRoot, 'package.json'), join(next, 'package.json'));
  assert.deepEqual(await ensureDependencies({ pluginRoot: next, dataDir, install: recordingInstall(calls) }), { status: 'ready' });
  assert.equal(calls.length, 1);
  assert.equal(existsSync(join(next, 'node_modules', 'js-yaml')), true);
});

test('changed dependencies trigger a reinstall', async (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];
  await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) });
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ dependencies: { 'js-yaml': '^5.4.0' } }));
  assert.deepEqual(await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'installed' });
  assert.equal(calls.length, 2);
});

test('a failed install is reported and retried next session', async (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const calls = [];
  const result = await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls, false) });
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /code 1/);
  assert.equal(existsSync(join(pluginRoot, 'node_modules')), false);
  assert.deepEqual(await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'installed' });
  assert.equal(calls.length, 2);
});

test('node_modules that Claude Code installed itself are left alone', async (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  mkdirSync(join(pluginRoot, 'node_modules'));
  const calls = [];
  assert.deepEqual(await ensureDependencies({ pluginRoot, dataDir, install: recordingInstall(calls) }), { status: 'provided' });
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

test('the hook reports a refused data root instead of failing', (t) => {
  const base = sandbox(t);
  const inside = join(base, 'plugins', 'cache', 'mk', 'career-ops', '1.0.0', 'userdata');
  const saved = { root: process.env.CAREER_OPS_ROOT, cache: process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR };
  process.env.CAREER_OPS_ROOT = inside;
  process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = join(base, 'plugins');
  t.after(() => {
    for (const [key, value] of [['CAREER_OPS_ROOT', saved.root], ['CLAUDE_CODE_PLUGIN_CACHE_DIR', saved.cache]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  assert.deepEqual(ensureDataRoot(), { status: 'inside-plugin-copy', root: inside, source: 'CAREER_OPS_ROOT' });
  assert.equal(existsSync(inside), false);
});

test('an npm install that runs too long is stopped and reported', (t) => {
  const base = sandbox(t);
  const started = Date.now();
  const result = runNpmInstall(base, { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], timeoutMs: 300 });
  assert.equal(result.ok, false);
  assert.match(result.error, /did not finish within 0.3 s/);
  assert.ok(Date.now() - started < 5000, 'the install was not stopped at its timeout');
});

test('the hook does nothing for a checkout loaded in place', async (t) => {
  const base = sandbox(t);
  assert.deepEqual(await sessionStart({ CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: join(base, 'data') }), []);
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

// Runs ensureDependencies in its own process, with an install that takes long
// enough for two sessions started together to overlap if nothing serializes them.
function hookRunner(base) {
  const runner = join(base, 'run-hook.mjs');
  const hook = pathToFileURL(join(ROOT, 'scripts', 'claude-plugin-session-start.mjs')).href;
  writeFileSync(runner, `
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDependencies } from ${JSON.stringify(hook)};
const [pluginRoot, dataDir, log] = process.argv.slice(2);
const result = await ensureDependencies({
  pluginRoot,
  dataDir,
  lockOptions: { retryMs: 20 },
  install(cwd) {
    appendFileSync(log, 'start\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
    mkdirSync(join(cwd, 'node_modules', 'js-yaml'), { recursive: true });
    appendFileSync(log, 'end\\n');
    return { ok: true, code: 0 };
  },
});
console.log(result.status);
`);
  return runner;
}

function runNode(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolveRun({ code, stdout: stdout.trim(), stderr }));
  });
}

test('sessions that start together run the install once, never at the same time', async (t) => {
  const base = sandbox(t);
  const { pluginRoot, dataDir } = fakePlugin(base);
  const log = join(base, 'install.log');
  const runner = hookRunner(base);

  const results = await Promise.all([runNode([runner, pluginRoot, dataDir, log]), runNode([runner, pluginRoot, dataDir, log])]);
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  // The second session waited for the lock, then found the packages installed.
  assert.deepEqual(results.map((r) => r.stdout).sort(), ['installed', 'ready']);
  assert.deepEqual(readFileSync(log, 'utf-8').trim().split('\n'), ['start', 'end']);
  assert.equal(existsSync(join(dataDir, 'deps.lock')), false);
});

// doctor.mjs run from a plugin install copy: the tracked code files copied
// under a fake plugins/cache/, with this checkout's node_modules linked in.
let doctorCopy = null;
function doctorPluginCopy(t) {
  if (doctorCopy) return doctorCopy;
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-plugin-doctor-')));
  process.on('exit', () => rmSync(base, { recursive: true, force: true }));
  const copy = join(base, 'plugins', 'cache', 'career-ops', 'career-ops', '1.0.0');
  const skip = /^(docs|tests|web|dashboard|fonts|examples)\/|^README\.|^CHANGELOG/;
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' }).split('\0').filter((f) => f && !skip.test(f));
  for (const file of files) {
    const from = join(ROOT, file);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(copy, file)), { recursive: true });
    cpSync(from, join(copy, file), { verbatimSymlinks: true });
  }
  const depsReason = linkNodeModules(copy);
  if (depsReason) {
    t.skip(depsReason);
    return null;
  }
  doctorCopy = { base, copy };
  return doctorCopy;
}

function runDoctor({ base, copy }, args, extra = {}) {
  const home = mkdtempSync(join(base, 'home-'));
  const env = { ...childEnv(base, extra), HOME: home, USERPROFILE: home };
  const result = spawnSync(process.execPath, [join(copy, 'doctor.mjs'), ...args], { cwd: copy, env, encoding: 'utf-8' });
  return { ...result, home };
}

test('doctor reports a data root inside the plugin copy and creates nothing there', (t) => {
  const setup = doctorPluginCopy(t);
  if (!setup) return;
  const inside = join(setup.copy, 'userdata');

  const human = runDoctor(setup, [], { CAREER_OPS_ROOT: inside });
  assert.equal(human.status, 1);
  assert.match(human.stdout, /CAREER_OPS_ROOT points inside a Claude Code plugin install/);
  assert.equal(existsSync(inside), false, 'doctor created User Layer folders inside the plugin copy');

  const onboarding = runDoctor(setup, ['--json', '--init-templates'], { CAREER_OPS_ROOT: inside });
  const state = JSON.parse(onboarding.stdout);
  assert.deepEqual(state.autoCopied, []);
  assert.equal(state.dataRootError.code, 'CAREER_OPS_UNSAFE_DATA_ROOT');
  assert.ok(state.warnings.some((w) => w.includes('inside a Claude Code plugin install')), state.warnings.join('\n'));
  assert.equal(existsSync(inside), false, '--init-templates seeded files inside the plugin copy');
});

test('doctor sets up ~/career-ops-data for a plugin copy with no override', (t) => {
  const setup = doctorPluginCopy(t);
  if (!setup) return;
  const run = runDoctor(setup, []);
  const dataRoot = join(run.home, 'career-ops-data');
  assert.match(run.stdout, /Claude Code plugin install: your files live in/);
  assert.equal(existsSync(join(dataRoot, 'data')), true);
  assert.equal(existsSync(join(setup.copy, 'data', 'pipeline.md')), false);
});
