// tests/verify-pipeline-control-bytes.test.mjs — Check 16 (#3892), end to end
// through the real verify-pipeline.mjs process.
//
// Stripping at the cell sanitizer stops NEW control bytes entering the tracker;
// it can do nothing about the ones already written. This is the other half:
// the only place a byte that is invisible in every rendered view of the table
// becomes visible again. Asserted through the process because the exit code is
// the part CI and cron wrappers read — a finding that printed but exited 0
// would be indistinguishable from a clean tracker.
//
// Only the tracker and reports dir point at a fixture, the same way
// tests/verify-pipeline-check15.test.mjs arranges them, so no user data is read.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline — Check 16 fails on a control byte already written into a tracker cell');

const HEADER = '# Applications Tracker\n\n'
  + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
  + '|---|------|---------|------|-------|--------|-----|--------|-------|\n';
const CLEAN_ROW = '| 1 | 2026-09-05 | Acme Co | Senior Engineer | 4.5/5 | Applied | ❌ | — | seeded |\n';
// U+0001 in the Role cell — what a title pasted out of a rendered posting looks
// like on disk. Every markdown renderer shows "Senior Engineer".
const DIRTY_ROW = '| 1 | 2026-09-05 | Acme Co | Senior\x01 Engineer | 4.5/5 | Applied | ❌ | — | seeded |\n';

const tmp = mkdtempSync(join(tmpdir(), 'co-vp-ctrl-'));
try {
  const reports = join(tmp, 'reports');
  mkdirSync(reports, { recursive: true });
  const tracker = join(tmp, 'applications.md');

  // verify-pipeline exits 1 on errors, so the output has to be read off the
  // thrown error too — otherwise the non-zero exit hides the assertion.
  const runVp = () => {
    const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports, CAREER_OPS_PORTALS: join(tmp, 'no-portals.yml') };
    try {
      const stdout = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
      return { stdout, status: 0 };
    } catch (err) {
      return { stdout: typeof err.stdout === 'string' ? err.stdout : '', status: err.status ?? 1 };
    }
  };

  writeFileSync(tracker, HEADER + DIRTY_ROW, 'utf-8');
  const dirty = runVp();
  const flagged = /control character/i.test(dirty.stdout);
  if (flagged && dirty.status === 1) {
    pass('a control byte in a tracker cell is reported as an error and exits 1');
  } else {
    fail(`control byte not caught: flagged=${flagged} exit=${dirty.status}\n${dirty.stdout.split('\n').filter((l) => /control|Pipeline Health/i.test(l)).join('\n')}`);
  }
  if (/U\+0001/.test(dirty.stdout)) {
    pass('the finding names the code point, so the byte can be found in the file');
  } else {
    fail('the finding did not name the offending code point');
  }

  writeFileSync(tracker, HEADER + CLEAN_ROW, 'utf-8');
  const clean = runVp();
  // Exit 0 as well as the success line: the line alone would still print if the
  // byte were reported by some other check, which is the false negative this
  // control exists to rule out.
  if (/No control characters in tracker cells/.test(clean.stdout) && !/control character\(s\)/.test(clean.stdout) && clean.status === 0) {
    pass('control: the same row without the byte reports clean, raises nothing and exits 0');
  } else {
    fail(`control drifted: exit=${clean.status}\n${clean.stdout.split('\n').filter((l) => /control|Pipeline Health/i.test(l)).join('\n')}`);
  }
} catch (err) {
  fail(`verify-pipeline Check 16 tests could not run: ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
