// tests/verify-pipeline-via-skip.test.mjs — Check 11's cross-channel duplicate
// warning must be satisfiable by correct behaviour (#3978).
//
// The check exists to catch double-submission risk: the same company+role
// reached through two agencies. The canonical way to RESOLVE that collision is
// the one states.yml provides — apply through one channel, mark the other SKIP
// ("Doesn't fit, don't apply"). Counting the SKIP row as a submission channel
// warned forever about the risk the user had just avoided, and no "resolve by
// hand" action could clear it: the only exits were ignoring the check
// permanently or falsifying Via/Company to silence it.
//
// So this suite pins BOTH directions through the real process, because a fix
// that merely silences the warning is indistinguishable from one that breaks
// the check:
//   1. resolved   — one Applied + one SKIP via a different agency → no warning
//   2. control    — flip the SKIP to Applied → the warning is still raised
//   3. alias     — a non-literal skip alias (`Monitor`) resolves the same way,
//                   proving the exemption goes through a real normalizer and
//                   is not a bare `=== 'skip'` on the raw cell
//   4. discarded  — deliberately still a channel: "Discarded by candidate or
//                   offer closed" can follow a real application
//
// Only the tracker and reports dir are fixtures; CAREER_OPS_ROOT stays the
// checkout so the other checks resolve, exactly as verify-pipeline-check15 does.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline — Check 11 does not count a SKIP row as a submission channel (#3978)');

const tmp = mkdtempSync(join(tmpdir(), 'co-vp-via-skip-'));
try {
  const reports = join(tmp, 'reports');
  mkdirSync(reports, { recursive: true });
  const tracker = join(tmp, 'applications.md');

  const HEADER =
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|-----|------|-------|--------|-----|--------|-------|\n';
  const row = (num, via, status) =>
    `| ${num} | 2026-09-02 | ExampleCorp | ${via} | Senior Test Automation Engineer | 3.8/5 | ${status} | ❌ | — | — |\n`;

  // Every fixture below is warning-clean for the other checks, so a healthy run
  // exits 0 — Check 11 raises warnings, and warnings alone do not set exit 1.
  //
  // That matters for what this helper must NOT do. Check 11 prints long before
  // verify-pipeline exits, so an unrelated later failure (a broken check, a
  // timeout, a crash) leaves "Via channels consistent" sitting in stdout while
  // the process dies. Returning that stdout regardless of exit status would let
  // assertion 1 pass on a run that never actually proved anything. So the exit
  // status is carried out with the output and asserted before any match: a
  // non-zero exit fails the fixture loudly instead of being read as a result.
  const runVp = (table) => {
    writeFileSync(tracker, table, 'utf-8');
    const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports };
    try {
      const stdout = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
      return { status: 0, stdout, stderr: '' };
    } catch (err) {
      return {
        status: typeof err.status === 'number' ? err.status : 1,
        stdout: typeof err.stdout === 'string' ? err.stdout : '',
        stderr: typeof err.stderr === 'string' ? err.stderr : '',
      };
    }
  };

  // Unwraps a run only when it exited cleanly; otherwise records the failure and
  // hands back '' so the caller's regex simply does not match.
  const outputOf = (label, run) => {
    if (run.status === 0) return run.stdout;
    fail(`${label}: verify-pipeline exited ${run.status}, so its Check 11 output proves nothing
${run.stderr.trim() || run.stdout.trim()}`);
    return '';
  };
  const viaLines = (out) => out.split('\n').filter((l) => /Cross-channel|Via channels/.test(l)).join('\n');

  // 1. The resolved collision: applied through AgencyA, AgencyB marked SKIP.
  const resolved = outputOf('resolved', runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'SKIP')));
  if (!/Cross-channel duplicate/.test(resolved) && /Via channels consistent/.test(resolved)) {
    pass('a correctly resolved collision (one Applied, one SKIP) reports Via channels consistent');
  } else {
    fail(`resolved collision still warns — the check cannot be satisfied by correct behaviour:\n${viaLines(resolved)}`);
  }

  // 2. Control: the real double submission is still caught. Without this, a fix
  //    that deleted the check outright would pass assertion 1.
  const control = outputOf('control', runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'Applied')));
  if (/Cross-channel duplicate/.test(control) && /AgencyA/.test(control) && /AgencyB/.test(control)) {
    pass('control: two Applied rows via different agencies still raise the double-submission warning');
  } else {
    fail(`real double submission was not caught:\n${viaLines(control)}`);
  }

  // 3. A skip alias rather than the literal label. `Monitor` is deliberate: it
  //    is an alias BOTH this check and Check 1 accept, so the run still exits
  //    0 and Check 11's verdict is trustworthy.
  //
  //    The wider aliases states.yml defines for skip — geo_blocker, and the
  //    Turkish uygun değil / uygun_degil — cannot be asserted here, and the
  //    reason is worth recording. normalizeStatus() resolves all of them to
  //    'skip', but verify-pipeline's own Check 1 validates statuses against a
  //    LOCAL alias table carrying none of them, so such a row fails Check 1
  //    with a non-canonical-status ERROR and the process exits 1 long before
  //    Check 11's output means anything. Closing that gap is a separate change
  //    to Check 1's table; asserting it here would only pin a state the
  //    tracker cannot currently reach.
  const alias = outputOf('alias', runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'Monitor')));
  if (!/Cross-channel duplicate/.test(alias)) {
    pass('a skip alias (Monitor) is recognized as never-submitted, not just the literal SKIP');
  } else {
    fail(`skip alias counted as a channel — the exemption is matching the raw cell, not a normalized status:
${viaLines(alias)}`);
  }

  // 4. Discarded stays a channel on purpose: it can follow a real application.
  const discarded = outputOf('discarded', runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'Discarded')));
  if (/Cross-channel duplicate/.test(discarded)) {
    pass('Discarded still counts as a channel (it can follow a real application)');
  } else {
    fail(`Discarded was treated as never-submitted — the exemption is meant to be skip-only:\n${viaLines(discarded)}`);
  }
} catch (err) {
  fail(`verify-pipeline Check 11 SKIP-channel tests could not run: ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
