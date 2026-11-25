/**
 * updater-dashboard-rebuild.test.mjs — when apply() rebuilds the compiled
 * dashboard, and what it names the binary.
 *
 * Two gaps this pins shut:
 *
 *   - A Go dependency bump changes only dashboard/go.mod and dashboard/go.sum.
 *     The rebuild trigger looked for `.go` files, so an install with a built
 *     binary kept the old dependency code through every such update.
 *   - `go build -o career-dashboard .` writes exactly that filename. On Windows
 *     the binary is career-dashboard.exe (build-dashboard.mjs), so the rebuild
 *     wrote a second, extension-less file and left the .exe stale, while the
 *     updater printed "dashboard binary rebuilt".
 */

import { dashboardBinaryName, dashboardBuildInputsChanged } from '../update-system.mjs';
import { fail, pass } from './helpers.mjs';

function check(condition, passMessage, failMessage) {
  if (condition) pass(passMessage);
  else fail(failMessage);
}

console.log('\n🧪 Testing the updater dashboard rebuild trigger and binary name...');

for (const changed of [
  ['dashboard/go.sum'],
  ['dashboard/go.mod', 'dashboard/go.sum'],
  ['dashboard/main.go'],
  ['dashboard/internal/data/career.go'],
  ['', 'docs/SCRIPTS.md', 'dashboard/go.mod'],
]) {
  check(
    dashboardBuildInputsChanged(changed),
    `a change to ${changed.filter(Boolean).join(' + ')} triggers a rebuild`,
    `a change to ${changed.filter(Boolean).join(' + ')} did not trigger a rebuild`,
  );
}

for (const changed of [
  [],
  [''],
  ['dashboard/README.md'],
  ['go.sum', 'internal/go.mod'],
  ['dashboard/internal/testdata/go.sum.txt'],
  ['web/go.mod'],
]) {
  check(
    !dashboardBuildInputsChanged(changed),
    `a change to ${JSON.stringify(changed)} does not trigger a rebuild`,
    `a change to ${JSON.stringify(changed)} triggered a rebuild`,
  );
}

check(
  dashboardBinaryName('win32') === 'career-dashboard.exe',
  'the Windows rebuild writes career-dashboard.exe',
  `the Windows rebuild writes ${dashboardBinaryName('win32')}`,
);
for (const platform of ['darwin', 'linux', 'freebsd']) {
  check(
    dashboardBinaryName(platform) === 'career-dashboard',
    `the ${platform} rebuild writes career-dashboard`,
    `the ${platform} rebuild writes ${dashboardBinaryName(platform)}`,
  );
}
