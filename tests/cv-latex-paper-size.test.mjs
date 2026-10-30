// tests/cv-latex-paper-size.test.mjs — the LaTeX path must honor the same sheet
// the HTML path does.
//
// modes/pdf.md tells the reader that a `page_format` in config/profile.yml "is
// the user's standing answer and it already reaches every renderer". It did not:
// templates/cv-template.tex hardcoded `\documentclass[letterpaper,11pt]`, and
// build-cv-latex.mjs had no PAPER substitution, so a candidate in DACH who set
// `page_format: a4` got an A4 body on the HTML path and a Letter sheet from the
// LaTeX path in the same run. `paper` in the payload was worse than ignored —
// validatePayload reported it as a key the tex builder does not read.
//
// The sheet is now decided by lib/page-format.mjs, the single source both
// renderers consult, so these cases pin the ranking it already documents:
// payload `page_format` > profile > `auto` + `country` > the project default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ROOT } from './helpers.mjs';

const BASE = {
  name: 'Test Candidate',
  contact_line: 'Berlin, Germany',
  email: { url: 't@example.com', display: 't@example.com' },
  linkedin: { url: '', display: '' },
  github: { url: '', display: '' },
  education: [], projects: [], awards: [], skills: [],
  experience: [{ company: 'Test Corp', role: 'Engineer', location: 'Remote', dates: '2024', bullets: ['Did work'] }],
};

// getProfilePath() honors CAREER_OPS_PROFILE, which is how a test supplies a
// profile without writing into the repo's own config/.
function build(payload, { profileYaml } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-paper-'));
  const input = join(dir, 'p.json');
  const out = join(dir, 'out.tex');
  writeFileSync(input, JSON.stringify(payload));

  const env = { ...process.env };
  if (profileYaml !== undefined) {
    const profile = join(dir, 'profile.yml');
    writeFileSync(profile, profileYaml);
    env.CAREER_OPS_PROFILE = profile;
  } else {
    // No profile at all: a stray real one must not decide this test.
    env.CAREER_OPS_PROFILE = join(dir, 'absent.yml');
  }

  execFileSync(process.execPath, [join(ROOT, 'build-cv-latex.mjs'), input, out], {
    cwd: ROOT,
    encoding: 'utf-8',
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return readFileSync(out, 'utf-8');
}

const sheetOf = (tex) => (tex.match(/\\documentclass\[(\w+),11pt\]\{article\}/) || [])[1];

test('payload page_format: a4 selects a4paper', () => {
  assert.equal(sheetOf(build({ ...BASE, page_format: 'a4' })), 'a4paper');
});

test('payload page_format: letter selects letterpaper', () => {
  assert.equal(sheetOf(build({ ...BASE, page_format: 'letter' })), 'letterpaper');
});

test('no page_format anywhere falls back to the project default, letter', () => {
  assert.equal(sheetOf(build(BASE)), 'letterpaper');
});

test('profile page_format reaches the LaTeX template', () => {
  const tex = build(BASE, { profileYaml: 'candidate:\n  full_name: Test\npage_format: a4\n' });
  assert.equal(sheetOf(tex), 'a4paper');
});

test('payload page_format outranks the profile, as it does on the HTML path', () => {
  const tex = build({ ...BASE, page_format: 'letter' }, {
    profileYaml: 'page_format: a4\n',
  });
  assert.equal(sheetOf(tex), 'letterpaper');
});

test('page_format: auto with a DACH country selects a4paper', () => {
  assert.equal(sheetOf(build({ ...BASE, page_format: 'auto', country: 'DE' })), 'a4paper');
});

test('page_format: auto with the US selects letterpaper', () => {
  assert.equal(sheetOf(build({ ...BASE, page_format: 'auto', country: 'US' })), 'letterpaper');
});

test('page_format on a tex payload is recognized, not reported as an unread key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-paper-warn-'));
  const input = join(dir, 'p.json');
  const out = join(dir, 'out.tex');
  writeFileSync(input, JSON.stringify({ ...BASE, page_format: 'a4' }));
  const run = spawnSync(process.execPath, [join(ROOT, 'build-cv-latex.mjs'), input, out], {
    cwd: ROOT, encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_PROFILE: join(dir, 'absent.yml') },
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /page_format/);
});
