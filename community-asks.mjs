#!/usr/bin/env node
/**
 * community-asks.mjs — decides whether career-ops asks the user for support,
 * and which ask.
 *
 * career-ops never phones home, so the only signals the maintainers get are
 * the ones people choose to give. It asks for them in words, rarely, and at
 * the right moment (AGENTS.md → "Community asks"):
 *
 *   star       after the first saved evaluation report
 *   manifesto  after five reports, at least seven days after the star ask
 *   (the Hired Wall ask lives in hired-share.mjs, at a hire)
 *
 * Each ask is shown at most once, and never two in one run.
 *
 *   node community-asks.mjs next            prints one line or nothing; always exits 0
 *   node community-asks.mjs open <ask>      opens the ask's page, after the user said yes
 *   node community-asks.mjs status          the state as JSON
 *   node community-asks.mjs off             never ask again
 *   CAREER_OPS_NO_ASKS=1                    the same, without writing anything
 *
 * Guarantees (tests/community-asks.test.mjs):
 *   - At most once. `next` claims data/.community-asks/<ask> with an exclusive
 *     create BEFORE it prints. When the marker exists or cannot be written, it
 *     prints nothing. The markers are user-layer data (DATA_CONTRACT.md): an
 *     update, or a reinstall that keeps the data, never asks again.
 *   - Never unattended: silent under CI, batch workers (CAREER_OPS_HEADLESS,
 *     CAREER_OPS_BATCH_STATE) and Claude Code's headless entrypoints. Never
 *     decided by isTTY: an agent's shell has no TTY, so a TTY check would hide
 *     the ask from almost every user.
 *   - No network. The script never makes a request. `open` hands one fixed URL
 *     to the system's browser opener, and the user still clicks the star or
 *     signs themselves: nothing is ever starred or signed for them (GitHub
 *     Acceptable Use Policies, section 4, forbid automated starring).
 */

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { isMainModule } from './lib/is-main-module.mjs';

export const STAR_URL = 'https://github.com/career-ops-hq/career-ops';
export const MANIFESTO_URL = 'https://career-ops.org/manifesto?utm_source=ask';
export const MANIFESTO_MIN_REPORTS = 5;
export const MANIFESTO_MIN_DAYS_AFTER_STAR = 7;
export const ASKS = Object.freeze(['star', 'manifesto']);
/** From this many reports the star ask names the count: the user has run career-ops for a while. */
export const VETERAN_MIN_REPORTS = 5;

// The drawing for the star ask ("yours is missing"). `next` prints it in a fenced
// block of its own so the agent copies it exactly. Star ask only, never the manifesto.
// The emoji closes its row: a terminal that draws it one column wider shifts nothing.
export const STAR_ART = Object.freeze([
  " +          . '",
  "        o  ⭐",
  "       / \\",
  "*-----*   *-----*",
  " `.           .'",
  "    *       *",
  "   /  .-*-.  \\",
  "  *-'       '-*",
]);

const REPORT_FILE = /^\d{3,}-.+\.md$/;
const DAY_MS = 86_400_000;
const CI_VARS = Object.freeze([
  'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'TRAVIS', 'TF_BUILD', 'JENKINS_URL',
  'TEAMCITY_VERSION', 'BITBUCKET_BUILD_NUMBER', 'CODEBUILD_BUILD_ID', 'DRONE', 'APPVEYOR',
]);

const USAGE = `Usage:
  node community-asks.mjs next          print the one ask that is due, or nothing (always exits 0)
  node community-asks.mjs open <ask>    open the page of an ask the user said yes to (star | manifesto)
  node community-asks.mjs status        show the state as JSON
  node community-asks.mjs off           never ask again (CAREER_OPS_NO_ASKS=1 does the same without writing)

Options:
  --root <dir>   data root (default: the configured career-ops data root)
  --now <iso>    clock override, for tests`;

/**
 * The line the agent says. The star line says career-ops "collects nothing
 * about you": that holds while LEGAL_DISCLAIMER.md says it collects no
 * analytics, telemetry or usage data, and the test ties the two together. A
 * change that starts sending any data, even opt-in, revisits this sentence in
 * the same PR.
 *
 * @param {string} ask - 'star' or 'manifesto'.
 * @param {{reports?: number}} [context]
 * @returns {string}
 */
