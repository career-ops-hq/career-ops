// tests/doctor-chromium-launch-error.test.mjs — doctor names why Chromium failed
// to launch instead of always saying "not installed".
//
// Only a missing binary is fixed by `npx playwright install chromium`; a binary
// that is present but cannot start (missing system libraries, a host that
// blocks the process) needs different advice, and the install command is a
// no-op there because the browser is already downloaded.
//
// The classifier is tested on the message shapes Playwright throws. doctor
// itself is driven with PLAYWRIGHT_BROWSERS_PATH pointing at a stub browser, so
// no real Chromium is launched.
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { isDeepStrictEqual } from 'util';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { classifyChromiumLaunchError } from '../lib/chromium-launch-error.mjs';

console.log('\ndoctor.mjs — Chromium launch errors');

const DOCTOR = join(ROOT, 'doctor.mjs');
const NIXOS = existsSync('/etc/NIXOS');
// install-deps is apt-only on Linux, so doctor prescribes it only where apt is
// the package manager; elsewhere on Linux it names the distro's own.
const APT_ONLY_ELSEWHERE = process.platform === 'linux'
  && !(() => { try { return /^(?:ID|ID_LIKE)=.*\b(?:debian|ubuntu)\b/m.test(readFileSync('/etc/os-release', 'utf-8')); } catch { return false; } })();

function expectCause(name, message, expected) {
  const got = classifyChromiumLaunchError(new Error(message));
  if (isDeepStrictEqual(got, expected)) pass(name);
  else fail(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

// --- the classifier, on the shapes Playwright throws ---------------------------

expectCause(
  'a missing binary is classified as not installed',
  "browserType.launch: Executable doesn't exist at /pw/chromium_headless_shell-1/chrome-headless-shell\n╔══╗\n║ npx playwright install ║",
  { kind: 'missing-executable', path: '/pw/chromium_headless_shell-1/chrome-headless-shell' },
);

expectCause(
  'a loader error in the browser logs is classified as missing libraries',
  [
    'browserType.launch: Target page, context or browser has been closed',
    'Browser logs:',
    '',
    '<launching> /pw/chrome-headless-shell --disable-extensions --no-sandbox',
    '<launched> pid=7',
    '[pid=7][err] chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory',
    'Call log:',
    '  - [pid=7] <process did exit: exitCode=127, signal=null>',
  ].join('\n'),
  { kind: 'missing-libraries', libraries: ['libnss3.so'] },
);

expectCause(
  "Playwright's Linux host-dependency box is classified as missing libraries, listing each one",
  [
    'browserType.launch: ',
    '╔══════════════════════════════════════════════════════╗',
    '║ Host system is missing dependencies to run browsers. ║',
    '║ Missing libraries:                                   ║',
    '║     libgbm.so.1                                      ║',
    '║     libasound.so.2                                   ║',
    '╚══════════════════════════════════════════════════════╝',
  ].join('\n'),
  { kind: 'missing-libraries', libraries: ['libgbm.so.1', 'libasound.so.2'] },
);

expectCause(
  "Playwright's Windows host-dependency message is classified as missing libraries, listing each DLL",
  [
    'browserType.launch: Host system is missing dependencies!',
    '',
    'Some of the Media Foundation files cannot be found on the system. If you are',
    'on Windows Server try fixing this by running the following command in PowerShell',
    'as Administrator:',
    '',
    '    Install-WindowsFeature Server-Media-Foundation',
    '',
    'Full list of missing libraries:',
    '    mf.dll',
    '    mfplat.dll',
  ].join('\n'),
  { kind: 'missing-libraries', libraries: ['mf.dll', 'mfplat.dll'] },
);

{
  const cause = classifyChromiumLaunchError(new Error([
    'browserType.launch: Target page, context or browser has been closed',
    'Browser logs:',
    '<launching> /pw/chrome-headless-shell --no-sandbox',
    '<launched> pid=9',
    '[pid=9][err] [1021/101010.000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!',
    'Call log:',
  ].join('\n')));
  if (cause.kind === 'launch-failed' && /No usable sandbox!/.test(cause.detail) && !/--no-sandbox/.test(cause.detail)) {
    pass('any other failure keeps the browser stderr line, not the launch command line');
  } else {
    fail(`any other failure should keep the browser stderr line: got ${JSON.stringify(cause)}`);
  }
}

expectCause(
  'a failure without browser logs falls back to the first line of the message',
  'browserType.launch: Timeout 180000ms exceeded.\nCall log:\n  - <launching>',
  { kind: 'launch-failed', detail: 'Timeout 180000ms exceeded.' },
);

// --- doctor end to end, against a stub browser ---------------------------------

// The headless-shell path Playwright launches under a given browsers dir, read
// from the "Executable doesn't exist" error it throws while that dir is empty.
function headlessShellPath(browsersDir) {
  const probe = spawnSync(NODE, ['--input-type=module', '-e', `
    const { chromium } = await import('playwright');
    try { (await chromium.launch({ headless: true })).close(); } catch (e) { process.stdout.write(e.message); }
  `], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir } });
  return probe.stdout.match(/Executable doesn't exist at (\S+)/)?.[1] ?? null;
}

// The two lines doctor prints for the check: the verdict and its fix.
function doctorChromiumLines(browsersDir) {
  const target = mkdtempSync(join(tmpdir(), 'co-doctor-chromium-target-'));
  try {
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: {} }));
    const run = spawnSync(NODE, [DOCTOR, '--target', target], {
      cwd: target,
      encoding: 'utf-8',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
    });
    const lines = (run.stdout || '').split('\n');
    const i = lines.findIndex((line) => /Playwright chromium/.test(line));
    return i === -1 ? '' : lines.slice(i, i + 2).join('\n');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
}

