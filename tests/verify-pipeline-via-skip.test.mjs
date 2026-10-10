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
//   3. localized  — a states.yml skip alias the file's local ALIASES table
//                   never carried (`uygun değil`) resolves the same way, which
//                   is the reason status is read through the shared
//                   normalizeStatus() rather than a table copied in here
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

  // verify-pipeline exits 1 only on errors; a warning-only run exits 0. Read
  // stdout off the error object too so a non-zero exit cannot hide the report.
  const runVp = (table) => {
    writeFileSync(tracker, table, 'utf-8');
    const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports };
    try {
      return execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
    } catch (err) {
      return typeof err.stdout === 'string' ? err.stdout : '';
    }
  };
  const viaLines = (out) => out.split('\n').filter((l) => /Cross-channel|Via channels/.test(l)).join('\n');

  // 1. The resolved collision: applied through AgencyA, AgencyB marked SKIP.
  const resolved = runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'SKIP'));
  if (!/Cross-channel duplicate/.test(resolved) && /Via channels consistent/.test(resolved)) {
    pass('a correctly resolved collision (one Applied, one SKIP) reports Via channels consistent');
  } else {
    fail(`resolved collision still warns — the check cannot be satisfied by correct behaviour:\n${viaLines(resolved)}`);
  }

  // 2. Control: the real double submission is still caught. Without this, a fix
  //    that deleted the check outright would pass assertion 1.
  const control = runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'Applied'));
  if (/Cross-channel duplicate/.test(control) && /AgencyA/.test(control) && /AgencyB/.test(control)) {
    pass('control: two Applied rows via different agencies still raise the double-submission warning');
  } else {
    fail(`real double submission was not caught:\n${viaLines(control)}`);
  }

  // 3. A states.yml skip alias absent from verify-pipeline's own ALIASES table.
  const localized = runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'uygun değil'));
  if (!/Cross-channel duplicate/.test(localized)) {
    pass('a localized skip alias from states.yml (uygun değil) is recognized as never-submitted');
  } else {
    fail(`localized skip alias counted as a channel — status is not going through the shared normalizeStatus():\n${viaLines(localized)}`);
  }

  // 4. Discarded stays a channel on purpose: it can follow a real application.
  const discarded = runVp(HEADER + row(11, 'AgencyA', 'Applied') + row(19, 'AgencyB', 'Discarded'));
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
