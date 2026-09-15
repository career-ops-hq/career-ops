// tests/verify-ats-scoring.test.mjs — ATS scoring test suite.
//
// Covers 4 key ATS evaluation scenarios using tracked test-fixtures/sample-resume.pdf:
// 1. Standalone PDF without job description (score capped at 98/100, info issue).
// 2. PDF with 100% matching job description (score 100/100, Grade A, 0 missing keywords).
// 3. PDF with partially matching job description (score penalized, warning issued, missing keywords listed).
// 4. PDF with mismatching job description (<50% match, critical issue, gate fails).
//
// Run:  node --test tests/verify-ats-scoring.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPdf, isPass } from '../verify-ats.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SCRIPT_PATH = join(ROOT, 'verify-ats.mjs');
const FIXTURES_DIR = join(ROOT, 'test-fixtures');

const FIXTURE_PDF = join(FIXTURES_DIR, 'sample-resume.pdf');

const MATCHING_JD = join(FIXTURES_DIR, 'jd-matching.md');
const PARTIAL_JD = join(FIXTURES_DIR, 'jd-partial.md');
const MISMATCH_JD = join(FIXTURES_DIR, 'jd-mismatch.md');

test('ATS Scoring Scenarios (verify-ats)', async (t) => {

  const pdfBuffer = readFileSync(FIXTURE_PDF);
  
  let inputFiles;
  let cliArgs;

  // ── Scenario 1: Standalone PDF ──────────────────────────────────────
  const r1 = await auditPdf(pdfBuffer);
  
  await t.test(`Scenario 1: Standalone PDF without JD (Score: ${r1.score}/100, capped at max 98/100) — info notice`, () => {
    
    const isUnderCap = r1.score <= 98;
    
    assert.ok(isUnderCap, `Expected score <= 98 without JD, got ${r1.score}`);
    
    assert.equal(r1.jdAlignment, null, 'Expected null jdAlignment without JD');
    
    const infoMessages = r1.issues
      .filter(i => {
        if (i.severity === 'info') {
          return true;
        }
        return false;
      })
      .map(i => i.message);

    const hasNotice = infoMessages.some(msg => {

      const missingJdNotice = 'No job description provided';

      if(msg.includes(missingJdNotice)) {
        return true;
      }
      return false;
    });
    
    assert.ok(hasNotice, 'Expected info notice about missing job description');

    inputFiles = [SCRIPT_PATH, FIXTURE_PDF];

    cliArgs = [...inputFiles, '--json']

    const cli = spawnSync(process.execPath, cliArgs, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    
    assert.equal(cli.status, 0, `CLI failed with code ${cli.status}: ${cli.stderr}`);
    
    const parsed = JSON.parse(cli.stdout);
    const issues = parsed.issues;
    
    assert.equal(parsed.pass, true);
    assert.equal(parsed.score, r1.score);
    assert.equal(parsed.jdAlignment, null);
    
    const cliUnderCap = parsed.score <= 98;
    
    assert.ok(cliUnderCap);
    
    const cliInfoIssues = issues
    
      .filter(i => {
        if(i.severity === 'info') {
          return true;
        }
        return false;
      })
      .map(i => i.message);
    
    const hasMissingJdNotice = cliInfoIssues.some(msg => {
      
      const missingJdNotice = 'No job description provided';

      if(msg.includes(missingJdNotice)) {
        return true;
      }
      return false;
    });
    
    assert.ok(hasMissingJdNotice);
  });

  let jdAlignment;
  let matchPercent;
  let missingKeywords;
  let matchedKeywords;

  // ── Scenario 2: 100% matching JD ─────────────────────────────────────
  const jdMatchingContent = readFileSync(MATCHING_JD, 'utf-8');

  const matchingJdOptions = { 
    jobDescription: jdMatchingContent 
  };
  
  const r2 = await auditPdf(pdfBuffer, matchingJdOptions);
  
  await t.test(`Scenario 2: PDF with 100% matching JD (Score: ${r2.score}/100, Grade ${r2.grade}) — 0 missing keywords`, () => {
    
    assert.equal(r2.score, 100, `Expected perfect score 100, got ${r2.score}`);
    assert.equal(r2.grade, 'A', `Expected Grade A, got ${r2.grade}`);

    jdAlignment = r2.jdAlignment;
    
    assert.ok(jdAlignment, 'Expected jdAlignment object');

    matchPercent = jdAlignment.matchPercent;
    missingKeywords = jdAlignment.missing;
    
    assert.equal(matchPercent, 100);
    assert.equal(missingKeywords.length, 0);

    matchedKeywords = jdAlignment.matched;
    
    const hasMatchedKeywords = matchedKeywords.length > 0;
    
    assert.ok(hasMatchedKeywords);

    const infoMessages = r2.issues
      .filter(i => {
        if (i.severity === 'info') {
          return true;
        }
        return false;
      })
      .map(i => i.message);

    const hasPerfectNotice = infoMessages.some(msg => {
      
      const perfectNotice = '100% match';
      
      if (msg.includes(perfectNotice)) {
        return true;
      }
      return false;
    });

    assert.ok(hasPerfectNotice, 'Expected info notice for perfect JD alignment');
    
    assert.equal(isPass(r2, 70), true);

    inputFiles = [SCRIPT_PATH, FIXTURE_PDF, MATCHING_JD];

    cliArgs = [...inputFiles, '--json'];

    const cli = spawnSync(process.execPath, cliArgs, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    assert.equal(cli.status, 0, `CLI failed with code ${cli.status}: ${cli.stderr}`);
    
    const parsed = JSON.parse(cli.stdout);

    const issues = parsed.issues;
    
    jdAlignment = parsed.jdAlignment;
    
    missingKeywords = jdAlignment.missing;
    matchPercent = jdAlignment.matchPercent;
    
    assert.equal(parsed.pass, true);
    assert.equal(parsed.score, r2.score);
    
    assert.equal(parsed.grade, 'A');
    
    assert.equal(matchPercent, 100);
    assert.equal(missingKeywords.length, 0);

    const cliInfoIssues = issues
      .filter(i => {
        if (i.severity === 'info') {
          return true;
        }
        return false;
      })
      .map(i => i.message);

    const cliHasPerfectNotice = cliInfoIssues.some(msg => {

      const perfectNotice = '100% match';
      
      if (msg.includes(perfectNotice)) {
        return true;
      }
      return false;
    });
    
    assert.ok(cliHasPerfectNotice);
  });

  // ── Scenario 3: Partial matching JD ──────────────────────────────────
  const jdPartialContent = readFileSync(PARTIAL_JD, 'utf-8');

  const partialJdOptions = { 
    jobDescription: jdPartialContent 
  };
  
  const r3 = await auditPdf(pdfBuffer, partialJdOptions);

  await t.test(`Scenario 3: PDF with partially matching JD (Score: ${r3.score}/100) — penalty and missing keywords`, () => {

    const isPenalized = r3.score < 98;
    
    assert.ok(isPenalized, `Expected penalized score < 98, got ${r3.score}`);

    jdAlignment = r3.jdAlignment;

    assert.ok(jdAlignment, 'Expected jdAlignment object');
    
    matchPercent = jdAlignment.matchPercent;
    
    const hasMinExpectedMatch = matchPercent >= 50;
    const hasMaxExpectedMatch = matchPercent <= 70;
    
    assert.ok(hasMinExpectedMatch, `Expected match >= 50%, got ${matchPercent}`);
    assert.ok(hasMaxExpectedMatch, `Expected match <= 70%, got ${matchPercent}`);
    
    missingKeywords = jdAlignment.missing;
    matchedKeywords = jdAlignment.matched;

    const hasMissingKeywords = missingKeywords.length > 0;
    
    assert.ok(hasMissingKeywords, 'Expected missing keywords');
    
    const hasMatchedKeywords = matchedKeywords.length > 0;
    
    assert.ok(hasMatchedKeywords, 'Expected matched keywords');

    const warningMessages = r3.issues
      .filter(i => {
        if (i.severity === 'warning') {
          return true;
        }
        return false;
      })
      .map(i => i.message);

    const hasWarningNotice = warningMessages.some(msg => {

      const partialNotice = 'Incomplete job description match';
      
      if (msg.includes(partialNotice)) {
        return true;
      }
      return false;
    });

    assert.ok(hasWarningNotice, 'Expected warning for partial JD alignment');

    inputFiles = [SCRIPT_PATH, FIXTURE_PDF, PARTIAL_JD];
    
    const flags = ['--min-score', '50', '--json'];

    cliArgs = [...inputFiles, ...flags];

    const cli = spawnSync(process.execPath, cliArgs, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    assert.equal(cli.status, 0, `CLI failed with code ${cli.status}: ${cli.stderr}`);
    
    const parsed = JSON.parse(cli.stdout);
    const issues = parsed.issues;

    jdAlignment = parsed.jdAlignment;
    missingKeywords = jdAlignment.missing;

    assert.equal(parsed.pass, true);
    assert.equal(parsed.score, r3.score);
    
    const cliHasMissing = missingKeywords.length > 0;
    
    assert.ok(cliHasMissing);

    const cliWarningIssues = issues
      .filter(i => {
        if (i.severity === 'warning') {
          return true;
        }
        return false;
      })
      .map(i => i.message);

    const cliHasWarning = cliWarningIssues.some(msg => {

      const partialNotice = 'Incomplete job description match';
      
      if (msg.includes(partialNotice)) {
        return true;
      }
      return false;
    });

    assert.ok(cliHasWarning);
  });

  // ── Scenario 4: Mismatching JD ───────────────────────────────────────
  const jdMismatchContent = readFileSync(MISMATCH_JD, 'utf-8');

  const mismatchJdOptions = { 
    jobDescription: jdMismatchContent 
  };
  
  const r4 = await auditPdf(pdfBuffer, mismatchJdOptions);

  await t.test(`Scenario 4: PDF with mismatching JD (Score: ${r4.score}/100, <50% match) — critical issue and gate failure`, () => {

    jdAlignment = r4.jdAlignment;

    assert.ok(jdAlignment, 'Expected jdAlignment object');

    matchPercent = jdAlignment.matchPercent;
    
    const isLowMatch = matchPercent < 50;
    
    assert.ok(isLowMatch, `Expected <50% match, got ${matchPercent}`);

    const criticalMessages = r4.issues
      .filter(i => {
        if (i.severity === 'critical') {
          return true;
        }
        return false;
      })
      .map(i => i.message);

    const hasCriticalNotice = criticalMessages.some(msg => {

      const mismatchNotice = 'Incomplete job description match';
      
      if (msg.includes(mismatchNotice)) {
        return true;
      }
      return false;
    });

    assert.ok(hasCriticalNotice, 'Expected critical issue for mismatching JD');
    
    assert.equal(isPass(r4, 70), false, 'Expected isPass to be false due to critical issue');

    inputFiles = [SCRIPT_PATH, FIXTURE_PDF, MISMATCH_JD,]

    cliArgs = [...inputFiles, '--json'];
    
    const cli = spawnSync(process.execPath, cliArgs, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    
    assert.equal(cli.status, 1, `Expected CLI to exit 1 on gate failure, got ${cli.status}`);
    
    const parsed = JSON.parse(cli.stdout);
    const issues = parsed.issues;
    
    assert.equal(parsed.pass, false);
    assert.equal(parsed.score, r4.score);

    const cliCriticalIssues = issues
      .filter(i => {
        if (i.severity === 'critical') {
          return true;
        }
        return false;
      })
      .map(i => i.message);

    const cliHasCritical = cliCriticalIssues.some(msg => {

      const mismatchNotice = 'Incomplete job description match';
      
      if (msg.includes(mismatchNotice)) {
        return true;
      }
      return false;
    });
    
    assert.ok(cliHasCritical);
  });
});
