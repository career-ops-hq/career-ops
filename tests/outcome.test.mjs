// tests/outcome.test.mjs — Unit test suite for outcome.mjs (#1722).
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

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

} finally {
  rmSync(testDir, { recursive: true, force: true });
}
