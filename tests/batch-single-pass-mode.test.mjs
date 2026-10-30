// tests/batch-single-pass-mode.test.mjs — tests for optional single-pass CV-match evaluation mode
// covering CLI flags (--mode match, --single-pass), multi-step bypass,
// and condensed single-pass prompt generation.

import { pass, fail, ROOT, getBash } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  PATHS, parseCliMode, loadContext,
  parseLegitimacy, processOffer,
} from '../batch-evaluate-gemini.mjs';

console.log('\nbatch-single-pass-mode.test.mjs — Single-Pass CV-Match Evaluation Mode');

// ── Test 1: CLI mode parser in batch-evaluate-gemini.mjs ──────────────────────
try {
  if (parseCliMode([]) === 'full') {
    pass('parseCliMode defaults to full mode when no mode flag is passed');
  } else {
    fail('parseCliMode did not default to full mode');
  }

  if (parseCliMode(['--mode', 'match']) === 'match') {
    pass('parseCliMode parses --mode match');
  } else {
    fail('parseCliMode failed on --mode match');
  }

  if (parseCliMode(['--mode=match']) === 'match') {
    pass('parseCliMode parses --mode=match');
  } else {
    fail('parseCliMode failed on --mode=match');
  }

  if (parseCliMode(['--single-pass']) === 'match') {
    pass('parseCliMode parses --single-pass as match mode alias');
  } else {
    fail('parseCliMode failed on --single-pass');
  }

  if (parseCliMode(['--single-pass=false', '--mode', 'full']) === 'full') {
    pass('parseCliMode rejects --single-pass with assigned value and respects --mode full');
  } else {
    fail('parseCliMode failed when --single-pass had an assigned value');
  }

  if (parseCliMode(['--single-pass=false']) === 'full') {
    pass('parseCliMode rejects standalone --single-pass=false and defaults to full');
  } else {
    fail('parseCliMode failed on standalone --single-pass=false');
  }
} catch (err) {
  fail(`parseCliMode tests threw: ${err.message}`);
}

// ── Test 2: loadContext in match mode bypasses multi-step chain ─────────────
const workDir = mkdtempSync(join(tmpdir(), 'cops-matchmode-'));
const originalProfileYml = PATHS.profileYml;
const originalCv = PATHS.cv;
const originalProfile = PATHS.profile;
const originalCustom = PATHS.custom;

try {
  PATHS.custom = join(workDir, '_custom.md');
  const dummyProfilePath = join(workDir, 'profile.yml');
  PATHS.profileYml = dummyProfilePath;

  const dummyProfileMd = join(workDir, '_profile.md');
  writeFileSync(dummyProfileMd, '# Archetypes\n- AI Engineer\n', 'utf-8');
  PATHS.profile = dummyProfileMd;

  const dummyCvPath = join(workDir, 'cv.md');
  writeFileSync(dummyCvPath, '# Jane Doe\n## Experience\n- Staff Engineer at Acme (2020-2026)\n- Senior Engineer at Beta (2015-2020)\n', 'utf-8');
  PATHS.cv = dummyCvPath;

  writeFileSync(dummyProfilePath, 'candidate:\n  full_name: "Jane Doe"\nspend_tier: standard\n', 'utf-8');

  const matchPrompt = loadContext('match');
  const fullPrompt = loadContext('full');

  if (matchPrompt.includes('single-pass CV match mode')) {
    pass('match mode prompt declares single-pass CV match mode');
  } else {
    fail('match mode prompt missing single-pass declaration');
  }

  // Multi-step reasoning chain (oferta.md / _shared.md) must be bypassed in match mode
  if (!matchPrompt.includes('EVALUATION MODE (oferta.md)') && !matchPrompt.includes('SYSTEM CONTEXT (_shared.md)')) {
    pass('match mode bypasses multi-step reasoning chain (oferta.md and _shared.md omitted)');
  } else {
    fail('match mode did not bypass oferta.md / _shared.md');
  }

  // Full mode must still include oferta.md and _shared.md
  if (fullPrompt.includes('EVALUATION MODE (oferta.md)') && fullPrompt.includes('SYSTEM CONTEXT (_shared.md)')) {
    pass('full mode retains multi-step reasoning chain (oferta.md and _shared.md included)');
  } else {
    fail('full mode unexpectedly lost oferta.md / _shared.md');
  }

  // Match prompt must include CV facts
  if (matchPrompt.includes('Staff Engineer at Acme')) {
    pass('match mode prompt extracts CV facts');
  } else {
    fail('match mode prompt missing CV facts');
  }

  // Match mode loads the same profile files as full mode and as
  // batch/batch-prompt-match.md: archetypes, targets and language.output.
  if (matchPrompt.includes('CANDIDATE PROFILE & TARGETS (config/profile.yml)') && matchPrompt.includes('AI Engineer') && matchPrompt.includes('spend_tier: standard')) {
    pass('match mode prompt includes profile.yml and _profile.md like full mode');
  } else {
    fail('match mode prompt missing profile.yml or _profile.md');
  }

  if (matchPrompt.includes('language.output')) {
    pass('match mode prompt carries the language.output rule');
  } else {
    fail('match mode prompt missing the language.output rule');
  }

  // Full mode must retain profileContent and profileYml
  if (fullPrompt.includes('CANDIDATE PROFILE & TARGETS (config/profile.yml)') && fullPrompt.includes('USER ARCHETYPES & NARRATIVE (_profile.md)')) {
    pass('full mode retains profileContent and profileYml');
  } else {
    fail('full mode unexpectedly lost profileContent or profileYml');
  }

  // Match prompt must enforce machine-readable summary block
  if (matchPrompt.includes('---SCORE_SUMMARY---') && matchPrompt.includes('---END_SUMMARY---')) {
    pass('match mode prompt includes ---SCORE_SUMMARY--- contract for tracker compatibility');
  } else {
    fail('match mode prompt missing ---SCORE_SUMMARY--- block');
  }

} catch (err) {
  fail(`batch-evaluate-gemini match mode tests threw: ${err.message}`);
} finally {
  PATHS.profileYml = originalProfileYml;
  PATHS.cv = originalCv;
  PATHS.profile = originalProfile;
  PATHS.custom = originalCustom;
  rmSync(workDir, { recursive: true, force: true });
}

