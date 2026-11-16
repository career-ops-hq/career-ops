// tests/portal-health-path.test.mjs — appendPortalHealth() must resolve its
// default path against the CONFIGURED DATA ROOT, and must never write into the
// checkout that owns scan.mjs.
//
// The second half is what this test has always been for. It was written when
// PORTAL_HEALTH_PATH resolved via path.dirname(fileURLToPath(import.meta.url)) --
// the script's own directory -- so any invocation with a sandboxed cwd (a test
// run, a temp dir, a CI checkout) wrote fixture rows straight into the real
// data/portal-health.tsv of whatever checkout happened to own scan.mjs. That
// guarantee is unchanged and still asserted below.
//
// What changed is the mechanism (#3510). Resolving from the cwd fixed the
// pollution but left scan.mjs with two rules for where user data lives: this
// path followed the shell, while SCAN_HISTORY_PATH, PIPELINE_PATH and
// APPLICATIONS_PATH had already followed DATA_ROOT since the data-root feature
// landed in 02daaf1 -- and stats.mjs:39, the only reader of this file, reads it
// at join(DATA_ROOT, 'data', 'portal-health.tsv'). A user with a data root
// configured got rows written somewhere their own reader never looked.
//
// So isolation now comes from CAREER_OPS_ROOT, the mechanism the rest of the
// suite already uses, rather than from the cwd. This spawns a real child with a
// data root pinned to a temp dir AND a cwd pinned to a second temp dir, so the
// two are provably distinguishable, then calls appendPortalHealth() with no
// filePath argument -- the exact call scan.mjs's own production path makes. The
// row must land under the data root, not the cwd, and the script's own directory
// must be provably untouched.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { randomUUID } from 'crypto';
import { applyScriptDirGuard } from './portal-health-guard.mjs';

console.log('\nscan.mjs — portal-health.tsv resolves against the data root, never the checkout');

const scanUrl = JSON.stringify(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const sandboxCwd = mkdtempSync(join(tmpdir(), 'career-ops-portal-health-cwd-'));
const sandboxRoot = mkdtempSync(join(tmpdir(), 'career-ops-portal-health-root-'));

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

  const res = spawnSync(NODE, ['--input-type=module', '-e', script], {
    // cwd and data root deliberately differ: if the two were the same directory
    // this test could not tell an anchored path from a cwd-relative one, which
    // is exactly how the resolution drifted in the first place.
    cwd: sandboxCwd,
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: sandboxRoot, CAREER_OPS_DATA_DIR: '' },
  });

  if (res.error || res.status !== 0) {
    fail(`appendPortalHealth() child process failed: ${res.error?.message || res.stderr}`);
  } else {
    pass('appendPortalHealth() runs cleanly with a sandbox cwd');
  }

  // 1. The row lands under the configured data root, not the script dir.
  const rootHealthPath = join(sandboxRoot, 'data', 'portal-health.tsv');
  if (existsSync(rootHealthPath) && readFileSync(rootHealthPath, 'utf-8').includes(marker)) {
    pass('the fixture row is written under the configured data root');
  } else {
    fail(`expected ${rootHealthPath} to contain the fixture row, it does not`);
  }

  // 1b. And NOT under the cwd, which is a different directory here. stats.mjs
  //     reads this file at the data root; a row under the cwd is a row its only
  //     reader will never see.
  const cwdHealthPath = join(sandboxCwd, 'data', 'portal-health.tsv');
  if (!existsSync(cwdHealthPath)) {
    pass('nothing was written under the cwd, which no reader looks at');
  } else {
    fail(`appendPortalHealth() wrote to the cwd at ${cwdHealthPath} instead of the data root (#3510)`);
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
  rmSync(sandboxRoot, { recursive: true, force: true });
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
