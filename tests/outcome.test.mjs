// tests/outcome.test.mjs — Unit test suite for outcome.mjs (#1722).
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync, realpathSync, symlinkSync, utimesSync } from 'fs';
import { join, win32 as win32Path, posix as posixPath } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathIsInside } from '../tracker-utils.mjs';

const OUTCOME_SCRIPT = join(ROOT, 'outcome.mjs');

console.log('\noutcome.mjs — outcome recording & archiving');

function check(desc, condition, details = '') {
  if (condition) pass(desc);
  else fail(`${desc}${details ? ` (${details})` : ''}`);
}

const testDir = mkdtempSync(join(tmpdir(), 'cops-outcome-test-'));

function setupTestEnvironment() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(join(testDir, 'data'), { recursive: true });

  const mockTracker = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-07-01 | Acme Corp | Senior Backend Engineer | 4.5/5 | Applied | local:output/acme.pdf | local:reports/1-acme.md | Applied online |
| 2 | 2026-07-02 | Beta Systems | Lead AI Architect | 4.8/5 | Interview | local:output/beta.pdf | local:reports/2-beta.md | Screen passed |
| 3 | 2026-07-03 | Gamma Labs | Director of Data | 4.2/5 | Applied | local:output/gamma.pdf | local:reports/3-gamma.md | Applied online |
`;
  writeFileSync(join(testDir, 'data', 'applications.md'), mockTracker);
  writeFileSync(join(testDir, 'cv.md'), '# Candidate CV\n\nSenior Engineer with 10 years experience.\n');
}

try {
  setupTestEnvironment();

  // Test 1: Help command
  const helpOut = execFileSync(NODE, [OUTCOME_SCRIPT, '--help'], { encoding: 'utf-8' });
  check('outcome.mjs --help returns usage info', helpOut.includes('Usage: node outcome.mjs'));

  // Test 2: Invalid outcome type
  try {
    execFileSync(NODE, [OUTCOME_SCRIPT, '1', 'invalid_outcome_type'], {
      cwd: testDir,
      env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    fail('Invalid outcome type should fail');
  } catch (err) {
    check('Invalid outcome type rejects with exit status', err.status === 1);
  }

  // Test 3: Unknown row selector
  try {
    execFileSync(NODE, [OUTCOME_SCRIPT, '999', 'rejected'], {
      cwd: testDir,
      env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    fail('Non-existent row selector should fail');
  } catch (err) {
    check('Non-existent row selector exits with code 2', err.status === 2);
  }

  // Test 4: Dry-run mode
  const dryRunOut = execFileSync(NODE, [OUTCOME_SCRIPT, '1', 'interview_progress', '--stage', 'Tech Screen', '--dry-run', '--json'], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  });
  const dryRunJson = JSON.parse(dryRunOut);
  check('Dry-run returns structured JSON', dryRunJson.dryRun === true && dryRunJson.num === 1);
  check('Dry-run does not create outcome directory', !existsSync(dryRunJson.outcomeDir));

  // Test 5: Real execution for interview_progress
  const outcome1Out = execFileSync(NODE, [
    OUTCOME_SCRIPT,
    '1',
    'interview_progress',
    '--stage', 'Tech Screen',
    '--feedback', 'Great feedback on system design and architecture.',
    '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  });
  const res1 = JSON.parse(outcome1Out);
  check('Outcome execution succeeds', res1.success === true && res1.canonicalState === 'Interview');

  const outcomeDir1 = res1.outcomeDir;
  check('Creates application outcome directory', existsSync(outcomeDir1));
  check('Creates submitted_cv.md', existsSync(join(outcomeDir1, 'submitted_cv.md')));
  check('Creates posting_missing.md stub when URL absent', existsSync(join(outcomeDir1, 'posting_missing.md')));

  const log1 = readFileSync(join(outcomeDir1, 'outcome.md'), 'utf-8');
  check('Logs verbatim feedback in outcome.md', log1.includes('Great feedback on system design and architecture.'));
  check('Logs stage reached in outcome.md', log1.includes('Tech Screen'));

  const trackerContent1 = readFileSync(join(testDir, 'data', 'applications.md'), 'utf-8');
  check('Tracker row #1 status updated to Interview', trackerContent1.includes('| 1 | 2026-07-01 | Acme Corp | Senior Backend Engineer | 4.5/5 | Interview |'));

  // Test 6: Append-only and idempotency with second outcome entry
  const outcome2Out = execFileSync(NODE, [
    OUTCOME_SCRIPT,
    'Acme',
    'offer_received',
    '--stage', 'Final Offer',
    '--feedback', 'Received formal offer letter with comp package.',
    '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  });
  const res2 = JSON.parse(outcome2Out);
  check('Second outcome execution succeeds', res2.canonicalState === 'Offer');

  const log2 = readFileSync(join(outcomeDir1, 'outcome.md'), 'utf-8');
  check('outcome.md preserves first entry (append-only)', log2.includes('Tech Screen'));
  check('outcome.md contains second entry', log2.includes('Final Offer') && log2.includes('Received formal offer letter'));

  const trackerContent2 = readFileSync(join(testDir, 'data', 'applications.md'), 'utf-8');
  check('Tracker row #1 status updated to Offer', trackerContent2.includes('| 1 | 2026-07-01 | Acme Corp | Senior Backend Engineer | 4.5/5 | Offer |'));

  // Test 7: Verify all mapped states
  const testMappings = [
    { type: 'hired', expectedState: 'Hired' },
    { type: 'rejected', expectedState: 'Rejected' },
    { type: 'no_response', expectedState: 'Discarded' },
    { type: 'offer_declined', expectedState: 'Discarded' },
  ];

  for (const { type, expectedState } of testMappings) {
    const out = execFileSync(NODE, [
      OUTCOME_SCRIPT,
      '2',
      type,
      '--json',
    ], {
      cwd: testDir,
      env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(out);
    check(`Outcome "${type}" maps to state "${expectedState}"`, parsed.canonicalState === expectedState);
  }

  // Test 8: Verify copying canonical PDF CV from tracker cell and pdf-index.tsv
  mkdirSync(join(testDir, 'output'), { recursive: true });
  writeFileSync(join(testDir, 'output', 'acme.pdf'), 'PDF-CV-CONTENT');
  const outWithPdf = execFileSync(NODE, [
    OUTCOME_SCRIPT,
    '1',
    'interview_progress',
    '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  });
  const resWithPdf = JSON.parse(outWithPdf);
  check('Copies canonical PDF CV if present', existsSync(join(resWithPdf.outcomeDir, 'submitted_cv.pdf')));
  check('PDF CV content matches', readFileSync(join(resWithPdf.outcomeDir, 'submitted_cv.pdf'), 'utf-8') === 'PDF-CV-CONTENT');

  // Test 9: Resolve a report-keyed capture archived on an earlier day (#134).
  // Row 3 carries no URL and is touched by no other test, so the live-archive
  // fallback cannot run and the outcome dir is clean. Before report keying this
  // produced posting_missing.md even with the capture sitting in jds/.
  mkdirSync(join(testDir, 'jds'), { recursive: true });
  const capture = join(testDir, 'jds', '003-gamma-labs-director-of-data.txt');
  writeFileSync(capture, 'ARCHIVED-JD-BODY');
  const lastMonth = Date.now() / 1000 - 30 * 24 * 60 * 60;
  utimesSync(capture, lastMonth, lastMonth);

  const resKeyed = JSON.parse(execFileSync(NODE, [OUTCOME_SCRIPT, '3', 'rejected', '--json'], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  }));
  const keyedPosting = join(resKeyed.outcomeDir, 'posting.txt');
  check('Resolves a report-keyed capture from an earlier day', existsSync(keyedPosting));
  check('Copied capture keeps its own extension, not .pdf', !existsSync(join(resKeyed.outcomeDir, 'posting.pdf')));
  check('Capture content is copied verbatim', existsSync(keyedPosting) && readFileSync(keyedPosting, 'utf-8') === 'ARCHIVED-JD-BODY');
  check('No missing-posting stub when a capture resolved', !existsSync(join(resKeyed.outcomeDir, 'posting_missing.md')));
  check('Original capture is left in place', existsSync(capture));

  // Test 10: --clean-output — dry-run preview lists the output/ pair without touching them (#2653).
  writeFileSync(join(testDir, 'output', 'acme.html'), 'HTML-CV-CONTENT');
  writeFileSync(join(testDir, 'data', 'pdf-index.tsv'),
    '# report\tpdf\thtml\tformat\tdate\n' +
    '001\toutput/acme.pdf\toutput/acme.html\ta4\t2026-07-01\n');

  const cleanDryOut = execFileSync(NODE, [
    OUTCOME_SCRIPT, '1', 'rejected', '--clean-output', '--dry-run', '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  });
  const cleanDryJson = JSON.parse(cleanDryOut);
  check('Dry-run --clean-output lists both pdf and html candidates',
    cleanDryJson.cleanupCandidates?.length === 2);
  check('Dry-run --clean-output does not delete output/acme.pdf', existsSync(join(testDir, 'output', 'acme.pdf')));
  check('Dry-run --clean-output does not delete output/acme.html', existsSync(join(testDir, 'output', 'acme.html')));

  // Test 11: --clean-output archives then removes the verified pair from output/.
  const cleanRes = JSON.parse(execFileSync(NODE, [
    OUTCOME_SCRIPT, '1', 'rejected', '--clean-output', '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  }));
  check('Archives submitted_cv.pdf before cleanup', existsSync(join(cleanRes.outcomeDir, 'submitted_cv.pdf')));
  check('Archives submitted_cv.html before cleanup', existsSync(join(cleanRes.outcomeDir, 'submitted_cv.html')));
  check('Removes output/acme.pdf after verified archive', !existsSync(join(testDir, 'output', 'acme.pdf')));
  check('Removes output/acme.html after verified archive', !existsSync(join(testDir, 'output', 'acme.html')));
  check('Reports both removals', cleanRes.cleanup.removed.length === 2);
  check('Reports no refusals', cleanRes.cleanup.refused.length === 0);

  // Test 12: --clean-output refuses to delete when the archived copy doesn't verify (#2653).
  // Row 2 (Beta Systems) has an existing outcome dir from Test 7 with no CV archived yet.
  // Pre-seed a same-SIZE, different-content submitted_cv.pdf — the exact case a size-only
  // check would wrongly pass — so the hash check must be what catches it.
  mkdirSync(join(testDir, 'output'), { recursive: true });
  const betaCurrent = 'BETA-PDF-CURRENT-CONTENT'.padEnd(30, '-');
  const betaStale = 'BETA-PDF-STALE-CONTENT'.padEnd(30, '-');
  check('Test fixture: same-size, different-content strings', betaCurrent.length === betaStale.length && betaCurrent !== betaStale);
  writeFileSync(join(testDir, 'output', 'beta.pdf'), betaCurrent);
  writeFileSync(join(testDir, 'data', 'pdf-index.tsv'),
    '# report\tpdf\thtml\tformat\tdate\n' +
    '002\toutput/beta.pdf\t\ta4\t2026-07-02\n');
  const betaOutcomeDir = join(testDir, 'data', 'outcomes', '2_beta-systems_lead-ai-architect');
  mkdirSync(betaOutcomeDir, { recursive: true });
  writeFileSync(join(betaOutcomeDir, 'submitted_cv.pdf'), betaStale);

  const refuseRes = JSON.parse(execFileSync(NODE, [
    OUTCOME_SCRIPT, '2', 'rejected', '--clean-output', '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  }));
  check('Refuses to delete when archived copy does not match despite equal size', refuseRes.cleanup.refused.length === 1);
  check('Original output/beta.pdf survives a failed verification', existsSync(join(testDir, 'output', 'beta.pdf')));

  // Test 13: an explicit --cv pointing inside output/ is eligible for cleanup (#2653).
  writeFileSync(join(testDir, 'output', 'gamma-custom.pdf'), 'GAMMA-CUSTOM-CV-CONTENT');
  const cvInOutputRes = JSON.parse(execFileSync(NODE, [
    OUTCOME_SCRIPT, '3', 'no_response', '--cv', 'output/gamma-custom.pdf', '--clean-output', '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  }));
  check('Archives an explicit --cv from output/', existsSync(join(cvInOutputRes.outcomeDir, 'submitted_cv.pdf')));
  check('Removes an explicit --cv once archived and verified', !existsSync(join(testDir, 'output', 'gamma-custom.pdf')));
  check('Reports the --cv removal, not a refusal', cvInOutputRes.cleanup.removed.length === 1 && cvInOutputRes.cleanup.refused.length === 0);

  // Test 14: an explicit --cv OUTSIDE output/ is never a cleanup candidate (#2653).
  const outsideCv = join(testDir, 'external-cv.pdf');
  writeFileSync(outsideCv, 'EXTERNAL-CV-NEVER-TOUCH');
  const cvOutsideRes = JSON.parse(execFileSync(NODE, [
    OUTCOME_SCRIPT, '3', 'hired', '--cv', outsideCv, '--clean-output', '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  }));
  check('An explicit --cv outside output/ is left untouched', existsSync(outsideCv));
  check('No removal or refusal recorded for a --cv outside output/', cvOutsideRes.cleanup.removed.length === 0 && cvOutsideRes.cleanup.refused.length === 0);

  // Test 15: a manifest (pdf-index.tsv) HTML path escaping output/ must never be
  // treated as cleanup-eligible, even though its paired PDF resolves fine (CodeRabbit
  // finding on #2911 — the html column was trusted without its own containment check).
  // The PDF still resolves and cleans up normally; only the escaping HTML is excluded.
  const gammaPdfContent = 'GAMMA-CUSTOM-CV-CONTENT';
  writeFileSync(join(testDir, 'output', 'gamma.pdf'), gammaPdfContent);
  const escapingHtml = join(testDir, 'gamma-outside.html');
  writeFileSync(escapingHtml, 'ESCAPING-HTML-NEVER-TOUCH');
  writeFileSync(join(testDir, 'data', 'pdf-index.tsv'),
    '# report\tpdf\thtml\tformat\tdate\n' +
    '003\toutput/gamma.pdf\tgamma-outside.html\ta4\t2026-07-03\n');

  const escapeRes = JSON.parse(execFileSync(NODE, [
    OUTCOME_SCRIPT, '3', 'offer_declined', '--clean-output', '--json',
  ], {
    cwd: testDir,
    env: { ...process.env, CAREER_OPS_TRACKER: join(testDir, 'data', 'applications.md') },
    encoding: 'utf-8',
  }));
  const touchedPaths = [...escapeRes.cleanup.removed, ...escapeRes.cleanup.refused.map(r => r.path)];
  check('A manifest HTML path escaping output/ is never deleted', existsSync(escapingHtml));
  check('Escaping HTML path is never archived as submitted_cv.html', !existsSync(join(escapeRes.outcomeDir, 'submitted_cv.html')));
  check('Cleanup never records a path outside output/', !touchedPaths.some(p => p.endsWith('gamma-outside.html')));
  check('The contained PDF still resolves and cleans up normally (containment check still recognizes real output/ files)',
    !existsSync(join(testDir, 'output', 'gamma.pdf')) && escapeRes.cleanup.removed.some(p => p.endsWith(join('output', 'gamma.pdf'))));

  // Test 16: Root-layout trackers own the same workspace as data-layout
  // trackers. Outcome artifacts and an overridden PDF manifest must follow
  // that workspace rather than the installed script or the workspace parent.
  // macOS exposes mkdtempSync paths through /var while child processes may
  // report the canonical /private/var spelling. Compare one canonical path so
  // this workspace-ownership assertion is platform-independent.
  const rootLayoutDir = realpathSync(mkdtempSync(join(tmpdir(), 'cops-outcome-root-layout-')));
  try {
    const rootTracker = join(rootLayoutDir, 'applications.md');
    const customManifest = join(rootLayoutDir, 'custom', 'pdf-index.tsv');
    const indexedPdf = join(rootLayoutDir, 'output', 'root-layout.pdf');
    mkdirSync(join(rootLayoutDir, 'custom'), { recursive: true });
    mkdirSync(join(rootLayoutDir, 'output'), { recursive: true });
    writeFileSync(rootTracker, `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 7 | 2026-07-07 | Root Corp | Platform Engineer | 4.6/5 | Applied | - | [7](reports/7-root.md) | Root layout |
