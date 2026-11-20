// lib/browser-launch.mjs — which Chromium-family browser Playwright drives.
//
// Recent Playwright Chromium builds need a current OS. Where the bundled binary
// is present but cannot start (macOS 12, for instance, which recent builds no
// longer support), every browser-backed feature fails with no fallback — PDF
// rendering, the portal scanners, liveness checks, JD extraction. Most such
// machines already have a Chromium-family browser installed, and Playwright can
// drive any of them through `executablePath`.
//
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH already named that binary for the PDF
// path (generate-pdf.mjs, lib/pdf-server.mjs). This module is that same
// override, made reusable: one resolver every launch site shares, which also
// reads the data-root .env and can auto-detect an installed browser.
//
// Resolution precedence (first that applies wins):
//   1. The caller already set executablePath or channel → that browser is kept.
//   2. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH — the shell first, then the
//      data-root .env (most commands never load .env, so this module reads it).
//   3. CAREER_OPS_BROWSER_AUTODETECT is truthy → the first installed
//      Brave/Chrome/Edge/Chromium at its standard location for the platform.
//   4. For pages this project does not control: the installed Google Chrome,
//      unless PLAYWRIGHT_BROWSERS_PATH explicitly names Playwright's browsers
//      (the Docker image, the NixOS flake shell).
//   5. Nothing resolves → Playwright's bundled Chromium.
//
// Step 4 is automatic for a security reason. Job boards, ATS pages and URLs
// from job posts are third-party content, and Playwright pins an early build of
// each Chrome milestone, so its bundled browser never receives Chrome's later
// security fixes. Google's updater patches the installed Chrome within hours of
// a release, independently of Playwright's release cycle. Every launch for such
// a page also asks for Chromium's sandbox, which Playwright turns off by default
// (see chromiumSandboxStatus), so a renderer bug does not become code execution
// as the user. CAREER_OPS_BROWSER_SANDBOX=off, in the shell or the data-root
// .env, is the visible way back to Playwright's default where the sandbox cannot
// start; doctor warns while it is set.
//
// Local content keeps the older rule, through `localContentOnly`: generate-pdf
// and img-to-pdf render only the user's own files, so nothing is gained from
// the switch, and a PDF should not vary with whatever browser is installed. For
// the same reason, step 3 stays opt-in, and it may pick another browser family.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, posix, resolve as resolvePath } from 'node:path';
import { parseEnv } from 'node:util';
import { getCareerOpsRoot } from '../path-resolver.mjs';

