#!/usr/bin/env node
/**
 * claude-plugin-session-start.mjs — SessionStart hook for the Claude Code
 * plugin install (hooks/hooks.json).
 *
 * Claude Code copies an installed plugin into ~/.claude/plugins/cache/ and
 * replaces that copy on every update. The copy has no node_modules: Claude
 * Code installs a plugin's packages only when it ships a package-lock.json,
 * and this repository keeps its lockfile out of git. So the hook installs the
 * runtime dependencies into ${CLAUDE_PLUGIN_DATA}, which survives updates, and
 * links them into the copy, where Node's ESM resolution looks for them
 * (NODE_PATH does not apply to `import`).
 *
 * It also creates the data root (~/career-ops-data unless CAREER_OPS_ROOT or
 * CAREER_OPS_DATA_DIR says otherwise), so the first onboarding write has a
 * folder to land in.
 *
 * A checkout loaded in place (a marketplace added from a local path) is the
 * user's own: its node_modules and data root are theirs to manage, so the hook
 * does nothing there.
 *
 * Silent when nothing changed. Whatever it prints becomes session context, so
 * it prints only what the agent needs to know. It always exits 0: a failed
 * install must not block the session.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCareerOpsRoot, isPluginInstallCopy } from '../path-resolver.mjs';
import { acquireDirLock, releaseOrWarn } from '../lib/dir-lock.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const STAMP = 'career-ops-deps.json';

// Sessions that start together share ${CLAUDE_PLUGIN_DATA}, even across plugin
// versions, so the stamp check, the install and the stamp write run under one
// lock in that folder. A waiter gives up before the hook's 300 s timeout.
const DEPS_LOCK = 'deps.lock';
const DEPS_LOCK_OPTIONS = { timeoutMs: 240_000, maxWaitMs: 240_000, retryMs: 250, staleMs: 30_000 };

/**
 * The package.json the hook installs from: the plugin's runtime dependencies
 * and nothing else, so no lifecycle script from the plugin's own manifest runs.
 *
 * @param {string} pluginRoot
 * @returns {{name: string, private: true, dependencies: Record<string, string>}}
 */
export function dependencyManifest(pluginRoot) {
  const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf-8'));
  return { name: 'career-ops-plugin-deps', private: true, dependencies: pkg.dependencies ?? {} };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// The install holds deps.lock, so it must end before the hook's 300 s timeout
// kills this process and leaves a lock whose owner is gone, and before a
// waiting session's 240 s wait runs out.
export const NPM_INSTALL_TIMEOUT_MS = 180_000;
const NPM_INSTALL_ARGS = ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];

/**
 * @param {string} cwd
 * @param {{command?: string, args?: string[], timeoutMs?: number}} [options] - command and args are for tests
 * @returns {{ok: boolean, code: number|null, error?: string}}
 */
export function runNpmInstall(cwd, { command = 'npm', args = NPM_INSTALL_ARGS, timeoutMs = NPM_INSTALL_TIMEOUT_MS } = {}) {
  // --ignore-scripts: Playwright's browser download is doctor's job, and it
  // would otherwise hold the session start for minutes.
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    // npm is npm.cmd on Windows, which Node only starts through a shell. There
    // the timeout ends cmd.exe and can leave npm itself running.
    shell: process.platform === 'win32' && command === 'npm',
    timeout: timeoutMs,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    return { ok: false, code: null, error: `npm install did not finish within ${timeoutMs / 1000} s` };
  }
  return { ok: result.status === 0, code: result.status, error: result.error?.message };
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Install the runtime dependencies into dataDir when they are missing or
 * package.json changed since the last install, then link them into the copy.
 * Everything after the "provided" check runs under the data folder's lock.
 *
 * @param {{pluginRoot: string, dataDir: string, install?: (cwd: string) => {ok: boolean, code?: number|null, error?: string}, lockOptions?: object}} opts
 * @returns {Promise<{status: 'provided'|'ready'|'installed'|'failed', detail?: string}>}
 */
export async function ensureDependencies({ pluginRoot, dataDir, install = runNpmInstall, lockOptions = {} }) {
  const link = join(pluginRoot, 'node_modules');
  const initial = lstatOrNull(link);
  // A real directory means Claude Code installed the packages itself.
  if (initial && !initial.isSymbolicLink()) return { status: 'provided' };

  mkdirSync(dataDir, { recursive: true });
  const lock = await acquireDirLock(join(dataDir, DEPS_LOCK), {
    ...DEPS_LOCK_OPTIONS,
    ...lockOptions,
    owner: { purpose: 'career-ops plugin dependency install' },
  });
  try {
    return installAndLink({ pluginRoot, dataDir, install, link });
  } finally {
    releaseOrWarn(lock);
  }
}