`);
    writeFileSync(indexedPdf, 'ROOT-LAYOUT-PDF');
    writeFileSync(customManifest, '# report\tpdf\thtml\tformat\tdate\n7\toutput/root-layout.pdf\t\ta4\t2026-07-07\n');

    const rootResult = JSON.parse(execFileSync(NODE, [OUTCOME_SCRIPT, '7', 'rejected', '--json'], {
      cwd: rootLayoutDir,
      env: {
        ...process.env,
        CAREER_OPS_TRACKER: rootTracker,
        CAREER_OPS_PDF_INDEX: customManifest,
      },
      encoding: 'utf-8',
    }));
    const expectedDir = join(rootLayoutDir, 'data', 'outcomes', '7_root-corp_platform-engineer');
    check('Root-layout outcome directory stays under workspace/data', rootResult.outcomeDir === expectedDir);
    check('Outcome honors CAREER_OPS_PDF_INDEX', readFileSync(join(expectedDir, 'submitted_cv.pdf'), 'utf8') === 'ROOT-LAYOUT-PDF');
  } finally {
    rmSync(rootLayoutDir, { recursive: true, force: true });
  }

  // Test 17: Windows UNC path containment (CodeRabbit finding on PR #2911).
  // This calls the actual pathIsInside() from tracker-utils.mjs — the same
  // function outcome.mjs's --clean-output uses at runtime (it already existed
  // there for lock-directory validation; #2911 reused rather than duplicated
  // it) — passing path.win32/path.posix explicitly so the Windows and POSIX
  // branches are both exercised deterministically regardless of which OS runs
  // this test suite. A UNC path (\\server\share\...) has no drive letter and
  // its relative() output doesn't start with '..', so only a real isAbsolute()
  // check (not a hand-rolled regex) classifies it as outside output/.
  check('Windows UNC path is correctly rejected as outside output/',
    pathIsInside('\\\\server\\share\\cv.pdf', 'C:\\career-ops\\output', win32Path) === false);

  check('A UNC path actually inside a UNC output/ is still correctly accepted',
    pathIsInside('\\\\server\\share\\output\\cv.pdf', '\\\\server\\share\\output', win32Path) === true);

  check('POSIX path traversal outside output/ is still correctly rejected',
    pathIsInside('/repo/output/../etc/passwd', '/repo/output', posixPath) === false);

  check('A real POSIX path inside output/ is still correctly accepted',
    pathIsInside('/repo/output/acme.pdf', '/repo/output', posixPath) === true);

  // Test 18: a symlink inside output/ must not carry --clean-output's deletion
  // outside the boundary (code review on PR #2911). resolve() does not follow
  // symlinks, so the lexical check alone accepted `output/link/acme.pdf` while
  // the file really lived in a sibling directory — and deleted it. Deletion is
  // unrecoverable, so this is a real fixture with a real symlink rather than a
  // unit call: the whole resolve/contain/archive/delete chain has to be exercised
  // end to end for the assertion to mean anything.
  const symRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cops-outcome-symlink-')));
  try {
    const symWs = join(symRoot, 'ws');
    const outsideDir = join(symRoot, 'outside');
    mkdirSync(join(symWs, 'data'), { recursive: true });
    mkdirSync(join(symWs, 'output'), { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    const symTracker = join(symWs, 'data', 'applications.md');
    writeFileSync(symTracker, `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-07-01 | Acme Corp | Senior Backend Engineer | 4.5/5 | Applied | - | [1](reports/1-acme.md) | Applied online |
