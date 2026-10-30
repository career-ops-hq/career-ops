// tests/jd-skill-gap.test.mjs — the JD skill classifier compares a
// posting against the user's cv.md, so it has to find that cv.md.
//
//   const CV_PATH = 'cv.md';   // -> process.cwd()
//
// cv.md is a Source-of-Truth Boundary primary file and lives wherever
// CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR / the .career-ops-data marker points. A
// bare relative path resolves against whatever directory the process was
// started in, so from anywhere else:
//
//   Error: cv.md not found — this is a user-layer file, create it first.
//
// The advice is wrong for the user it reaches: they HAVE one, and following it
// creates a second copy in the wrong place. Everything this script reports is a
// comparison against that file, so without it there is nothing to say at all.
//
// Run:  node --test tests/jd-skill-gap.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Kubernetes and Terraform are in the CV; the rest are not. That split is the
// measurement — a run that finds no CV cannot produce it.
const CV = '# CV\n\n- Deep Kubernetes and Terraform experience in production.\n';
const JD = [
  '# Senior Platform Engineer', '',
  '## Requirements',
  '- 5+ years with Kubernetes and Docker in production',
  '- Strong Terraform and AWS experience',
  '- Proficiency in Python and Go', '',
].join('\n');

function fixture() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-jdgap-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-jddecoy-'));
  writeFileSync(join(dataRoot, 'cv.md'), CV);
  writeFileSync(join(dataRoot, 'jd.md'), JD);
  return { dataRoot, decoyCwd };
}

const cleanup = (f) => {
  for (const d of [f.dataRoot, f.decoyCwd]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

function run(f, args = ['--summary']) {
  const r = spawnSync(process.execPath, [join(ROOT, 'jd-skill-gap.mjs'), join(f.dataRoot, 'jd.md'), ...args], {
    cwd: f.decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: f.dataRoot, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('it finds the data root cv.md instead of reporting it missing', () => {
  const f = fixture();
  try {
    const r = run(f);
    assert.doesNotMatch(
      r.all,
      /cv\.md not found/i,
      `it looked in the cwd and told a user who has a CV to create one:\n${r.all.slice(0, 400)}`,
    );
  } finally { cleanup(f); }
});

test('and classifies against it, rather than calling everything a gap', () => {
  // The half that matters. "Found no CV" and "found a CV with nothing in it"
  // both produce an empty match list, so absence of the error is not enough —
  // the skills that ARE in the CV have to come back matched.
  const f = fixture();
  try {
    const r = run(f);
    assert.match(r.all, /Kubernetes/, `Kubernetes was not classified at all:\n${r.all.slice(0, 400)}`);
    const gapLine = r.all.split('\n').find((l) => /Real gaps/i.test(l)) ?? '';
    assert.doesNotMatch(gapLine, /Kubernetes|Terraform/, `a skill present in cv.md was reported as a gap: ${gapLine}`);
  } finally { cleanup(f); }
});

test('a skill genuinely absent from the CV is still a gap', () => {
  // The guard: finding the CV must not make everything match. Docker, AWS,
  // Python and Go are in the JD and not in the CV.
  const f = fixture();
  try {
    const gapLine = run(f).all.split('\n').find((l) => /Real gaps/i.test(l)) ?? '';
    assert.match(gapLine, /Docker/, `a genuine gap stopped being reported: ${gapLine}`);
  } finally { cleanup(f); }
});
