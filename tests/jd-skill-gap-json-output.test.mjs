// tests/jd-skill-gap-json-output.test.mjs — the JSON branch of jd-skill-gap's
// CLI.
//
// jd-skill-gap.mjs --self-test covers the pure functions, but the CLI's output
// branches live inside the `process.argv[1] === import.meta.url` guard, so no
// in-file assertion can reach them. That gap is why the missing `lowConfidence`
// key survived: diagnoseExtraction() was called only inside the --summary
// branch, and the JSON branch — the one other tooling consumes, and the one
// modes/pdf.md Step 4 gates on — printed bare empty arrays that read exactly
// like a clean bill of health.
//
// So this suite runs the real binary with CAREER_OPS_ROOT set and parses what
// it actually prints. A fixture cv.md is required because the CLI exits 1
// without one — but it must live in the data root, not in the cwd (#4209).
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, formatRunFailure, ROOT, NODE } from './helpers.mjs';

console.log('\njd-skill-gap.mjs — JSON output branch');

// cv.md resolves from the data root, not from process.cwd() (#4209). A
// separate decoy cwd — different from the data root — proves the two paths
// are distinguished: if the script still read from cwd, it would find nothing
// and exit 1 before printing any JSON.
const dataRoot = mkdtempSync(join(tmpdir(), 'co-jd-skill-gap-json-data-'));
const decoyCwd = mkdtempSync(join(tmpdir(), 'co-jd-skill-gap-json-cwd-'));

try {
  writeFileSync(join(dataRoot, 'cv.md'), '# Skills\nPython, Docker\n');

  // A JD with a recognized requirements section: conclusive run.
  writeFileSync(
    join(dataRoot, 'extractable.md'),
    '# Role\n\nYOU HAVE:\n- Experience with Python and Kubernetes\n'
  );
  // No requirements section at all: the check cannot run.
  writeFileSync(
    join(dataRoot, 'headerless.md'),
    '# Role\n\nWe are a fast-growing team and we would love to hear from you.\n'
  );

  const runJson = (fixture) => {
    const out = run(NODE, [join(ROOT, 'jd-skill-gap.mjs'), join(dataRoot, fixture)], {
      cwd: decoyCwd,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' },
    });
    if (out === null) return null;
    try {
      return JSON.parse(out);
    } catch {
      fail(`${fixture}: stdout was not valid JSON — got: ${out.slice(0, 200)}`);
      return null;
    }
  };

  const conclusive = runJson('extractable.md');
  if (conclusive === null) {
    fail(`extractable.md run failed: ${formatRunFailure()}`);
  } else {
    for (const key of ['existing', 'supportedByResume', 'gap', 'lowConfidence']) {
      if (key in conclusive) pass(`JSON output carries "${key}"`);
      else fail(`JSON output is missing "${key}"`);
    }

    if (conclusive.lowConfidence === null) pass('a conclusive run reports lowConfidence: null');
    else fail(`a conclusive run should report lowConfidence: null, got ${JSON.stringify(conclusive.lowConfidence)}`);

    if (conclusive.existing.includes('Python')) pass('a named cv.md skill lands in existing');
    else fail(`expected Python in existing, got ${JSON.stringify(conclusive.existing)}`);

    if (conclusive.gap.includes('Kubernetes')) pass('a skill absent from cv.md lands in gap');
    else fail(`expected Kubernetes in gap, got ${JSON.stringify(conclusive.gap)}`);
  }

  // The regression this suite exists for: an empty result must be labelled, not
  // silently indistinguishable from "no gaps found".
  const inconclusive = runJson('headerless.md');
  if (inconclusive === null) {
    fail(`headerless.md run failed: ${formatRunFailure()}`);
  } else {
    const buckets = [...inconclusive.existing, ...inconclusive.supportedByResume, ...inconclusive.gap];
    if (buckets.length === 0) pass('a headerless JD classifies nothing');
    else fail(`expected no classified skills, got ${JSON.stringify(buckets)}`);

    if (inconclusive.lowConfidence && typeof inconclusive.lowConfidence === 'object') {
      pass('an inconclusive run reports a lowConfidence object rather than null');
    } else {
      fail('an empty result must carry lowConfidence — otherwise it reads as a clean bill of health');
    }

    if (inconclusive.lowConfidence?.reason === 'no-requirements-section') {
      pass('lowConfidence.reason identifies the missing requirements section');
    } else {
      fail(`expected reason "no-requirements-section", got ${JSON.stringify(inconclusive.lowConfidence?.reason)}`);
    }

    if (typeof inconclusive.lowConfidence?.message === 'string' && inconclusive.lowConfidence.message.length > 0) {
      pass('lowConfidence.message is a non-empty string');
    } else {
      fail('lowConfidence.message must be a non-empty string');
    }
  }

  // #4209: cv.md is found via CAREER_OPS_ROOT, not cwd. The decoyCwd has no
  // cv.md — if the script read from cwd it would have exited 1 above and every
  // runJson() call would have returned null. Reaching this point proves it read
  // from the data root instead.
  pass('cv.md is resolved from CAREER_OPS_ROOT, not from process.cwd()');
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(decoyCwd, { recursive: true, force: true });
}
