// tests/postinstall-script.test.mjs — pins package.json's postinstall script
// away from Playwright's --with-deps flag (#4223).
//
// --with-deps shells out to the host's system package manager to install
// Chromium's OS-level libraries. Playwright only ships that logic for
// Debian/Ubuntu; on any other Linux distro (Fedora, Arch, ...) it falls back
// to an apt-get invocation that does not exist there, and `npm install`
// fails with exit code 127 on every non-Debian/Ubuntu machine. The `||`
// retry in the original script does not help: both sides run the identical
// failing command, so it can never recover from a deterministic
// "apt-get: command not found", only from a transient one (a flaky
// Chromium binary download, which the flagless form still guards against).

import { execSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { pass, fail, ROOT, rmSync } from './helpers.mjs';

console.log('\n📦 package.json postinstall — no --with-deps (#4223)');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const postinstall = pkg.scripts?.postinstall ?? '';

if (postinstall) {
  pass('package.json declares a postinstall script');
} else {
  fail('package.json has no postinstall script — update this test if that was removed on purpose');
}

if (!postinstall.includes('--with-deps')) {
  pass('postinstall does not pass --with-deps (installs the Chromium binary only, no host package-manager assumption)');
} else {
  fail(`postinstall still passes --with-deps, which fails on any non-Debian/Ubuntu Linux distro: ${postinstall}`);
}

if (postinstall.includes('playwright install chromium')) {
  pass('postinstall still installs the chromium browser Playwright needs');
} else {
  fail(`postinstall no longer installs chromium: ${postinstall}`);
}

// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is Playwright's own "do not download
// browsers" switch, but an explicit `playwright install` ignores it. The NixOS
// dev shell (flake.nix) sets it and points PLAYWRIGHT_BROWSERS_PATH at the
// read-only Nix store, where the installer cannot take its lock file: it
// retried silently for about 10 minutes per attempt, so `npm install` hung for
// about 20 and then failed. The script must skip the install when the variable
// is truthy, and run it otherwise. `npx` is stubbed, so nothing downloads.
console.log('\n📦 package.json postinstall — honors PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');

const stubDir = mkdtempSync(join(tmpdir(), 'co-postinstall-'));
const marker = join(stubDir, 'npx-ran');
try {
  writeFileSync(join(stubDir, 'npx'), `#!/bin/sh\necho ran > "${marker}"\n`);
  chmodSync(join(stubDir, 'npx'), 0o755);
  writeFileSync(join(stubDir, 'npx.cmd'), `@echo ran> "${marker}"\r\n`);

  const runsInstall = (value) => {
    rmSync(marker, { force: true });
    const env = { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH}` };
    delete env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
    if (value !== undefined) env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = value;
    execSync(postinstall, { cwd: ROOT, env, stdio: 'ignore' });
    return existsSync(marker);
  };

  for (const value of [undefined, '', '0', 'false', 'FALSE']) {
    if (runsInstall(value)) {
      pass(`installs chromium when PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${JSON.stringify(value ?? '(unset)')}`);
    } else {
      fail(`skipped the chromium install when PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${JSON.stringify(value ?? '(unset)')}`);
    }
  }
  for (const value of ['1', 'true']) {
    if (!runsInstall(value)) {
      pass(`skips the install when PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${JSON.stringify(value)}`);
    } else {
      fail(`ran \`playwright install\` although PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${JSON.stringify(value)}`);
    }
  }
} catch (e) {
  fail(`postinstall script failed to run: ${e.message}`);
} finally {
  rmSync(stubDir, { recursive: true, force: true });
}

// Chromium is needed for PDF generation and browser checks, not for the rest
// of career-ops, so a failed download must not fail `npm install`: offline,
// behind a proxy, or with the CDN down, the dependencies are already in place
// and only the browser is missing. The script tries twice, then warns and
// exits 0. Here `npx` is stubbed to fail, so nothing downloads.
console.log('\n📦 package.json postinstall — a failed Chromium download does not fail npm install');

const failDir = mkdtempSync(join(tmpdir(), 'co-postinstall-fail-'));
const attempts = join(failDir, 'npx-attempts');
try {
  writeFileSync(join(failDir, 'npx'), `#!/bin/sh\necho ran >> "${attempts}"\nexit 1\n`);
  chmodSync(join(failDir, 'npx'), 0o755);
  writeFileSync(join(failDir, 'npx.cmd'), `@echo ran>> "${attempts}"\r\n@exit /b 1\r\n`);

  const env = { ...process.env, PATH: `${failDir}${delimiter}${process.env.PATH}` };
  delete env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
  let output = '';
  try {
    output = execSync(`${postinstall} 2>&1`, { cwd: ROOT, env, encoding: 'utf-8' });
    pass('postinstall exits 0 when both Chromium install attempts fail');
  } catch (e) {
    fail(`postinstall exited ${e.status} when the Chromium install failed, which fails npm install: ${postinstall}`);
  }
  const ran = existsSync(attempts) ? readFileSync(attempts, 'utf-8').trim().split(/\r?\n/).length : 0;
  if (ran === 2) {
    pass('postinstall retries the Chromium install once before giving up');
  } else {
    fail(`expected 2 Chromium install attempts, saw ${ran}`);
  }
  if (output.includes('npx playwright install chromium')) {
    pass('postinstall tells the user how to install Chromium later');
  } else {
    fail(`postinstall gave no hint after the failed install; output was: ${JSON.stringify(output)}`);
  }
} finally {
  rmSync(failDir, { recursive: true, force: true });
}
