// tests/browser-launch.test.mjs — which Chromium-family browser gets launched.
//
// lib/browser-launch.mjs is the one resolver every launch site shares. It keeps
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH as the explicit override (the variable the
// PDF path already used) and adds two things: the data-root .env is read, since
// most commands never load it, and an installed browser can be auto-detected
// when CAREER_OPS_BROWSER_AUTODETECT is on.
//
// The load-bearing assertion is the negative control: with nothing configured
// the launch options come back unchanged, so the bundled Chromium is launched
// exactly as before and no existing user sees a behavior change.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  resolveBrowserExecutable,
  browserLaunchOptions,
  __resetBrowserLaunchCacheForTest,
} from '../lib/browser-launch.mjs';

console.log('\nlib/browser-launch.mjs — browser executable resolution');

const EXE = 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH';
const AUTO = 'CAREER_OPS_BROWSER_AUTODETECT';
const SAVED = Object.fromEntries(
  [EXE, AUTO, 'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR'].map(k => [k, process.env[k]]),
);

// Each case starts from a known environment: the data root points at a temp dir
// so no stray .env is read, and absent keys are deleted rather than emptied
// (an empty shell value means "off" and would not fall through to .env).
function setEnv({ exe, auto, root }) {
  if (exe === undefined) delete process.env[EXE]; else process.env[EXE] = exe;
  if (auto === undefined) delete process.env[AUTO]; else process.env[AUTO] = auto;
  process.env.CAREER_OPS_ROOT = root;
  delete process.env.CAREER_OPS_DATA_DIR;
  __resetBrowserLaunchCacheForTest();
}

function restoreEnv() {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  __resetBrowserLaunchCacheForTest();
}

const emptyRoot = mkdtempSync(join(tmpdir(), 'co-browser-empty-'));
const envRoot = mkdtempSync(join(tmpdir(), 'co-browser-env-'));
writeFileSync(join(envRoot, '.env'), `${EXE}=/opt/fromdotenv/browser\n`);

try {
  // Negative control: nothing configured -> bundled Chromium, options untouched.
  setEnv({ root: emptyRoot });
  const none = resolveBrowserExecutable();
  const noneOpts = browserLaunchOptions({ headless: true });
  if (none === null && noneOpts.headless === true && !('executablePath' in noneOpts)) {
    pass('nothing configured -> no executablePath, options unchanged (bundled Chromium)');
  } else {
    fail(`expected an unchanged default: ${JSON.stringify(none)} / ${JSON.stringify(noneOpts)}`);
  }

  // The explicit override wins and is injected verbatim.
  setEnv({ exe: '/opt/custom/brave', root: emptyRoot });
  const envWins = resolveBrowserExecutable();
  const envOpts = browserLaunchOptions({ headless: true });
  if (envWins?.path === '/opt/custom/brave' && envWins.source === 'env'
      && envOpts.executablePath === '/opt/custom/brave' && envOpts.headless === true) {
    pass(`${EXE} is honored and injected, source=env`);
  } else {
    fail(`explicit override should win: ${JSON.stringify(envWins)} / ${JSON.stringify(envOpts)}`);
  }

  // Whitespace is not a path: it reads as unset, matching the ?.trim() || ''
  // behavior the shared-painter socket key relied on.
  setEnv({ exe: '   ', root: emptyRoot });
  if (resolveBrowserExecutable() === null) pass('a whitespace-only override reads as unset');
  else fail(`whitespace override should be unset: ${JSON.stringify(resolveBrowserExecutable())}`);

  // The data-root .env supplies it when the shell does not — the reason this
  // resolver exists rather than a bare process.env read.
  setEnv({ root: envRoot });
  const fromFile = resolveBrowserExecutable();
  if (fromFile?.path === '/opt/fromdotenv/browser' && fromFile.source === 'env') {
    pass(`the data-root .env supplies ${EXE}`);
  } else {
    fail(`.env override should be read: ${JSON.stringify(fromFile)}`);
  }

  // A shell variable that is present but empty switches off what .env sets.
  process.env[EXE] = '';
  process.env.CAREER_OPS_ROOT = envRoot;
  __resetBrowserLaunchCacheForTest();
  if (resolveBrowserExecutable() === null) {
    pass('an empty shell variable overrides and disables the .env value');
  } else {
    fail(`empty shell var should disable .env: ${JSON.stringify(resolveBrowserExecutable())}`);
  }

  // A caller that already picked a browser is never second-guessed.
  setEnv({ exe: '/opt/custom/brave', root: emptyRoot });
  const preset = browserLaunchOptions({ headless: true, executablePath: '/already/set' });
  const channel = browserLaunchOptions({ headless: true, channel: 'chrome' });
  if (preset.executablePath === '/already/set'
      && channel.channel === 'chrome' && !('executablePath' in channel)) {
    pass('an explicit executablePath/channel on the caller is left untouched');
  } else {
    fail(`caller choice overridden: ${JSON.stringify(preset)} / ${JSON.stringify(channel)}`);
  }

  // Auto-detect is opt-in: off by default even when a browser is installed.
  setEnv({ root: emptyRoot });
  if (resolveBrowserExecutable() === null) {
    pass('auto-detect stays off unless explicitly enabled');
  } else {
    fail(`auto-detect must be opt-in: ${JSON.stringify(resolveBrowserExecutable())}`);
  }

  // When on, it either finds a real installed browser or nothing — it never
  // invents a path, and never reports itself as the explicit override.
  setEnv({ auto: 'true', root: emptyRoot });
  const auto = resolveBrowserExecutable();
  if (auto === null || auto.source === 'auto') {
    pass('auto-detect yields source=auto or null, never a fabricated path');
  } else {
    fail(`unexpected auto-detect result: ${JSON.stringify(auto)}`);
  }
} finally {
  restoreEnv();
  rmSync(emptyRoot, { recursive: true, force: true });
  rmSync(envRoot, { recursive: true, force: true });
}