`);
    writeFileSync(join(symWs, 'cv.md'), '# GENERIC MASTER CV\n');

    const victim = join(outsideDir, 'acme.pdf');
    writeFileSync(victim, 'IRREPLACEABLE-USER-DATA');
    // A directory SYMLINK needs SeCreateSymbolicLinkPrivilege on Windows, which a
    // non-elevated shell lacks unless Developer Mode is on, so this call threw
    // EPERM and took the whole suite -- all 58 checks, this safety guard among
    // them -- down on a default Windows box. A junction needs no privilege and
    // is what the repo already uses for the same reason (test-all.mjs's e2e
    // fixture, generate-pdf-page-budget, contacts, plugin-symlink-discovery
    // since #3267). It exercises the guard identically: pathIsInsideCanonical()
    // calls realpathSync, which resolves a junction exactly as it resolves a
    // symlink, so the escape is still detected. Verified by mutation -- with the
    // canonicalization removed, this check goes red and the victim file is
    // actually deleted. The target is absolute and a directory on a local
    // volume, the two constraints junctions add. Ignored off Windows.
    symlinkSync(outsideDir, join(symWs, 'output', 'link'), process.platform === 'win32' ? 'junction' : 'dir');

    const symRes = JSON.parse(execFileSync(NODE, [
      OUTCOME_SCRIPT, '1', 'rejected', '--cv', join('output', 'link', 'acme.pdf'), '--clean-output', '--json',
    ], {
      cwd: symWs,
      env: { ...process.env, CAREER_OPS_TRACKER: symTracker },
      encoding: 'utf-8',
    }));

    check('A symlinked path escaping output/ is never deleted', existsSync(victim));
    check('Symlink-escaping path contents are intact', readFileSync(victim, 'utf-8') === 'IRREPLACEABLE-USER-DATA');
    check('Symlink-escaping path is not reported as removed', symRes.cleanup.removed.length === 0);
  } finally {
    rmSync(symRoot, { recursive: true, force: true });
  }

} finally {
  rmSync(testDir, { recursive: true, force: true });
}
