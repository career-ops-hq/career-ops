// tests/keyword-match-data-root-path.test.mjs — a relative report path resolves
// against the data root when it is not under the working directory (#6620).
//
// modes/oferta.md step 1b passes `reports/{###}-….md`, relative to the data
// root. With the user layer outside the checkout (a .career-ops-data marker or
// CAREER_OPS_ROOT), keyword-match.mjs looked only under the working directory
// and stopped with "Report not found".
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

console.log('\nkeyword-match: relative paths under the data root');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

const dataRoot = mkdtempSync(join(tmpdir(), 'kw-data-root-'));
mkdirSync(join(dataRoot, 'reports'));
writeFileSync(join(dataRoot, 'cv.md'), '# Candidate\n\nBuilt Python services and Docker images.\n');
// A second CV with different skills, so the --cv case can tell an explicit CV
// from the default one.
writeFileSync(join(dataRoot, 'cv-alt.md'), '# Candidate\n\nRan Kubernetes clusters.\n');
mkdirSync(join(dataRoot, 'jds'));
writeFileSync(join(dataRoot, 'jds', 'example.md'), [
  'Data Engineer',
  '',
  'We are hiring a data engineer to build and run our data platform. You will design batch and streaming pipelines,',
  'own their reliability, and work closely with analysts and product teams. Requirements: strong Python, hands-on',
  'Docker and Kubernetes, solid SQL, and experience operating services in production. Nice to have: Terraform and AWS.',
  '',
].join('\n'));
writeFileSync(join(dataRoot, 'reports', '001-example-2026-01-01.md'), [
  '# Evaluation: Example — Data Engineer',
  '',
  '## Keywords extracted',
  'Python, Docker, Kubernetes',
  '',
].join('\n'));

// The child runs from an empty directory of its own, so a jds/, reports/ or
// cv.md in the checkout can never shadow the data-root fixture and the
// fallback is what every case below actually exercises.
const workDir = mkdtempSync(join(tmpdir(), 'kw-cwd-'));

// A second working directory that holds a stale copy of the same report, with
// different keywords, for the case where both locations have the file.
const staleDir = mkdtempSync(join(tmpdir(), 'kw-stale-cwd-'));
mkdirSync(join(staleDir, 'reports'));
writeFileSync(join(staleDir, 'reports', '001-example-2026-01-01.md'), [
  '# Evaluation: Example — Data Engineer (stale copy)',
  '',
  '## Keywords extracted',
  'Rust, Haskell',
  '',
].join('\n'));
// ...and a report that exists only there, which the data root does not have.
writeFileSync(join(staleDir, 'reports', '002-only-in-cwd-2026-01-01.md'), [
  '# Evaluation: Example — Platform Engineer (only in the working directory)',
  '',
  '## Keywords extracted',
  'Rust, Haskell',
  '',
].join('\n'));

const run = (args, cwd = workDir) => spawnSync(NODE, [join(ROOT, 'keyword-match.mjs'), ...args], {
  encoding: 'utf-8',
  cwd,
  env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
});

try {
  check('reports/{file} is found under the data root', () => {
    const r = run(['reports/001-example-2026-01-01.md']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /\*\*Present \(2\):\*\* Python, Docker/);
  });

  check('--cv cv-alt.md is found under the data root and used instead of cv.md', () => {
    const r = run(['reports/001-example-2026-01-01.md', '--cv', 'cv-alt.md']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /\*\*Present \(1\):\*\* Kubernetes/);
  });

  check('--jd-text jds/{file} is found under the data root', () => {
    const r = run(['--jd-text', 'jds/example.md']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /Python/);
  });

  check('the data root wins when the working directory has a stale copy of the same path', () => {
    const r = run(['reports/001-example-2026-01-01.md'], staleDir);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /\*\*Present \(2\):\*\* Python, Docker/);
    assert.doesNotMatch(r.stdout, /Rust|Haskell/);
  });

  check('a report missing from the data root is not read from a copy in the working directory', () => {
    const r = run(['reports/002-only-in-cwd-2026-01-01.md'], staleDir);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stderr, /Report not found: reports\/002-only-in-cwd-2026-01-01\.md/);
    assert.match(r.stderr, /pass \.\/reports\/002-only-in-cwd-2026-01-01\.md/);
    assert.doesNotMatch(r.stdout, /Rust|Haskell/);
  });

  check('an explicit ./ path still reads the working directory', () => {
    const r = run(['./reports/002-only-in-cwd-2026-01-01.md'], staleDir);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /Rust/);
  });

  check('a path found in neither place still stops with "Report not found"', () => {
    const r = run(['reports/999-missing-2026-01-01.md']);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stderr, /Report not found: reports\/999-missing-2026-01-01\.md/);
  });
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
  rmSync(staleDir, { recursive: true, force: true });
}
