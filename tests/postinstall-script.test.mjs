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

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

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
