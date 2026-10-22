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
import { isMainModule } from '../lib/is-main-module.mjs';

const STAMP = 'career-ops-deps.json';

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

function runNpmInstall(cwd) {
  // --ignore-scripts: Playwright's browser download is doctor's job, and it
  // would otherwise hold the session start for minutes.
  const result = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  return { ok: result.status === 0, code: result.status, error: result.error?.message };
}

/**
 * Install the runtime dependencies into dataDir when they are missing or
 * package.json changed since the last install, then link them into the copy.
 *
 * @param {{pluginRoot: string, dataDir: string, install?: (cwd: string) => {ok: boolean, code?: number|null, error?: string}}} opts
 * @returns {{status: 'provided'|'ready'|'installed'|'failed', detail?: string}}
 */
export function ensureDependencies({ pluginRoot, dataDir, install = runNpmInstall }) {
  const link = join(pluginRoot, 'node_modules');
  const target = join(dataDir, 'node_modules');

  let linkStat = null;
  try {
    linkStat = lstatSync(link);
  } catch {
    // Absent: linked below.
  }
  // A real directory means Claude Code installed the packages itself.
  if (linkStat && !linkStat.isSymbolicLink()) return { status: 'provided' };

  const manifest = dependencyManifest(pluginRoot);
  const stampPath = join(dataDir, STAMP);
  const current = JSON.stringify(readJson(stampPath));
  let status = 'ready';
  if (current !== JSON.stringify(manifest.dependencies) || !existsSync(target)) {
    mkdirSync(dataDir, { recursive: true });
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
 * would be deleted on the next update.
 *
 * @returns {{status: 'ok'|'inside-plugin-copy', root: string}}
 */
export function ensureDataRoot(root = getCareerOpsRoot()) {
  if (isPluginInstallCopy(root)) return { status: 'inside-plugin-copy', root };
  mkdirSync(root, { recursive: true });
  return { status: 'ok', root };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} Lines for the session context; empty when nothing changed
 */
export function sessionStart(env = process.env) {
  const pluginRoot = resolve(env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const dataDir = env.CLAUDE_PLUGIN_DATA;
  if (!dataDir || !isPluginInstallCopy(pluginRoot, env)) return [];

  const lines = [];
  const deps = ensureDependencies({ pluginRoot, dataDir });
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
      `career-ops plugin: the data root ${data.root} is inside the plugin install, which Claude Code replaces on every update. ` +
      'Do not write the user\'s files there: ask them to set CAREER_OPS_ROOT to an absolute path outside ~/.claude/plugins.',
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
    const lines = sessionStart();
    if (lines.length > 0) console.log(lines.join('\n'));
  } catch (err) {
    console.log(`career-ops plugin: session setup failed (${err.message}).`);
  }
  process.exit(0);
}
