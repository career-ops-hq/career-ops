// tests/verify-pipeline-check15.test.mjs — Check 15 (portals.yml coverage) end
// to end, through the real verify-pipeline.mjs process.
//
// tests/audit-portals.test.mjs pins the contract this check leans on:
// findUnclaimedEntries() skips an enabled entry with no `name`, adding it to no
// bucket. That alone is not enough — the bug it guards against lived on the
// verify-pipeline side, where the "All N entries resolve" success line counted
// every enabled entry regardless of that rule, so a nameless entry was never
// provider-checked AND reported as resolved. This suite runs the check as the
// user runs it and asserts the two visible outcomes: the warning names the
// entry, and the success line is withheld.
//
// Only the portals file is pointed at a fixture. CAREER_OPS_ROOT stays the
// checkout so providers/ resolves; tracker and reports go to a temp dir the
// same way test-all.mjs's own verify-pipeline fixtures do, so the other checks
// never read a user's real data. Provider resolution is config matching — no
// network is touched.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline — Check 15 reports a nameless enabled entry instead of counting it as resolved');

const tmp = mkdtempSync(join(tmpdir(), 'co-vp-check15-'));
try {
  const reports = join(tmp, 'reports');
  mkdirSync(reports, { recursive: true });
  const tracker = join(tmp, 'applications.md');
  writeFileSync(tracker, '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n', 'utf-8');

  // Explicit `provider:` plus the canonical Greenhouse careers_url, so the
  // control entry resolves by config alone and cannot depend on detect() shape.
  const claimed = `  - name: Claimed Co
    provider: greenhouse
    careers_url: https://boards.greenhouse.io/claimedco
    enabled: true
`;
  const nameless = `  - careers_url: https://boards.greenhouse.io/nameless
    enabled: true
`;
  const withMalformed = join(tmp, 'malformed.yml');
  writeFileSync(withMalformed, `tracked_companies:\n${claimed}${nameless}`, 'utf-8');
  const clean = join(tmp, 'clean.yml');
  writeFileSync(clean, `tracked_companies:\n${claimed}`, 'utf-8');

  // verify-pipeline exits 1 only on errors; a warning-only run exits 0. Either
  // way the report is on stdout, so read it from the error object too rather
  // than letting a non-zero exit hide the assertion.
  const runVp = (portalsFile) => {
    const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports, CAREER_OPS_PORTALS: portalsFile };
    try {
      return execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
    } catch (err) {
      return typeof err.stdout === 'string' ? err.stdout : '';
    }
  };

  const out = runVp(withMalformed);
  const warned = /enabled entry has no name/.test(out);
  const claimedResolved = /resolve to a provider/.test(out);
  if (warned && !claimedResolved) {
    pass('a nameless enabled entry is warned about and the "All N entries resolve" line is withheld');
  } else {
    fail(`nameless entry: warned=${warned} successLine=${claimedResolved}\n${out.split('\n').filter((l) => /portals\.yml|resolve to a provider|coverage/i.test(l)).join('\n')}`);
  }
  if (/nameless/.test(out)) {
    pass('the warning carries the careers_url so the entry can be found in the file');
  } else {
    fail('the warning did not name the entry\'s careers_url');
  }

  const control = runVp(clean);
  if (/All 1 enabled portals\.yml entries resolve to a provider/.test(control) && !/has no name/.test(control)) {
    pass('control: the same file without the nameless entry reports 1 resolved and no warning');
  } else {
    fail(`control drifted:\n${control.split('\n').filter((l) => /portals\.yml|resolve to a provider|coverage/i.test(l)).join('\n')}`);
  }
} catch (err) {
  fail(`verify-pipeline Check 15 tests could not run: ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
