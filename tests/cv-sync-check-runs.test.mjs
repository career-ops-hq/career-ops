// tests/cv-sync-check-runs.test.mjs — regression coverage for cv-sync-check.mjs starting up.
//
// Why this exists: cv-sync-check.mjs referenced an undefined `projectRoot`, so it
// crashed with a ReferenceError before running a single check. test-all.mjs asserts
// `expectExit: 1` for this script ("fails without cv.md (normal in repo)"), and an
// uncaught ReferenceError ALSO exits 1 — so the crash was indistinguishable from the
// expected missing-cv.md failure and CI stayed green. Exit code alone cannot cover
// this script; assert on the output instead.

import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\ncv-sync-check.mjs — starts up and reports instead of crashing');

const work = mkdtempSync(join(tmpdir(), 'cops-cvsync-'));
try {
  // Empty data root: no cv.md, no config/profile.yml. The script is EXPECTED to
  // exit 1 here — that is a clean, reported failure, not a crash.
  const res = spawnSync(NODE, [join(ROOT, 'cv-sync-check.mjs')], {
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: work },
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';

  if (/ReferenceError/.test(stderr)) {
    fail(`cv-sync-check.mjs crashed with a ReferenceError: ${stderr.split('\n').find(l => l.includes('ReferenceError'))}`);
  } else {
    pass('no ReferenceError on startup');
  }

  if (stdout.includes('=== career-ops sync check ===')) {
    pass('emits its own report header (proof it ran, not just exited)');
  } else {
    fail(`expected the sync-check header in stdout, got: ${JSON.stringify(stdout.slice(0, 200))}`);
  }

  if (/cv\.md not found/.test(stdout)) {
    pass('reports the missing cv.md as a structured error');
  } else {
    fail(`expected a missing-cv.md error in stdout, got: ${JSON.stringify(stdout.slice(0, 200))}`);
  }

  // Guard the whole file, not just the three lines that were broken: any future
  // undefined identifier at module scope surfaces here as a non-1 exit or a trace.
  if (res.status === 1) {
    pass('exits 1 for the expected reason (missing user files), not from a throw');
  } else {
    fail(`expected exit 1, got ${res.status}${stderr ? ` — stderr: ${stderr.slice(0, 200)}` : ''}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
