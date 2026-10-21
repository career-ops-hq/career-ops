// tests/verify-pipeline-jd-archive.test.mjs — Check 17 (JD archive coverage,
// #4525) end to end, through the real verify-pipeline.mjs process.
//
// check-jd-archive.mjs already existed as a standalone command with its own
// severity split (hard `missing-jd-archive` vs. soft `jd-archive-review-due`),
// but nothing in the day-to-day health check (verify-pipeline.mjs) ever
// called it — a missing JD archive only ever surfaced if a user remembered to
// run check-jd-archive.mjs on its own. This asserts the check actually runs
// as part of `node verify-pipeline.mjs`, with the same severity split as
// check-jd-archive.mjs's own CLI (missing = error/exit 1, review-due = warning
// only), through the real process rather than calling the imported function
// directly — the finding has to actually reach the user's terminal.
//
// CAREER_OPS_REPORTS / CAREER_OPS_JDS mirror the existing test convention
// (tests/verify-pipeline-check15.test.mjs); CAREER_OPS_ROOT stays the
// checkout so STATES_FILE resolves.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline — Check 17 surfaces check-jd-archive.mjs findings');

function fixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'co-vp-jd-'));
  const reports = join(tmp, 'reports');
  const jds = join(tmp, 'jds');
  mkdirSync(reports, { recursive: true });
  mkdirSync(jds, { recursive: true });
  return { tmp, reports, jds, tracker: join(tmp, 'applications.md') };
}

function runVp({ tracker, reports, jds }) {
  const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports, CAREER_OPS_JDS: jds };
  try {
    return execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
  } catch (err) {
    return typeof err.stdout === 'string' ? err.stdout : '';
  }
}

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n';

try {
  {
    const f = fixture();
    writeFileSync(f.tracker, `# Applications Tracker\n\n${HEADER}| 1 | 2026-01-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme-2026-01-01.md) | n |\n`, 'utf-8');
    writeFileSync(join(f.reports, '001-acme-2026-01-01.md'), '# Eval\n\n**Score:** 4.0/5\n', 'utf-8');
    const out = runVp(f);
    const flaggedLine = out.split('\n').find(l => l.includes('⚠️') && l.includes('001-acme-2026-01-01.md'));
    if (flaggedLine) {
      pass('a live-status application (Applied) with no archived JD and no capture reports as a jd-archive-review-due warning');
    } else {
      fail(`expected a jd-archive-review-due warning (⚠️ + filename on the same line), got:\n${out.split('\n').filter(l => /jd|archive/i.test(l)).join('\n')}`);
    }
    rmSync(f.tmp, { recursive: true, force: true });
  }

  {
    const f = fixture();
    writeFileSync(f.tracker, `# Applications Tracker\n\n${HEADER}| 2 | 2026-01-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | [2](reports/002-acme-2026-01-01.md) | n |\n`, 'utf-8');
    writeFileSync(join(f.reports, '002-acme-2026-01-01.md'), '# Eval\n\n## Job Description (archived verbatim)\n\nWe are looking for a Senior Backend Engineer to join our platform team and own the checkout service end to end.\n\n## Machine Summary\n', 'utf-8');
    const out = runVp(f);
    if (/have an archived JD or a resolvable jds\/ capture/.test(out) && !/002-acme/.test(out)) {
      pass('a report with an embedded JD section reports no finding');
    } else {
      fail(`expected a clean pass, got:\n${out.split('\n').filter(l => /jd|archive/i.test(l)).join('\n')}`);
    }
    rmSync(f.tmp, { recursive: true, force: true });
  }

  {
    const f = fixture();
    writeFileSync(f.tracker, `# Applications Tracker\n\n${HEADER}| 3 | 2026-01-01 | Acme | Backend Engineer | 4.0/5 | Rejected | ❌ | [3](reports/003-acme-2026-01-01.md) | n |\n`, 'utf-8');
    writeFileSync(join(f.reports, '003-acme-2026-01-01.md'), '# Eval\n\n**Score:** 4.0/5\n', 'utf-8');
    const out = runVp(f);
    if (!/003-acme/.test(out)) {
      pass('a terminal-status row (Rejected) with no JD archive is not reported at all — zero retroactive risk');
    } else {
      fail(`a terminal row should not be flagged at all, got:\n${out.split('\n').filter(l => /jd|archive|003/i.test(l)).join('\n')}`);
    }
    rmSync(f.tmp, { recursive: true, force: true });
  }

  {
    const f = fixture();
    writeFileSync(f.tracker, '# Applications Tracker\n\n' + HEADER, 'utf-8');
    const out = runVp(f);
    if (/No reports yet — nothing to check for JD archives/.test(out)) {
      pass('an empty tracker/reports dir reports the no-reports-yet message, not an error');
    } else {
      fail(`expected the no-reports-yet message, got:\n${out.split('\n').filter(l => /jd|archive/i.test(l)).join('\n')}`);
    }
    rmSync(f.tmp, { recursive: true, force: true });
  }
} catch (err) {
  fail(`verify-pipeline Check 17 tests could not run: ${err.message}`);
}
