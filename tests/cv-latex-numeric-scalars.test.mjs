// tests/cv-latex-numeric-scalars.test.mjs — the LaTeX mirror of #2641.
//
// #2641 removed `typeof text !== 'string' -> ''` from escapeHtml because a
// machine-authored payload with `dates: 2024` (a JSON number, not "2024")
// rendered an empty field while the section stayed present. escapeLatex — the
// function build-cv-latex.mjs runs every value through — kept the same guard,
// so the .tex shipped without employment dates, education dates, project dates
// or award years, and the builder still reported "valid": true and exited 0.
//
// End-to-end through the real builder and the shipped template, because
// build-cv-latex.mjs exports nothing. Field names are the ones THIS builder
// reads (education uses `dates`, awards use `year`) — they differ from the HTML
// builder's in places, which is a schema question this test does not touch.
import { pass, fail, ROOT, NODE, run, lastRunFailure } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nbuild-cv-latex — numeric scalars');

// Numbers on purpose: every date/year below is a JSON number, not a string.
const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Numeric Scalars', email: 'num@example.com' },
  summary: 'Summary.',
  competencies: ['Competency'],
  experience: [{ company: 'Corp', role: 'Engineer', dates: 2024, bullets: ['Did a thing'] }],
  education: [{ institution: 'Uni', degree: 'BSc Computing', dates: 2019 }],
  awards: [{ title: 'Prize', year: 2025 }],
  projects: [{ name: 'Proj', dates: 2023, bullets: ['Built a thing'] }],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-latex-numeric-'));
try {
  const input = join(dir, 'num.json');
  const output = join(dir, 'num.tex');
  writeFileSync(input, JSON.stringify(PAYLOAD));

  if (run(NODE, [join(ROOT, 'build-cv-latex.mjs'), input, output]) === null) {
    const f = lastRunFailure();
    fail(`build-cv-latex.mjs crashed (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
  } else if (!existsSync(output)) {
    fail('build-cv-latex.mjs exited 0 but wrote no output file');
  } else {
    const tex = readFileSync(output, 'utf-8');
    const missing = [
      ['experience dates', '2024'],
      ['education dates', '2019'],
      ['award year', '2025'],
      ['project dates', '2023'],
    ].filter(([, value]) => !tex.includes(value));

    missing.length === 0
      ? pass('numeric date/year scalars render into the .tex instead of vanishing')
      : fail(`numeric scalars dropped from the .tex: ${missing.map(([what, v]) => `${what} (${v})`).join(', ')}`);

    // The empty-field shape this produced, asserted directly: a dropped date
    // leaves `{Corp}{}` rather than `{Corp}{2024}`.
    /\{Corp\}\{2024\}/.test(tex)
      ? pass('the experience subheading carries its date rather than an empty brace pair')
      : fail(`experience subheading lost its date: ${(tex.match(/\{Corp\}\{[^}]*\}/) || ['(not found)'])[0]}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
