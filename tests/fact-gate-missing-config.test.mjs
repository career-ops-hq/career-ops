// tests/fact-gate-missing-config.test.mjs — a fact gate with no config loaded
// must not look like a fact gate that ran and found nothing.
//
// config/cv-facts.json is optional and absent from a fresh clone, and its
// forbidden_phrases/warn_phrases are the only phrase-level guard the module
// has. loadConfig() returned the empty shape for a missing file, so the two
// states produced a byte-identical clean result and every render reported the
// gate as passing — including the renders of a claim that had been
// deliberately quarantined (#3894).
//
// Deliberately a warning, never a failure: a user who never wrote a
// cv-facts.json is in a normal state. The assertions below pin the
// distinction, not a verdict change.
//
// Run:  node test-all.mjs --only fact-gate-missing-config

import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
// Namespace import on purpose: a named import of a not-yet-existing export is a
// SyntaxError at link time, which kills the whole suite before a single
// assertion runs and reports one opaque failure instead of the real set.
import * as factGate from '../verify-cv-facts.mjs';

const { loadFactConfig, verifyFacts } = factGate;

console.log('\nFact gate: missing config is a distinguishable state (#3894)');

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-facts-missing-config-'));
try {
  const source = join(tmp, 'cv.md');
  const presentConfig = join(tmp, 'cv-facts.json');
  const missingConfig = join(tmp, 'no-such-cv-facts.json');
  const target = join(tmp, 'cv.html');
  writeFileSync(source, 'Improved reliability for 25 users.');
  writeFileSync(presentConfig, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));
  writeFileSync(target, '<html><body><p>Improved reliability for 25 users.</p></body></html>');

  // 1. loadFactConfig reports existence separately from content.
  if (typeof loadFactConfig !== 'function') {
    fail('loadFactConfig is not exported — callers have no way to tell a disabled gate from a clean one');
  } else {
    const absent = loadFactConfig(missingConfig);
    if (absent.missing === true && Array.isArray(absent.config?.forbidden_phrases)) {
      pass('loadFactConfig reports missing:true and still returns a usable empty config');
    } else {
      fail(`loadFactConfig did not flag an absent config: ${JSON.stringify(absent)}`);
    }

    const present = loadFactConfig(presentConfig);
    if (present.missing === false && Array.isArray(present.config?.forbidden_phrases)) {
      pass('loadFactConfig reports missing:false for a config that exists');
    } else {
      fail(`loadFactConfig mis-reported an existing config: ${JSON.stringify(present)}`);
    }

    // Validation must survive the shape change — a malformed config is still an error.
    const malformed = join(tmp, 'malformed.json');
    writeFileSync(malformed, JSON.stringify({ forbidden_phrases: 'not-an-array' }));
    try {
      loadFactConfig(malformed);
      fail('loadFactConfig accepted a non-array forbidden_phrases');
    } catch (err) {
      if (/forbidden_phrases must be an array/.test(err.message)) {
        pass('loadFactConfig still rejects a non-array key');
      } else {
        fail(`loadFactConfig threw the wrong error for a malformed config: ${err.message}`);
      }
    }
  }

  // 2. The distinction the issue is about: disabled vs ran-clean must not be
  //    the same result object.
  const ranClean = verifyFacts('Improved reliability for 25 users.', { sourcePaths: [source], configPath: presentConfig });
  const disabled = verifyFacts('Improved reliability for 25 users.', { sourcePaths: [source], configPath: missingConfig });
  if (JSON.stringify(ranClean) === JSON.stringify(disabled)) {
    fail('a disabled fact gate and a gate that ran clean returned identical results');
  } else {
    pass('a disabled fact gate and a gate that ran clean return distinguishable results');
  }
  if (disabled.configMissing === true && ranClean.configMissing === false) {
    pass('verifyFacts surfaces configMissing on both sides');
  } else {
    fail(`verifyFacts did not surface configMissing (disabled=${JSON.stringify(disabled.configMissing)}, ran-clean=${JSON.stringify(ranClean.configMissing)})`);
  }

  // 3. A warning, not a failure: the verdict is untouched.
  if (disabled.verdict === 'pass') {
    pass('a missing config stays a warning — the verdict is not downgraded');
  } else {
    fail(`a missing config changed the verdict to ${disabled.verdict} — it must stay advisory`);
  }

  // 4. The CLI render path says so out loud, and still exits 0.
  const cli = (configPath) => spawnSync(NODE, [
    join(ROOT, 'verify-cv-facts.mjs'), target, '--source', source, '--config', configPath,
  ], { cwd: tmp, encoding: 'utf-8', timeout: 30_000 });

  const cliMissing = cli(missingConfig);
  const missingOutput = `${cliMissing.stdout}${cliMissing.stderr}`;
  const cliPresent = cli(presentConfig);
  const presentOutput = `${cliPresent.stdout}${cliPresent.stderr}`;
  if (missingOutput === presentOutput) {
    fail('the CLI printed the same output with and without a fact-gate config');
  } else if (/cv-facts|fact-gate config/i.test(missingOutput.replace(presentOutput, ''))) {
    pass('the CLI names the missing fact-gate config');
  } else {
    fail(`the CLI output differed but never named the missing config: ${JSON.stringify(missingOutput)}`);
  }
  if (cliMissing.status === 0) {
    pass('the CLI still exits 0 with no config — a warning, not a gate failure');
  } else {
    fail(`the CLI exited ${cliMissing.status} with no config — a missing config must not fail the run`);
  }

  const cliJson = spawnSync(NODE, [
    join(ROOT, 'verify-cv-facts.mjs'), target, '--source', source, '--config', missingConfig, '--json',
  ], { cwd: tmp, encoding: 'utf-8', timeout: 30_000 });
  let parsed = null;
  try { parsed = JSON.parse(cliJson.stdout); } catch { /* reported below */ }
  if (parsed?.configMissing === true) {
    pass('--json carries configMissing so a machine caller can see the gate was not loaded');
  } else {
    fail(`--json did not carry configMissing:true (stdout: ${JSON.stringify(cliJson.stdout)})`);
  }

  // 5. The two document render paths surface it too. Asserted at source level:
  //    both gate calls sit behind a Playwright import, so exercising them here
  //    would mean rendering a real PDF to test one console line.
  for (const script of ['generate-pdf.mjs', 'generate-cover-letter.mjs']) {
    const src = readFileSync(join(ROOT, script), 'utf-8');
    if (/configMissing[\s\S]{0,200}?console\.(warn|error)/.test(src)) {
      pass(`${script} warns when the fact-gate config is missing`);
    } else {
      fail(`${script} never surfaces configMissing — its renders still report a disabled gate as clean`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