export function askText(ask, { reports = 0 } = {}) {
  if (ask === 'star') {
    const opening = reports >= VETERAN_MIN_REPORTS
      ? `You've run ${reports} evaluations with career-ops so far. It's free and collects nothing about you, `
      : 'If this report saved you some time: career-ops is free and collects nothing about you, ';
    return opening
      + "so we can't tell whether it helped. A Star on GitHub (the button at the top right of the page) "
      + 'is one of the few ways we find out, '
      + 'and it helps the next job seeker find career-ops. '
      + `Say "yes" and I'll open the page (${STAR_URL}). I won't ask for a star again.`;
  }
  if (ask === 'manifesto') {
    return "The way you've been searching has a name: CareerOps, and it has a manifesto. "
      + 'If it speaks for you, sign it (your name goes on the public wall). '
      + `Say "yes" and I'll open it (${MANIFESTO_URL}). I won't ask about the manifesto again.`;
  }
  return '';
}

/**
 * What `next` prints for an ask: the star ask comes with its drawing in a
 * fenced block of its own, for the agent to copy exactly; the manifesto ask is
 * the sentence alone.
 *
 * @param {string} ask
 * @param {{reports?: number}} [context]
 * @returns {string}
 */
export function askOutput(ask, context = {}) {
  const text = askText(ask, context);
  if (!text) return '';
  return ask === 'star' ? `\`\`\`\n${STAR_ART.join('\n')}\n\`\`\`\n${text}` : text;
}

const isOn = (value) => value !== undefined && value !== null && value !== ''
  && value !== '0' && String(value).toLowerCase() !== 'false';

/**
 * Why this run must not ask, or null when it may.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function unattendedReason(env = process.env) {
  if (isOn(env.CAREER_OPS_NO_ASKS)) return 'CAREER_OPS_NO_ASKS is set';
  if (isOn(env.CAREER_OPS_HEADLESS)) return 'CAREER_OPS_HEADLESS is set';
  if (env.CAREER_OPS_BATCH_STATE) return 'this is a batch worker (CAREER_OPS_BATCH_STATE is set)';
  if (isOn(env.CI)) return 'CI is set';
  const ci = CI_VARS.find((name) => isOn(env[name]));
  if (ci) return `${ci} is set`;
  const entrypoint = String(env.CLAUDE_CODE_ENTRYPOINT || '');
  if (entrypoint.startsWith('sdk-') || entrypoint === 'mcp') return `headless Claude Code (${entrypoint})`;
  return null;
}

/**
 * Number of evaluation reports (`{###}-{slug}.md`) in a reports directory.
 *
 * @param {string} reportsDir
 * @returns {number}
 */
export function countReports(reportsDir) {
  try {
    return readdirSync(reportsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && REPORT_FILE.test(entry.name)).length;
  } catch {
    return 0;
  }
}

/**
 * When an ask was shown, or null when it never was. A marker that exists but
 * cannot be read still counts as shown: unreadable must never mean "ask again".
 *
 * @param {string} asksDir
 * @param {string} name
 * @returns {Date|null}
 */
function shownAt(asksDir, name) {
  const file = join(asksDir, name);
  if (!existsSync(file)) return null;
  try {
    const at = Date.parse(readFileSync(file, 'utf8').trim());
    if (Number.isFinite(at)) return new Date(at);
  } catch { /* fall through to the file time */ }
  try { return statSync(file).mtime; } catch { return new Date(0); }
}

/**
 * The ask that is due, or null. Pure: the caller reads the state.
 *
 * @param {{reports?: number, star?: Date|null, manifesto?: Date|null, off?: boolean,
 *   legacyManifesto?: boolean, now?: Date}} state
 * @returns {'star'|'manifesto'|null}
 */
export function decideAsk({ reports = 0, star = null, manifesto = null, off = false, legacyManifesto = false, now = new Date() } = {}) {
  if (off) return null;
  if (!star) return reports >= 1 ? 'star' : null;
  if (manifesto || legacyManifesto) return null;
  const daysSinceStar = (now.getTime() - star.getTime()) / DAY_MS;
  return reports >= MANIFESTO_MIN_REPORTS && daysSinceStar >= MANIFESTO_MIN_DAYS_AFTER_STAR ? 'manifesto' : null;
}

/**
 * Claim an ask: create its marker with an exclusive create. Only the process
 * that creates it may print, so two sessions at once still ask once.
 *
 * @param {string} asksDir
 * @param {string} name
 * @param {Date} [now]
 * @returns {boolean} true when this call created the marker.
 */
export function claim(asksDir, name, now = new Date()) {
  try {
    mkdirSync(asksDir, { recursive: true });
    const fd = openSync(join(asksDir, name), 'wx');
    try { writeSync(fd, `${now.toISOString()}\n`); } finally { closeSync(fd); }
    return true;
  } catch {
    return false;
  }
}

