// tests/batch-single-pass-mode.test.mjs — tests for optional single-pass CV-match evaluation mode
// covering CLI flags (--mode match, --single-pass), multi-step bypass,
// and condensed single-pass prompt generation.

import { pass, fail, ROOT, getBash, toBashPath, linkNodeModules } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
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

  for (const bad of [['--mode'], ['--mode', '--limit=3'], ['--mode='], ['--mode', 'mach']]) {
    let threw = false;
    try { parseCliMode(bad); } catch { threw = true; }
    if (threw) {
      pass(`parseCliMode rejects ${JSON.stringify(bad)} instead of falling back to full`);
    } else {
      fail(`parseCliMode accepted ${JSON.stringify(bad)}`);
    }
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
  writeFileSync(PATHS.custom, '# House rules\n- Never below 90k EUR\n', 'utf-8');
  const dummyProfilePath = join(workDir, 'profile.yml');
  PATHS.profileYml = dummyProfilePath;

  const dummyProfileMd = join(workDir, '_profile.md');
  writeFileSync(dummyProfileMd, '# Archetypes\n- AI Engineer\n', 'utf-8');
  PATHS.profile = dummyProfileMd;

  const dummyCvPath = join(workDir, 'cv.md');
  writeFileSync(dummyCvPath, '# Jane Doe\n## Experience\n- Staff Engineer at Acme (2020-2026)\n- Senior Engineer at Beta (2015-2020)\n', 'utf-8');
  PATHS.cv = dummyCvPath;

  writeFileSync(dummyProfilePath, 'candidate:\n  full_name: "Jane Doe"\nspend_tier: standard\ncompensation:\n  minimum: 95000\nlanguage:\n  output: es\n', 'utf-8');

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

  // Match mode prompt must NOT include profileContent or profileYml (relies strictly on CV evidence)
  if (!matchPrompt.includes('TARGET ROLES & PREFERENCES') && !matchPrompt.includes('AI Engineer') && !matchPrompt.includes('spend_tier: standard')) {
    pass('match mode prompt omits profileContent and profileYml (relies strictly on CV evidence)');
  } else {
    fail('match mode prompt unexpectedly included profileContent or profileYml');
  }

  if (!matchPrompt.includes('Never below 90k') && !matchPrompt.includes('95000')) {
    pass('match mode prompt omits _custom.md and the profile compensation (#5297)');
  } else {
    fail('match mode prompt leaked _custom.md or compensation from profile.yml');
  }

  // language.output is the one profile setting match mode takes (#5297).
  if (matchPrompt.includes('OUTPUT LANGUAGE') && /human-facing output \(report prose and headings\) in es,/.test(matchPrompt)) {
    pass('match mode prompt carries language.output from profile.yml');
  } else {
    fail('match mode prompt missing language.output');
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

  if (parseLegitimacy('Not High Confidence') === 'Proceed with Caution' &&
      parseLegitimacy("isn't high confidence") === 'Proceed with Caution') {
    pass('parseLegitimacy does not read a negated label as High Confidence');
  } else {
    fail('parseLegitimacy read a negated label as High Confidence');
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
// processOffer() reserves the report number in a child process
// (reserve-report-num.mjs), which does not see the PATHS overrides. Point it at
// the temp dir through its env vars too, so the test never touches the real
// reports/, batch/batch-state.tsv or the tracker lock.
const mockWork = mkdtempSync(join(tmpdir(), 'cops-jdarchive-'));
const oldReports = PATHS.reports;
const oldAdditions = PATHS.trackerAdditions;
const oldReportsEnv = process.env.CAREER_OPS_REPORTS_DIR;
const oldBatchStateEnv = process.env.CAREER_OPS_BATCH_STATE;
const oldTrackerEnv = process.env.CAREER_OPS_TRACKER;
try {
  PATHS.reports = join(mockWork, 'reports');
  PATHS.trackerAdditions = join(mockWork, 'tracker-additions');
  mkdirSync(PATHS.reports, { recursive: true });
  process.env.CAREER_OPS_REPORTS_DIR = PATHS.reports;
  process.env.CAREER_OPS_BATCH_STATE = join(mockWork, 'batch-state.tsv');
  process.env.CAREER_OPS_TRACKER = join(mockWork, 'applications.md');
  // Run this report through match mode, which writes no PDF.
  writeFileSync(join(mockWork, 'cv.md'), '# Jane Doe\n', 'utf-8');
  writeFileSync(join(mockWork, '_profile.md'), '# Archetypes\n', 'utf-8');
  writeFileSync(join(mockWork, 'profile.yml'), 'language:\n  output: en\n', 'utf-8');
  PATHS.cv = join(mockWork, 'cv.md');
  PATHS.profile = join(mockWork, '_profile.md');
  PATHS.profileYml = join(mockWork, 'profile.yml');
  PATHS.custom = join(mockWork, '_custom.md');
  loadContext('match');

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
    if (reportText.includes('**PDF:** ❌') && !reportText.includes('**PDF:** pending')) {
      pass('match mode report marks the PDF as not generated instead of pending');
    } else {
      fail('match mode report still claims **PDF:** pending');
    }
  } else {
    fail('processOffer failed to write report file for JD archive test');
  }
} catch (err) {
  fail(`verbatim JD archival test threw: ${err.message}`);
} finally {
  PATHS.reports = oldReports;
  PATHS.trackerAdditions = oldAdditions;
  PATHS.cv = originalCv;
  PATHS.profile = originalProfile;
  PATHS.profileYml = originalProfileYml;
  PATHS.custom = originalCustom;
  if (oldReportsEnv === undefined) delete process.env.CAREER_OPS_REPORTS_DIR;
  else process.env.CAREER_OPS_REPORTS_DIR = oldReportsEnv;
  if (oldBatchStateEnv === undefined) delete process.env.CAREER_OPS_BATCH_STATE;
  else process.env.CAREER_OPS_BATCH_STATE = oldBatchStateEnv;
  if (oldTrackerEnv === undefined) delete process.env.CAREER_OPS_TRACKER;
  else process.env.CAREER_OPS_TRACKER = oldTrackerEnv;
  rmSync(mockWork, { recursive: true, force: true });
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

// ── Test 5: the Claude match path gets the output language, not the profile ──
// #5297: a match worker must not see _profile.md, _custom.md or the targeting
// and compensation in profile.yml; the full mode still gets all three.
{
  const base = mkdtempSync(join(tmpdir(), 'cops-match-profile-'));
  const runMode = (modeArgs) => {
    const dir = join(base, `checkout-${modeArgs.join('-') || 'full'}`);
    const binDir = join(dir, 'stub-bin');
    const capture = join(dir, 'captured-system-prompt.md');
    for (const d of [join(dir, 'batch'), join(dir, 'modes'), join(dir, 'config'), binDir]) mkdirSync(d, { recursive: true });
    writeFileSync(join(dir, 'batch', 'batch-runner.sh'), readFileSync(join(ROOT, 'batch', 'batch-runner.sh'), 'utf-8'), { mode: 0o755 });
    writeFileSync(join(dir, 'batch', 'batch-prompt.md'), 'Full worker prompt fixture.\n');
    writeFileSync(join(dir, 'batch', 'batch-prompt-match.md'), 'Match worker prompt fixture.\n');
    writeFileSync(join(dir, 'batch', 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/one\tfixture\t-\n');
    writeFileSync(join(dir, 'path-resolver.mjs'), readFileSync(join(ROOT, 'path-resolver.mjs'), 'utf-8'));
    writeFileSync(join(dir, 'profile-language.mjs'), readFileSync(join(ROOT, 'profile-language.mjs'), 'utf-8'));
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'yaml-document.mjs'), readFileSync(join(ROOT, 'lib', 'yaml-document.mjs'), 'utf-8'));
    const linkProblem = linkNodeModules(dir);
    if (linkProblem) throw new Error(linkProblem);
    writeFileSync(join(dir, 'reserve-report-num.mjs'), "if (!process.argv.includes('--release')) console.log('001');\n");
    for (const name of ['merge-tracker.mjs', 'reconcile-pipeline.mjs', 'verify-pipeline.mjs']) writeFileSync(join(dir, name), '// Not under test here.\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'compensation:\n  minimum: 95000\nlanguage:\n  output: es\n');
    writeFileSync(join(dir, 'modes', '_profile.md'), '# Archetypes\n- PROFILE-ARCHETYPE-MARKER\n');
    writeFileSync(join(dir, 'modes', '_custom.md'), '# House rules\n- CUSTOM-RULE-MARKER\n');
    writeFileSync(join(binDir, 'claude'), [
      '#!/usr/bin/env bash',
      'while [[ $# -gt 0 ]]; do',
      '  if [[ "$1" == "--append-system-prompt-file" ]]; then cp "$2" "$CAPTURE_FILE"; fi',
      '  shift',
      'done',
      'exit 1',
      '',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, CAPTURE_FILE: capture };
    for (const key of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_REPORTS_DIR', 'CAREER_OPS_BATCH_STATE', 'CAREER_OPS_TRACKER']) delete env[key];
    try {
      execFileSync(getBash(), [toBashPath(join(dir, 'batch', 'batch-runner.sh')), ...modeArgs, '--parallel', '1', '--max-retries', '0', '--rate-limit-sleep', '0'], {
        cwd: dir, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
      });
    } catch { /* the stub worker fails on purpose; only the captured prompt matters */ }
    return existsSync(capture) ? readFileSync(capture, 'utf-8') : null;
  };
  try {
    const matchPrompt = runMode(['--mode', 'match']);
    const fullPrompt = runMode([]);
    if (matchPrompt === null || fullPrompt === null) {
      fail('Claude match/full prompt test: the stub worker was never launched');
    } else {
      if (matchPrompt.startsWith('Match worker prompt fixture.')
          && !matchPrompt.includes('PROFILE-ARCHETYPE-MARKER')
          && !matchPrompt.includes('CUSTOM-RULE-MARKER')
          && !matchPrompt.includes('95000')) {
        pass('Claude match worker prompt carries no _profile.md, _custom.md or profile.yml content (#5297)');
      } else {
        fail('Claude match worker prompt leaked profile content');
      }
      if (/## Runtime output language[\s\S]*language\.output for this run: `es`/.test(matchPrompt)) {
        pass('Claude match worker prompt carries language.output from profile.yml');
      } else {
        fail('Claude match worker prompt missing language.output');
      }
      if (fullPrompt.includes('PROFILE-ARCHETYPE-MARKER') && fullPrompt.includes('CUSTOM-RULE-MARKER') && fullPrompt.includes('95000')) {
        pass('Claude full worker prompt still carries the profile personalization');
      } else {
        fail('Claude full worker prompt lost the profile personalization');
      }
    }
  } catch (err) {
    fail(`Claude match/full prompt test threw: ${err.message}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
