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
//   1. The caller already set executablePath or channel → left untouched.
//   2. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH — the shell first, then the
//      data-root .env (most commands never load .env, so this module reads it).
//   3. CAREER_OPS_BROWSER_AUTODETECT is truthy → the first installed
//      Brave/Chrome/Edge/Chromium at its standard location for the platform.
//   4. Nothing resolves → the options are returned unchanged, so the bundled
//      Chromium is launched exactly as before.
//
// Auto-detect is opt-in rather than automatic on purpose: a machine with a
// working bundled Chromium must keep using it, and flag-gating keeps the choice
// deterministic instead of varying with whatever else is installed.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

// The data-root .env, parsed once. Only scan.mjs, the evaluators,
// openai-tailor.mjs and openrouter-runner.mjs load a .env, so a setting that
// lives only there would be invisible to every other launch site. Parsed rather
// than applied to process.env (the way doctor.mjs reads it) so a value here can
// never shadow a real shell export of the same name.
let __envFileCache; // undefined = not read yet; object = parsed (possibly {})
function envFile() {
  if (__envFileCache !== undefined) return __envFileCache;
  __envFileCache = {};
  try {
    const text = readFileSync(join(getCareerOpsRoot(), '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'")
          && value[value.length - 1] === value[0]) {
        value = value.slice(1, -1);
      }
      if (key && !(key in __envFileCache)) __envFileCache[key] = value;
    }
  } catch {
    // No .env, or unreadable — an empty cache is the right answer either way.
  }
  return __envFileCache;
}

// A setting from the shell first, then the data-root .env. A variable PRESENT
// in the shell wins even when empty, and an empty shell value reads as "off"
// without falling through to .env — so a shell export can switch off what a
// .env turns on, which is how the test suite neutralises a developer's own
// machine configuration.
function setting(name) {
  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
    const value = process.env[name];
    return value != null && value.trim() !== '' ? value.trim() : null;
  }
  const fromFile = envFile()[name];
  return fromFile != null && fromFile.trim() !== '' ? fromFile.trim() : null;
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
 * @returns {{ path: string, source: 'env' | 'auto' } | null}
 */
export function resolveBrowserExecutable() {
  const explicit = setting(EXECUTABLE_ENV);
  if (explicit) return { path: explicit, source: 'env' };

  if (TRUTHY.has(String(setting(AUTODETECT_ENV) ?? '').toLowerCase())) {
    const candidate = (CANDIDATES[process.platform] || []).find(p => existsSync(p));
    if (candidate) return { path: candidate, source: 'auto' };
  }
  return null;
}

/**
 * Playwright launch options with the resolved `executablePath` merged in.
 *
 * A caller that has already chosen a browser (executablePath or channel set) is
 * returned untouched, and when nothing resolves the options come back
 * unchanged — so the default path stays byte-identical to the bundled Chromium.
 *
 * @template {Record<string, any>} T
 * @param {T} [base] - e.g. { headless: true }
 * @returns {T | (T & { executablePath: string })}
 */
export function browserLaunchOptions(base = /** @type {any} */ ({})) {
  if (base && (base.executablePath || base.channel)) return base;
  const found = resolveBrowserExecutable();
  return found ? { ...base, executablePath: found.path } : base;
}

/**
 * Launch Chromium through the resolved browser.
 *
 * The single entry point every launch site should use: it imports playwright
 * lazily, so this module stays importable (and testable) without the package
 * installed.
 *
 * @param {Record<string, any>} [options]
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchChromium(options = {}) {
  const { chromium } = await import('playwright');
  return chromium.launch(browserLaunchOptions(options));
}

/** Test-only: drop the cached .env parse so a test can vary the data root. */
export function __resetBrowserLaunchCacheForTest() {
  __envFileCache = undefined;
}
