/**
 * updater-dependency-install.test.mjs — the updater's npm step, on apply and on rollback.
 *
 * Three properties:
 *
 *   1. A failed `npm install` is reported as a failure, with npm's own reason.
 *      apply() printed "npm install skipped (may need manual run)" and then
 *      "Update complete", and `--silent` had already thrown npm's error away.
 *   2. The install does only the install. package.json's postinstall downloads
 *      Chromium unless PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set, and npm audits
 *      unless told not to; both had to fit inside NPM_INSTALL_TIMEOUT_MS. The
 *      updater installs the browser itself right after, under
 *      PLAYWRIGHT_INSTALL_TIMEOUT_MS.
 *   3. rollback() reinstalls. It restores package.json from the backup branch,
 *      and node_modules kept whatever the update had installed.
 *
 * 1 and 2 drive the exported helpers through their exec seam. 3 runs the real
 * rollback CLI in a throwaway repository with `npm` and `npx` shadowed on PATH
 * (a POSIX script and a .cmd, as in postinstall-script.test.mjs), and checks
 * which package.json npm saw. The apply() side runs end to end in
 * `upgrade-tests.mjs --failed-install`.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NPM_INSTALL_TIMEOUT_MS,
  PLAYWRIGHT_INSTALL_TIMEOUT_MS,
  UPDATE_APPLIED_INSTALL_FAILED_EXIT,
  installDependencies,
  refreshDependencies,
} from '../update-system.mjs';
import { fail, makeUpdaterRepo, pass, rmSync } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const updaterSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');
// The updater reads its system-layer list from here (#5554); rollback refuses without it.
const manifestSource = readFileSync(join(ROOT, 'lib', 'update-manifest.mjs'), 'utf8');

function check(condition, passMessage, failMessage) {
  if (condition) pass(passMessage);
  else fail(failMessage);
}

/** An exec double: records each call, and fails the commands `failures` names. */
function fakeExec(failures = {}) {
  const calls = [];
  const exec = (command, options) => {
    calls.push({ command, options });
    for (const [prefix, error] of Object.entries(failures)) {
      if (command.startsWith(prefix)) throw error;
    }
    return '';
  };
  return { exec, calls };
}

function commandFailure(stderr) {
  const err = new Error('Command failed: npm install --no-audit --no-fund --loglevel=error');
  err.status = 1;
  err.stderr = stderr;
  return err;
}

console.log('\n🧪 Testing the updater dependency install (apply + rollback)...');

// ── 1. installDependencies: command, budget, browser skip ──
{
  const { exec, calls } = fakeExec();
  const result = installDependencies({ exec, root: '/fixture' });
  const [call] = calls;
  check(
    result.ok === true && calls.length === 1,
    'a successful npm install returns ok',
    `unexpected result ${JSON.stringify(result)} after ${calls.length} call(s)`,
  );
  check(
    call?.command.startsWith('npm install') && !call.command.includes('--silent')
      && call.command.includes('--no-audit'),
    'npm install keeps its error output and skips the registry audit',
    `npm install command was ${JSON.stringify(call?.command)}`,
  );
  check(
    call?.options.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1',
    "npm install skips the postinstall's Chromium download",
    `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD was ${JSON.stringify(call?.options.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD)}`,
  );
  check(
    call?.options.timeout === NPM_INSTALL_TIMEOUT_MS && call?.options.cwd === '/fixture',
    'npm install runs in the install root under NPM_INSTALL_TIMEOUT_MS',
    `npm install options were ${JSON.stringify({ cwd: call?.options.cwd, timeout: call?.options.timeout })}`,
  );
}

// ── 2. installDependencies: failures carry a reason ──
{
  const { exec } = fakeExec({
    'npm install': commandFailure('\nnpm error code ENOTFOUND\nnpm error network request failed\n'),
  });
  const result = installDependencies({ exec, root: '/fixture' });
  check(
    result.ok === false && result.reason === 'npm error code ENOTFOUND',
    "a failed npm install reports npm's first error line",
    `failed install returned ${JSON.stringify(result)}`,
  );

  const timedOut = Object.assign(new Error('spawnSync /bin/sh ETIMEDOUT'), { code: 'ETIMEDOUT', signal: 'SIGTERM' });
  const timeoutResult = installDependencies({ exec: fakeExec({ 'npm install': timedOut }).exec, root: '/fixture' });
  check(
    timeoutResult.ok === false
      && timeoutResult.reason.includes(`timed out after ${Math.round(NPM_INSTALL_TIMEOUT_MS / 1000)}s`)
      && timeoutResult.reason.includes('CAREER_OPS_NPM_INSTALL_TIMEOUT_MS'),
    'a timed-out npm install says so and names the variable that raises the budget',
    `timed-out install returned ${JSON.stringify(timeoutResult)}`,
  );

  const silent = installDependencies({ exec: fakeExec({ 'npm install': commandFailure('') }).exec, root: '/fixture' });
  check(
    silent.ok === false && silent.reason.startsWith('Command failed'),
    'a failure with no stderr still carries a reason',
    `stderr-less failure returned ${JSON.stringify(silent)}`,
  );
}

