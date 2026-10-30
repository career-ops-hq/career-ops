// tests/cv-dollar-pattern.test.mjs — candidate text containing a JS
// String.replace $-pattern must not be interpreted during template fill.
//
// Both CV builders filled placeholders by passing the escaped value as the
// STRING replacement argument. JS scans that argument for $&, $', $` and $$,
// and neither escapeLatex nor escapeHtml neutralizes those two-character
// sequences — escapeLatex turns `$` into `\$` and leaves the next character be.
//
// So a perfectly ordinary bullet corrupted the document:
//   "$'000"  -> $' means "everything after the match", splicing the remainder
//              of the TEMPLATE into the CV. build-cv-latex emitted a .tex with
//              two \end{document} and still reported "valid": true, exit 0.
//   "$&500K" -> $& means "the matched text", re-inserting {{BULLETS}} itself,
//              which then tripped build-cv-html's unresolved-placeholder guard
//              and failed the build with a misattributed error.
//
// Money amounts in bullets are exactly where this shows up, which is to say:
// on real CVs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = () => mkdtempSync(join(tmpdir(), 'cv-dollar-'));

const run = (script, payload, out) =>
  execFileSync(process.execPath, [join(ROOT, script), payload, out], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

test("build-cv-latex: a $' in a bullet does not splice the template", () => {
  const dir = tmp();
  const payload = join(dir, 'p.json');
  const out = join(dir, 'out.tex');
  writeFileSync(payload, JSON.stringify({
    name: 'Test Candidate',
    contact_line: 'City',
    email: { url: 't@example.com', display: 't@example.com' },
    linkedin: { url: '', display: '' },
    github: { url: '', display: '' },
    education: [], projects: [], awards: [], skills: [],
    experience: [{
      company: 'Test Corp', role: 'Engineer', location: 'Remote', dates: '2024',
      bullets: ["Reported budget lines in $'000 format for quarterly reviews"],
    }],
  }));

  run('build-cv-latex.mjs', payload, out);
  const tex = readFileSync(out, 'utf-8');

  // The splice duplicated everything after the match, including the preamble's end.
  const endCount = (tex.match(/\\end\{document\}/g) || []).length;
  assert.equal(endCount, 1, 'template must not be spliced into the body');
  assert.match(tex, /Reported budget lines in \\\$'000 format for quarterly reviews/);
});

test('build-cv-html: a $& in a bullet does not re-insert the placeholder', () => {
  const dir = tmp();
  const payload = join(dir, 'p.json');
  const out = join(dir, 'out.html');
  writeFileSync(payload, JSON.stringify({
    lang: 'en',
    page_format: 'letter',
    candidate: { name: 'Test Candidate', email: 't@example.com' },
    summary: 'Backend engineer.',
    competencies: ['Cloud'],
    projects: [], education: [], certifications: [], awards: [], skills: [],
    experience: [{
      company: 'Test Corp', role: 'Engineer', dates: '2024',
      bullets: ['Delivered cost savings of $&500K across the org'],
    }],
  }));

  // Before the fix this exited non-zero with "Unresolved placeholders: {{BULLETS}}".
  run('build-cv-html.mjs', payload, out);
  const html = readFileSync(out, 'utf-8');

  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/, 'no placeholder may survive the fill');
  assert.match(html, /Delivered cost savings of \$&amp;500K across the org/);
});

test('build-cv-latex: $` and $$ in a bullet survive verbatim', () => {
  const dir = tmp();
  const payload = join(dir, 'p.json');
  const out = join(dir, 'out.tex');
  writeFileSync(payload, JSON.stringify({
    name: 'Test Candidate',
    contact_line: 'City',
    email: { url: 't@example.com', display: 't@example.com' },
    linkedin: { url: '', display: '' },
    github: { url: '', display: '' },
    education: [], projects: [], awards: [], skills: [],
    experience: [{
      company: 'Test Corp', role: 'Engineer', location: 'Remote', dates: '2024',
      // $` = text before the match; $$ = a literal single $.
      bullets: ['Cut spend from $$4M using the $`legacy pipeline'],
    }],
  }));

  run('build-cv-latex.mjs', payload, out);
  const tex = readFileSync(out, 'utf-8');

  assert.equal((tex.match(/\\end\{document\}/g) || []).length, 1);
  // $$ must not collapse to a single $, and $` must not pull in preceding text.
  assert.match(tex, /Cut spend from \\\$\\\$4M using the \\\$`legacy pipeline/);
});