// Read every piece of state only after the lock is held: the session that held
// it before this one may have just installed and linked these packages.
function installAndLink({ pluginRoot, dataDir, install, link }) {
  const target = join(dataDir, 'node_modules');
  const linkStat = lstatOrNull(link);
  const manifest = dependencyManifest(pluginRoot);
  const stampPath = join(dataDir, STAMP);
  const current = JSON.stringify(readJson(stampPath));
  let status = 'ready';
  if (current !== JSON.stringify(manifest.dependencies) || !existsSync(target)) {
    writeFileSync(join(dataDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(stampPath, { force: true });
    const result = install(dataDir);
    if (!result.ok) {
      return { status: 'failed', detail: result.error || `npm exited with code ${result.code}` };
    }
    writeFileSync(stampPath, `${JSON.stringify(manifest.dependencies)}\n`);
    status = 'installed';
  }

  let pointsAtTarget = false;
  try {
    pointsAtTarget = linkStat !== null && resolve(pluginRoot, readlinkSync(link)) === resolve(target);
  } catch {
    // Unreadable link: replaced below.
  }
  if (!pointsAtTarget) {
    rmSync(link, { force: true });
    // 'junction' lets Windows link a directory without admin rights; other
    // platforms ignore the type.
    symlinkSync(target, link, 'junction');
  }
  return { status };
}

/**
 * Create the data root, unless it resolves inside a plugin copy, where it
 * would be deleted on the next update. With no argument the root comes from
 * getCareerOpsRoot(), which refuses such a root with an UnsafeDataRootError.
 *
 * @param {string} [root]
 * @returns {{status: 'ok'|'inside-plugin-copy', root: string, source?: string}}
 */
export function ensureDataRoot(root) {
  if (root === undefined) {
    try {
      root = getCareerOpsRoot();
    } catch (err) {
      if (err?.code !== 'CAREER_OPS_UNSAFE_DATA_ROOT') throw err;
      return { status: 'inside-plugin-copy', root: err.root, source: err.source };
    }
  }
  if (isPluginInstallCopy(root)) return { status: 'inside-plugin-copy', root };
  mkdirSync(root, { recursive: true });
  return { status: 'ok', root };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string[]>} Lines for the session context; empty when nothing changed
 */
export async function sessionStart(env = process.env) {
  const pluginRoot = resolve(env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const dataDir = env.CLAUDE_PLUGIN_DATA;
  if (!dataDir || !isPluginInstallCopy(pluginRoot, env)) return [];

  const lines = [];
  let deps;
  try {
    deps = await ensureDependencies({ pluginRoot, dataDir });
  } catch (err) {
    // The lock wait ran out: another session is still installing.
    deps = { status: 'failed', detail: err.message };
  }
  if (deps.status === 'installed') {
    lines.push(`career-ops plugin: installed its Node packages into ${join(dataDir, 'node_modules')}.`);
  } else if (deps.status === 'failed') {
    lines.push(
      `career-ops plugin: could not install its Node packages (${deps.detail}). Scripts that import js-yaml, dotenv or playwright will fail. ` +
      `Ask the user to run \`npm install --omit=dev --ignore-scripts\` in ${dataDir}, then start a new session.`,
    );
  }

  const data = ensureDataRoot();
  if (data.status === 'inside-plugin-copy') {
    lines.push(
      `career-ops plugin: ${data.source ?? 'the data root'} points inside the plugin install (${data.root}), which Claude Code replaces on every update, ` +
      'so career-ops scripts refuse it. Ask the user to set it to an absolute path outside ~/.claude/plugins, or to remove it to use ~/career-ops-data.',
    );
  }
  return lines;
}

const USAGE = `Usage: node scripts/claude-plugin-session-start.mjs

Claude Code runs this at session start (hooks/hooks.json). It reads
CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA from the environment and takes no
other arguments.

  --help, -h   Show this message`;

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  try {
    const lines = await sessionStart();
    if (lines.length > 0) console.log(lines.join('\n'));
  } catch (err) {
    console.log(`career-ops plugin: session setup failed (${err.message}).`);
  }
  process.exit(0);
}