// ── 3. refreshDependencies: browser after npm, and only after a working npm ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-deps-refresh-'));
  try {
    const none = fakeExec();
    check(
      refreshDependencies({ exec: none.exec, root: dir }).ok === true && none.calls.length === 0,
      'without a package.json there is nothing to install, and nothing runs',
      `ran ${JSON.stringify(none.calls.map((c) => c.command))} with no package.json`,
    );

    writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}\n');
    const ok = fakeExec();
    const okResult = refreshDependencies({ exec: ok.exec, root: dir });
    check(
      okResult.ok === true
        && ok.calls.length === 2
        && ok.calls[0].command.startsWith('npm install')
        && ok.calls[1].command === 'npx playwright install chromium'
        && ok.calls[1].options.timeout === PLAYWRIGHT_INSTALL_TIMEOUT_MS,
      'the browser is installed after npm, under its own budget',
      `refresh ran ${JSON.stringify(ok.calls.map((c) => [c.command, c.options.timeout]))}`,
    );

    const npmFails = fakeExec({ 'npm install': commandFailure('npm error code E404\n') });
    const failed = refreshDependencies({ exec: npmFails.exec, root: dir });
    check(
      failed.ok === false && failed.reason === 'npm error code E404' && npmFails.calls.length === 1,
      'a failed npm install is returned to the caller, and the browser step is skipped',
      `refresh after a failed npm install returned ${JSON.stringify(failed)} after ${npmFails.calls.length} call(s)`,
    );

    const browserFails = fakeExec({ npx: new Error('download failed') });
    check(
      refreshDependencies({ exec: browserFails.exec, root: dir }).ok === true,
      'a failed browser install does not fail the dependency step',
      'a failed browser install was reported as a failed npm install',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 4. apply() withholds "Update complete" over a failed install ──
{
  const applyStart = updaterSource.indexOf('\nasync function apply()');
  const applyEnd = updaterSource.indexOf('\n// ── DEPENDENCIES', applyStart);
  const applyBody = updaterSource.slice(applyStart, applyEnd);
  const refresh = applyBody.indexOf('refreshDependencies()');
  const guard = applyBody.indexOf('if (!dependencies.ok)');
  const complete = applyBody.indexOf('Update complete:');
  check(
    applyStart > 0 && refresh > 0 && guard > refresh && complete > guard
      && /if \(!dependencies\.ok\) \{[\s\S]*?process\.exitCode = UPDATE_APPLIED_INSTALL_FAILED_EXIT;\s*return;/.test(applyBody),
    'apply() checks the install result and exits with its own code before printing "Update complete"',
    'apply() no longer guards "Update complete" with the npm install result',
  );

  // The parent of the re-exec sees that code as "applied", not as a failure:
  // no "self-reexec failed", and no restore over the committed updater files.
  const parentCatch = applyBody.match(/\} catch \(err\) \{\s*([\s\S]*?)const timedOut = isTimeoutLikeError\(err\);/);
  check(
    UPDATE_APPLIED_INSTALL_FAILED_EXIT !== 0 && UPDATE_APPLIED_INSTALL_FAILED_EXIT !== 1
      && Boolean(parentCatch)
      && /if \(err\?\.status === UPDATE_APPLIED_INSTALL_FAILED_EXIT\) \{\s*process\.exitCode = UPDATE_APPLIED_INSTALL_FAILED_EXIT;\s*return;\s*\}/.test(parentCatch[1]),
    'the re-exec parent passes the applied-but-not-installed exit through before any restore',
    'the re-exec parent no longer recognizes the applied-but-not-installed exit code',
  );
}

// ── 5. Real rollback CLI reinstalls against the restored package.json ──

/** `npm` and `npx` stand-ins. npm copies the package.json it was run against. */
function writeStubs(stubDir, { npmFails }) {
  mkdirSync(stubDir, { recursive: true });
  const saw = join(stubDir, 'npm-saw-package.json');
  const skip = join(stubDir, 'npm-skip-env');
  const npxRan = join(stubDir, 'npx-ran');
  writeFileSync(join(stubDir, 'npm'), [
    '#!/bin/sh',
    `cp package.json "${saw}"`,
    `printf '%s' "$PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD" > "${skip}"`,
    ...(npmFails ? ['echo "npm error code ENOTFOUND" >&2', 'exit 1'] : []),
    '',
  ].join('\n'));
  writeFileSync(join(stubDir, 'npm.cmd'), [
    `@copy /y package.json "${saw}" >nul`,
    // Redirection first: `echo 1> file` is cmd's "redirect handle 1", so the
    // value would never reach the file.
    `@> "${skip}" echo %PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD%`,
    ...(npmFails ? ['@echo npm error code ENOTFOUND 1>&2', '@exit /b 1'] : []),
    '',
  ].join('\r\n'));
  writeFileSync(join(stubDir, 'npx'), `#!/bin/sh\necho ran > "${npxRan}"\n`);
  writeFileSync(join(stubDir, 'npx.cmd'), `@echo ran> "${npxRan}"\r\n`);
  chmodSync(join(stubDir, 'npm'), 0o755);
  chmodSync(join(stubDir, 'npx'), 0o755);
  return { saw, skip, npxRan };
}

function runRollback(dir, stubDir) {
  const env = { ...process.env, CAREER_OPS_GIT_TIMEOUT_MS: '10000' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = `${stubDir}${delimiter}${env[pathKey] || ''}`;
  const result = spawnSync(process.execPath, ['update-system.mjs', 'rollback'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env,
  });
  return { ...result, output: `${result.stdout || ''}\n${result.stderr || ''}` };
}

const BACKUP_PACKAGE = '{\n  "name": "fixture",\n  "dependencies": { "js-yaml": "^4.1.1" }\n}\n';
const TARGET_PACKAGE = '{\n  "name": "fixture",\n  "dependencies": { "js-yaml": "^5.3.0" }\n}\n';

/** Backup commit, then an "update" that changes package.json, as apply() leaves it. */
function seedRepo(prefix) {
  const fixture = makeUpdaterRepo({ prefix });
  const { dir, g } = fixture;
  writeFileSync(join(dir, 'update-system.mjs'), updaterSource);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'update-manifest.mjs'), manifestSource);
  writeFileSync(join(dir, 'package.json'), BACKUP_PACKAGE);
  g('add', '-A');
  g('commit', '-qm', 'backup state');
  g('branch', 'backup-pre-update-1.0.0-20260101T000000Z');
  writeFileSync(join(dir, 'package.json'), TARGET_PACKAGE);
  g('add', '-A');
  g('commit', '-qm', 'chore: auto-update system files to v1.1.0');
  return fixture;
}

const readOrNull = (path) => {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
};

{
  const { dir } = seedRepo('co-deps-rollback-ok-');
  const stubDir = join(dir, '.git', 'co-stubs');
  try {
    const { saw, skip, npxRan } = writeStubs(stubDir, { npmFails: false });
    const result = runRollback(dir, stubDir);
    check(
      result.status === 0 && result.output.includes('Rollback complete'),
      'rollback with a working npm exits 0 and reports completion',
      `rollback exited ${result.status}: ${result.output.slice(-600)}`,
    );
    check(
      readOrNull(saw) === BACKUP_PACKAGE,
      'rollback runs npm install against the restored package.json',
      `npm saw ${JSON.stringify(readOrNull(saw))}, expected the backup's package.json`,
    );
    check(
      (readOrNull(skip) || '').trim() === '1' && existsSync(npxRan),
      'rollback skips the postinstall download and installs the browser itself',
      `skip env ${JSON.stringify(readOrNull(skip))}, npx ran: ${existsSync(npxRan)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { dir, g } = seedRepo('co-deps-rollback-fail-');
  const stubDir = join(dir, '.git', 'co-stubs');
  try {
    writeStubs(stubDir, { npmFails: true });
    const result = runRollback(dir, stubDir);
    check(
      result.status === 1
        && result.output.includes('Rollback incomplete')
        && result.output.includes('npm error code ENOTFOUND')
        && result.output.includes('Run `npm install`')
        && !result.output.includes('Rollback complete'),
      'rollback with a failing npm exits 1, gives npm\'s reason and the command to run',
      `rollback exited ${result.status}: ${result.output.slice(-600)}`,
    );
    check(
      readOrNull(join(dir, 'package.json')) === BACKUP_PACKAGE
        && g('log', '-1', '--format=%s').startsWith('chore: rollback system files from backup-pre-update-1.0.0'),
      'a failed reinstall does not undo the restored and committed files',
      `package.json ${JSON.stringify(readOrNull(join(dir, 'package.json')))}, HEAD ${g('log', '-1', '--format=%s')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
