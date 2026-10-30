// tests/keyword-match-jd-fallback.test.mjs — a report with no keyword section
// still gets a coverage check, read from its archived JD, and says so loudly.
//
// Before this, keyword-match.mjs exited 1 with one stderr line. An agent running
// modes/pdf.md Step 22 in a batch could drop that line and report no coverage
// at all, so the tailored CV shipped without a keyword check.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

console.log('\nkeyword-match: archived-JD fallback');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

const dir = mkdtempSync(join(tmpdir(), 'kw-fallback-'));
const cvPath = join(dir, 'cv.md');
writeFileSync(cvPath, '# Candidate\n\nBuilt Python services and Docker images.\n');

function run(reportText, extraArgs = []) {
  const reportPath = join(dir, 'report.md');
  writeFileSync(reportPath, reportText);
  return spawnSync(NODE, [join(ROOT, 'keyword-match.mjs'), reportPath, '--cv', cvPath, ...extraArgs], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: dir },
  });
}

const jdOnlyReport = [
  '# Evaluation: Example Co — Data Engineer',
  '',
  '## A) Role Summary',
  'A data role.',
  '',
  '## Job Description (archived verbatim)',
  'Qualifications',
  'Experience with Python, Kubernetes and Docker',
  '',
].join('\n');

try {
  check('a report with no keyword section is scored from its archived JD', () => {
    const r = run(jdOnlyReport);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stderr, /no "## Keywords extracted" section/);
    assert.match(r.stdout, /_Keywords: 3 taken from the archived job description/);
    assert.match(r.stdout, /\*\*Present \(2\):\*\* Docker, Python/);
    assert.match(r.stdout, /\*\*Missing \(1\):\*\* Kubernetes/);
  });

  check('the JSON output names where the keywords came from', () => {
    const r = run(jdOnlyReport, ['--json']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).keywordSource, 'archived-jd');
  });

  check('a report with a keyword section reports that source', () => {
    const r = run(`## Keywords extracted\n- Python\n\n${jdOnlyReport}`, ['--json']);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.keywordSource, 'report');
    assert.deepEqual(out.present, ['Python']);
  });

  check('the archive pointer form is followed to the jds/ file', () => {
    mkdirSync(join(dir, 'jds'), { recursive: true });
    writeFileSync(join(dir, 'jds', '007-example.md'), 'Requirements\nKubernetes and Docker\n');
    const r = run('## Job Description (archived verbatim)\nSee jds/007-example.md for the full archive (archive-posting.mjs --report=007).\n', ['--json']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.deepEqual(JSON.parse(r.stdout).missing, ['Kubernetes']);
  });

  check('an archive pointer that leaves jds/ is not read', () => {
    writeFileSync(join(dir, 'outside.md'), 'Kubernetes and Docker\n');
    const r = run('## Job Description (archived verbatim)\nSee jds/../Kubernetes.md for the full archive (archive-posting.mjs --report=007).\n');
    assert.equal(r.status, 1, describeSpawn(r));
    assert.equal(r.stdout, '');
  });

  check('a report with neither section exits 1 and names both', () => {
    const r = run('# Evaluation\n\n## A) Role Summary\nNothing else.\n');
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stderr, /## Keywords extracted/);
    assert.match(r.stderr, /## Job Description/);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
