// tests/verify-pipeline-anon-duplicates.test.mjs — Check 2 must not report two
// anonymous-employer rows from different agencies as "possible duplicates".
//
// Company `?` is the marker for an unknown end employer (#1596). Two such rows
// with the same role title are different openings when they came through
// different agencies, so company+role alone is not a usable duplicate key.
// Pinned in both directions, since a fix that only silences the warning is
// indistinguishable from one that breaks the check:
//   1. different agencies, same `?` + role  -> no duplicate warning
//   2. control: same agency, same `?` + role -> warning still raised
//   3. control: named company, different agencies -> warning still raised
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline — Check 2 keys anonymous (`?`) rows by Via as well');

const tmp = mkdtempSync(join(tmpdir(), 'co-vp-anon-dup-'));
try {
  const reports = join(tmp, 'reports');
  mkdirSync(reports, { recursive: true });
  const tracker = join(tmp, 'applications.md');

  const HEADER =
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|-----|------|-------|--------|-----|--------|-------|\n';
  const row = (num, company, via) =>
    `| ${num} | 2026-09-02 | ${company} | ${via} | Commercial Director | 3.0/5 | SKIP | ❌ | — | — |\n`;

  // Exit status is asserted before any match, so a crashed run cannot be read
  // as "no warning".
  const dupLine = (label, table) => {
    writeFileSync(tracker, table, 'utf-8');
    const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports };
    try {
      const out = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
      return out.split('\n').filter((l) => /Possible duplicates/.test(l)).join('\n');
    } catch (err) {
      fail(`${label}: verify-pipeline exited ${err.status ?? 1}; its Check 2 output proves nothing`);
      return null;
    }
  };

  const apart = dupLine('different agencies', HEADER + row(1, '?', 'AgencyA') + row(2, '?', 'AgencyB'));
  if (apart !== null) {
    if (apart === '') pass('`?` rows via different agencies are not reported as duplicates');
    else fail(`different agencies reported as duplicates:\n${apart}`);
  }

  const same = dupLine('same agency', HEADER + row(1, '?', 'AgencyA') + row(2, '?', 'AgencyA'));
  if (same !== null) {
    if (/#1, #2/.test(same)) pass('`?` rows via the same agency are still reported as duplicates');
    else fail('same agency + same role was not reported as a duplicate');
  }

  const named = dupLine('named company', HEADER + row(1, 'ExampleCorp', 'AgencyA') + row(2, 'ExampleCorp', 'AgencyB'));
  if (named !== null) {
    if (/#1, #2/.test(named)) pass('named-company rows are still reported as duplicates whatever the Via');
    else fail('named company + same role was not reported as a duplicate');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
