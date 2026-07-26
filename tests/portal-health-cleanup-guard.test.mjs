// tests/portal-health-cleanup-guard.test.mjs — applyScriptDirGuard() must never
// clobber content another process wrote into the script-dir data file during a
// test run. Unlike a blind backup/restore, it removes only the marker row the
// test's own child process may have written (regression case), leaving any
// concurrent legitimate row intact, and deletes the file only if the marker
// row was the sole content and the file did not exist before the run.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { applyScriptDirGuard } from './portal-health-guard.mjs';

console.log('\napplyScriptDirGuard() — safe cleanup of a possibly-regressed script-dir write');

const dir = mkdtempSync(join(tmpdir(), 'career-ops-guard-'));
const marker = 'Portal Health CWD Fixture TEST-MARKER';

try {
  // 1. Marker absent (the expected/fixed case) -> file left completely untouched.
  {
    const p = join(dir, 'untouched.tsv');
    const original = 'timestamp\tcompany\tstatus\n2026-01-01\tRealCo\treachable\n';
    writeFileSync(p, original, 'utf-8');
    applyScriptDirGuard({ path: p, existedBefore: true, marker });
    if (readFileSync(p, 'utf-8') === original) pass('marker absent: file left byte-for-byte untouched');
    else fail('marker absent: file was modified when it should not have been');
  }

  // 2. Marker present alongside a concurrent legitimate row -> only the marker
  //    row is stripped; the concurrent row survives (this is the CodeRabbit finding).
  {
    const p = join(dir, 'concurrent.tsv');
    const concurrentRow = '2026-01-01\tConcurrentRealCo\treachable\n';
    writeFileSync(p, concurrentRow + '2026-01-01\t' + marker + '\treachable\n', 'utf-8');
    applyScriptDirGuard({ path: p, existedBefore: true, marker });
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
    applyScriptDirGuard({ path: p, existedBefore: false, marker });
    if (!existsSync(p)) pass('marker-only new file: removed entirely rather than left empty');
    else fail('marker-only new file: expected file to be removed, it still exists');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
