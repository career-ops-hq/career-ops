// tests/tracker-distinct-openings.test.mjs — dedup-tracker.mjs and
// verify-pipeline.mjs must honour the same "provably different opening" proof
// merge-tracker.mjs already does: a posting-URL mismatch (#1298) or a req/job-id
// mismatch in Notes (#1524).
//
// Employers routinely post one title per city or country (Instacart's US-remote
// and Canada-remote "Senior Machine Learning Engineer, Economist"; a nearshore
// agency's Bogotá and Santo Domingo copies of one role). merge-tracker adds each
// as its own row because their URLs and job ids differ — then dedup-tracker,
// comparing company + title only, deleted one of them, and verify-pipeline
// warned about them on every run with no way to resolve it.
//
// Each behaviour is pinned in BOTH directions, because a fix that silences the
// check is indistinguishable from one that breaks it:
//   dedup-tracker   — distinct URLs kept · distinct req ids kept · a real
//                     duplicate (no distinguishing key) is still removed
//   verify-pipeline — Check 2 and Check 9 are clean for distinct openings and
//                     still warn for a real duplicate
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\ntracker identity — dedup-tracker and verify-pipeline keep distinct same-title openings apart');

const tmp = mkdtempSync(join(tmpdir(), 'co-distinct-openings-'));
try {
  const reports = join(tmp, 'reports');
  mkdirSync(reports, { recursive: true });
  const tracker = join(tmp, 'applications.md');
  const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports };

  const HEADER =
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|-----|\n';
  const ROLE = 'Senior Machine Learning Engineer, Economist';
  const row = (num, score, notes, url) =>
    `| ${num} | 2026-09-17 | ExampleCorp | ${ROLE} | ${score}/5 | Evaluated | ❌ | — | ${notes} | ${url} |\n`;

  const run = (script) => {
    try {
      const stdout = execFileSync(NODE, [join(ROOT, script)], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
      return { status: 0, out: stdout };
    } catch (err) {
      return { status: typeof err.status === 'number' ? err.status : 1, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
  };
  // dedup-tracker logs its keep/remove decisions on stderr (console.warn), so
  // capture both streams for it.
  const runDedup = () => {
    try {
      const out = execFileSync(NODE, [join(ROOT, 'dedup-tracker.mjs')], { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
      return { status: 0, out };
    } catch (err) {
      return { status: typeof err.status === 'number' ? err.status : 1, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
  };
  const dataRows = () => readFileSync(tracker, 'utf-8').split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));

  // --- dedup-tracker ------------------------------------------------------
  const cases = [
    {
      label: 'distinct posting URLs',
      table: HEADER + row(1, '1.4', 'US remote', 'https://example.com/jobs/8157736') + row(2, '1.0', 'Canada remote', 'https://example.com/jobs/8157738'),
      expectRows: 2,
    },
    {
      label: 'distinct req/job ids in Notes (no URL column values)',
      table: HEADER + row(1, '1.4', 'Job id 8157736', '') + row(2, '1.0', 'Job id 8157738', ''),
      expectRows: 2,
    },
    {
      label: 'control: same URL (a real duplicate) is still removed',
      table: HEADER + row(1, '1.4', 'first eval', 'https://example.com/jobs/1') + row(2, '1.0', 'second eval', 'https://example.com/jobs/1?utm_source=x'),
      expectRows: 1,
    },
    {
      label: 'control: no distinguishing key on either row is still removed',
      table: HEADER + row(1, '1.4', 'first eval', '') + row(2, '1.0', 'second eval', ''),
      expectRows: 1,
    },
  ];
  for (const c of cases) {
    writeFileSync(tracker, c.table, 'utf-8');
    const r = runDedup();
    const got = dataRows().length;
    if (r.status === 0 && got === c.expectRows) {
      pass(`dedup-tracker — ${c.label}: ${got} row(s) remain`);
    } else {
      fail(`dedup-tracker — ${c.label}: expected ${c.expectRows} row(s), got ${got} (exit ${r.status})\n${r.out.trim()}`);
    }
  }

  // --- verify-pipeline Check 2 --------------------------------------------
  const dupLine = (out) => out.split('\n').filter((l) => /Possible duplicates|No exact duplicates/.test(l)).join('\n');

  writeFileSync(tracker, HEADER + row(1, '1.4', 'Job id 8157736', 'https://example.com/jobs/8157736') + row(2, '1.0', 'Job id 8157738', 'https://example.com/jobs/8157738'), 'utf-8');
  let vp = run('verify-pipeline.mjs');
  if (vp.status === 0 && !/Possible duplicates/.test(vp.out) && /No exact duplicates/.test(vp.out)) {
    pass('verify-pipeline Check 2 — same-title rows with distinct URLs/ids are not reported');
  } else {
    fail(`verify-pipeline Check 2 still warns on distinct openings (exit ${vp.status}):\n${dupLine(vp.out) || vp.out.trim()}`);
  }

  writeFileSync(tracker, HEADER + row(1, '1.4', 'first eval', '') + row(2, '1.0', 'second eval', ''), 'utf-8');
  vp = run('verify-pipeline.mjs');
  if (vp.status === 0 && /Possible duplicates: #1, #2/.test(vp.out)) {
    pass('verify-pipeline Check 2 — control: rows with no distinguishing key still warn');
  } else {
    fail(`verify-pipeline Check 2 control did not warn (exit ${vp.status}):\n${dupLine(vp.out) || vp.out.trim()}`);
  }

  // --- verify-pipeline Check 9 (reports/) ---------------------------------
  // Link each report from a tracker row so the orphan-report check stays quiet
  // and only Check 9's verdict is under test.
  const report = (num, url) => {
    const name = `00${num}-examplecorp-2026-09-17.md`;
    writeFileSync(join(reports, name),
      `# Evaluation: ExampleCorp — ${ROLE}\n\n**Date:** 2026-09-17\n**Score:** 1.4/5 | **URL:** ${url} | **Legitimacy:** High Confidence\n`, 'utf-8');
    return name;
  };
  const linkedRow = (num, name, notes, url) =>
    `| ${num} | 2026-09-17 | ExampleCorp | ${ROLE} | 1.4/5 | Evaluated | ❌ | [00${num}](reports/${name}) | ${notes} | ${url} |\n`;
  const reportLine = (out) => out.split('\n').filter((l) => /Duplicate reports|No duplicate reports/.test(l)).join('\n');

  const a = report(1, 'https://example.com/jobs/8157736');
  const b = report(2, 'https://example.com/jobs/8157738');
  writeFileSync(tracker, HEADER + linkedRow(1, a, 'Job id 8157736', 'https://example.com/jobs/8157736') + linkedRow(2, b, 'Job id 8157738', 'https://example.com/jobs/8157738'), 'utf-8');
  vp = run('verify-pipeline.mjs');
  if (vp.status === 0 && !/Duplicate reports for same company\+role/.test(vp.out)) {
    pass('verify-pipeline Check 9 — reports of the same title with different **URL:** headers are not duplicates');
  } else {
    fail(`verify-pipeline Check 9 still flags distinct postings (exit ${vp.status}):\n${reportLine(vp.out) || vp.out.trim()}`);
  }

  report(2, 'https://example.com/jobs/8157736');
  writeFileSync(tracker, HEADER + linkedRow(1, a, 'first eval', '') + linkedRow(2, b, 'second eval', ''), 'utf-8');
  vp = run('verify-pipeline.mjs');
  if (vp.status === 0 && /Duplicate reports for same company\+role/.test(vp.out)) {
    pass('verify-pipeline Check 9 — control: two reports for the same URL still warn');
  } else {
    fail(`verify-pipeline Check 9 control did not warn (exit ${vp.status}):\n${reportLine(vp.out) || vp.out.trim()}`);
  }
} catch (err) {
  fail(`tracker distinct-openings tests could not run: ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