/**
 * Everything decideAsk needs, read from a data root.
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {Date} now
 */
export function readState(root, env = process.env, now = new Date()) {
  const asksDir = join(root, 'data', '.community-asks');
  const reportsDir = resolve(env.CAREER_OPS_REPORTS_DIR || join(root, 'reports'));
  // scan.mjs used to show the manifesto once in a terminal and leave this file
  // in the folder it ran from. Whoever saw it is not asked again.
  const legacyManifesto = [root, process.cwd()].some((dir) => existsSync(join(dir, '.manifesto-noted')));
  return {
    asksDir,
    reportsDir,
    reports: countReports(reportsDir),
    star: shownAt(asksDir, 'star'),
    manifesto: shownAt(asksDir, 'manifesto'),
    off: existsSync(join(asksDir, 'off')),
    legacyManifesto,
    now,
  };
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  // Bounded: on Linux xdg-open can hand the URL to a handler that waits, and the
  // agent's shell would hang after the user said yes. On timeout the URL is printed.
  try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 10_000, windowsHide: true }); return true; } catch { return false; }
}

function parseArgs(argv) {
  const flags = { root: null, now: null, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--root') flags.root = argv[++i] ?? null;
    else if (arg.startsWith('--root=')) flags.root = arg.slice('--root='.length);
    else if (arg === '--now') flags.now = argv[++i] ?? null;
    else if (arg.startsWith('--now=')) flags.now = arg.slice('--now='.length);
    else positional.push(arg);
  }
  return { flags, positional };
}

async function defaultRoot() {
  // Loaded lazily: `next` must stay silent and exit 0 even if the resolver
  // throws (for example, an unsafe data root), and the tests pass --root.
  const { getCareerOpsRoot } = await import('./path-resolver.mjs');
  const { resolveWorkspaceRootFor } = await import('./tracker-utils.mjs');
  return resolveWorkspaceRootFor(getCareerOpsRoot());
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const { flags, positional } = parseArgs(argv);
  const [command = 'next', target] = positional;
  if (flags.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  const parsedNow = flags.now ? new Date(flags.now) : new Date();
  const now = Number.isFinite(parsedNow.getTime()) ? parsedNow : new Date();

  if (command === 'next') {
    try {
      if (unattendedReason(env)) return 0;
      const root = resolve(flags.root || await defaultRoot());
      const state = readState(root, env, now);
      const ask = decideAsk(state);
      if (ask && claim(state.asksDir, ask, now)) process.stdout.write(`${askOutput(ask, state)}\n`);
    } catch { /* an ask is never worth breaking the user's run */ }
    return 0;
  }

  if (command === 'open') {
    const url = target === 'star' ? STAR_URL : target === 'manifesto' ? MANIFESTO_URL : null;
    if (!url) { process.stderr.write(`community-asks: open needs star or manifesto\n${USAGE}\n`); return 1; }
    const opened = !unattendedReason(env) && openInBrowser(url);
    process.stdout.write(opened ? `Opened ${url} in your browser.\n` : `Open this page: ${url}\n`);
    return 0;
  }

  if (command === 'status') {
    const root = resolve(flags.root || await defaultRoot());
    const state = readState(root, env, now);
    const iso = (date) => (date ? date.toISOString() : null);
    process.stdout.write(`${JSON.stringify({
      root,
      reportsDir: state.reportsDir,
      reports: state.reports,
      shown: { star: iso(state.star), manifesto: iso(state.manifesto) },
      off: state.off,
      legacyManifesto: state.legacyManifesto,
      unattended: unattendedReason(env),
      due: state.off ? null : decideAsk(state),
    }, null, 2)}\n`);
    return 0;
  }

  if (command === 'off') {
    const root = resolve(flags.root || await defaultRoot());
    const asksDir = join(root, 'data', '.community-asks');
    if (claim(asksDir, 'off', now) || existsSync(join(asksDir, 'off'))) {
      process.stdout.write("Community asks are off: career-ops won't ask for a star or a signature again. "
        + `Delete ${join(asksDir, 'off')} to undo.\n`);
      return 0;
    }
    process.stderr.write(`community-asks: could not write ${join(asksDir, 'off')}; set CAREER_OPS_NO_ASKS=1 instead.\n`);
    return 1;
  }

  process.stderr.write(`community-asks: unknown command "${command}"\n${USAGE}\n`);
  return 1;
}

if (isMainModule(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => { process.stderr.write(`community-asks: ${err.message}\n`); process.exitCode = 1; },
  );
}