// Standard install locations, in preference order. Brave leads because it is
// the one most likely to still publish builds for an OS the bundled Chromium
// has dropped.
const CANDIDATES = {
  darwin: [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/brave-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ],
  win32: [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

const EXECUTABLE_ENV = 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH';
const AUTODETECT_ENV = 'CAREER_OPS_BROWSER_AUTODETECT';
export const SANDBOX_ENV = 'CAREER_OPS_BROWSER_SANDBOX';
const BROWSER_ENV_NAMES = [EXECUTABLE_ENV, AUTODETECT_ENV, SANDBOX_ENV];
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

// Preserve only the browser settings before a caller loads dotenv. On
// Windows, process.env lookups are case-insensitive but spreading it into a
// plain object is not, so normalize any differently-cased key to the canonical
// name while the snapshot is taken.
export function snapshotBrowserProcessEnv(processEnv = process.env, platform = process.platform) {
  const snapshot = {};
  const entries = platform === 'win32' ? Object.entries(processEnv) : [];
  for (const name of BROWSER_ENV_NAMES) {
    if (Object.prototype.hasOwnProperty.call(processEnv, name)) {
      snapshot[name] = processEnv[name];
      continue;
    }
    if (platform === 'win32') {
      const match = entries.find(([key]) => key.toUpperCase() === name);
      if (match) snapshot[name] = match[1];
    }
  }
  return snapshot;
}

// The data-root .env, parsed once. Only scan.mjs, the evaluators,
// openai-tailor.mjs and openrouter-runner.mjs load a .env, so a setting that
// lives only there would be invisible to every other launch site. Parsed rather
// than applied to process.env (the way doctor.mjs reads it) so a value here can
// never shadow a real shell export of the same name.
let __envFileCache = new Map(); // project root -> parsed object (possibly {})
function envFile(projectRoot = getCareerOpsRoot()) {
  if (__envFileCache.has(projectRoot)) return __envFileCache.get(projectRoot);
  let parsed = {};
  try {
    const contents = readFileSync(join(projectRoot, '.env'), 'utf8');
    // Node 22.13 can retain an inline comment on the final assignment when a
    // .env file has no trailing newline. Normalize the parser input so the
    // minimum supported Node release reads that last value consistently.
    parsed = parseEnv(contents.endsWith('\n') ? contents : `${contents}\n`);
  } catch {
    // No .env, or unreadable — an empty cache is the right answer either way.
  }
  __envFileCache.set(projectRoot, parsed);
  return parsed;
}

// A setting from the shell first, then the data-root .env. A variable PRESENT
// in the shell wins even when empty, and an empty shell value reads as "off"
// without falling through to .env — so a shell export can switch off what a
// .env turns on, which is how the test suite neutralises a developer's own
// machine configuration.
function settingWithSource(name, projectRoot, processEnv = process.env) {
  if (Object.prototype.hasOwnProperty.call(processEnv, name)) {
    const value = processEnv[name];
    return {
      value: value != null && value.trim() !== '' ? value.trim() : null,
      source: 'shell',
    };
  }
  const fromFile = envFile(projectRoot)[name];
  return {
    value: fromFile != null && fromFile.trim() !== '' ? fromFile.trim() : null,
    source: 'file',
  };
}

function setting(name, projectRoot, processEnv) {
  return settingWithSource(name, projectRoot, processEnv).value;
}

/**
 * The Chromium-family executable career-ops should launch, or null to use
 * Playwright's bundled Chromium.
 *
 * Deliberately NOT memoised: sharedPdfSocketPath() keys the painter socket on
 * this result, and changing the override within one process must change that
 * key (see tests/pdf-shared-executable-path.test.mjs). Re-reading the
 * environment is a few property lookups, and the file read behind it is cached
 * separately; the existsSync probes only run when auto-detect is switched on.
 *
 * @param {{
 *   platform?: string,
 *   pathExists?: (path: string) => boolean,
 *   projectRoot?: string,
 *   processEnv?: Record<string, string | undefined>,
 * }} [probe] - Optional probe seam for deterministic tests.
 * @returns {{ path: string, source: 'env' | 'auto' } | null}
 */
export function resolveBrowserExecutable({
  platform = process.platform,
  pathExists = existsSync,
  projectRoot = getCareerOpsRoot(),
  processEnv = process.env,
} = {}) {
  const explicit = settingWithSource(EXECUTABLE_ENV, projectRoot, processEnv);
  if (explicit.value) {
    // A path in the data-root .env belongs to that data root, independently of
    // the directory a command happened to start from. Keep shell exports
    // untouched for backwards compatibility: relative shell paths have always
    // been interpreted by Playwright from the process cwd.
    const path = explicit.source === 'file' && !isAbsolute(explicit.value)
      ? resolvePath(projectRoot, explicit.value)
      : explicit.value;
    return { path, source: 'env' };
  }

  if (TRUTHY.has(String(setting(AUTODETECT_ENV, projectRoot, processEnv) ?? '').toLowerCase())) {
    const candidate = (CANDIDATES[platform] || []).find(p => pathExists(p));
    if (candidate) return { path: candidate, source: 'auto' };
  }
  return null;
}

// Where Google Chrome installs itself. Google Chrome only: it is the browser
// whose updater this default relies on. macOS and Linux paths go through
// path.posix: `platform` can differ from the host (tests resolve Linux on a
// Windows runner), and the host's path module would write backslashes.
function systemChromeCandidates(platform, localAppData, home) {
  if (platform === 'darwin') {
    const app = 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return [`/${app}`, ...(home ? [posix.join(home, app)] : [])];
  }
  if (platform === 'linux') return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ...(localAppData ? [`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`] : []),
    ];
  }
  return [];
}

/**
 * The browser a page this project does not control opens in, or null for
 * Playwright's bundled Chromium.
 *
 * `browsersPath` defaults to the real environment rather than `processEnv`: it
 * is Playwright's own setting, read from process.env when Playwright launches,
 * and the snapshot callers pass as `processEnv` does not carry it.
 *
 * @param {{
 *   platform?: string,
 *   pathExists?: (path: string) => boolean,
 *   projectRoot?: string,
 *   processEnv?: Record<string, string | undefined>,
 *   browsersPath?: string,
 *   localAppData?: string,
 *   homeDir?: string,
 * }} [probe] - Optional probe seam for deterministic tests.
 * @returns {{ path: string, source: 'env' | 'auto' | 'system' } | null}
 */
export function remotePageBrowser(probe = {}) {
  const found = resolveBrowserExecutable(probe);
  if (found) return found;
  const {
    platform = process.platform,
    pathExists = existsSync,
    browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH,
    localAppData = process.env.LOCALAPPDATA,
    homeDir = homedir(),
  } = probe;
  if (browsersPath) return null;
  const chrome = systemChromeCandidates(platform, localAppData, homeDir).find(p => pathExists(p));
  return chrome ? { path: chrome, source: 'system' } : null;
}

// Where Playwright puts a channel's browser on Linux, for the channels whose
// sandbox helper can be checked. Playwright resolves the channel itself.
const LINUX_CHANNEL_EXECUTABLE = { chrome: '/opt/google/chrome/chrome' };

