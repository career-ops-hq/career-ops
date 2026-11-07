// tests/verify-pipeline-reeval-duplicates.test.mjs: Check 9 (duplicate reports
// for the same company+role) does not flag a re-evaluation that one tracker row
// keeps on record (#5780), end to end through the real verify-pipeline.mjs
// process.
//
// Same fixture shape as tests/verify-pipeline-duplicate-report-urls.test.mjs:
// only the tracker and reports dir are fixtures, CAREER_OPS_ROOT stays the
// checkout.
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline: Check 9 does not flag a re-evaluation kept on one tracker row (#5780)');

const vpTmp = mkdtempSync(join(tmpdir(), 'co-vp-reeval-dup-'));
try {
  const vpReports = join(vpTmp, 'reports');
  mkdirSync(vpReports, { recursive: true });
  const vpTracker = join(vpTmp, 'applications.md');
  const vpEnv = { ...process.env, CAREER_OPS_TRACKER: vpTracker, CAREER_OPS_REPORTS: vpReports };

  const report = (company, role) =>
    `# Evaluación: ${company} — ${role}\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: "${company}"\nrole: "${role}"\nscore: 4.2\n\`\`\`\n`;

  // #1 and #3 are the same role at Acme with no posting URL, so the #4588
  // URL exemption cannot apply and only the tracker can tell them apart.
  writeFileSync(join(vpReports, '001-acme-2026-01-04.md'), report('Acme', 'Staff AI Engineer'));
  writeFileSync(join(vpReports, '003-acme-2026-01-05.md'), report('Acme', 'Staff AI Engineer'));

  const HEADER =
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n';
  const L1 = '[1](reports/001-acme-2026-01-04.md)';
  const L3 = '[3](reports/003-acme-2026-01-05.md)';
  const row = (num, reportCell, notes) =>
    `| ${num} | 2026-01-05 | Acme | Staff AI Engineer | 4.2/5 | Evaluated | ❌ | ${reportCell} | ${notes} |\n`;

  const dupFlagged = (rows) => {
    writeFileSync(vpTracker, HEADER + rows.join(''));
    const o = run(NODE, ['verify-pipeline.mjs'], { env: vpEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    return o === null ? null : /Duplicate reports[^\n]*001-acme[^\n]*003-acme/.test(o);
  };

  if (dupFlagged([row(1, `${L1} / ${L3}`, 're-eval after JD change')]) === false) {
    pass('both reports linked from one row\'s Report cell are a re-evaluation: not flagged');
  } else fail('a Report cell carrying both reports was flagged as duplicate reports');

  if (dupFlagged([row(1, L3, 'Superseded report [1] (was 4.5/5)')]) === false) {
    pass('a Report cell link plus a `Superseded report [N]` Notes marker on the same row: not flagged');
  } else fail('a Superseded report marker on the linking row did not exempt the pair');

  // Everything below must still warn.
  if (dupFlagged([row(1, L1, 'ok')]) === true) {
    pass('one report linked and the other unreferenced (the #1425 concurrent-worker case): still flagged');
  } else fail('an unreferenced duplicate report was exempted');

  if (dupFlagged([row(1, L1, 'ok'), row(2, L3, 'ok')]) === true) {
    pass('the two reports linked from two different rows: still flagged');
  } else fail('reports split across two tracker rows were exempted');

  if (dupFlagged([row(1, L1, 'ok'), row(2, '—', 'Superseded report [3] (was 4.0/5)')]) === true) {
    pass('a Superseded marker on a different row than the link: still flagged');
  } else fail('a Superseded marker on another row exempted the pair');

  if (dupFlagged([row(1, `${L1} / ${L3}`, 'ok'), row(2, L3, 'ok')]) === true) {
    pass('one row links both but a second row also links one of them: still flagged');
  } else fail('a report referenced by two rows was exempted');

  if (dupFlagged([row(1, L3, 'see [1] for the first pass')]) === true) {
    pass('a bare [N] in Notes without the Superseded marker is not a reference: still flagged');
  } else fail('a bare [N] in Notes was read as a superseded-report reference');

  if (dupFlagged([row(1, `${L1} / [3]`, 'ok')]) === true) {
    pass('a bare [N] in the Report cell that is not a link is not a reference: still flagged');
  } else fail('a bare [N] in the Report cell was read as a linked report');

  // Two files that share a report NUMBER are a numbering collision, not a
  // re-evaluation, even when the one link covers both by number.
  writeFileSync(join(vpReports, '003-acme-2026-01-06.md'), report('Acme', 'Staff AI Engineer'));
  writeFileSync(vpTracker, HEADER + row(1, `${L1} / ${L3}`, 'ok'));
  const o = run(NODE, ['verify-pipeline.mjs'], { env: vpEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  if (o !== null && /Duplicate reports[^\n]*003-acme-2026-01-05[^\n]*003-acme-2026-01-06/.test(o)) {
    pass('two report files sharing one number are still flagged even when that number is linked');
  } else fail('two report files sharing one number were exempted by a link to that number');
} catch (e) {
  fail(`verify-pipeline re-evaluation duplicate checks crashed: ${e.message}`);
} finally {
  rmSync(vpTmp, { recursive: true, force: true });
}