// Runs doctor against a stub browser that prints stderrLine and exits 127, the
// way a Chromium that cannot start does. Returns null if the stub could not be
// placed.
function doctorWithStubBrowser(stderrLine) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-chromium-'));
  try {
    const exe = headlessShellPath(dir);
    if (!exe) return null;
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, `#!/bin/sh\necho ${JSON.stringify(stderrLine)} >&2\nexit 127\n`);
    chmodSync(exe, 0o755);
    return doctorChromiumLines(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-chromium-empty-'));
  try {
    const out = doctorChromiumLines(dir);
    if (/✗ Playwright chromium not installed/.test(out) && (NIXOS || /npx playwright install chromium/.test(out))) {
      pass('doctor: no browser binary still reports not installed with the install command');
    } else {
      fail(`doctor: no browser binary should report not installed with the install command, got:\n${out}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A shell-script stub cannot stand in for the browser on Windows.
if (process.platform === 'win32') {
  pass('doctor stub-browser cases skipped on Windows (a shell-script stub cannot stand in for the browser)');
} else {
  {
    const out = doctorWithStubBrowser('chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory');
    const fixOk = NIXOS
      || (APT_ONLY_ELSEWHERE ? /distribution's package manager/.test(out ?? '') : /npx playwright install-deps chromium/.test(out ?? ''));
    if (out === null) {
      fail('doctor: could not learn the headless-shell path Playwright launches');
    } else if (/✗ Playwright chromium is installed but cannot start: .*libnss3\.so/.test(out)
      && !/not installed/.test(out) && !/npx playwright install chromium/.test(out) && fixOk) {
      pass('doctor: a binary that cannot load its libraries is not reported as not installed, and gets the dependency fix');
    } else {
      fail(`doctor: a binary that cannot load its libraries was misdiagnosed:\n${out}`);
    }
  }

  {
    const out = doctorWithStubBrowser('[1021/101010.000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!');
    if (out === null) {
      fail('doctor: could not learn the headless-shell path Playwright launches');
    } else if (/✗ Playwright chromium is installed but failed to launch: .*No usable sandbox!/.test(out)
      && !/not installed/.test(out) && !/npx playwright install/.test(out)) {
      pass('doctor: any other launch failure shows the browser error and no install command');
    } else {
      fail(`doctor: any other launch failure was misdiagnosed:\n${out}`);
    }
  }
}