// ── Test 3b: parseLegitimacy canonical state normalization ────────────────────
try {
  if (parseLegitimacy('High Confidence') === 'High Confidence' &&
      parseLegitimacy('high confidence') === 'High Confidence' &&
      parseLegitimacy('High') === 'High Confidence') {
    pass('parseLegitimacy parses High Confidence variations');
  } else {
    fail('parseLegitimacy failed on High Confidence');
  }

  if (parseLegitimacy('Proceed with Caution') === 'Proceed with Caution' &&
      parseLegitimacy('proceed with caution') === 'Proceed with Caution') {
    pass('parseLegitimacy parses Proceed with Caution variations');
  } else {
    fail('parseLegitimacy failed on Proceed with Caution');
  }

  if (parseLegitimacy('Suspicious') === 'Suspicious' &&
      parseLegitimacy('suspicious') === 'Suspicious') {
    pass('parseLegitimacy parses Suspicious variations');
  } else {
    fail('parseLegitimacy failed on Suspicious');
  }

  if (parseLegitimacy('unknown') === 'Proceed with Caution' &&
      parseLegitimacy('') === 'Proceed with Caution') {
    pass('parseLegitimacy defaults safely to Proceed with Caution for unknown/empty tiers');
  } else {
    fail('parseLegitimacy failed to default to Proceed with Caution');
  }
} catch (err) {
  fail(`parseLegitimacy tests threw: ${err.message}`);
}


// ── Test 3e: Verbatim JD archival in generated reports ────────────────────────
try {
  const mockWork = mkdtempSync(join(tmpdir(), 'cops-jdarchive-'));
  const oldReports = PATHS.reports;
  const oldAdditions = PATHS.trackerAdditions;
  PATHS.reports = join(mockWork, 'reports');
  PATHS.trackerAdditions = join(mockWork, 'tracker-additions');

  const rawJd = 'Verbatim Job Description: Software Engineer at Acme Corp. Must know Node.js, distributed systems, and CI/CD pipelines.';
  const mockBrowser = {
    newPage: async () => ({
      url: () => 'https://example.com/test-job',
      route: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => rawJd,
      close: async () => {}
    })
  };

  const mockEval = async () => `
## Executive Match Summary
Great fit.

---SCORE_SUMMARY---
COMPANY: Acme Corp
ROLE: Software Engineer
SCORE: 4.8
ARCHETYPE: Backend Engineer
LEGITIMACY: High Confidence
---END_SUMMARY---
`;

  await processOffer(mockBrowser, '- [ ] https://example.com/test-job | Acme | SWE', 1, mockEval);

  const reportFiles = readdirSync(PATHS.reports).filter(f => f.endsWith('.md') && !f.includes('RESERVED'));
  if (reportFiles.length > 0) {
    const reportText = readFileSync(join(PATHS.reports, reportFiles[0]), 'utf-8');
    if (reportText.includes('## Job Description (archived verbatim)') && reportText.includes(rawJd)) {
      pass('processOffer appends ## Job Description (archived verbatim) with raw scraped JD');
    } else {
      fail('processOffer report missing ## Job Description (archived verbatim) or raw JD text');
    }
  } else {
    fail('processOffer failed to write report file for JD archive test');
  }

  PATHS.reports = oldReports;
  PATHS.trackerAdditions = oldAdditions;
  rmSync(mockWork, { recursive: true, force: true });
} catch (err) {
  fail(`verbatim JD archival test threw: ${err.message}`);
}

