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
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  resolveBrowserExecutable,
  browserLaunchOptions,
  __resetBrowserLaunchCacheForTest,
} from '../lib/browser-launch.mjs';

console.log('\nlib/browser-launch.mjs — browser executable resolution');

// generate-pdf keeps its existing launchChromium export, but its executable
// choice must come from the shared resolver rather than a second env-only path.
const generatePdfSource = readFileSync(new URL('../generate-pdf.mjs', import.meta.url), 'utf8');
if (/import\s*\{[^}]*\bbrowserLaunchOptions\b[^}]*\}\s*from\s*['"]\.\/lib\/browser-launch\.mjs['"]/.test(generatePdfSource)
    && /export\s+async\s+function\s+launchChromium\b/.test(generatePdfSource)
    && /const\s*\{\s*projectRoot\s*,\s*\.\.\.launchOptions\s*\}\s*=\s*options/.test(generatePdfSource)
    && /chromium\.launch\(browserLaunchOptions\(launchOptions,\s*\{\s*projectRoot\s*\}\)\)/.test(generatePdfSource)
    && /projectRoot:\s*opts\.workspaceRoot\s*\|\|\s*getCareerOpsRoot\(\)/.test(generatePdfSource)) {
  pass('generate-pdf delegates launch options and defaults browser settings to the data root');
} else {
  fail('generate-pdf launchChromium is not backed by the data-root-aware shared browser resolver');
}

