// tests/verify-pipeline-duplicate-report-urls.test.mjs: Check 9 (duplicate
// reports for the same company+role) tells two openings apart by their posting
// URL (#4588), end to end through the real verify-pipeline.mjs process.
//
// The fixture is the one test-all.mjs builds for its #1425 duplicate/orphan
// report checks, rebuilt here in a temp dir. Only the tracker and reports dir
// are fixtures; CAREER_OPS_ROOT stays the checkout, as in
// tests/verify-pipeline-via-skip.test.mjs.
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline: Check 9 does not flag same company+role reports with distinct posting URLs (#4588)');

const vpTmp = mkdtempSync(join(tmpdir(), 'co-vp-dup-report-urls-'));
try {
  const vpReports = join(vpTmp, 'reports');
  mkdirSync(vpReports, { recursive: true });
  const vpTracker = join(vpTmp, 'applications.md');
  const vpEnv = { ...process.env, CAREER_OPS_TRACKER: vpTracker, CAREER_OPS_REPORTS: vpReports };

  const report = (company, role) =>
    `# Evaluación: ${company} — ${role}\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: "${company}"\nrole: "${role}"\nscore: 4.2\n\`\`\`\n`;

  // #1 and #3 are the same role at Acme written by two concurrent workers;
  // #2 is a different Acme role (must NOT be flagged as duplicate);
  // #3 also has no tracker row (orphan — tracker dedup kept #1).
  writeFileSync(join(vpReports, '001-acme-2026-01-04.md'), report('Acme', 'Staff AI Engineer'));
  writeFileSync(join(vpReports, '002-acme-2026-01-05.md'), report('Acme', 'Platform Engineer'));
  writeFileSync(join(vpReports, '003-acme-2026-01-05.md'), report('Acme', 'Staff AI Engineer'));

  writeFileSync(vpTracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    '| 1 | 2026-01-04 | Acme | Staff AI Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-01-04.md) | ok |\n' +
    '| 2 | 2026-01-05 | Acme | Platform Engineer | 4.0/5 | Evaluated | ❌ | [2](reports/002-acme-2026-01-05.md) | ok |\n');

  // Same company+role but two DIFFERENT posting URLs (one title posted per
  // city, or two reqs opened with the same title) are two openings, not a
  // re-evaluation — merge-tracker already treats them so. Only a group where
  // every report carries a URL key and no two share one is exempt; a missing
  // or placeholder URL proves nothing, so those groups are still flagged.
  const vpDupFlagged = () => {
    const o = run(NODE, ['verify-pipeline.mjs'], { env: vpEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    return o === null ? null : /Duplicate reports[^\n]*001-acme[^\n]*003-acme/.test(o);
  };
  // AGENTS.md documents the URL INLINE in the Score line; other writers put it
  // on its own line. Both spellings must be read.
  const ownLine = (url) => report('Acme', 'Staff AI Engineer').replace('\n\n## Machine', `\n\n**URL:** ${url}\n\n## Machine`);
  const inlineHdr = (url) => report('Acme', 'Staff AI Engineer').replace('\n\n## Machine', `\n\n**Score:** 4.2/5 | **URL:** ${url} | **PDF:** pending\n\n## Machine`);
  const setPair = (a, b) => {
    writeFileSync(join(vpReports, '001-acme-2026-01-04.md'), a);
    writeFileSync(join(vpReports, '003-acme-2026-01-05.md'), b);
  };

  setPair(ownLine('https://jobs.example.com/acme/111'), ownLine('https://jobs.example.com/acme/222'));
  if (vpDupFlagged() === false) pass('same company+role with distinct posting URLs is not flagged as duplicate reports (#4588)');
  else fail('same company+role with distinct posting URLs falsely flagged as duplicate reports');

  setPair(inlineHdr('https://jobs.example.com/acme/111'), inlineHdr('https://jobs.example.com/acme/222'));
  if (vpDupFlagged() === false) pass('inline `| **URL:** … |` header is read for the duplicate-report exemption');
  else fail('inline **URL:** header not read: distinct postings flagged as duplicate reports');

  setPair(ownLine('https://jobs.example.com/acme/111'), ownLine('https://jobs.example.com/acme/111?utm_source=x'));
  if (vpDupFlagged() === true) pass('same posting URL (tracking params only differ) is still flagged as duplicate reports');
  else fail('same posting URL not flagged as duplicate reports');

  setPair(ownLine('https://jobs.example.com/acme/111'), report('Acme', 'Staff AI Engineer'));
  if (vpDupFlagged() === true) pass('a report with no URL cannot prove two reports distinct: still flagged');
  else fail('group with a URL-less report was exempted from the duplicate check');

  setPair(ownLine('https://jobs.example.com/acme/111'), ownLine('N/A'));
  if (vpDupFlagged() === true) pass('`**URL:** N/A` is a missing value, not a second posting: still flagged');
  else fail('`**URL:** N/A` counted as a distinct posting URL');

  // An empty `**URL:**` header must not capture the next header as its value.
  setPair(
    report('Acme', 'Staff AI Engineer').replace('\n\n## Machine', '\n\n**URL:**\n**Legitimacy:** High\n\n## Machine'),
    report('Acme', 'Staff AI Engineer').replace('\n\n## Machine', '\n\n**URL:**\n**Legitimacy:** High\n\n## Machine'),
  );
  if (vpDupFlagged() === true) pass('empty `**URL:**` headers do not read the next header as a URL: still flagged');
  else fail('empty **URL:** header read as a URL: duplicate reports exempted');
} catch (e) {
  fail(`verify-pipeline duplicate-report URL checks crashed: ${e.message}`);
} finally {
  rmSync(vpTmp, { recursive: true, force: true });
}