// Without user namespaces, Chromium starts its sandbox through the setuid
// helper next to its binary: chrome-sandbox, owned by root with the setuid bit.
// Google's packages install it that way; Playwright's bundled build has none.
// The binary is resolved first, so /usr/bin/google-chrome finds the helper in
// /opt/google/chrome. Only asked on Linux, so path.posix, whatever the host.
function hasSetuidSandboxHelper(executablePath, realpath, stat) {
  try {
    const helper = stat(posix.join(posix.dirname(realpath(executablePath)), 'chrome-sandbox'));
    return helper.uid === 0 && (helper.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

// One `unshare` per process: the answer does not change while it runs, and
// apply-scope.mjs asks at import time. Keyed on the spawn seam, so a test that
// passes its own still gets its own answer.
const userNamespaceCache = new WeakMap();
function canCreateUserNamespace(spawn) {
  if (!userNamespaceCache.has(spawn)) {
    const namespace = spawn('unshare', ['--user', '--map-root-user', 'true'], { stdio: 'ignore', timeout: 2000 });
    userNamespaceCache.set(spawn, namespace.status === 0);
  }
  return userNamespaceCache.get(spawn);
}

/**
 * Whether Chromium's sandbox can start for the browser about to launch.
 * CAREER_OPS_BROWSER_SANDBOX=off turns it off on every platform. Otherwise it
 * always can on macOS and Windows. On Linux, Chromium refuses it as root, and
 * it needs either a setuid chrome-sandbox helper next to the browser, or a user
 * namespace, which AppArmor (Ubuntu 23.10+), a kernel setting or a container's
 * seccomp profile can deny. For the bundled Chromium and any browser without
 * that helper, trying to create a namespace covers all of those, where reading
 * each setting would not. A failed launch would stop every browser-backed
 * feature, so when the answer is not a clear yes, the sandbox stays off and
 * doctor warns.
 *
 * @param {{
 *   platform?: string,
 *   getuid?: () => number,
 *   spawn?: typeof spawnSync,
 *   executablePath?: string,
 *   channel?: string,
 *   realpath?: (path: string) => string,
 *   stat?: (path: string) => { uid: number, mode: number },
 *   projectRoot?: string,
 *   processEnv?: Record<string, string | undefined>,
 * }} [probe] - The browser that will launch (executablePath or channel; neither
 *   means the bundled Chromium), plus optional seams for deterministic tests.
 * @returns {{ enabled: true, reason: null } | { enabled: false, reason: 'disabled' | 'root' | 'user-namespaces' }}
 */
export function chromiumSandboxStatus({
  platform = process.platform,
  getuid = process.getuid,
  spawn = spawnSync,
  executablePath,
  channel,
  realpath = realpathSync,
  stat = statSync,
  projectRoot,
  processEnv,
} = {}) {
  if (FALSY.has(String(setting(SANDBOX_ENV, projectRoot, processEnv) ?? '').toLowerCase())) {
    return { enabled: false, reason: 'disabled' };
  }
  if (platform !== 'linux') return { enabled: true, reason: null };
  if (getuid?.() === 0) return { enabled: false, reason: 'root' };
  const browser = executablePath ?? LINUX_CHANNEL_EXECUTABLE[channel];
  if (browser && hasSetuidSandboxHelper(browser, realpath, stat)) return { enabled: true, reason: null };
  return canCreateUserNamespace(spawn) ? { enabled: true, reason: null } : { enabled: false, reason: 'user-namespaces' };
}

/**
 * Playwright launch options for a page this project does not control: the
 * sandbox wherever it can start, and the browser remotePageBrowser() picks. A
 * caller's own executablePath, channel or chromiumSandbox is kept.
 *
 * With `localContentOnly`, for the user's own files: only the explicit settings
 * apply, and when nothing resolves the options come back unchanged.
 *
 * @template {Record<string, any>} T
 * @param {T} [base] - e.g. { headless: true }
 * @param {{ platform?: string, pathExists?: (path: string) => boolean, projectRoot?: string, processEnv?: Record<string, string | undefined>, browsersPath?: string, localAppData?: string, homeDir?: string, getuid?: () => number, spawn?: typeof spawnSync, realpath?: (path: string) => string, stat?: (path: string) => { uid: number, mode: number }, localContentOnly?: boolean }} [probe]
 * @returns {T | (T & { executablePath: string })}
 */
export function browserLaunchOptions(base = /** @type {any} */ ({}), probe = {}) {
  const callerPicked = Boolean(base?.executablePath || base?.channel);
  if (probe.localContentOnly) {
    const found = callerPicked ? null : resolveBrowserExecutable(probe);
    return found ? { ...base, executablePath: found.path } : base;
  }
  const found = callerPicked ? null : remotePageBrowser(probe);
  const options = found ? { ...base, executablePath: found.path } : base;
  // Asked about the browser that will launch: Google Chrome's setuid helper
  // can start the sandbox where the bundled Chromium cannot.
  const sandbox = Object.hasOwn(options ?? {}, 'chromiumSandbox')
    ? {}
    : { chromiumSandbox: chromiumSandboxStatus({ ...probe, executablePath: options?.executablePath, channel: options?.channel }).enabled };
  return { ...sandbox, ...options };
}

/** Test-only: drop the cached .env parse so a test can vary the data root. */
export function __resetBrowserLaunchCacheForTest() {
  __envFileCache = new Map();
}