const scanSource = readFileSync(new URL('../scan.mjs', import.meta.url), 'utf8');
if (/const\s+BROWSER_PROCESS_ENV\s*=\s*\{\s*\.\.\.process\.env\s*\}/.test(scanSource)
    && /browserLaunchOptions\([\s\S]*?\{\s*projectRoot:\s*DATA_ROOT,\s*processEnv:\s*BROWSER_PROCESS_ENV\s*\}/.test(scanSource)) {
  pass('scan verification preserves shell-vs-data-root browser setting origin');
} else {
  fail('scan verification does not preserve the origin of data-root browser settings');
}

// Several suites run a copied generate-pdf.mjs in an isolated directory. A
// new static import must travel with every one of those fixtures; otherwise the
// whole cross-platform CI matrix fails at module load time. Discover the
// fixtures from their copy operations so a newly added sandbox joins this
// contract automatically instead of relying on another hand-maintained list.
const fixtureWithoutBrowserHelper = [];
for (const entry of readdirSync(new URL('.', import.meta.url), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
  const source = readFileSync(new URL(entry.name, import.meta.url), 'utf8');
  const copiesGeneratePdfDirectly = /copyFileSync\s*\(\s*join\(ROOT,\s*['"]generate-pdf\.mjs['"]/.test(source);
  const copiesGeneratePdfFromLiteralList = /for\s*\(\s*const\s+(?:f|file)\s+of\s+\[[\s\S]{0,1200}['"]generate-pdf\.mjs['"][\s\S]{0,1200}\]\s*\)\s*\{?[\s\S]{0,200}copyFileSync\(join\(ROOT,\s*(?:f|file)\)/.test(source);
  const copiesGeneratePdfFromClosure = /['"]generate-pdf\.mjs['"]\s*:\s*\[[\s\S]{0,3000}copyFileSync\(join\(ROOT,\s*file\)/.test(source);
  if ((copiesGeneratePdfDirectly || copiesGeneratePdfFromLiteralList || copiesGeneratePdfFromClosure)
      && !source.includes('browser-launch.mjs')) {
    fixtureWithoutBrowserHelper.push(entry.name);
  }
}
if (fixtureWithoutBrowserHelper.length === 0) {
  pass('every isolated generate-pdf fixture carries lib/browser-launch.mjs');
} else {
  fail(`isolated generate-pdf fixtures missing lib/browser-launch.mjs: ${fixtureWithoutBrowserHelper.join(', ')}`);
}

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
const relativeEnvRoot = mkdtempSync(join(tmpdir(), 'co-browser-relative-env-'));
// No trailing newline: Node 22.13's parser needs the resolver to normalize one
// or it retains the inline comment as part of the executable path.
writeFileSync(join(envRoot, '.env'), `${EXE}=/opt/fromdotenv/browser # browser override`);
writeFileSync(join(relativeEnvRoot, '.env'), `${EXE}=browsers/brave\n`);

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
  // resolver exists rather than a bare process.env read. Inline comments are
  // stripped by Node's built-in .env parser.
  setEnv({ root: envRoot });
  const fromFile = resolveBrowserExecutable();
  if (fromFile?.path === '/opt/fromdotenv/browser' && fromFile.source === 'env') {
    pass(`the data-root .env supplies ${EXE} and strips inline comments`);
  } else {
    fail(`.env override should be read: ${JSON.stringify(fromFile)}`);
  }

  // Commands such as doctor --target diagnose a checkout other than the
  // process-wide data root. Their explicit root must control both the resolver
  // result and the launch options, without mutating CAREER_OPS_ROOT.
  setEnv({ root: emptyRoot });
  const fromTarget = resolveBrowserExecutable({ projectRoot: envRoot });
  const targetOpts = browserLaunchOptions({ headless: true }, { projectRoot: envRoot });
  if (fromTarget?.path === '/opt/fromdotenv/browser'
      && targetOpts.executablePath === '/opt/fromdotenv/browser') {
    pass('an explicit project root supplies the browser setting for targeted checks');
  } else {
    fail(`explicit project root ignored: ${JSON.stringify(fromTarget)} / ${JSON.stringify(targetOpts)}`);
  }

  // A relative path in .env belongs to the data root, not to whichever cwd
  // launched the command. A shell export keeps the historical cwd-relative
  // behavior because it is already explicit process configuration.
  setEnv({ root: relativeEnvRoot });
  const relativeFromFile = resolveBrowserExecutable();
  setEnv({ exe: 'browsers/brave', root: relativeEnvRoot });
  const relativeFromShell = resolveBrowserExecutable();
  if (relativeFromFile?.path === join(relativeEnvRoot, 'browsers', 'brave')
      && relativeFromShell?.path === 'browsers/brave') {
    pass('relative .env paths resolve from the data root while shell paths stay unchanged');
  } else {
    fail(`relative executable path resolution is wrong: ${JSON.stringify(relativeFromFile)} / ${JSON.stringify(relativeFromShell)}`);
  }

  // scan.mjs loads DATA_ROOT/.env through dotenv before it needs a browser.
  // Passing the pre-dotenv shell snapshot makes the resolver re-read the file,
  // retaining the path's origin instead of misclassifying it as a shell value.
  setEnv({ exe: 'browsers/brave', root: relativeEnvRoot });
  const fromDotenvLoadedProcess = resolveBrowserExecutable({
    projectRoot: relativeEnvRoot,
    processEnv: {},
  });
  if (fromDotenvLoadedProcess?.path === join(relativeEnvRoot, 'browsers', 'brave')) {
    pass('a dotenv-loaded relative path retains the data-root .env as its origin');
  } else {
    fail(`dotenv-loaded path lost its file origin: ${JSON.stringify(fromDotenvLoadedProcess)}`);
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

  // Auto-detection's success path is deterministic: simulate a machine where
  // only Brave exists instead of depending on the CI host's installed apps.
  setEnv({ auto: 'true', root: emptyRoot });
  const bravePath = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const auto = resolveBrowserExecutable({
    platform: 'darwin',
    pathExists: candidate => candidate === bravePath,
  });
  if (auto?.path === bravePath && auto.source === 'auto') {
    pass('enabled auto-detect finds a synthetic Brave install with source=auto');
  } else {
    fail(`auto-detect should find synthetic Brave: ${JSON.stringify(auto)}`);
  }

  const absent = resolveBrowserExecutable({
    platform: 'darwin',
    pathExists: () => false,
  });
  if (absent === null) {
    pass('enabled auto-detect returns null when no candidate exists');
  } else {
    fail(`auto-detect should return null without candidates: ${JSON.stringify(absent)}`);
  }
} finally {
  restoreEnv();
  rmSync(emptyRoot, { recursive: true, force: true });
  rmSync(envRoot, { recursive: true, force: true });
  rmSync(relativeEnvRoot, { recursive: true, force: true });
}
