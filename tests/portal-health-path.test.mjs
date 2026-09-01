// tests/portal-health-path.test.mjs — appendPortalHealth()/loadPortalHealth()
// must resolve their default path against DATA_ROOT, not cwd and not the
// directory scan.mjs lives in.
//
// SCAN_HISTORY_PATH / PIPELINE_PATH / APPLICATIONS_PATH already join DATA_ROOT.
// PORTAL_HEALTH_PATH used to be a bare cwd-relative `data/portal-health.tsv`,
// so a run with cwd ≠ DATA_ROOT (CAREER_OPS_DATA_DIR) wrote where stats.mjs
// does not read. Earlier still, it was resolved via import.meta.url — the
// script's own directory — and sandboxed tests polluted the real checkout.
//
// This spawns a real child with CAREER_OPS_DATA_DIR pinned to a temp dir and
// cwd pinned to a *different* temp dir, then calls appendPortalHealth() with
// no filePath argument — the exact call scan.mjs's own production path makes.
// The row must land under DATA_ROOT, not cwd, and the script's own directory
// must be provably untouched.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { randomUUID } from 'crypto';
import { applyScriptDirGuard } from './portal-health-guard.mjs';

console.log('\nscan.mjs — portal-health.tsv resolves against DATA_ROOT, not cwd');

const scanUrl = JSON.stringify(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-portal-health-root-'));
const sandboxCwd = mkdtempSync(join(tmpdir(), 'career-ops-portal-health-cwd-'));

// The script's own directory is ROOT in this checkout -- the same directory
// the pre-fix bug always resolved to regardless of the cwd it was given.
const scriptDirHealthPath = join(ROOT, 'data', 'portal-health.tsv');
const scriptDirHealthExisted = existsSync(scriptDirHealthPath);
const scriptDirHealthBackup = scriptDirHealthExisted ? readFileSync(scriptDirHealthPath, 'utf-8') : null;
// Keep in sync with PORTAL_HEALTH_HEADER in scan.mjs -- passed to the guard so
// a header-only remainder (appendPortalHealth always writes the header before
// the marker row) still counts as empty and the cleanup fully removes a
// script-dir file it created rather than leaving a bare header behind.
const PORTAL_HEALTH_HEADER = 'timestamp\tcompany\tstatus\n';
// Unique per test run so two concurrent CI/test runs can never remove each
// other's fixture row from this shared fallback path.
const marker = 'Portal Health CWD Fixture ' + randomUUID();

try {
  const script = `
    const mod = await import(${scanUrl});
    await mod.appendPortalHealth([{ timestamp: '2026-01-01T00:00:00.000Z', company: ${JSON.stringify(marker)}, status: 'reachable' }]);
  `;

  const childEnv = { ...process.env };
  delete childEnv.CAREER_OPS_ROOT;
  delete childEnv.CAREER_OPS_DATA_DIR;
  childEnv.CAREER_OPS_DATA_DIR = dataRoot;

  const res = spawnSync(NODE, ['--input-type=module', '-e', script], {
    cwd: sandboxCwd,
    env: childEnv,
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (res.error || res.status !== 0) {
    fail(`appendPortalHealth() child process failed: ${res.error?.message || res.stderr}`);
  } else {
    pass('appendPortalHealth() runs cleanly with cwd ≠ CAREER_OPS_DATA_DIR');
  }

  // 1. The row lands under DATA_ROOT, not the sandbox cwd and not the script dir.
  const dataRootHealthPath = join(dataRoot, 'data', 'portal-health.tsv');
  const cwdHealthPath = join(sandboxCwd, 'data', 'portal-health.tsv');
  if (existsSync(dataRootHealthPath) && readFileSync(dataRootHealthPath, 'utf-8').includes(marker)) {
    pass('the fixture row is written under DATA_ROOT');
  } else {
    fail(`expected ${dataRootHealthPath} to contain the fixture row, it does not`);
  }
  if (!existsSync(cwdHealthPath)) {
    pass('the fixture row is not written under the sandbox cwd');
  } else {
    fail(`portal-health leaked to cwd (${cwdHealthPath}) — DATA_ROOT split-brain regression`);
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
  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(sandboxCwd, { recursive: true, force: true });
  // Defensive cleanup, matching the pattern in tests/scan-no-targets.test.mjs
  // and tests/intake-mutex.test.mjs -- never observed to trigger once the path
  // is fixed, but leaves the tree exactly as found if it somehow still does.
  // Uses applyScriptDirGuard() rather than a blind restore-from-backup: a
  // straight write of scriptDirHealthBackup would silently discard any row a
  // concurrent real process (e.g. a scheduled scan) appended to this same
  // live file while the sandboxed child process ran. The guard instead
  // removes only this test's own marker row and leaves everything else alone.
  await applyScriptDirGuard({
    path: scriptDirHealthPath,
    existedBefore: scriptDirHealthExisted,
    marker,
    headerOnlyContent: PORTAL_HEALTH_HEADER,
  });
}