// ── Test 4: batch/batch-runner.sh CLI flag parsing and prompt wiring ─────────
try {
  const runnerPath = join(ROOT, 'batch', 'batch-runner.sh');
  const runnerSrc = readFileSync(runnerPath, 'utf-8');

  if (runnerSrc.includes('--mode MODE') && runnerSrc.includes('--single-pass')) {
    pass('batch-runner.sh usage documents --mode and --single-pass');
  } else {
    fail('batch-runner.sh usage missing --mode or --single-pass documentation');
  }

  if (runnerSrc.includes('batch-prompt-match.md')) {
    pass('batch-runner.sh wires match mode to batch-prompt-match.md');
  } else {
    fail('batch-runner.sh does not reference batch-prompt-match.md');
  }

  // Verify batch/batch-prompt-match.md exists on disk and is well-formed
  const matchPromptFile = join(ROOT, 'batch', 'batch-prompt-match.md');
  if (existsSync(matchPromptFile)) {
    pass('batch/batch-prompt-match.md template exists');
    const content = readFileSync(matchPromptFile, 'utf-8');
    const requiredPlaceholders = ['{{URL}}', '{{JD_FILE}}', '{{REPORT_NUM}}', '{{DATE}}', '{{ID}}'];
    const allPlaceholdersPresent = requiredPlaceholders.every(p => content.includes(p));
    if (allPlaceholdersPresent) {
      pass('batch-prompt-match.md contains all orchestrator placeholders for prompt caching');
    } else {
      fail('batch-prompt-match.md missing one or more placeholders');
    }

    if (content.includes('one decimal place') && content.includes('4.45')) {
      pass('batch-prompt-match.md instructs score rounding to exactly one decimal place');
    } else {
      fail('batch-prompt-match.md missing score rounding instruction');
    }

    if (content.includes('language.output') && content.includes('Single-pass match evaluation')) {
      pass('batch-prompt-match.md instructs notes translation according to language.output');
    } else {
      fail('batch-prompt-match.md missing notes translation instruction');
    }
  } else {
    fail('batch/batch-prompt-match.md not found');
  }

  // Run batch-runner.sh with invalid --mode through bash
  const bash = getBash();
  try {
    execFileSync(bash, [runnerPath, '--mode', 'unsupported'], { stdio: 'pipe' });
    fail('batch-runner.sh --mode unsupported should exit with error');
  } catch (err) {
    const combinedOutput = `${err.stdout || ''}\n${err.stderr || ''}`;
    if (err.status !== 0 && combinedOutput.includes("Unknown --mode 'unsupported'")) {
      pass('batch-runner.sh rejects unknown --mode value with helpful error');
    } else {
      fail(`batch-runner.sh unexpected rejection output: ${combinedOutput}`);
    }
  }

  // Verify batch/batch-runner.sh handles malformed match mode worker outputs and enforces valid scores
  if (runnerSrc.includes('match_output_retries') && runnerSrc.includes('Malformed or missing match mode JSON summary')) {
    pass('batch-runner.sh includes retry handling for malformed or missing match mode JSON output');
  } else {
    fail('batch-runner.sh missing retry handling for malformed match mode output');
  }

  if (runnerSrc.includes('missing or invalid match mode score') && runnerSrc.includes('missing or invalid numeric score in match mode')) {
    pass('batch-runner.sh enforces required numeric score in match mode to prevent bypass or recording "-" as completed');
  } else {
    fail('batch-runner.sh missing score guard for match mode');
  }

} catch (err) {
  fail(`batch-runner.sh tests threw: ${err.message}`);
}
