// tests/portal-health-path.test.mjs — appendPortalHealth()/loadPortalHealth()
// must resolve their default path against process.cwd(), not the directory
// scan.mjs lives in.
//
// Every sibling data path in scan.mjs (SCAN_HISTORY_PATH, PIPELINE_PATH,
// APPLICATIONS_PATH, BLACKLIST_PATH, SCAN_RUNS_PATH) is a bare cwd-relative
// string. PORTAL_HEALTH_PATH used to be the one exception, resolved via
// path.dirname(fileURLToPath(import.meta.url)) -- the script's own directory.
// Any invocation with a sandboxed cwd (a test run, a temp dir, a CI checkout)
// still wrote fixture rows straight into the real data/portal-health.tsv of
// whatever checkout happens to own scan.mjs, polluting real pipeline data with
// test fixtures.
//
// This spawns a real child process with cwd pinned to a temp dir that is NOT
// the directory scan.mjs lives in, then calls appendPortalHealth() with no
// filePath argument -- the exact call scan.mjs's own production code path
// makes. The row must land under the given cwd, and the script's own
// directory must be provably untouched.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — portal-health.tsv resolves against cwd, not script dir');

const scanUrl = JSON.stringify(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const sandboxCwd = mkdtempSync(join(tmpdir(), 'career-ops-portal-health-'));

// The script's own directory is ROOT in this checkout -- the same directory
// the pre-fix bug always resolved to regardless of the cwd it was given.
const scriptDirHealthPath = join(ROOT, 'data', 'portal-health.tsv');
const scriptDirHealthExisted = existsSync(scriptDirHealthPath);
const scriptDirHealthBackup = scriptDirHealthExisted ? readFileSync(scriptDirHealthPath, 'utf-8') : null;

try {
  const marker = 'Portal Health CWD Fixture';
  const script = `
    const mod = await import(${scanUrl});
    mod.appendPortalHealth([{ timestamp: '2026-01-01T00:00:00.000Z', company: ${JSON.stringify(marker)}, status: 'reachable' }]);
  `;

  const res = spawnSync(NODE, ['-e', script], {
    cwd: sandboxCwd,
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (res.error || res.status !== 0) {
    fail(`appendPortalHealth() child process failed: ${res.error?.message || res.stderr}`);
  } else {
    pass('appendPortalHealth() runs cleanly with a sandbox cwd');
  }

  // 1. The row lands under the cwd the process was given, not the script dir.
  const sandboxHealthPath = join(sandboxCwd, 'data', 'portal-health.tsv');
  if (existsSync(sandboxHealthPath) && readFileSync(sandboxHealthPath, 'utf-8').includes(marker)) {
    pass('the fixture row is written under the sandbox cwd');
  } else {
    fail(`expected ${sandboxHealthPath} to contain the fixture row, it does not`);
  }

  // 2. The script's own directory -- the real user-layer data dir in a normal
  //    checkout -- is left completely alone. This is the assertion this test
  //    exists to make: without it, this exact test would silently regress by
  //    resurrecting the bug it was written to catch.
  const scriptDirHealthContentNow = existsSync(scriptDirHealthPath) ? readFileSync(scriptDirHealthPath, 'utf-8') : null;
  if (!scriptDirHealthExisted && scriptDirHealthContentNow === null) {
    pass("the script directory's data/portal-health.tsv was never created");
  } else if (scriptDirHealthExisted && scriptDirHealthContentNow === scriptDirHealthBackup) {
    pass("the pre-existing script directory data/portal-health.tsv is untouched");
  } else {
    fail(`the sandboxed run wrote into the script's own directory (${scriptDirHealthPath}) -- this is the cwd-resolution regression`);
  }
} finally {
  rmSync(sandboxCwd, { recursive: true, force: true });
  // Defensive restore, matching the pattern in tests/scan-no-targets.test.mjs
  // and tests/intake-mutex.test.mjs -- never observed to trigger once the path
  // is fixed, but leaves the tree exactly as found if it somehow still does.
  if (scriptDirHealthExisted) {
    writeFileSync(scriptDirHealthPath, scriptDirHealthBackup, 'utf-8');
  } else if (existsSync(scriptDirHealthPath)) {
    rmSync(scriptDirHealthPath, { force: true });
  }
}
