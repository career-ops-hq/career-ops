// lib/remote-page-browser-check.mjs — doctor's check of the browser third-party
// pages get.
//
// Job boards, ATS pages and application forms open in the browser
// browserLaunchOptions() picks, with Chromium's sandbox wherever it can start.
// A browser bug on such a page matters more the older the build and the weaker
// the sandbox, so both fallbacks (Playwright's bundled Chromium, the sandbox
// off) warn instead of passing quietly, and a launch that fails names the way
// out. Kept out of doctor.mjs, which runs on import, so each outcome has a test.

import { browserLaunchOptions, chromiumSandboxStatus, remotePageBrowser, SANDBOX_ENV } from './browser-launch.mjs';
import { classifyChromiumLaunchError } from './chromium-launch-error.mjs';

const BROWSER_SOURCE_LABEL = { env: 'configured browser', auto: 'auto-detected browser', system: 'system Chrome' };

const INSTALL_CHROME = 'Install Google Chrome from Google\'s package: its setuid chrome-sandbox helper starts the sandbox'
  + ' without user namespaces, and career-ops uses it unless another browser is configured.';
const REINSTALL_CHROME = 'Google Chrome is installed, but its chrome-sandbox helper is not setuid root, so the sandbox'
  + ' cannot fall back to it. Reinstall Google Chrome from Google\'s package, which sets that up.';
const SYSCTL = 'Allowing unprivileged user namespaces also works (on Ubuntu:'
  + ' sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0), but it turns that hardening off for every program on the machine.';

/**
 * Why the sandbox is off, and what turns it back on.
 *
 * @param {'disabled' | 'root' | 'user-namespaces'} reason
 * @param {{ source: string } | null} choice - The browser the pages open in.
 * @returns {{ why: string, fix: string }}
 */
function sandboxOff(reason, choice) {
  if (reason === 'disabled') {
    return {
      why: `${SANDBOX_ENV}=off is set`,
      fix: `Unset ${SANDBOX_ENV} once the browser can start with the sandbox (on Linux: Google Chrome from Google's package, or unprivileged user namespaces allowed).`,
    };
  }
  if (reason === 'root') {
    return {
      why: 'career-ops is running as root, where Chromium refuses it',
      fix: 'Run career-ops as a non-root user. In the provided Docker image this warning is expected, since it runs as root: there the container is the boundary around the browser.',
    };
  }
  return {
    why: 'this user cannot create the user namespace it needs (AppArmor on Ubuntu 23.10+, a kernel setting, or a container), and the browser has no setuid chrome-sandbox helper to use instead',
    fix: `${choice?.source === 'system' ? REINSTALL_CHROME : INSTALL_CHROME} ${SYSCTL}`,
  };
}

async function launchWithPlaywright(options) {
  const { chromium } = await import('playwright');
  return chromium.launch(options);
}

/**
 * Doctor results for the browser third-party pages open in.
 *
 * @param {{
 *   probe?: Parameters<typeof browserLaunchOptions>[1],
 *   bundledCheckPassed?: boolean,
 *   launch?: (options: Record<string, any>) => Promise<{ close: () => Promise<void> }>,
 * }} [opts] - `probe` goes to browser-launch.mjs (projectRoot, processEnv, and
 *   its test seams). `bundledCheckPassed` says the PDF check already launched
 *   the same browser without the sandbox. `launch` is a test seam.
 * @returns {Promise<Array<{ pass?: boolean, warn?: boolean, label: string, fix?: string }>>}
 */
export async function checkRemotePageBrowser({ probe = {}, bundledCheckPassed = false, launch = launchWithPlaywright } = {}) {
  const choice = remotePageBrowser(probe);
  const sandbox = chromiumSandboxStatus({ ...probe, executablePath: choice?.path });
  // Without the system Chrome or the sandbox, this is the launch the PDF check
  // already made. A failure there says what to fix, so it is not repeated here.
  if (choice?.source === 'system' || (bundledCheckPassed && sandbox.enabled)) {
    let browser;
    try {
      browser = await launch(browserLaunchOptions({ headless: true }, probe));
    } catch (err) {
      // No playwright package: the PDF check already says to install it.
      if (err?.code === 'ERR_MODULE_NOT_FOUND') return [];
      const cause = classifyChromiumLaunchError(err);
      const tried = `It tried ${choice?.path ?? 'the bundled Chromium'}${sandbox.enabled ? ' with Chromium\'s sandbox on' : ''}.`;
      if (cause.kind === 'sandbox-unavailable') {
        return [{
          pass: false,
          label: `The browser for third-party pages failed to launch: Chromium could not start its sandbox (${cause.detail})`,
          fix: `${tried} To launch it without the sandbox, as Playwright does by default, set ${SANDBOX_ENV}=off in your shell or the data-root .env.`,
        }];
      }
      return [{
        pass: false,
        label: `The browser for third-party pages failed to launch: ${cause.detail ?? cause.kind}`,
        fix: `${tried} If doctor runs inside a sandbox or container, check that it allows a browser process to start.`
          + (sandbox.enabled ? ` If it starts only without the sandbox, ${SANDBOX_ENV}=off launches it that way.` : ''),
      }];
    } finally {
      try { await browser?.close(); } catch { /* ignore */ }
    }
  }
  const results = [];
  if (!choice) {
    const explicit = Boolean(probe.browsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH);
    results.push({
      warn: true,
      label: `Third-party pages open in Playwright's bundled Chromium, which misses Chrome's security fixes between Playwright releases${explicit ? ' (PLAYWRIGHT_BROWSERS_PATH is set)' : ' (Google Chrome not found)'}`,
      fix: explicit ? 'To use an installed Google Chrome instead, unset PLAYWRIGHT_BROWSERS_PATH.' : 'Install Google Chrome.',
    });
  }
  if (!sandbox.enabled) {
    const off = sandboxOff(sandbox.reason, choice);
    results.push({ warn: true, label: `Chromium's sandbox is off for third-party pages: ${off.why}`, fix: off.fix });
  }
  if (results.length === 0) {
    results.push({ pass: true, label: `Third-party pages open in the ${BROWSER_SOURCE_LABEL[choice.source]} (${choice.path}), with Chromium's sandbox on` });
  }
  return results;
}
