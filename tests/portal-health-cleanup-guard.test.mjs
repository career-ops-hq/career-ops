// tests/portal-health-cleanup-guard.test.mjs — applyScriptDirGuard() must never
// clobber content another process wrote into the script-dir data file during a
// test run. Unlike a blind backup/restore, it removes only the marker row the
// test's own child process may have written (regression case), leaving any
// concurrent legitimate row intact, and deletes the file only if the marker
// row was the sole content (allowing for a leading header) and the file did
// not exist before the run. Its read-modify-write shares portal-health-lock.mjs's
// cross-process lock with appendPortalHealth() (scan.mjs), so the two can
// never interleave.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { applyScriptDirGuard } from './portal-health-guard.mjs';
import { acquirePortalHealthLock, LockTimeoutError } from '../portal-health-lock.mjs';

console.log('\napplyScriptDirGuard() — safe cleanup of a possibly-regressed script-dir write');

const dir = mkdtempSync(join(tmpdir(), 'career-ops-guard-'));
const marker = 'Portal Health CWD Fixture TEST-MARKER';
const HEADER = 'timestamp\tcompany\tstatus\n';

try {
  // 1. Marker absent (the expected/fixed case) -> file left completely untouched.
  {
    const p = join(dir, 'untouched.tsv');
    const original = HEADER + '2026-01-01\tRealCo\treachable\n';
    writeFileSync(p, original, 'utf-8');
    await applyScriptDirGuard({ path: p, existedBefore: true, marker });
    if (readFileSync(p, 'utf-8') === original) pass('marker absent: file left byte-for-byte untouched');
    else fail('marker absent: file was modified when it should not have been');
  }

  // 2. Marker present alongside a concurrent legitimate row -> only the marker
  //    row is stripped; the concurrent row survives (this is the CodeRabbit finding).
  {
    const p = join(dir, 'concurrent.tsv');
    const concurrentRow = '2026-01-01\tConcurrentRealCo\treachable\n';
    writeFileSync(p, HEADER + concurrentRow + '2026-01-01\t' + marker + '\treachable\n', 'utf-8');
    await applyScriptDirGuard({ path: p, existedBefore: true, marker, headerOnlyContent: HEADER });
    const after = readFileSync(p, 'utf-8');
    if (after.includes('ConcurrentRealCo') && !after.includes(marker)) {
      pass('marker present: only the marker row removed, concurrent row preserved');
    } else {
      fail(`marker present: expected concurrent row preserved and marker stripped, got: ${JSON.stringify(after)}`);
    }
  }

  // 3. File did not exist before, and marker was the only content -> the file
  //    is removed entirely rather than left as an empty artifact.
  {
    const p = join(dir, 'new-file.tsv');
    writeFileSync(p, '2026-01-01\t' + marker + '\treachable\n', 'utf-8');
    await applyScriptDirGuard({ path: p, existedBefore: false, marker });
    if (!existsSync(p)) pass('marker-only new file: removed entirely rather than left empty');
    else fail('marker-only new file: expected file to be removed, it still exists');
  }

  // 4. appendPortalHealth() always writes the header line before the marker
  //    row, so a plain "is the remainder empty?" check never fires in the real
  //    regression it exists to clean up. Header-only remainder must also be
  //    treated as empty and the new file removed entirely.
  {
    const p = join(dir, 'header-only.tsv');
    writeFileSync(p, HEADER + '2026-01-01\t' + marker + '\treachable\n', 'utf-8');
    await applyScriptDirGuard({ path: p, existedBefore: false, marker, headerOnlyContent: HEADER });
    if (!existsSync(p)) pass('header-only remainder on a new file: removed entirely, not left as a bare header');
    else fail(`header-only remainder: expected file removed, it still exists with: ${JSON.stringify(readFileSync(p, 'utf-8'))}`);
  }

  // 5. The guard's read-modify-write must share the SAME lock appendPortalHealth()
  //    takes (portal-health-lock.mjs, keyed by the file path) — proven here by
  //    holding that exact lock manually and confirming the guard genuinely
  //    blocks on it (times out) rather than racing straight through to a
  //    read/write. The env overrides keep this assertion in the milliseconds
  //    range instead of waiting out the lock's real default timeout.
  {
    const p = join(dir, 'locked.tsv');
    writeFileSync(p, HEADER + '2026-01-01\t' + marker + '\treachable\n', 'utf-8');
    const prevTimeout = process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_TIMEOUT_MS;
    const prevRetry = process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_RETRY_MS;
    process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_TIMEOUT_MS = '200';
    process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_RETRY_MS = '20';
    const held = await acquirePortalHealthLock(p);
    try {
      await applyScriptDirGuard({ path: p, existedBefore: false, marker });
      fail('lock sharing: applyScriptDirGuard() proceeded while another holder had the lock — no shared exclusion');
    } catch (e) {
      if (e instanceof LockTimeoutError) pass('lock sharing: applyScriptDirGuard() correctly blocked on a lock held elsewhere (LockTimeoutError)');
      else fail(`lock sharing: expected LockTimeoutError, got: ${e?.constructor?.name}: ${e?.message}`);
    } finally {
      held.release();
      if (prevTimeout === undefined) delete process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_TIMEOUT_MS;
      else process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_TIMEOUT_MS = prevTimeout;
      if (prevRetry === undefined) delete process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_RETRY_MS;
      else process.env.CAREER_OPS_PORTAL_HEALTH_LOCK_RETRY_MS = prevRetry;
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
