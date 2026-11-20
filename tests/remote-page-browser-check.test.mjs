// tests/remote-page-browser-check.test.mjs — every outcome of doctor's check of
// the browser third-party pages open in: the pass, the two fallback warnings
// (bundled Chromium, sandbox off for each reason) and the launch failures.
//
// Everything goes through probe and launch seams, so no result depends on the
// browsers or the kernel of the machine running the suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRemotePageBrowser } from '../lib/remote-page-browser-check.mjs';
import { SANDBOX_ENV } from '../lib/browser-launch.mjs';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX_CHROME = '/opt/google/chrome/chrome';
const root = mkdtempSync(join(tmpdir(), 'co-remote-page-check-'));
test.after(() => rmSync(root, { recursive: true, force: true }));

// A machine with nothing configured: no shell settings, an empty data root, and
// Playwright's browsers not pinned.
const machine = (extra = {}) => ({ processEnv: {}, projectRoot: root, browsersPath: '', homeDir: '/nonexistent-home', ...extra });
const mac = (chrome = true) => machine({ platform: 'darwin', pathExists: p => chrome && p === MAC_CHROME });
const linux = ({ chrome = false, uid = 1000, namespaces = false, helperMode = 0o100755 } = {}) => machine({
  platform: 'linux',
  getuid: () => uid,
  pathExists: p => chrome && p === LINUX_CHROME,
  spawn: () => ({ status: namespaces ? 0 : 1 }),
  realpath: p => p,
  stat: () => ({ uid: 0, mode: helperMode }),
});

function launcher(error) {
  const calls = [];
  const launch = async (options) => {
    calls.push(options);
    if (error) throw error;
    return { close: async () => {} };
  };
  return { launch, calls };
}

test('system Chrome with the sandbox on passes, after a real launch with both', async () => {
  const { launch, calls } = launcher();
  const results = await checkRemotePageBrowser({ probe: mac(), launch });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executablePath, MAC_CHROME);
  assert.equal(calls[0].chromiumSandbox, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].pass, true);
  assert.match(results[0].label, /system Chrome .*with Chromium's sandbox on/);
});

test('no Google Chrome: a warning that names the bundled Chromium and says to install Chrome', async () => {
  const { launch, calls } = launcher();
  const results = await checkRemotePageBrowser({ probe: mac(false), bundledCheckPassed: true, launch });
  // The PDF check launched the bundled Chromium without the sandbox; this one adds it.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chromiumSandbox, true);
  assert.equal(calls[0].executablePath, undefined);
  assert.deepEqual(results.map(r => Boolean(r.warn)), [true]);
  assert.match(results[0].label, /bundled Chromium.*\(Google Chrome not found\)/);
  assert.equal(results[0].fix, 'Install Google Chrome.');
});

test('PLAYWRIGHT_BROWSERS_PATH: the warning says so, and no launch repeats the failed PDF check', async () => {
  const { launch, calls } = launcher();
  const results = await checkRemotePageBrowser({ probe: { ...mac(), browsersPath: '/ms-playwright' }, bundledCheckPassed: false, launch });
  assert.equal(calls.length, 0);
  assert.match(results[0].label, /PLAYWRIGHT_BROWSERS_PATH is set/);
  assert.match(results[0].fix, /unset PLAYWRIGHT_BROWSERS_PATH/);
});

test('root: the sandbox-off warning says why, and that the Docker image expects it', async () => {
  const { launch } = launcher();
  const results = await checkRemotePageBrowser({ probe: linux({ chrome: true, uid: 0 }), launch });
  const off = results.find(r => /sandbox is off/.test(r.label));
  assert.ok(off?.warn);
  assert.match(off.label, /running as root/);
  assert.match(off.fix, /non-root user/);
  assert.match(off.fix, /Docker image/);
});

test('no user namespaces and no Chrome: install Google Chrome first, the sysctl as the trade-off', async () => {
  const { launch, calls } = launcher();
  const results = await checkRemotePageBrowser({ probe: linux(), bundledCheckPassed: true, launch });
  // Bundled Chromium with the sandbox off is the launch the PDF check made.
  assert.equal(calls.length, 0);
  assert.equal(results.length, 2);
  const off = results[1];
  assert.match(off.label, /user namespace/);
  assert.match(off.fix, /^Install Google Chrome from Google's package/);
  assert.match(off.fix, /apparmor_restrict_unprivileged_userns=0.*every program/);
});

test('no user namespaces, Chrome without a setuid helper: reinstall Chrome, not install it', async () => {
  const { launch } = launcher();
  const results = await checkRemotePageBrowser({ probe: linux({ chrome: true }), launch });
  const off = results.find(r => /sandbox is off/.test(r.label));
  assert.match(off.fix, /^Google Chrome is installed, but its chrome-sandbox helper is not setuid root/);
});

test('Chrome with a setuid helper on a host without user namespaces passes with the sandbox on', async () => {
  const { launch, calls } = launcher();
  const results = await checkRemotePageBrowser({ probe: linux({ chrome: true, helperMode: 0o104755 }), launch });
  assert.equal(calls[0].chromiumSandbox, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].pass, true);
});

test(`${SANDBOX_ENV}=off: a warning that it is off by request`, async () => {
  const { launch, calls } = launcher();
  const results = await checkRemotePageBrowser({ probe: { ...mac(), processEnv: { [SANDBOX_ENV]: 'off' } }, launch });
  assert.equal(calls[0].chromiumSandbox, false);
  const off = results.find(r => /sandbox is off/.test(r.label));
  assert.ok(off?.warn);
  assert.match(off.label, new RegExp(`${SANDBOX_ENV}=off is set`));
  assert.match(off.fix, new RegExp(`^Unset ${SANDBOX_ENV}`));
});

test('a launch Chromium aborts for want of a sandbox names the switch', async () => {
  const err = new Error('browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n'
    + '[pid=3][err] [1117/120000.000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! Update your kernel.');
  const { launch } = launcher(err);
  const results = await checkRemotePageBrowser({ probe: linux({ chrome: true, namespaces: true }), launch });
  assert.equal(results.length, 1);
  assert.equal(results[0].pass, false);
  assert.match(results[0].label, /could not start its sandbox \(No usable sandbox!/);
  assert.match(results[0].fix, new RegExp(`set ${SANDBOX_ENV}=off in your shell or the data-root \\.env`));
});

test('any other launch failure keeps the generic advice, with the switch as a hint while the sandbox is on', async () => {
  const { launch } = launcher(new Error('browserType.launch: Timeout 180000ms exceeded.'));
  const results = await checkRemotePageBrowser({ probe: mac(), launch });
  assert.equal(results[0].pass, false);
  assert.match(results[0].label, /failed to launch: Timeout 180000ms exceeded\./);
  assert.match(results[0].fix, new RegExp(`It tried ${MAC_CHROME.replace(/[.]/g, '\\.')} with Chromium's sandbox on`));
  assert.match(results[0].fix, new RegExp(`${SANDBOX_ENV}=off launches it that way`));
});

test('no playwright package: nothing to add to the PDF check\'s own failure', async () => {
  const { launch } = launcher(Object.assign(new Error('Cannot find package \'playwright\''), { code: 'ERR_MODULE_NOT_FOUND' }));
  assert.deepEqual(await checkRemotePageBrowser({ probe: mac(), launch }), []);
});
